use base64::Engine as _;

use super::*;
use crate::field::compare::{self, AsBuiltPoint, DesignPoint, MatchMethod, Tolerance};
use crate::field::{self, FieldFormat};
use crate::import::ParsedPoint;
use crate::models::{
    AsBuiltBatch, BaselineScope, CodeField, Comparison, ComparisonRow, ComparisonStatus,
    ComparisonSummary, DetectedFormat, FieldExportResult, FieldMatchMethod, FieldPresetInfo,
    FileBlob, ToleranceInput,
};

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
             WHERE sp.project_id = $1 AND sp.point_type = 'design' \
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

    /// All as-built comparison batches for a project (newest first).
    async fn as_built_batches(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<AsBuiltBatch>> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<AsBuiltBatchRow> = sqlx::query_as(&format!(
            "SELECT {AS_BUILT_BATCH_COLUMNS} FROM as_built_batches \
             WHERE project_id = $1 ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// A single comparison: batch metadata + per-point rows + summary stats.
    async fn comparison(&self, ctx: &Context<'_>, batch_id: Uuid) -> Result<Comparison> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        let batch = load_batch_in_org(pool, batch_id, auth.org_id).await?;
        // CRS for converting the stored projected meters into geographic coords
        // the 3D scene overlay can place.
        let ProjectCrs { epsg, rotation, .. } =
            load_project_crs(pool, batch.project_id, auth.org_id).await?;
        let rows = load_comparison_rows(pool, batch_id, epsg, rotation).await?;
        let summary = summarize_rows(&rows);
        Ok(Comparison {
            batch,
            rows,
            summary,
        })
    }

    /// The stakeout comparison as a downloadable CSV (report unit).
    async fn comparison_report_csv(&self, ctx: &Context<'_>, batch_id: Uuid) -> Result<FileBlob> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        let batch = load_batch_in_org(pool, batch_id, auth.org_id).await?;
        let ProjectCrs { epsg, rotation, .. } =
            load_project_crs(pool, batch.project_id, auth.org_id).await?;
        let rows = load_comparison_rows(pool, batch_id, epsg, rotation).await?;
        let csv = field::report::comparison_csv(&rows, batch.report_unit);
        let base = export_basename(pool, batch.project_id).await?;
        Ok(FileBlob {
            filename: format!("{base}-stakeout.csv"),
            mime_type: "text/csv".to_string(),
            content_base64: base64::engine::general_purpose::STANDARD.encode(csv),
        })
    }

    /// The stakeout comparison as a downloadable PDF (rendered by the shared
    /// WeasyPrint report service).
    async fn comparison_report_pdf(&self, ctx: &Context<'_>, batch_id: Uuid) -> Result<FileBlob> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        let batch = load_batch_in_org(pool, batch_id, auth.org_id).await?;
        let ProjectCrs { epsg, rotation, .. } =
            load_project_crs(pool, batch.project_id, auth.org_id).await?;
        let rows = load_comparison_rows(pool, batch_id, epsg, rotation).await?;
        let summary = summarize_rows(&rows);
        let name = project_name(pool, batch.project_id).await?;
        let now = chrono::Utc::now();
        let html = field::report::comparison_html(
            &name,
            unit_label(batch.report_unit),
            &batch,
            &rows,
            &summary,
            batch.report_unit,
            &now.format("%Y-%m-%d").to_string(),
            &now.format("%Y").to_string(),
        );
        let pdf = render_pdf(&html).await?;
        let base = export_basename(pool, batch.project_id).await?;
        Ok(FileBlob {
            filename: format!("{base}-stakeout.pdf"),
            mime_type: "application/pdf".to_string(),
            content_base64: base64::engine::general_purpose::STANDARD.encode(pdf),
        })
    }
}

/// Posts report HTML to the shared WeasyPrint service and returns the PDF bytes.
async fn render_pdf(html: &str) -> Result<Vec<u8>> {
    let base =
        std::env::var("REPORT_SERVICE_URL").unwrap_or_else(|_| "http://localhost:8000".to_string());
    let url = format!("{}/render", base.trim_end_matches('/'));
    let body = serde_json::json!({ "html": html }).to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| async_graphql::Error::new(format!("report service unreachable: {e}")))?;
    if !resp.status().is_success() {
        return Err(async_graphql::Error::new(format!(
            "report service error: {}",
            resp.status()
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    Ok(bytes.to_vec())
}

/// The project's display name (empty string if missing).
async fn project_name(pool: &PgPool, project_id: Uuid) -> Result<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT name FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(n,)| n).unwrap_or_default())
}

/// Human-readable unit name for report headers.
fn unit_label(u: LengthUnit) -> &'static str {
    match u {
        LengthUnit::UsSurveyFoot => "US survey feet",
        LengthUnit::InternationalFoot => "international feet",
        LengthUnit::Meter => "meters",
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
/// Matches the web's convention (lowercase, non-alphanumeric runs → single `-`),
/// e.g. "Field Export" → "field-export".
async fn export_basename(pool: &PgPool, project_id: Uuid) -> Result<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT name FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    let name = row.map(|(n,)| n).unwrap_or_default();
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in name.chars() {
        if c.is_alphanumeric() {
            slug.extend(c.to_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    Ok(if slug.is_empty() {
        "points".to_string()
    } else {
        slug.to_string()
    })
}

#[derive(Default)]
pub struct FieldMutation;

#[Object]
impl FieldMutation {
    /// Sniffs an uploaded file's format (base64) for the import UI.
    async fn detect_field_format(
        &self,
        ctx: &Context<'_>,
        content_base64: String,
    ) -> Result<DetectedFormat> {
        require_auth(ctx)?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let content = decode_utf8(&content_base64)?;
        let format = field::detect(&content);
        Ok(DetectedFormat {
            format,
            // CSV is columnar — the caller must pick a preset/mapping to decode.
            needs_mapping: matches!(format, FieldFormat::Csv),
        })
    }

    /// Decodes an as-built file, compares it to a design baseline, snapshots the
    /// result, and returns the new batch. Coordinates arrive in `space`/`unit`
    /// (default projected-ground / US survey foot); CSV requires a `presetId`.
    async fn import_as_built(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        content_base64: String,
        filename: Option<String>,
        format: Option<FieldFormat>,
        preset_id: Option<String>,
        space: Option<ExportSpace>,
        unit: Option<LengthUnit>,
        baseline_scope: Option<BaselineScope>,
        baseline_ref_id: Option<Uuid>,
        tol_override: Option<ToleranceInput>,
        report_unit: Option<LengthUnit>,
    ) -> Result<AsBuiltBatch> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        let ProjectCrs {
            epsg,
            csf,
            params,
            rotation,
        } = load_project_crs(pool, project_id, auth.org_id).await?;

        let content = decode_utf8(&content_base64)?;
        let format = format.unwrap_or_else(|| field::detect(&content));
        let space = space.unwrap_or(ExportSpace::ProjectedGround);
        let unit = unit.unwrap_or(LengthUnit::UsSurveyFoot);
        let scope = baseline_scope.unwrap_or(BaselineScope::All);
        let report_unit = report_unit.unwrap_or(unit);
        if space == ExportSpace::Grid && params.is_none() {
            return Err(async_graphql::Error::new(
                "grid-space import requires a solved transform",
            ));
        }

        // Decode → ParsedPoint (in the file's space/unit). CSV needs a preset.
        let preset = match format {
            FieldFormat::Csv => Some(
                field::preset_by_id(preset_id.as_deref().unwrap_or("generic_csv"))
                    .ok_or_else(|| async_graphql::Error::new("unknown CSV preset"))?,
            ),
            _ => None,
        };
        let parsed: Vec<ParsedPoint> = {
            let codec = field::codec(format, preset.as_ref())
                .map_err(|e| async_graphql::Error::new(e.to_string()))?;
            codec
                .decode(&content)
                .map_err(|e| async_graphql::Error::new(e.to_string()))?
        };

        // Convert to canonical projected-grid meters.
        let as_builts: Vec<AsBuiltPoint> = parsed
            .iter()
            .map(|p| {
                let (n, e) = to_projected_grid(
                    space, p.northing, p.easting, unit, csf, params, rotation, epsg,
                );
                AsBuiltPoint {
                    label: p.label.clone(),
                    n,
                    e,
                    z: p.elevation.map(|z| unit.to_meters(z)),
                }
            })
            .collect();

        let tol = match &tol_override {
            Some(t) => Tolerance {
                h_warn: t.h_warn,
                h_fail: t.h_fail,
                v_warn: t.v_warn,
                v_fail: t.v_fail,
            },
            None => load_project_tol(pool, project_id).await?,
        };
        let designs = load_designs(pool, project_id, scope, baseline_ref_id).await?;
        let rows = compare::compare_all(&as_builts, &designs, &tol, csf, params);

        // Persist the batch (tolerance snapshot) + every comparison row.
        let mut tx = pool.begin().await?;
        let batch_row: AsBuiltBatchRow = sqlx::query_as(&format!(
            "INSERT INTO as_built_batches \
               (project_id, source_filename, format, imported_by, baseline_scope, \
                baseline_ref_id, delta_space, tol_h_warn, tol_h_fail, tol_v_warn, \
                tol_v_fail, report_unit) \
             VALUES ($1, $2, $3, $4, $5, $6, 'projected_ground', $7, $8, $9, $10, $11) \
             RETURNING {AS_BUILT_BATCH_COLUMNS}"
        ))
        .bind(project_id)
        .bind(filename.unwrap_or_default())
        .bind(format.as_db_str())
        .bind(auth.user_id)
        .bind(scope.as_db_str())
        .bind(baseline_ref_id)
        .bind(tol.h_warn)
        .bind(tol.h_fail)
        .bind(tol.v_warn)
        .bind(tol.v_fail)
        .bind(report_unit.as_db_str())
        .fetch_one(&mut *tx)
        .await?;

        for r in &rows {
            sqlx::query(
                "INSERT INTO as_built_comparisons \
                   (batch_id, as_built_label, as_built_n, as_built_e, as_built_z, \
                    design_point_id, design_n, design_e, design_z, match_method, \
                    delta_n, delta_e, delta_z, delta_h_radial, delta_grid_n, \
                    delta_grid_e, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, \
                         $15, $16, $17)",
            )
            .bind(batch_row.id)
            .bind(&r.as_built_label)
            .bind(r.as_built_n)
            .bind(r.as_built_e)
            .bind(r.as_built_z)
            .bind(r.design_id)
            .bind(r.design_n)
            .bind(r.design_e)
            .bind(r.design_z)
            .bind(r.match_method.as_db_str())
            .bind(r.delta_n)
            .bind(r.delta_e)
            .bind(r.delta_z)
            .bind(r.delta_h_radial)
            .bind(r.delta_grid_n)
            .bind(r.delta_grid_e)
            .bind(r.status.as_db_str())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(batch_row.into())
    }

    /// Manually re-pairs an as-built row to a chosen design point and recomputes
    /// that row's deltas against the (snapshotted) as-built coords + batch tolerance.
    async fn repair_comparison(
        &self,
        ctx: &Context<'_>,
        batch_id: Uuid,
        as_built_comp_id: Uuid,
        design_point_id: Uuid,
    ) -> Result<ComparisonRow> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        let batch = load_batch_in_org(pool, batch_id, auth.org_id).await?;
        let ProjectCrs { csf, params, .. } =
            load_project_crs(pool, batch.project_id, auth.org_id).await?;

        let comp: Option<ComparisonRowDb> = sqlx::query_as(&format!(
            "SELECT {AS_BUILT_COMPARISON_COLUMNS} FROM as_built_comparisons \
             WHERE id = $1 AND batch_id = $2"
        ))
        .bind(as_built_comp_id)
        .bind(batch_id)
        .fetch_optional(pool)
        .await?;
        let comp = found_in_org(comp, "comparison row")?;

        let design: Option<(Uuid, String, f64, f64, Option<f64>)> = sqlx::query_as(
            "SELECT id, label, northing, easting, elevation FROM survey_points \
             WHERE id = $1 AND project_id = $2 AND point_type = 'design'",
        )
        .bind(design_point_id)
        .bind(batch.project_id)
        .fetch_optional(pool)
        .await?;
        let (did, dlabel, dn, de, dz) = found_in_org(design, "design point")?;

        let tol = Tolerance {
            h_warn: batch.tol_h_warn,
            h_fail: batch.tol_h_fail,
            v_warn: batch.tol_v_warn,
            v_fail: batch.tol_v_fail,
        };
        let ab = AsBuiltPoint {
            label: comp.as_built_label.clone(),
            n: comp.as_built_n,
            e: comp.as_built_e,
            z: comp.as_built_z,
        };
        let design = DesignPoint {
            id: did,
            label: dlabel,
            n: dn,
            e: de,
            z: dz,
        };
        let re = compare::compare_one(&ab, Some(&design), MatchMethod::Manual, &tol, csf, params);

        let updated: ComparisonRowDb = sqlx::query_as(&format!(
            "UPDATE as_built_comparisons SET \
               design_point_id = $2, design_n = $3, design_e = $4, design_z = $5, \
               match_method = $6, delta_n = $7, delta_e = $8, delta_z = $9, \
               delta_h_radial = $10, delta_grid_n = $11, delta_grid_e = $12, status = $13 \
             WHERE id = $1 RETURNING {AS_BUILT_COMPARISON_COLUMNS}"
        ))
        .bind(as_built_comp_id)
        .bind(re.design_id)
        .bind(re.design_n)
        .bind(re.design_e)
        .bind(re.design_z)
        .bind(re.match_method.as_db_str())
        .bind(re.delta_n)
        .bind(re.delta_e)
        .bind(re.delta_z)
        .bind(re.delta_h_radial)
        .bind(re.delta_grid_n)
        .bind(re.delta_grid_e)
        .bind(re.status.as_db_str())
        .fetch_one(pool)
        .await?;
        Ok(updated.into())
    }

    /// Deletes an as-built batch and its comparison rows (cascade). Editor role.
    async fn delete_as_built_batch(&self, ctx: &Context<'_>, batch_id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        load_batch_in_org(pool, batch_id, auth.org_id).await?; // ownership check
        sqlx::query("DELETE FROM as_built_batches WHERE id = $1")
            .bind(batch_id)
            .execute(pool)
            .await?;
        Ok(true)
    }
}

const AS_BUILT_BATCH_COLUMNS: &str = "id, project_id, source_filename, format, baseline_scope, \
    baseline_ref_id, delta_space, tol_h_warn, tol_h_fail, tol_v_warn, tol_v_fail, report_unit, \
    created_at";

const AS_BUILT_COMPARISON_COLUMNS: &str = "id, as_built_label, as_built_n, as_built_e, \
    as_built_z, design_point_id, design_n, design_e, design_z, match_method, delta_n, delta_e, \
    delta_z, delta_h_radial, delta_grid_n, delta_grid_e, status";

#[derive(sqlx::FromRow)]
struct AsBuiltBatchRow {
    id: Uuid,
    project_id: Uuid,
    source_filename: String,
    format: String,
    baseline_scope: String,
    baseline_ref_id: Option<Uuid>,
    delta_space: String,
    tol_h_warn: f64,
    tol_h_fail: f64,
    tol_v_warn: f64,
    tol_v_fail: f64,
    report_unit: String,
    created_at: DateTime<Utc>,
}

impl From<AsBuiltBatchRow> for AsBuiltBatch {
    fn from(r: AsBuiltBatchRow) -> Self {
        AsBuiltBatch {
            id: r.id,
            project_id: r.project_id,
            source_filename: r.source_filename,
            format: FieldFormat::from_db_str(&r.format).unwrap_or(FieldFormat::Csv),
            baseline_scope: BaselineScope::from_db_str(&r.baseline_scope),
            baseline_ref_id: r.baseline_ref_id,
            delta_space: r.delta_space,
            tol_h_warn: r.tol_h_warn,
            tol_h_fail: r.tol_h_fail,
            tol_v_warn: r.tol_v_warn,
            tol_v_fail: r.tol_v_fail,
            report_unit: LengthUnit::from_db_str(&r.report_unit).unwrap_or(LengthUnit::Meter),
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ComparisonRowDb {
    id: Uuid,
    as_built_label: String,
    as_built_n: f64,
    as_built_e: f64,
    as_built_z: Option<f64>,
    design_point_id: Option<Uuid>,
    design_n: Option<f64>,
    design_e: Option<f64>,
    design_z: Option<f64>,
    match_method: String,
    delta_n: Option<f64>,
    delta_e: Option<f64>,
    delta_z: Option<f64>,
    delta_h_radial: Option<f64>,
    delta_grid_n: Option<f64>,
    delta_grid_e: Option<f64>,
    status: String,
}

impl From<ComparisonRowDb> for ComparisonRow {
    fn from(r: ComparisonRowDb) -> Self {
        ComparisonRow {
            id: r.id,
            as_built_label: r.as_built_label,
            as_built_n: r.as_built_n,
            as_built_e: r.as_built_e,
            as_built_z: r.as_built_z,
            design_point_id: r.design_point_id,
            design_n: r.design_n,
            design_e: r.design_e,
            design_z: r.design_z,
            match_method: FieldMatchMethod::from_db_str(&r.match_method),
            delta_n: r.delta_n,
            delta_e: r.delta_e,
            delta_z: r.delta_z,
            delta_h_radial: r.delta_h_radial,
            delta_grid_n: r.delta_grid_n,
            delta_grid_e: r.delta_grid_e,
            status: ComparisonStatus::from_db_str(&r.status),
            // Geographic coords are filled by `load_comparison_rows` (needs CRS).
            as_built_latitude: None,
            as_built_longitude: None,
            as_built_height: None,
            design_latitude: None,
            design_longitude: None,
            design_height: None,
        }
    }
}

/// Decodes base64 content to a bounded UTF-8 string (reuses the import size cap).
fn decode_utf8(content_base64: &str) -> Result<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|_| async_graphql::Error::new("invalid base64 content"))?;
    if bytes.len() > crate::import::MAX_BYTES {
        return Err(async_graphql::Error::new(
            "file exceeds the maximum allowed size",
        ));
    }
    String::from_utf8(bytes).map_err(|_| async_graphql::Error::new("file is not valid UTF-8"))
}

/// Inverse of [`space_ne`]: takes a coordinate in `space`/`unit` and returns
/// canonical projected-grid meters `(northing, easting)`.
fn to_projected_grid(
    space: ExportSpace,
    n_in: f64,
    e_in: f64,
    unit: LengthUnit,
    csf: f64,
    params: Option<HelmertParams>,
    rotation: Option<convert::SiteRotation>,
    epsg: i32,
) -> (f64, f64) {
    match space {
        ExportSpace::ProjectedGrid => (unit.to_meters(n_in), unit.to_meters(e_in)),
        // ground → grid: grid = ground * csf.
        ExportSpace::ProjectedGround => (unit.to_meters(n_in) * csf, unit.to_meters(e_in) * csf),
        ExportSpace::Grid => {
            // Input is building-grid y (northing) / x (easting) → projected.
            let x = unit.to_meters(e_in);
            let y = unit.to_meters(n_in);
            match params {
                Some(t) => {
                    let (pe, pn) = t.apply(x, y);
                    (pn, pe)
                }
                None => (y, x),
            }
        }
        ExportSpace::Geographic => {
            // n_in = latitude, e_in = longitude (degrees). Convert handles the
            // site rotation at the projected↔geographic boundary.
            let set = convert::convert_with_rotation(
                convert::Space::Geographic,
                e_in,
                n_in,
                params,
                epsg,
                csf,
                rotation,
            );
            (
                set.projected_grid_n.unwrap_or(0.0),
                set.projected_grid_e.unwrap_or(0.0),
            )
        }
    }
}

/// Loads the design baseline points (canonical meters) for a comparison scope.
async fn load_designs(
    pool: &PgPool,
    project_id: Uuid,
    scope: BaselineScope,
    ref_id: Option<Uuid>,
) -> Result<Vec<DesignPoint>> {
    let base = "SELECT id, label, northing, easting, elevation FROM survey_points \
                WHERE project_id = $1 AND point_type = 'design'";
    type Row = (Uuid, String, f64, f64, Option<f64>);
    let rows: Vec<Row> = match scope {
        BaselineScope::All => {
            sqlx::query_as(base)
                .bind(project_id)
                .fetch_all(pool)
                .await?
        }
        BaselineScope::Category => {
            let cat = ref_id.ok_or_else(|| {
                async_graphql::Error::new("category baseline requires a baselineRefId")
            })?;
            sqlx::query_as(&format!("{base} AND category_id = $2"))
                .bind(project_id)
                .bind(cat)
                .fetch_all(pool)
                .await?
        }
        BaselineScope::Group => {
            let grp = ref_id.ok_or_else(|| {
                async_graphql::Error::new("group baseline requires a baselineRefId")
            })?;
            sqlx::query_as(&format!(
                "{base} AND id = ANY(COALESCE( \
                   (SELECT member_ids FROM point_groups WHERE id = $2 AND project_id = $1), \
                   ARRAY[]::uuid[]))"
            ))
            .bind(project_id)
            .bind(grp)
            .fetch_all(pool)
            .await?
        }
    };
    Ok(rows
        .into_iter()
        .map(|(id, label, n, e, z)| DesignPoint { id, label, n, e, z })
        .collect())
}

/// Loads a project's default tolerance spec (canonical meters).
async fn load_project_tol(pool: &PgPool, project_id: Uuid) -> Result<Tolerance> {
    let (h_warn, h_fail, v_warn, v_fail): (f64, f64, f64, f64) = sqlx::query_as(
        "SELECT tol_h_warn, tol_h_fail, tol_v_warn, tol_v_fail FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    Ok(Tolerance {
        h_warn,
        h_fail,
        v_warn,
        v_fail,
    })
}

/// Loads a batch, verifying it belongs to the caller's org via its project.
async fn load_batch_in_org(pool: &PgPool, batch_id: Uuid, org_id: Uuid) -> Result<AsBuiltBatch> {
    let row: Option<AsBuiltBatchRow> = sqlx::query_as(&format!(
        "SELECT {} FROM as_built_batches b JOIN projects p ON b.project_id = p.id \
         WHERE b.id = $1 AND p.org_id = $2",
        qualify_columns(AS_BUILT_BATCH_COLUMNS, "b")
    ))
    .bind(batch_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    found_in_org(row.map(Into::into), "comparison")
}

/// Loads all comparison rows for a batch (caller has verified batch ownership),
/// enriching each with geographic coords (via the project CRS) for the 3D overlay.
async fn load_comparison_rows(
    pool: &PgPool,
    batch_id: Uuid,
    epsg: i32,
    rotation: Option<convert::SiteRotation>,
) -> Result<Vec<ComparisonRow>> {
    let rows: Vec<ComparisonRowDb> = sqlx::query_as(&format!(
        "SELECT {AS_BUILT_COMPARISON_COLUMNS} FROM as_built_comparisons \
         WHERE batch_id = $1 ORDER BY created_at, as_built_label"
    ))
    .bind(batch_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|db| {
            let mut r: ComparisonRow = db.into();
            let (lat, lon) = to_geographic(r.as_built_e, r.as_built_n, epsg, rotation);
            r.as_built_latitude = Some(lat);
            r.as_built_longitude = Some(lon);
            r.as_built_height = Some(r.as_built_z.unwrap_or(0.0));
            if let (Some(dn), Some(de)) = (r.design_n, r.design_e) {
                let (dlat, dlon) = to_geographic(de, dn, epsg, rotation);
                r.design_latitude = Some(dlat);
                r.design_longitude = Some(dlon);
                r.design_height = Some(r.design_z.unwrap_or(0.0));
            }
            r
        })
        .collect())
}

/// Projected-grid meters → geographic (lat, lon) degrees, un-rotating the site
/// rotation at the projected↔geographic boundary (mirrors the export path).
fn to_geographic(
    e_m: f64,
    n_m: f64,
    epsg: i32,
    rotation: Option<convert::SiteRotation>,
) -> (f64, f64) {
    let (te, tn) = rotation.map_or((e_m, n_m), |r| r.to_true(e_m, n_m));
    crs::projected_to_geographic(epsg, te, tn).unwrap_or((0.0, 0.0))
}

/// Status counts + horizontal miss (max/RMS) over comparison rows.
fn summarize_rows(rows: &[ComparisonRow]) -> ComparisonSummary {
    let mut s = ComparisonSummary {
        pass: 0,
        warn: 0,
        fail: 0,
        unmatched: 0,
        no_vertical: 0,
        max_miss: None,
        rms_miss: None,
    };
    let mut sum_sq = 0.0;
    let mut n = 0i64;
    let mut max: Option<f64> = None;
    for r in rows {
        match r.status {
            ComparisonStatus::Pass => s.pass += 1,
            ComparisonStatus::Warn => s.warn += 1,
            ComparisonStatus::Fail => s.fail += 1,
            ComparisonStatus::Unmatched => s.unmatched += 1,
            ComparisonStatus::NoVertical => s.no_vertical += 1,
        }
        if let Some(radial) = r.delta_h_radial {
            sum_sq += radial * radial;
            n += 1;
            max = Some(max.map_or(radial, |m: f64| m.max(radial)));
        }
    }
    s.max_miss = max;
    s.rms_miss = if n > 0 {
        Some((sum_sq / n as f64).sqrt())
    } else {
        None
    };
    s
}
