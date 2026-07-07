//! As-built utility records: runs + structures CRUD, all audited + Crew-gated.
//! Geometry is snapshotted onto the run (immutable against survey-point edits);
//! derived length/slope come from `utilities::geom`.
#![allow(clippy::too_many_arguments)]
// The export resolver's sqlx row tuples are inherently wide.
#![allow(clippy::type_complexity)]
use chrono::NaiveDate;
use serde_json::{json, Value};

use super::*;
use crate::models::{
    FileBlob, UtilityAuditEntry, UtilityImportLayer, UtilityImportPreview, UtilityImportResult,
    UtilityInventory, UtilityLayerMapping, UtilityRun, UtilityRunInput, UtilityStructure,
    UtilityStructureInput, UtilityType, UtilityVertex, UtilityVertexInput,
};
use crate::units::LengthUnit;
use crate::utilities::import::{self, FeatureKind};
use crate::utilities::{audit, export as uexport, geom};

/// Posts report HTML to the shared WeasyPrint service; returns the PDF bytes.
async fn render_pdf(html: &str) -> Result<Vec<u8>> {
    let base =
        std::env::var("REPORT_SERVICE_URL").unwrap_or_else(|_| "http://localhost:8000".to_string());
    let url = format!("{}/render", base.trim_end_matches('/'));
    let body = json!({ "html": html }).to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(async_graphql::Error::new(format!(
            "report service error: {}",
            resp.status()
        )));
    }
    Ok(resp
        .bytes()
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?
        .to_vec())
}

/// Filename-safe slug from a project name (collapses non-alphanumerics to `-`).
fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Decode a base64 import payload to UTF-8 text.
fn decode_import(content_base64: &str) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.trim())
        .map_err(|_| async_graphql::Error::new("import payload is not valid base64"))?;
    String::from_utf8(bytes).map_err(|_| async_graphql::Error::new("import file is not UTF-8"))
}

/// Parse an import file ("dxf" | "geojson") into features.
fn parse_import(format: &str, text: &str) -> Result<Vec<import::ImportFeature>> {
    match format {
        "dxf" => import::parse_dxf(text).map_err(async_graphql::Error::new),
        "geojson" => import::parse_geojson(text, None).map_err(async_graphql::Error::new),
        other => Err(async_graphql::Error::new(format!(
            "unsupported import format: {other}"
        ))),
    }
}

fn kind_str(k: FeatureKind) -> &'static str {
    match k {
        FeatureKind::Line => "line",
        FeatureKind::Point => "point",
    }
}

const RUN_COLS: &str = "id, project_id, type_key, label, level, diameter, material, invert_up, \
    invert_down, slope, owner, install_date, condition, attrs_extra, tags, source, as_built_date, \
    locate_method, captured_at, created_at, updated_at";
const STRUCT_COLS: &str = "id, project_id, type_key, label, level, northing, easting, rim_elev, \
    inverts, material, owner, condition, attrs_extra, tags, source, as_built_date, locate_method, \
    source_point_id, captured_at, created_at, updated_at";

