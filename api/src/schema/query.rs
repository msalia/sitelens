#![allow(clippy::too_many_arguments)]
use super::*;

#[Object]
impl QueryRoot {
    /// Liveness check.
    async fn health(&self) -> &str {
        "ok"
    }

    /// Database connectivity check.
    async fn db_status(&self, ctx: &Context<'_>) -> String {
        match sqlx::query("SELECT 1").execute(pool(ctx).unwrap()).await {
            Ok(_) => "connected".to_string(),
            Err(_) => "disconnected".to_string(),
        }
    }

    /// Public runtime config the client needs (e.g. the shared Cesium Ion token).
    async fn public_config(&self, ctx: &Context<'_>) -> Result<PublicConfig> {
        let cfg = config(ctx)?;
        Ok(PublicConfig {
            cesium_ion_token: cfg.cesium_ion_token.clone(),
        })
    }

    /// The currently authenticated user, or null if not logged in.
    async fn me(&self, ctx: &Context<'_>) -> Result<Option<User>> {
        let Some(auth) = ctx.data_opt::<AuthContext>() else {
            return Ok(None);
        };
        let row: Option<UserRow> = sqlx::query_as(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE id = $1 AND org_id = $2"
        ))
        .bind(auth.user_id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        Ok(row.map(User::from))
    }

    /// All users in the caller's organization. Admin only.
    async fn users(&self, ctx: &Context<'_>) -> Result<Vec<User>> {
        let auth = require_admin(ctx)?;
        let rows: Vec<UserRow> = sqlx::query_as(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE org_id = $1 ORDER BY created_at"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows.into_iter().map(User::from).collect())
    }

    /// All projects in the caller's organization.
    async fn projects(&self, ctx: &Context<'_>) -> Result<Vec<Project>> {
        let auth = require_auth(ctx)?;
        let rows: Vec<ProjectRow> = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLUMNS} FROM projects WHERE org_id = $1 ORDER BY created_at DESC"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows.into_iter().map(Project::from).collect())
    }

