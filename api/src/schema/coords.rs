#![allow(clippy::too_many_arguments)]
use super::*;

#[derive(Default)]
pub struct CoordsQuery;

#[Object]
impl CoordsQuery {
    /// Converts a coordinate (given in `unit`, in the named `space`) into every
    /// derivable representation: grid, projected (grid + ground), and geographic.
    async fn convert_coordinate(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        space: CoordinateSpace,
        x: f64,
        y: f64,
        unit: LengthUnit,
    ) -> Result<CoordinateSet> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let crs = load_project_crs(pool, project_id, auth.org_id).await?;

        let space: Space = space.into();
        let (cx, cy) = normalize_input(space, x, y, unit);
        let result = convert::convert_with_rotation(
            space,
            cx,
            cy,
            crs.params,
            crs.epsg,
            crs.csf,
            crs.rotation,
        );
        Ok(result.into())
    }

    /// Searches the EPSG coordinate-reference-system catalog by code or name.
    async fn search_epsg(
        &self,
        ctx: &Context<'_>,
        query: String,
        limit: Option<i32>,
    ) -> Result<Vec<EpsgEntry>> {
        require_auth(ctx)?;
        let limit = limit.unwrap_or(25).clamp(1, 100) as usize;
        Ok(crs::search_epsg(&query, limit)
            .into_iter()
            .map(|(code, name)| EpsgEntry { code, name })
            .collect())
    }

    /// Exports points as CSV or LandXML in a chosen space + unit + column order.
    /// Filter by explicit `pointIds` and/or `categoryId` (all points if neither).
    async fn export_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: ExportFormat,
        space: ExportSpace,
        unit: LengthUnit,
        columns: Option<Vec<ExportColumn>>,
        point_ids: Option<Vec<Uuid>>,
        category_id: Option<Uuid>,
    ) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let ProjectCrs {
            epsg,
            csf,
            params,
            rotation,
        } = load_project_crs(pool, project_id, auth.org_id).await?;
        if space == ExportSpace::Grid && params.is_none() {
            return Err(async_graphql::Error::new(
                "grid export requires a solved transform",
            ));
        }

        type Row = (Uuid, String, f64, f64, Option<f64>, String);
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT id, label, northing, easting, elevation, description FROM survey_points \
             WHERE project_id = $1 \
               AND ($2::uuid[] IS NULL OR id = ANY($2)) \
               AND ($3::uuid IS NULL OR category_id = $3) \
             ORDER BY created_at",
        )
        .bind(project_id)
        .bind(point_ids.as_deref())
        .bind(category_id)
        .fetch_all(pool)
        .await?;

        let cols = columns.unwrap_or_else(|| {
            vec![
                ExportColumn::Point,
                ExportColumn::Northing,
                ExportColumn::Easting,
                ExportColumn::Elevation,
                ExportColumn::Description,
            ]
        });

        let fmt_lin = |v: f64| format!("{v:.4}");
        let fmt_deg = |v: f64| format!("{v:.8}");

        // Northing/easting for the chosen space, in the export unit (degrees for geographic).
        let space_ne = |e_m: f64, n_m: f64| -> (f64, f64) {
            match space {
                ExportSpace::ProjectedGrid => (unit.from_meters(n_m), unit.from_meters(e_m)),
                ExportSpace::ProjectedGround => {
                    (unit.from_meters(n_m / csf), unit.from_meters(e_m / csf))
                }
                ExportSpace::Grid => {
                    let (x, y) = params.map(|t| t.inverse(e_m, n_m)).unwrap_or((0.0, 0.0));
                    (unit.from_meters(y), unit.from_meters(x))
                }
                ExportSpace::Geographic => {
                    let (te, tn) = rotation.map_or((e_m, n_m), |r| r.to_true(e_m, n_m));
                    let (lat, lon) =
                        crs::projected_to_geographic(epsg, te, tn).unwrap_or((0.0, 0.0));
                    (lat, lon)
                }
            }
        };

        let mut csv_rows = Vec::with_capacity(rows.len());
        let mut xml_points = Vec::with_capacity(rows.len());
        for (_, label, n_m, e_m, z_m, description) in &rows {
            let (north, east) = space_ne(*e_m, *n_m);
            let (te, tn) = rotation.map_or((*e_m, *n_m), |r| r.to_true(*e_m, *n_m));
            let latlon = crs::projected_to_geographic(epsg, te, tn);
            let z_unit = z_m.map(|z| unit.from_meters(z));
            let is_geo = space == ExportSpace::Geographic;

            let cells: Vec<String> = cols
                .iter()
                .map(|c| match c {
                    ExportColumn::Point => label.clone(),
                    ExportColumn::Description => description.clone(),
                    ExportColumn::Northing => {
                        if is_geo {
                            fmt_deg(north)
                        } else {
                            fmt_lin(north)
                        }
                    }
                    ExportColumn::Easting => {
                        if is_geo {
                            fmt_deg(east)
                        } else {
                            fmt_lin(east)
                        }
                    }
                    ExportColumn::Elevation => z_unit.map(fmt_lin).unwrap_or_default(),
                    ExportColumn::Latitude => latlon.map(|(la, _)| fmt_deg(la)).unwrap_or_default(),
                    ExportColumn::Longitude => {
                        latlon.map(|(_, lo)| fmt_deg(lo)).unwrap_or_default()
                    }
                })
                .collect();
            csv_rows.push(cells);

            xml_points.push(ExportPoint {
                name: label.clone(),
                description: description.clone(),
                northing: north,
                easting: east,
                elevation: z_unit,
            });
        }

        Ok(match format {
            ExportFormat::Csv => {
                let headers: Vec<String> = cols.iter().map(column_header).collect();
                export::to_csv(&headers, &csv_rows)
            }
            ExportFormat::Landxml => export::to_landxml(&xml_points),
        })
    }
}