#[derive(sqlx::FromRow)]
struct RunRow {
    id: Uuid,
    project_id: Uuid,
    type_key: String,
    label: String,
    level: Option<String>,
    diameter: Option<f64>,
    material: Option<String>,
    invert_up: Option<f64>,
    invert_down: Option<f64>,
    slope: Option<f64>,
    owner: Option<String>,
    install_date: Option<NaiveDate>,
    condition: Option<String>,
    attrs_extra: Value,
    tags: Vec<String>,
    source: String,
    as_built_date: Option<NaiveDate>,
    locate_method: Option<String>,
    captured_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct VertexRow {
    seq: i32,
    northing: f64,
    easting: f64,
    elevation: Option<f64>,
    source_point_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct StructRow {
    id: Uuid,
    project_id: Uuid,
    type_key: String,
    label: String,
    level: Option<String>,
    northing: f64,
    easting: f64,
    rim_elev: Option<f64>,
    inverts: Value,
    material: Option<String>,
    owner: Option<String>,
    condition: Option<String>,
    attrs_extra: Value,
    tags: Vec<String>,
    source: String,
    as_built_date: Option<NaiveDate>,
    locate_method: Option<String>,
    source_point_id: Option<Uuid>,
    captured_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

fn to_vertex(v: VertexRow) -> UtilityVertex {
    UtilityVertex {
        seq: v.seq,
        northing: v.northing,
        easting: v.easting,
        elevation: v.elevation,
        source_point_id: v.source_point_id,
    }
}

fn to_run(r: RunRow, verts: Vec<VertexRow>) -> UtilityRun {
    let gverts: Vec<geom::Vertex> = verts
        .iter()
        .map(|v| geom::Vertex {
            northing: v.northing,
            easting: v.easting,
            elevation: v.elevation,
        })
        .collect();
    let length = (gverts.len() >= 2).then(|| geom::run_length_3d(&gverts));
    // Effective slope: the stored value, else derived from inverts over 2D length.
    let slope = r.slope.or_else(|| {
        geom::slope_from_inverts(r.invert_up, r.invert_down, geom::run_length_2d(&gverts))
    });
    UtilityRun {
        id: r.id,
        project_id: r.project_id,
        type_key: r.type_key,
        label: r.label,
        level: r.level,
        diameter: r.diameter,
        material: r.material,
        invert_up: r.invert_up,
        invert_down: r.invert_down,
        slope,
        owner: r.owner,
        install_date: r.install_date,
        condition: r.condition,
        attrs_extra: r.attrs_extra.to_string(),
        tags: r.tags,
        source: r.source,
        as_built_date: r.as_built_date,
        locate_method: r.locate_method,
        captured_at: r.captured_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        vertices: verts.into_iter().map(to_vertex).collect(),
        length,
    }
}

fn to_structure(s: StructRow) -> UtilityStructure {
    UtilityStructure {
        id: s.id,
        project_id: s.project_id,
        type_key: s.type_key,
        label: s.label,
        level: s.level,
        northing: s.northing,
        easting: s.easting,
        rim_elev: s.rim_elev,
        inverts: s.inverts.to_string(),
        material: s.material,
        owner: s.owner,
        condition: s.condition,
        attrs_extra: s.attrs_extra.to_string(),
        tags: s.tags,
        source: s.source,
        as_built_date: s.as_built_date,
        locate_method: s.locate_method,
        source_point_id: s.source_point_id,
        captured_at: s.captured_at,
        created_at: s.created_at,
        updated_at: s.updated_at,
    }
}

/// JSON snapshot of a run's audited attributes (for the audit diff).
fn run_snapshot(r: &RunRow) -> Value {
    json!({
        "type_key": r.type_key,
        "label": r.label,
        "level": r.level,
        "diameter": r.diameter,
        "material": r.material,
        "invert_up": r.invert_up,
        "invert_down": r.invert_down,
        "owner": r.owner,
        "condition": r.condition,
        "source": r.source,
        "tags": r.tags,
        "attrs_extra": r.attrs_extra,
    })
}

fn structure_snapshot(s: &StructRow) -> Value {
    json!({
        "type_key": s.type_key,
        "label": s.label,
        "level": s.level,
        "northing": s.northing,
        "easting": s.easting,
        "rim_elev": s.rim_elev,
        "inverts": s.inverts,
        "material": s.material,
        "owner": s.owner,
        "condition": s.condition,
        "source": s.source,
        "tags": s.tags,
        "attrs_extra": s.attrs_extra,
    })
}

fn parse_json(s: Option<String>, fallback: Value) -> Result<Value> {
    match s {
        Some(t) if !t.trim().is_empty() => serde_json::from_str(&t)
            .map_err(|e| async_graphql::Error::new(format!("invalid JSON: {e}"))),
        _ => Ok(fallback),
    }
}

async fn load_vertices(pool: &PgPool, run_id: Uuid) -> Result<Vec<VertexRow>> {
    Ok(sqlx::query_as(
        "SELECT seq, northing, easting, elevation, source_point_id FROM utility_vertices \
         WHERE run_id = $1 ORDER BY seq",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?)
}

/// A run's project id, verifying it's in the caller's org and not soft-deleted.
async fn run_project_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT r.project_id FROM utility_runs r JOIN projects p ON r.project_id = p.id \
         WHERE r.id = $1 AND p.org_id = $2 AND r.deleted_at IS NULL",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    found_in_org(row.map(|(p,)| p), "utility run")
}

async fn structure_project_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT s.project_id FROM utility_structures s JOIN projects p ON s.project_id = p.id \
         WHERE s.id = $1 AND p.org_id = $2 AND s.deleted_at IS NULL",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    found_in_org(row.map(|(p,)| p), "utility structure")
}

#[derive(Default)]
pub struct UtilitiesQuery;

#[Object]
impl UtilitiesQuery {
    /// The curated (APWA) utility type catalog.
    async fn utility_types(&self, ctx: &Context<'_>) -> Result<Vec<UtilityType>> {
        require_auth(ctx)?;
        Ok(sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT key, label, apwa_color, default_geometry FROM utility_types ORDER BY label",
        )
        .fetch_all(pool(ctx)?)
        .await?
        .into_iter()
        .map(|(key, label, apwa_color, default_geometry)| UtilityType {
            key,
            label,
            apwa_color,
            default_geometry,
        })
        .collect())
    }

    /// The project's utility inventory (runs + structures), filtered. When
    /// `limit` is set, the combined run+structure list is server-paginated by
    /// capture time (mirrors the survey-points table); pair it with `utilityCount`.
    async fn utilities(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        type_key: Option<String>,
        level: Option<String>,
        search: Option<String>,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> Result<UtilityInventory> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());

        // Page the combined inventory across both tables by capture time so a
        // page holds exactly `limit` items total. A NULL limit returns all.
        let page: Vec<(Uuid, String)> = sqlx::query_as(
            "SELECT id, kind FROM ( \
               SELECT id, 'run' AS kind, created_at, type_key, level, label, tags \
                 FROM utility_runs WHERE project_id = $1 AND deleted_at IS NULL \
               UNION ALL \
               SELECT id, 'structure' AS kind, created_at, type_key, level, label, tags \
                 FROM utility_structures WHERE project_id = $1 AND deleted_at IS NULL \
             ) u \
             WHERE ($2::text IS NULL OR type_key = $2) \
               AND ($3::text IS NULL OR level = $3) \
               AND ($4::text IS NULL OR label ILIKE '%'||$4||'%' \
                    OR array_to_string(tags, ' ') ILIKE '%'||$4||'%') \
             ORDER BY created_at LIMIT $5 OFFSET $6",
        )
        .bind(project_id)
        .bind(&type_key)
        .bind(&level)
        .bind(&search)
        .bind(limit.map(|l| l as i64))
        .bind(offset.unwrap_or(0).max(0) as i64)
        .fetch_all(pool)
        .await?;

        let run_ids: Vec<Uuid> = page
            .iter()
            .filter(|(_, k)| k.as_str() == "run")
            .map(|(id, _)| *id)
            .collect();
        let struct_ids: Vec<Uuid> = page
            .iter()
            .filter(|(_, k)| k.as_str() == "structure")
            .map(|(id, _)| *id)
            .collect();

        let run_rows: Vec<RunRow> = sqlx::query_as(&format!(
            "SELECT {RUN_COLS} FROM utility_runs WHERE id = ANY($1) ORDER BY created_at"
        ))
        .bind(&run_ids)
        .fetch_all(pool)
        .await?;

        let mut runs = Vec::with_capacity(run_rows.len());
        for r in run_rows {
            let verts = load_vertices(pool, r.id).await?;
            runs.push(to_run(r, verts));
        }

        let struct_rows: Vec<StructRow> = sqlx::query_as(&format!(
            "SELECT {STRUCT_COLS} FROM utility_structures WHERE id = ANY($1) ORDER BY created_at"
        ))
        .bind(&struct_ids)
        .fetch_all(pool)
        .await?;

        Ok(UtilityInventory {
            runs,
            structures: struct_rows.into_iter().map(to_structure).collect(),
        })
    }