    /// A single project by id, scoped to the caller's organization.
    async fn project(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<Project>> {
        let auth = require_auth(ctx)?;
        let row: Option<ProjectRow> = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLUMNS} FROM projects WHERE id = $1 AND org_id = $2"
        ))
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        Ok(row.map(Project::from))
    }

    /// The grid axes for a project, ordered by family then position.
    async fn grid_axes(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<GridAxis>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<GridAxisRow> = sqlx::query_as(
            "SELECT id, project_id, family, label, position FROM grid_axes \
             WHERE project_id = $1 ORDER BY family, position",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(GridAxis::from).collect())
    }

    /// The control points for a project.
    async fn control_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ControlPoint>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ControlPoint> = sqlx::query_as(&format!(
            "SELECT {CONTROL_POINT_COLUMNS} FROM control_points WHERE project_id = $1 ORDER BY created_at"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// The persisted Helmert transform for a project, if one has been solved.
    async fn transform(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Option<Transform>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row: Option<TransformRow> = sqlx::query_as(
            "SELECT translation_e, translation_n, rotation_rad, scale, rms_error, point_count, residuals \
             FROM transforms WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row.map(Transform::from))
    }

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
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (epsg, csf, rot_deg): (i32, f64, f64) = sqlx::query_as(
            "SELECT epsg_code, combined_scale_factor, site_origin_rotation_deg \
             FROM projects WHERE id = $1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?;
        let params = load_transform_params(pool, project_id).await?;
        let rotation = site_rotation(points_centroid(pool, project_id).await?, rot_deg);

        let space = match space {
            CoordinateSpace::Grid => Space::Grid,
            CoordinateSpace::Projected => Space::Projected,
            CoordinateSpace::Geographic => Space::Geographic,
        };
        // Geographic input is in degrees (x = lon, y = lat); everything else is a
        // linear measure in `unit` that we normalize to meters first.
        let (cx, cy) = match space {
            Space::Geographic => (x, y),
            _ => (unit.to_meters(x), unit.to_meters(y)),
        };
        let result = convert::convert_with_rotation(space, cx, cy, params, epsg, csf, rotation);
        Ok(result.into())
    }

    /// The caller organization's point categories (defaults + custom).
    async fn categories(&self, ctx: &Context<'_>) -> Result<Vec<PointCategory>> {
        let auth = require_auth(ctx)?;
        let rows: Vec<PointCategory> = sqlx::query_as(&format!(
            "SELECT {CATEGORY_COLUMNS} FROM point_categories WHERE org_id = $1 \
             ORDER BY is_default DESC, name"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows)
    }

    /// Surveyed points for a project, optionally filtered by free-text search
    /// (label/description/tags) and/or category. Paginated: `limit` is clamped to
    /// [1, 1000] (default 200) so the list query is always bounded.
    async fn survey_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        search: Option<String>,
        category_id: Option<Uuid>,
        group_id: Option<Uuid>,
        limit: Option<i64>,
        offset: Option<i64>,
        sort: Option<String>,
        descending: Option<bool>,
    ) -> Result<Vec<SurveyPoint>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        let offset = offset.unwrap_or(0).max(0);
        // Whitelist the sort column (never interpolate user input directly).
        let sort_col = match sort.as_deref() {
            Some("label") => "label",
            Some("northing") => "northing",
            Some("easting") => "easting",
            Some("elevation") => "elevation",
            _ => "seq",
        };
        let dir = if descending.unwrap_or(false) {
            "DESC"
        } else {
            "ASC"
        };
        let rows: Vec<SurveyPoint> = sqlx::query_as(&format!(
            "SELECT {SURVEY_POINT_COLUMNS} FROM survey_points WHERE project_id = $1 \
             AND ($2::text IS NULL OR label ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' \
                  OR array_to_string(tags, ' ') ILIKE '%'||$2||'%') \
             AND ($3::uuid IS NULL OR category_id = $3) \
             AND ($6::uuid IS NULL OR id = ANY(COALESCE( \
                  (SELECT member_ids FROM point_groups WHERE id = $6 AND project_id = $1), \
                  ARRAY[]::uuid[]))) \
             ORDER BY {sort_col} {dir} NULLS LAST, seq ASC LIMIT $4 OFFSET $5"
        ))
        .bind(project_id)
        .bind(search)
        .bind(category_id)
        .bind(limit)
        .bind(offset)
        .bind(group_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Total count of surveyed points matching the same filters as `surveyPoints`.
    /// Lets the UI paginate without fetching every row.
    async fn survey_point_count(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        search: Option<String>,
        category_id: Option<Uuid>,
        group_id: Option<Uuid>,
    ) -> Result<i64> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());
        let (count,): (i64,) = sqlx::query_as(
            "SELECT count(*) FROM survey_points WHERE project_id = $1 \
             AND ($2::text IS NULL OR label ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' \
                  OR array_to_string(tags, ' ') ILIKE '%'||$2||'%') \
             AND ($3::uuid IS NULL OR category_id = $3) \
             AND ($4::uuid IS NULL OR id = ANY(COALESCE( \
                  (SELECT member_ids FROM point_groups WHERE id = $4 AND project_id = $1), \
                  ARRAY[]::uuid[])))",
        )
        .bind(project_id)
        .bind(search)
        .bind(category_id)
        .bind(group_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// Import batches for a project.
    async fn import_batches(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ImportBatch>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ImportBatch> = sqlx::query_as(
            "SELECT id, project_id, source_filename, format, row_count FROM import_batches \
             WHERE project_id = $1 ORDER BY created_at DESC",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Saved CSV import profiles for a project.
    async fn import_profiles(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ImportProfile>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ImportProfileRow> = sqlx::query_as(
            "SELECT id, project_id, name, unit, mapping FROM import_profiles \
             WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(ImportProfile::from).collect())
    }

    /// Saved point groups (named selections) for a project.
    async fn point_groups(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<PointGroup>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<PointGroup> = sqlx::query_as(
            "SELECT id, project_id, name, member_ids FROM point_groups \
             WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// DXF overlays for a project.
    async fn cad_overlays(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<CadOverlay>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<CadOverlay> = sqlx::query_as(&format!(
            "SELECT {CAD_OVERLAY_COLUMNS} FROM cad_overlays WHERE project_id = $1 ORDER BY created_at"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// The raw DXF text of an overlay (for client-side parsing/rendering).
    async fn cad_overlay_content(&self, ctx: &Context<'_>, id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        let key = overlay_key_in_org(pool(ctx)?, id, auth.org_id).await?;
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        String::from_utf8(bytes)
            .map_err(|_| async_graphql::Error::new("overlay is not valid UTF-8"))
    }

    /// Exports a project as a self-contained `.slx` archive (JSON text) with all
    /// of its authored data. Re-import with `importProject`.
    async fn project_export(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        archive::export_project(pool, storage.as_ref(), project_id)
            .await
            .map_err(async_graphql::Error::new)
    }

    /// Cached OpenTopography terrain metadata for a project (null until first
    /// fetched). Drives the "Refresh terrain" 7-day cooldown on the client.
    async fn project_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<ProjectTerrain>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row = sqlx::query_as(&format!(
            "SELECT {TERRAIN_COLUMNS} FROM project_terrain WHERE project_id = $1"
        ))
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// Base64-encoded cached DEM GeoTIFF for the project's terrain.
    async fn project_terrain_content(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let key: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let Some((key,)) = key else {
            return Err(async_graphql::Error::new(
                "no terrain cached for this project",
            ));
        };
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    /// Cached OSM buildings metadata for a project (null when none fetched yet).
    async fn project_buildings(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<ProjectBuildings>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row = sqlx::query_as(&format!(
            "SELECT {BUILDINGS_COLUMNS} FROM project_buildings WHERE project_id = $1"
        ))
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// The cached building footprints as a JSON string:
    /// `[{"poly":[[lat,lon],...],"height":<m>}, ...]`.
    async fn project_buildings_content(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let key: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_buildings WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let Some((key,)) = key else {
            return Err(async_graphql::Error::new(
                "no buildings cached for this project",
            ));
        };
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
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
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (epsg, csf, rot_deg): (i32, f64, f64) = sqlx::query_as(
            "SELECT epsg_code, combined_scale_factor, site_origin_rotation_deg \
             FROM projects WHERE id = $1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?;
        let params = load_transform_params(pool, project_id).await?;
        let rotation = site_rotation(points_centroid(pool, project_id).await?, rot_deg);
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

    /// Everything the 3D viewer needs, pre-projected to geographic coordinates.
    async fn scene_data(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<SceneData> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (epsg, lat, lon, rot_deg): (i32, Option<f64>, Option<f64>, f64) = sqlx::query_as(
            "SELECT epsg_code, site_origin_lat, site_origin_lon, site_origin_rotation_deg \
             FROM projects WHERE id = $1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?;
        let params = load_transform_params(pool, project_id).await?;
        // The site spins about the centroid of all points, not the origin.
        let rotation = site_rotation(points_centroid(pool, project_id).await?, rot_deg);

        let to_scene = |id: Option<Uuid>,
                        label: String,
                        e: f64,
                        n: f64,
                        z: Option<f64>,
                        cat: Option<Uuid>|
         -> Option<ScenePoint> {
            // Rotate the stored projected coords to true earth for placement, but
            // keep the stored easting/northing on the point (the converter applies
            // the same rotation, so the inspector stays consistent).
            let (te, tn) = rotation.map_or((e, n), |r| r.to_true(e, n));
            crs::projected_to_geographic(epsg, te, tn).map(|(latitude, longitude)| ScenePoint {
                id,
                label,
                latitude,
                longitude,
                height: z.unwrap_or(0.0),
                easting: e,
                northing: n,
                category_id: cat,
            })
        };

        let cps: Vec<(String, f64, f64, Option<f64>)> = sqlx::query_as(
            "SELECT label, easting, northing, elevation FROM control_points \
             WHERE project_id = $1 ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let control_points: Vec<ScenePoint> = cps
            .into_iter()
            .filter_map(|(label, e, n, z)| to_scene(None, label, e, n, z, None))
            .collect();

        type SurveyRow = (Uuid, String, f64, f64, Option<f64>, Option<Uuid>);
        let sps: Vec<SurveyRow> = sqlx::query_as(
            "SELECT id, label, easting, northing, elevation, category_id FROM survey_points \
             WHERE project_id = $1 ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let survey_points: Vec<ScenePoint> = sps
            .into_iter()
            .filter_map(|(id, label, e, n, z, cat)| to_scene(Some(id), label, e, n, z, cat))
            .collect();

        // Grid lines need the transform to place axes in projected space.
        let mut grid_lines = Vec::new();
        if let Some(t) = params {
            let axes: Vec<(String, String, f64)> = sqlx::query_as(
                "SELECT family, label, position FROM grid_axes WHERE project_id = $1",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?;
            let span = |vals: Vec<f64>| -> (f64, f64) {
                if vals.is_empty() {
                    (-50.0, 50.0)
                } else {
                    let min = vals.iter().cloned().fold(f64::INFINITY, f64::min);
                    let max = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                    (min, max)
                }
            };
            let (xmin, xmax) = span(
                axes.iter()
                    .filter(|(f, _, _)| f == "numbered")
                    .map(|(_, _, p)| *p)
                    .collect(),
            );
            let (ymin, ymax) = span(
                axes.iter()
                    .filter(|(f, _, _)| f == "lettered")
                    .map(|(_, _, p)| *p)
                    .collect(),
            );
            for (family, label, pos) in &axes {
                let ends = if family == "lettered" {
                    [(xmin, *pos), (xmax, *pos)]
                } else {
                    [(*pos, ymin), (*pos, ymax)]
                };
                let coords: Vec<crate::models::LatLng> = ends
                    .iter()
                    .filter_map(|&(gx, gy)| {
                        let (e, n) = t.apply(gx, gy);
                        let (te, tn) = rotation.map_or((e, n), |r| r.to_true(e, n));
                        crs::projected_to_geographic(epsg, te, tn).map(|(latitude, longitude)| {
                            crate::models::LatLng {
                                latitude,
                                longitude,
                                height: 0.0,
                            }
                        })
                    })
                    .collect();
                if coords.len() == 2 {
                    grid_lines.push(SceneLine {
                        label: label.clone(),
                        coordinates: coords,
                    });
                }
            }
        }

        let origin = match (lat, lon) {
            (Some(latitude), Some(longitude)) => Some(crate::models::LatLng {
                latitude,
                longitude,
                height: 0.0,
            }),
            _ => control_points
                .first()
                .or(survey_points.first())
                .map(|p| crate::models::LatLng {
                    latitude: p.latitude,
                    longitude: p.longitude,
                    height: 0.0,
                }),
        };
        let origin_proj = match (lat, lon) {
            (Some(la), Some(lo)) => crs::geographic_to_projected(epsg, la, lo),
            _ => control_points
                .first()
                .or(survey_points.first())
                .map(|p| (p.easting, p.northing)),
        };

        Ok(SceneData {
            origin,
            origin_projected_e: origin_proj.map(|(e, _)| e),
            origin_projected_n: origin_proj.map(|(_, n)| n),
            site_rotation_deg: rot_deg,
            control_points,
            survey_points,
            grid_lines,
        })
    }
}
