use base64::Engine as _;

use super::*;
use crate::field;
use crate::models::{CodeField, FieldExportResult, FieldPresetInfo};

#[derive(Default)]
pub struct FieldQuery;

#[Object]
impl FieldQuery {
    /// The curated field-app export presets, for the export picker.
    async fn field_export_presets(&self, ctx: &Context<'_>) -> Result<Vec<FieldPresetInfo>> {
        require_auth(ctx)?;
        Ok(field::presets()
            .into_iter()
            .map(|p| FieldPresetInfo {
                id: p.id.to_string(),
                app: p.app.to_string(),
                format: p.format,
                default_space: p.default_space,
                default_unit: p.default_unit,
                description: p.description.to_string(),
            })
            .collect())
    }

    /// Encodes the project's points in a field-app preset's native format,
    /// returning a downloadable blob. Space and unit default to the preset's.
    /// Filter by explicit `pointIds` and/or `categoryId` (all points if neither).
    async fn export_field(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        preset_id: String,
        space: Option<ExportSpace>,
        unit: Option<LengthUnit>,
        point_ids: Option<Vec<Uuid>>,
        category_id: Option<Uuid>,
        code_field: Option<CodeField>,
    ) -> Result<FieldExportResult> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;

        let preset = field::preset_by_id(&preset_id)
            .ok_or_else(|| async_graphql::Error::new(format!("unknown preset '{preset_id}'")))?;
        let space = space.unwrap_or(preset.default_space);
        let unit = unit.unwrap_or(preset.default_unit);
        let code_field = code_field.unwrap_or(CodeField::Description);

        // Org-scoped CRS load doubles as the project ownership check.
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

        // Points + optional category name (for the Category code field).
        type Row = (String, f64, f64, Option<f64>, String, Option<String>);
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT sp.label, sp.northing, sp.easting, sp.elevation, sp.description, pc.name \
             FROM survey_points sp \
             LEFT JOIN point_categories pc ON sp.category_id = pc.id \
             WHERE sp.project_id = $1 \
               AND ($2::uuid[] IS NULL OR sp.id = ANY($2)) \
               AND ($3::uuid IS NULL OR sp.category_id = $3) \
             ORDER BY sp.created_at",
        )
        .bind(project_id)
        .bind(point_ids.as_deref())
        .bind(category_id)
        .fetch_all(pool)
        .await?;

        let export_points: Vec<ExportPoint> = rows
            .into_iter()
            .map(|(label, n_m, e_m, z_m, description, cat_name)| {
                let (north, east) = space_ne(space, e_m, n_m, csf, params, rotation, epsg, unit);
                let code = match code_field {
                    CodeField::Description => description,
                    CodeField::Category => cat_name.unwrap_or_default(),
                };
                ExportPoint {
                    name: label,
                    description: code,
                    northing: north,
                    easting: east,
                    elevation: z_m.map(|z| unit.from_meters(z)),
                }
            })
            .collect();

        // Resolve the filename before encoding so the non-Send codec box is not
        // held across an await.
        let base = export_basename(pool, project_id).await?;

        let content = {
            let codec = field::codec(preset.format, Some(&preset))
                .map_err(|e| async_graphql::Error::new(e.to_string()))?;
            codec.encode(&export_points)
        };
        Ok(FieldExportResult {
            filename: format!("{base}.{}", field::extension(preset.format)),
            mime_type: field::mime_type(preset.format).to_string(),
            content_base64: base64::engine::general_purpose::STANDARD.encode(content),
        })
    }
}

/// Northing/easting for the chosen export space, in `unit` (degrees for
/// geographic). Mirrors `coords::export_points`' space handling — kept local to
/// avoid reshaping that shipped resolver; unify if a third consumer appears.
fn space_ne(
    space: ExportSpace,
    e_m: f64,
    n_m: f64,
    csf: f64,
    params: Option<HelmertParams>,
    rotation: Option<convert::SiteRotation>,
    epsg: i32,
    unit: LengthUnit,
) -> (f64, f64) {
    match space {
        ExportSpace::ProjectedGrid => (unit.from_meters(n_m), unit.from_meters(e_m)),
        ExportSpace::ProjectedGround => (unit.from_meters(n_m / csf), unit.from_meters(e_m / csf)),
        ExportSpace::Grid => {
            let (x, y) = params.map(|t| t.inverse(e_m, n_m)).unwrap_or((0.0, 0.0));
            (unit.from_meters(y), unit.from_meters(x))
        }
        ExportSpace::Geographic => {
            let (te, tn) = rotation.map_or((e_m, n_m), |r| r.to_true(e_m, n_m));
            let (lat, lon) = crs::projected_to_geographic(epsg, te, tn).unwrap_or((0.0, 0.0));
            (lat, lon)
        }
    }
}

/// A filesystem-safe basename for an export file, from the project's name.
async fn export_basename(pool: &PgPool, project_id: Uuid) -> Result<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT name FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    let name = row.map(|(n,)| n).unwrap_or_default();
    let slug: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    Ok(if slug.is_empty() {
        "points".to_string()
    } else {
        slug
    })
}