    /// Combined count of runs + structures matching the inventory filters (for
    /// paging the inventory table).
    async fn utility_count(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        type_key: Option<String>,
        level: Option<String>,
        search: Option<String>,
    ) -> Result<i64> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());

        let (count,): (i64,) = sqlx::query_as(
            "SELECT count(*) FROM ( \
               SELECT created_at, type_key, level, label, tags FROM utility_runs \
                 WHERE project_id = $1 AND deleted_at IS NULL \
               UNION ALL \
               SELECT created_at, type_key, level, label, tags FROM utility_structures \
                 WHERE project_id = $1 AND deleted_at IS NULL \
             ) u \
             WHERE ($2::text IS NULL OR type_key = $2) \
               AND ($3::text IS NULL OR level = $3) \
               AND ($4::text IS NULL OR label ILIKE '%'||$4||'%' \
                    OR array_to_string(tags, ' ') ILIKE '%'||$4||'%')",
        )
        .bind(project_id)
        .bind(&type_key)
        .bind(&level)
        .bind(&search)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// A single run (with vertices + derived length/slope).
    async fn utility(&self, ctx: &Context<'_>, id: Uuid) -> Result<UtilityRun> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        run_project_in_org(pool, id, auth.org_id).await?;
        let row: RunRow = sqlx::query_as(&format!(
            "SELECT {RUN_COLS} FROM utility_runs WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        let verts = load_vertices(pool, id).await?;
        Ok(to_run(row, verts))
    }

    /// A single structure.
    async fn utility_structure(&self, ctx: &Context<'_>, id: Uuid) -> Result<UtilityStructure> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        structure_project_in_org(pool, id, auth.org_id).await?;
        let row: StructRow = sqlx::query_as(&format!(
            "SELECT {STRUCT_COLS} FROM utility_structures WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        Ok(to_structure(row))
    }

    /// The change history for a project (optionally a single entity), newest first.
    async fn utility_audit(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        entity_id: Option<Uuid>,
    ) -> Result<Vec<UtilityAuditEntry>> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        type Row = (
            Uuid,
            String,
            Uuid,
            String,
            Option<Uuid>,
            DateTime<Utc>,
            Value,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT id, entity_type, entity_id, action, changed_by, changed_at, diff \
             FROM utility_audit WHERE project_id = $1 AND ($2::uuid IS NULL OR entity_id = $2) \
             ORDER BY changed_at DESC",
        )
        .bind(project_id)
        .bind(entity_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(id, entity_type, entity_id, action, changed_by, changed_at, diff)| {
                    UtilityAuditEntry {
                        id,
                        entity_type,
                        entity_id,
                        action,
                        changed_by,
                        changed_at,
                        diff: diff.to_string(),
                    }
                },
            )
            .collect())
    }

    /// Parse an import file (base64 DXF / GeoJSON) and return its layers with
    /// auto-suggested APWA types, for the mapping UI. Read-only; nothing is saved.
    async fn preview_utility_import(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: String,
        content_base64: String,
    ) -> Result<UtilityImportPreview> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        ensure_project_in_org(pool(ctx)?, project_id, auth.org_id).await?;
        let text = decode_import(&content_base64)?;
        let features = parse_import(&format, &text)?;
        let layers = import::summarize(&features)
            .into_iter()
            .map(|s| UtilityImportLayer {
                layer: s.layer,
                kind: kind_str(s.kind).to_string(),
                count: s.count as i32,
                suggested_type: s.suggested_type,
            })
            .collect();
        Ok(UtilityImportPreview { layers })
    }

    /// Export the utility archive as a portable file. `format` ∈
    /// geojson|dxf|landxml|pdf; `type_key` optionally scopes to one type.
    /// GeoJSON is WGS84; DXF/LandXML/PDF use projected meters. Crew-gated.
    async fn export_utilities(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: String,
        type_key: Option<String>,
        search: Option<String>,
    ) -> Result<FileBlob> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());

        let crs = load_project_crs(pool, project_id, auth.org_id).await?;
        let epsg = crs.epsg;
        let rotation = crs.rotation;
        let name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(pool)
            .await?;
        let to_ll = |e: f64, n: f64| -> (f64, f64) {
            let (te, tn) = rotation.map_or((e, n), |r| r.to_true(e, n));
            crate::crs::projected_to_geographic(epsg, te, tn).unwrap_or((0.0, 0.0))
        };

        // APWA color per type (for the plan-view sheet + inventory swatches).
        let colors: std::collections::HashMap<String, String> =
            sqlx::query_as::<_, (String, String)>("SELECT key, apwa_color FROM utility_types")
                .fetch_all(pool)
                .await?
                .into_iter()
                .collect();
        let color_of = |tk: &str| colors.get(tk).cloned().unwrap_or_else(|| "#6b7280".into());
        // Whether an entity matches the active type/search filter — the "in the
        // inventory" set (colored in the plan, listed in the schedule). Mirrors the
        // former SQL filter; the whole network is fetched so the plan can draw the
        // rest in gray for context.
        let in_filter = |tk: &str, label: &str, tags: &[String]| -> bool {
            if let Some(t) = type_key.as_deref() {
                if tk != t {
                    return false;
                }
            }
            if let Some(s) = search.as_deref() {
                let sl = s.to_lowercase();
                if !(label.to_lowercase().contains(&sl)
                    || tags.iter().any(|t| t.to_lowercase().contains(&sl)))
                {
                    return false;
                }
            }
            true
        };

        // Runs (+ vertices) and structures — the whole network.
        let run_rows: Vec<(
            Uuid,
            String,
            String,
            Option<f64>,
            Option<String>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Vec<String>,
            Option<String>,
            String,
        )> = sqlx::query_as(
            "SELECT id, type_key, label, diameter, material, invert_up, invert_down, slope, tags, condition, source \
             FROM utility_runs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let mut ex_runs = Vec::with_capacity(run_rows.len());
        for (id, tk, label, diameter, material, iu, id_, slope, tags, condition, source) in run_rows
        {
            let vrows: Vec<(f64, f64, Option<f64>)> = sqlx::query_as(
                "SELECT northing, easting, elevation FROM utility_vertices \
                 WHERE run_id = $1 ORDER BY seq",
            )
            .bind(id)
            .fetch_all(pool)
            .await?;
            let gverts: Vec<geom::Vertex> = vrows
                .iter()
                .map(|&(n, e, z)| geom::Vertex {
                    northing: n,
                    easting: e,
                    elevation: z,
                })
                .collect();
            let length_m = (gverts.len() >= 2).then(|| geom::run_length_3d(&gverts));
            let vertices = vrows
                .into_iter()
                .map(|(n, e, z)| {
                    let (lat, lon) = to_ll(e, n);
                    uexport::ExVertex {
                        northing: n,
                        easting: e,
                        elevation: z,
                        lat,
                        lon,
                    }
                })
                .collect();
            let color = color_of(&tk);
            let report = in_filter(&tk, &label, &tags);
            ex_runs.push(uexport::ExRun {
                type_key: tk,
                label,
                material,
                diameter_m: diameter,
                invert_up: iu,
                invert_down: id_,
                slope,
                length_m,
                tags,
                vertices,
                color,
                condition,
                source,
                in_report: report,
            });
        }

        let struct_rows: Vec<(
            String,
            String,
            Option<String>,
            Option<f64>,
            f64,
            f64,
            Vec<String>,
            Option<String>,
            String,
        )> = sqlx::query_as(
            "SELECT type_key, label, material, rim_elev, northing, easting, tags, condition, source \
                 FROM utility_structures WHERE project_id = $1 AND deleted_at IS NULL \
                 ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let ex_structs: Vec<uexport::ExStruct> = struct_rows
            .into_iter()
            .map(
                |(tk, label, material, rim, n, e, tags, condition, source)| {
                    let (lat, lon) = to_ll(e, n);
                    let color = color_of(&tk);
                    let in_report = in_filter(&tk, &label, &tags);
                    uexport::ExStruct {
                        type_key: tk,
                        label,
                        material,
                        rim_elev: rim,
                        northing: n,
                        easting: e,
                        lat,
                        lon,
                        tags,
                        color,
                        condition,
                        source,
                        in_report,
                    }
                },
            )
            .collect();

        let base = {
            let s = slug(&name);
            if s.is_empty() {
                "utilities".to_string()
            } else {
                format!("{s}-utilities")
            }
        };
        use base64::Engine;
        let b64 = |bytes: Vec<u8>| base64::engine::general_purpose::STANDARD.encode(bytes);

        // GeoJSON/DXF/LandXML export the active inventory (filtered) set; the PDF
        // plan additionally renders the rest of the network in gray for context.
        let inv_runs: Vec<uexport::ExRun> =
            ex_runs.iter().filter(|r| r.in_report).cloned().collect();
        let inv_structs: Vec<uexport::ExStruct> =
            ex_structs.iter().filter(|s| s.in_report).cloned().collect();

        let (filename, mime, content) = match format.as_str() {
            "geojson" => (
                format!("{base}.geojson"),
                "application/geo+json".to_string(),
                b64(uexport::to_geojson(&inv_runs, &inv_structs).into_bytes()),
            ),
            "dxf" => (
                format!("{base}.dxf"),
                "application/dxf".to_string(),
                b64(uexport::to_dxf(&inv_runs, &inv_structs)
                    .map_err(async_graphql::Error::new)?
                    .into_bytes()),
            ),
            "landxml" => (
                format!("{base}.xml"),
                "application/xml".to_string(),
                b64(uexport::to_landxml(&inv_runs, &inv_structs).into_bytes()),
            ),
            "pdf" => {
                let now = chrono::Utc::now();
                // The project's building grid axes, plotted in grid space so the
                // plan overlays them like the 3D top view.
                let axes: Vec<(String, String, f64)> = sqlx::query_as(
                    "SELECT family, label, position FROM grid_axes WHERE project_id = $1",
                )
                .bind(project_id)
                .fetch_all(pool)
                .await?;
                let doc = uexport::schedule_document(
                    &name,
                    epsg,
                    crs.params,
                    &axes,
                    &ex_runs,
                    &ex_structs,
                    &now.format("%Y-%m-%d").to_string(),
                    &now.format("%Y").to_string(),
                );
                let pdf = render_pdf(&crate::report::render(&doc)).await?;
                (
                    format!("{base}-schedule.pdf"),
                    "application/pdf".to_string(),
                    b64(pdf),
                )
            }
            other => {
                return Err(async_graphql::Error::new(format!(
                    "unsupported export format: {other}"
                )))
            }
        };
        Ok(FileBlob {
            filename,
            mime_type: mime,
            content_base64: content,
        })
    }
}

#[derive(Default)]
pub struct UtilitiesMutation;

#[Object]
impl UtilitiesMutation {
    /// Creates a run with snapshotted vertices; logs a `create` audit entry.
    async fn create_utility_run(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: UtilityRunInput,
        vertices: Vec<UtilityVertexInput>,
    ) -> Result<UtilityRun> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let type_key = input
            .type_key
            .clone()
            .ok_or_else(|| async_graphql::Error::new("type_key is required"))?;
        if vertices.len() < 2 {
            return Err(async_graphql::Error::new(
                "a run needs at least two vertices",
            ));
        }
        let attrs = parse_json(input.attrs_extra.clone(), json!({}))?;

        let mut tx = pool.begin().await?;
        let row: RunRow = sqlx::query_as(&format!(
            "INSERT INTO utility_runs \
               (project_id, type_key, label, level, diameter, material, invert_up, invert_down, \
                owner, install_date, condition, attrs_extra, tags, source, as_built_date, \
                locate_method, captured_by) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) \
             RETURNING {RUN_COLS}"
        ))
        .bind(project_id)
        .bind(&type_key)
        .bind(input.label.unwrap_or_default())
        .bind(&input.level)
        .bind(input.diameter_inches.map(geom::inches_to_meters))
        .bind(&input.material)
        .bind(input.invert_up)
        .bind(input.invert_down)
        .bind(&input.owner)
        .bind(input.install_date)
        .bind(&input.condition)
        .bind(sqlx::types::Json(&attrs))
        .bind(input.tags.unwrap_or_default())
        .bind(input.source.unwrap_or_else(|| "field_survey".into()))
        .bind(input.as_built_date)
        .bind(&input.locate_method)
        .bind(auth.user_id)
        .fetch_one(&mut *tx)
        .await?;

        insert_vertices(&mut tx, row.id, &vertices).await?;
        audit::log(
            &mut *tx,
            project_id,
            "run",
            row.id,
            "create",
            Some(auth.user_id),
            &run_snapshot(&row),
        )
        .await?;
        tx.commit().await?;

        let verts = load_vertices(pool, row.id).await?;
        publish_scene(ctx, project_id);
        Ok(to_run(row, verts))
    }

    /// Updates a run's attributes (omitted fields keep their value); audited.
    async fn update_utility_run(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: UtilityRunInput,
    ) -> Result<UtilityRun> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        let project_id = run_project_in_org(pool, id, auth.org_id).await?;
        let before: RunRow = sqlx::query_as(&format!(
            "SELECT {RUN_COLS} FROM utility_runs WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        let attrs = match input.attrs_extra.clone() {
            Some(t) if !t.trim().is_empty() => Some(parse_json(Some(t), json!({}))?),
            _ => None,
        };

        let after: RunRow = sqlx::query_as(&format!(
            "UPDATE utility_runs SET \
               type_key = COALESCE($2, type_key), label = COALESCE($3, label), \
               level = COALESCE($4, level), diameter = COALESCE($5, diameter), \
               material = COALESCE($6, material), invert_up = COALESCE($7, invert_up), \
               invert_down = COALESCE($8, invert_down), owner = COALESCE($9, owner), \
               install_date = COALESCE($10, install_date), condition = COALESCE($11, condition), \
               attrs_extra = COALESCE($12, attrs_extra), tags = COALESCE($13, tags), \
               source = COALESCE($14, source), as_built_date = COALESCE($15, as_built_date), \
               locate_method = COALESCE($16, locate_method), updated_at = now() \
             WHERE id = $1 RETURNING {RUN_COLS}"
        ))
        .bind(id)
        .bind(&input.type_key)
        .bind(&input.label)
        .bind(&input.level)
        .bind(input.diameter_inches.map(geom::inches_to_meters))
        .bind(&input.material)
        .bind(input.invert_up)
        .bind(input.invert_down)
        .bind(&input.owner)
        .bind(input.install_date)
        .bind(&input.condition)
        .bind(attrs.map(sqlx::types::Json))
        .bind(input.tags)
        .bind(&input.source)
        .bind(input.as_built_date)
        .bind(&input.locate_method)
        .fetch_one(pool)
        .await?;

        let diff = audit::diff(&run_snapshot(&before), &run_snapshot(&after));
        audit::log(
            pool,
            project_id,
            "run",
            id,
            "update",
            Some(auth.user_id),
            &diff,
        )
        .await?;
        let verts = load_vertices(pool, id).await?;
        publish_scene(ctx, project_id);
        Ok(to_run(after, verts))
    }

    /// Replaces a run's geometry (re-snapshots vertices); audited.
    async fn update_utility_run_geometry(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        vertices: Vec<UtilityVertexInput>,
    ) -> Result<UtilityRun> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        let project_id = run_project_in_org(pool, id, auth.org_id).await?;
        if vertices.len() < 2 {
            return Err(async_graphql::Error::new(
                "a run needs at least two vertices",
            ));
        }
        let mut tx = pool.begin().await?;
        sqlx::query("DELETE FROM utility_vertices WHERE run_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        insert_vertices(&mut tx, id, &vertices).await?;
        sqlx::query("UPDATE utility_runs SET updated_at = now() WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        audit::log(
            &mut *tx,
            project_id,
            "run",
            id,
            "update",
            Some(auth.user_id),
            &json!({ "geometry": { "before": null, "after": format!("{} vertices", vertices.len()) } }),
        )
        .await?;
        tx.commit().await?;

        let row: RunRow = sqlx::query_as(&format!(
            "SELECT {RUN_COLS} FROM utility_runs WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        let verts = load_vertices(pool, id).await?;
        publish_scene(ctx, project_id);
        Ok(to_run(row, verts))
    }

    /// Creates a structure; audited.
    async fn create_utility_structure(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: UtilityStructureInput,
    ) -> Result<UtilityStructure> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let type_key = input
            .type_key
            .clone()
            .ok_or_else(|| async_graphql::Error::new("type_key is required"))?;
        let (Some(northing), Some(easting)) = (input.northing, input.easting) else {
            return Err(async_graphql::Error::new(
                "northing and easting are required",
            ));
        };
        let attrs = parse_json(input.attrs_extra.clone(), json!({}))?;
        let inverts = parse_json(input.inverts.clone(), json!([]))?;

        let row: StructRow = sqlx::query_as(&format!(
            "INSERT INTO utility_structures \
               (project_id, type_key, label, level, northing, easting, rim_elev, inverts, material, \
                owner, condition, attrs_extra, tags, source, as_built_date, locate_method, \
                source_point_id, captured_by) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) \
             RETURNING {STRUCT_COLS}"
        ))
        .bind(project_id)
        .bind(&type_key)
        .bind(input.label.unwrap_or_default())
        .bind(&input.level)
        .bind(northing)
        .bind(easting)
        .bind(input.rim_elev)
        .bind(sqlx::types::Json(&inverts))
        .bind(&input.material)
        .bind(&input.owner)
        .bind(&input.condition)
        .bind(sqlx::types::Json(&attrs))
        .bind(input.tags.unwrap_or_default())
        .bind(input.source.unwrap_or_else(|| "field_survey".into()))
        .bind(input.as_built_date)
        .bind(&input.locate_method)
        .bind(input.source_point_id)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;

        audit::log(
            pool,
            project_id,
            "structure",
            row.id,
            "create",
            Some(auth.user_id),
            &structure_snapshot(&row),
        )
        .await?;
        publish_scene(ctx, project_id);
        Ok(to_structure(row))
    }

    /// Updates a structure (omitted fields keep their value); audited.
    async fn update_utility_structure(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: UtilityStructureInput,
    ) -> Result<UtilityStructure> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        let project_id = structure_project_in_org(pool, id, auth.org_id).await?;
        let before: StructRow = sqlx::query_as(&format!(
            "SELECT {STRUCT_COLS} FROM utility_structures WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        let attrs = match input.attrs_extra.clone() {
            Some(t) if !t.trim().is_empty() => Some(parse_json(Some(t), json!({}))?),
            _ => None,
        };
        let inverts = match input.inverts.clone() {
            Some(t) if !t.trim().is_empty() => Some(parse_json(Some(t), json!([]))?),
            _ => None,
        };

        let after: StructRow = sqlx::query_as(&format!(
            "UPDATE utility_structures SET \
               type_key = COALESCE($2, type_key), label = COALESCE($3, label), \
               level = COALESCE($4, level), northing = COALESCE($5, northing), \
               easting = COALESCE($6, easting), rim_elev = COALESCE($7, rim_elev), \
               inverts = COALESCE($8, inverts), material = COALESCE($9, material), \
               owner = COALESCE($10, owner), condition = COALESCE($11, condition), \
               attrs_extra = COALESCE($12, attrs_extra), tags = COALESCE($13, tags), \
               source = COALESCE($14, source), as_built_date = COALESCE($15, as_built_date), \
               locate_method = COALESCE($16, locate_method), \
               source_point_id = COALESCE($17, source_point_id), updated_at = now() \
             WHERE id = $1 RETURNING {STRUCT_COLS}"
        ))
        .bind(id)
        .bind(&input.type_key)
        .bind(&input.label)
        .bind(&input.level)
        .bind(input.northing)
        .bind(input.easting)
        .bind(input.rim_elev)
        .bind(inverts.map(sqlx::types::Json))
        .bind(&input.material)
        .bind(&input.owner)
        .bind(&input.condition)
        .bind(attrs.map(sqlx::types::Json))
        .bind(input.tags)
        .bind(&input.source)
        .bind(input.as_built_date)
        .bind(&input.locate_method)
        .bind(input.source_point_id)
        .fetch_one(pool)
        .await?;

        let diff = audit::diff(&structure_snapshot(&before), &structure_snapshot(&after));
        audit::log(
            pool,
            project_id,
            "structure",
            id,
            "update",
            Some(auth.user_id),
            &diff,
        )
        .await?;
        publish_scene(ctx, project_id);
        Ok(to_structure(after))
    }

    /// Soft-deletes a run (audited).
    async fn delete_utility_run(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        let project_id = run_project_in_org(pool, id, auth.org_id).await?;
        sqlx::query("UPDATE utility_runs SET deleted_at = now() WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        audit::log(
            pool,
            project_id,
            "run",
            id,
            "delete",
            Some(auth.user_id),
            &json!({}),
        )
        .await?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    /// Soft-deletes a structure (audited).
    async fn delete_utility_structure(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        let project_id = structure_project_in_org(pool, id, auth.org_id).await?;
        sqlx::query("UPDATE utility_structures SET deleted_at = now() WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        audit::log(
            pool,
            project_id,
            "structure",
            id,
            "delete",
            Some(auth.user_id),
            &json!({}),
        )
        .await?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    /// Imports pre-drawn linework (base64 DXF / GeoJSON) as audited runs +
    /// structures, using a confirmed layer→type mapping. `space` is "geographic"
    /// (lon/lat, reprojected to the project CRS) or "projected" (easting/northing
    /// in `unit`). Unmapped layers are skipped. Crew-gated, editor role.
    async fn import_utilities(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: String,
        content_base64: String,
        mappings: Vec<UtilityLayerMapping>,
        space: String,
        unit: LengthUnit,
        source: Option<String>,
    ) -> Result<UtilityImportResult> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::Utilities).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let text = decode_import(&content_base64)?;
        let features = parse_import(&format, &text)?;
        let epsg = load_project_crs(pool, project_id, auth.org_id).await?.epsg;
        let geographic = space == "geographic";
        let src = match source.as_deref() {
            Some(s) if !s.trim().is_empty() => s.to_string(),
            _ => format.clone(),
        };

        // (layer, kind) → type_key, from mappings with a non-empty type.
        let map: std::collections::HashMap<(String, String), String> = mappings
            .into_iter()
            .filter_map(|m| {
                m.type_key
                    .filter(|t| !t.trim().is_empty())
                    .map(|t| ((m.layer, m.kind), t))
            })
            .collect();

        // Source (x, y) → canonical (northing, easting) meters, or None to skip.
        let to_ne = |x: f64, y: f64| -> Option<(f64, f64)> {
            if geographic {
                // GeoJSON order is [lon, lat].
                crate::crs::geographic_to_projected(epsg, y, x).map(|(e, n)| (n, e))
            } else {
                Some((unit.to_meters(y), unit.to_meters(x)))
            }
        };

        let mut runs_created = 0i32;
        let mut structures_created = 0i32;
        let mut skipped = 0i32;
        let mut tx = pool.begin().await?;

        for f in features {
            let key = (f.layer.clone(), kind_str(f.kind).to_string());
            let Some(type_key) = map.get(&key) else {
                skipped += 1;
                continue;
            };
            let label = f.label.clone().unwrap_or_else(|| type_key.clone());

            match f.kind {
                FeatureKind::Line => {
                    let verts: Vec<UtilityVertexInput> = f
                        .points
                        .iter()
                        .filter_map(|&(x, y)| {
                            to_ne(x, y).map(|(northing, easting)| UtilityVertexInput {
                                northing,
                                easting,
                                elevation: None,
                                source_point_id: None,
                            })
                        })
                        .collect();
                    if verts.len() < 2 {
                        skipped += 1;
                        continue;
                    }
                    let run_id: Uuid = sqlx::query_scalar(
                        "INSERT INTO utility_runs (project_id, type_key, label, source, captured_by) \
                         VALUES ($1, $2, $3, $4, $5) RETURNING id",
                    )
                    .bind(project_id)
                    .bind(type_key)
                    .bind(&label)
                    .bind(&src)
                    .bind(auth.user_id)
                    .fetch_one(&mut *tx)
                    .await?;
                    insert_vertices(&mut tx, run_id, &verts).await?;
                    audit::log(
                        &mut *tx,
                        project_id,
                        "run",
                        run_id,
                        "create",
                        Some(auth.user_id),
                        &json!({ "imported": { "format": format, "layer": f.layer } }),
                    )
                    .await?;
                    runs_created += 1;
                }
                FeatureKind::Point => {
                    let Some((northing, easting)) =
                        f.points.first().and_then(|&(x, y)| to_ne(x, y))
                    else {
                        skipped += 1;
                        continue;
                    };
                    let sid: Uuid = sqlx::query_scalar(
                        "INSERT INTO utility_structures \
                           (project_id, type_key, label, northing, easting, source, captured_by) \
                         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
                    )
                    .bind(project_id)
                    .bind(type_key)
                    .bind(&label)
                    .bind(northing)
                    .bind(easting)
                    .bind(&src)
                    .bind(auth.user_id)
                    .fetch_one(&mut *tx)
                    .await?;
                    audit::log(
                        &mut *tx,
                        project_id,
                        "structure",
                        sid,
                        "create",
                        Some(auth.user_id),
                        &json!({ "imported": { "format": format, "layer": f.layer } }),
                    )
                    .await?;
                    structures_created += 1;
                }
            }
        }

        tx.commit().await?;
        publish_scene(ctx, project_id);
        Ok(UtilityImportResult {
            runs_created,
            structures_created,
            skipped,
        })
    }
}

/// Inserts a run's vertices in order (seq = array index).
async fn insert_vertices(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    run_id: Uuid,
    vertices: &[UtilityVertexInput],
) -> Result<()> {
    for (i, v) in vertices.iter().enumerate() {
        sqlx::query(
            "INSERT INTO utility_vertices (run_id, seq, northing, easting, elevation, source_point_id) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(run_id)
        .bind(i as i32)
        .bind(v.northing)
        .bind(v.easting)
        .bind(v.elevation)
        .bind(v.source_point_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
