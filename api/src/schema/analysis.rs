//! Site-analysis resolvers (Phase 1): CRUD for the `analysis` record + duplicate.
//! Everything is Crew-gated (`Feature::SiteAnalysis`) and org/project scoped;
//! mutations also require an editor role + an active subscription. No compute yet —
//! `create`/`update` persist a drawn `draft`; the per-type run mutations land in
//! later phases.
use serde_json::{json, Value};

use super::*;
use crate::analysis::{parking, turning};
use crate::models::{
    Analysis, AnalysisInput, AnalysisStatus, AnalysisType, ParkingInput, TurningInput,
    VehicleTemplate, VehicleTemplateInput,
};

/// Read columns for an `analysis` row, in the order [`row_to_analysis`] expects.
const ANALYSIS_COLUMNS: &str = "id, project_id, type, name, status, params, input_geometry, \
     result, result_geometry, error, created_at, updated_at";

type AnalysisRow = (
    Uuid,           // id
    Uuid,           // project_id
    String,         // type
    String,         // name
    String,         // status
    Value,          // params (jsonb)
    Option<Value>,  // input_geometry (jsonb)
    Value,          // result (jsonb)
    Option<Value>,  // result_geometry (jsonb)
    Option<String>, // error
    DateTime<Utc>,  // created_at
    DateTime<Utc>,  // updated_at
);

fn row_to_analysis(r: AnalysisRow) -> Analysis {
    Analysis {
        id: r.0,
        project_id: r.1,
        kind: AnalysisType::from_db_str(&r.2),
        name: r.3,
        status: AnalysisStatus::from_db_str(&r.4),
        params: r.5.to_string(),
        input_geometry: r.6.map(|v| v.to_string()),
        result: r.7.to_string(),
        result_geometry: r.8.map(|v| v.to_string()),
        error: r.9,
        created_at: r.10,
        updated_at: r.11,
    }
}

/// Parses a JSON-object string param (`params`), defaulting to `{}` on empty.
fn parse_json_object(s: &str) -> Result<Value> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(s).map_err(|e| async_graphql::Error::new(format!("invalid JSON: {e}")))
}

/// Parses an optional JSON geometry string.
fn parse_json_opt(s: &Option<String>) -> Result<Option<Value>> {
    match s.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Ok(Some(serde_json::from_str(s).map_err(|e| {
            async_graphql::Error::new(format!("invalid geometry JSON: {e}"))
        })?)),
        None => Ok(None),
    }
}

/// Resolves an analysis's project (org-scoped); errors if not in the org.
async fn analysis_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT a.project_id FROM analysis a JOIN projects p ON p.id = a.project_id \
         WHERE a.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(found_in_org(row, "analysis")?.0)
}

// --- Vehicle templates ------------------------------------------------------

const VEHICLE_COLUMNS: &str = "id, org_id, name, vehicle_class, wheelbase, front_overhang, \
     rear_overhang, width, max_steering_angle, lock_to_lock_time, source";

type VehicleRow = (
    Uuid,
    Option<Uuid>,
    String,
    String,
    f64,
    f64,
    f64,
    f64,
    f64,
    Option<f64>,
    Option<String>,
);

fn row_to_vehicle(r: VehicleRow) -> VehicleTemplate {
    VehicleTemplate {
        is_preset: r.1.is_none(),
        id: r.0,
        org_id: r.1,
        name: r.2,
        vehicle_class: r.3,
        wheelbase: r.4,
        front_overhang: r.5,
        rear_overhang: r.6,
        width: r.7,
        max_steering_angle: r.8,
        lock_to_lock_time: r.9,
        source: r.10,
    }
}

/// Parses a `[[e,n],…]` polyline string into planar points.
fn parse_polyline(s: &str) -> Result<Vec<[f64; 2]>> {
    serde_json::from_str(s.trim())
        .map_err(|e| async_graphql::Error::new(format!("invalid path JSON: {e}")))
}

/// Parses a `[[[e,n],…],…]` obstacle-set string.
fn parse_polylines(s: &str) -> Result<Vec<Vec<[f64; 2]>>> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(s)
        .map_err(|e| async_graphql::Error::new(format!("invalid obstacles JSON: {e}")))
}

/// JSON array of `[e,n]` points.
fn points_json(pts: &[[f64; 2]]) -> Value {
    Value::Array(pts.iter().map(|p| json!([p[0], p[1]])).collect())
}

#[derive(Default)]
pub struct AnalysisQuery;

#[Object]
impl AnalysisQuery {
    /// Every analysis in a project (newest first).
    async fn analyses(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<Analysis>> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<AnalysisRow> = sqlx::query_as(&format!(
            "SELECT {ANALYSIS_COLUMNS} FROM analysis WHERE project_id = $1 \
             ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_analysis).collect())
    }

    /// A single analysis by id (org-scoped).
    async fn analysis(&self, ctx: &Context<'_>, id: Uuid) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<AnalysisRow> = sqlx::query_as(&format!(
            "SELECT {} FROM analysis a JOIN projects p ON p.id = a.project_id \
             WHERE a.id = $1 AND p.org_id = $2",
            qualify_columns(ANALYSIS_COLUMNS, "a")
        ))
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(row_to_analysis(found_in_org(row, "analysis")?))
    }

    /// The vehicle library: global presets + the caller org's custom vehicles.
    async fn vehicle_templates(&self, ctx: &Context<'_>) -> Result<Vec<VehicleTemplate>> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let rows: Vec<VehicleRow> = sqlx::query_as(&format!(
            "SELECT {VEHICLE_COLUMNS} FROM vehicle_template \
             WHERE org_id IS NULL OR org_id = $1 \
             ORDER BY org_id NULLS FIRST, name"
        ))
        .bind(auth.org_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_vehicle).collect())
    }
}

#[derive(Default)]
pub struct AnalysisMutation;

#[Object]
impl AnalysisMutation {
    /// Creates a draft analysis from a drawn input + params.
    async fn create_analysis(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: AnalysisInput,
    ) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let params = parse_json_object(&input.params)?;
        let geometry = parse_json_opt(&input.input_geometry)?;
        let row: AnalysisRow = sqlx::query_as(&format!(
            "INSERT INTO analysis (project_id, type, name, status, params, input_geometry, created_by) \
             VALUES ($1, $2, $3, 'draft', $4, $5, $6) RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(project_id)
        .bind(input.kind.as_db_str())
        .bind(&input.name)
        .bind(sqlx::types::Json(params))
        .bind(geometry.map(sqlx::types::Json))
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }

    /// Updates a draft analysis's name / params / drawn input (resets it to draft).
    async fn update_analysis(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: AnalysisInput,
    ) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        analysis_in_org(pool, id, auth.org_id).await?;
        let params = parse_json_object(&input.params)?;
        let geometry = parse_json_opt(&input.input_geometry)?;
        let row: AnalysisRow = sqlx::query_as(&format!(
            "UPDATE analysis SET type = $2, name = $3, params = $4, input_geometry = $5, \
               status = 'draft', result = '{{}}', result_geometry = NULL, error = NULL, \
               updated_at = now() \
             WHERE id = $1 RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(id)
        .bind(input.kind.as_db_str())
        .bind(&input.name)
        .bind(sqlx::types::Json(params))
        .bind(geometry.map(sqlx::types::Json))
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }

    /// Deletes an analysis.
    async fn delete_analysis(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Uuid,)> = sqlx::query_as(
            "DELETE FROM analysis a USING projects p \
             WHERE a.id = $1 AND p.id = a.project_id AND p.org_id = $2 RETURNING a.id",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        found_in_org(row, "analysis")?;
        Ok(true)
    }

    /// Clones an analysis (input + params) as a fresh draft — informal scenarios.
    async fn duplicate_analysis(&self, ctx: &Context<'_>, id: Uuid) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        analysis_in_org(pool, id, auth.org_id).await?;
        // Copy type/name/params/input_geometry; reset status + results.
        let row: AnalysisRow = sqlx::query_as(&format!(
            "INSERT INTO analysis (project_id, type, name, status, params, input_geometry, created_by) \
             SELECT project_id, type, name || ' (copy)', 'draft', params, input_geometry, $2 \
             FROM analysis WHERE id = $1 RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(id)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }

    /// Creates a per-org custom vehicle.
    async fn create_vehicle_template(
        &self,
        ctx: &Context<'_>,
        input: VehicleTemplateInput,
    ) -> Result<VehicleTemplate> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: VehicleRow = sqlx::query_as(&format!(
            "INSERT INTO vehicle_template \
               (org_id, name, vehicle_class, wheelbase, front_overhang, rear_overhang, width, \
                max_steering_angle, lock_to_lock_time, source) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING {VEHICLE_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(&input.name)
        .bind(&input.vehicle_class)
        .bind(input.wheelbase)
        .bind(input.front_overhang)
        .bind(input.rear_overhang)
        .bind(input.width)
        .bind(input.max_steering_angle)
        .bind(input.lock_to_lock_time)
        .bind(&input.source)
        .fetch_one(pool)
        .await?;
        Ok(row_to_vehicle(row))
    }

    /// Updates one of the org's custom vehicles (presets are read-only).
    async fn update_vehicle_template(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: VehicleTemplateInput,
    ) -> Result<VehicleTemplate> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<VehicleRow> = sqlx::query_as(&format!(
            "UPDATE vehicle_template SET name = $2, vehicle_class = $3, wheelbase = $4, \
               front_overhang = $5, rear_overhang = $6, width = $7, max_steering_angle = $8, \
               lock_to_lock_time = $9, source = $10 \
             WHERE id = $1 AND org_id = $11 RETURNING {VEHICLE_COLUMNS}"
        ))
        .bind(id)
        .bind(&input.name)
        .bind(&input.vehicle_class)
        .bind(input.wheelbase)
        .bind(input.front_overhang)
        .bind(input.rear_overhang)
        .bind(input.width)
        .bind(input.max_steering_angle)
        .bind(input.lock_to_lock_time)
        .bind(&input.source)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(row_to_vehicle(found_in_org(row, "vehicle")?))
    }

    /// Deletes one of the org's custom vehicles (presets can't be deleted).
    async fn delete_vehicle_template(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Uuid,)> = sqlx::query_as(
            "DELETE FROM vehicle_template WHERE id = $1 AND org_id = $2 RETURNING id",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        found_in_org(row, "vehicle")?;
        Ok(true)
    }

    /// Runs a turning-radius analysis: tractrix swept path for the chosen vehicle
    /// along the drawn path, plus an obstacle-clearance pass/fail. Synchronous.
    async fn run_turning_analysis(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: TurningInput,
    ) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        // Load the vehicle (a global preset or the org's own custom vehicle).
        let vr: Option<VehicleRow> = sqlx::query_as(&format!(
            "SELECT {VEHICLE_COLUMNS} FROM vehicle_template \
             WHERE id = $1 AND (org_id IS NULL OR org_id = $2)"
        ))
        .bind(input.vehicle_template_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let vehicle = row_to_vehicle(found_in_org(vr, "vehicle")?);

        let path = parse_polyline(&input.path)?;
        let obstacles = parse_polylines(&input.obstacles)?;
        // Keep the obstacle geometry for the render blob (the closure moves the
        // parsed copy) so the client can show what a failing run clipped.
        let obstacles_json: Vec<Value> = obstacles
            .iter()
            .map(|line| Value::Array(line.iter().map(|p| json!([p[0], p[1]])).collect()))
            .collect();
        let v = turning::Vehicle {
            wheelbase: vehicle.wheelbase,
            front_overhang: vehicle.front_overhang,
            rear_overhang: vehicle.rear_overhang,
            width: vehicle.width,
        };
        let step = input.step_resolution;
        // CPU-bound geometry off the async runtime.
        let (swept, clips) = tokio::task::spawn_blocking(move || {
            turning::swept_path(&path, &v, step).map(|sp| {
                let clips = turning::clearance(&sp.bodies, &obstacles);
                (sp, clips)
            })
        })
        .await
        .map_err(|e| async_graphql::Error::new(format!("turning task failed: {e}")))?
        .map_err(async_graphql::Error::new)?;

        // A handful of vehicle footprints for context (drawn as outlines).
        let stride = (swept.bodies.len() / 24).max(1);
        let bodies: Vec<Value> = swept
            .bodies
            .iter()
            .step_by(stride)
            .map(|q| Value::Array(q.iter().map(|p| json!([p[0], p[1]])).collect()))
            .collect();

        // Full-res swept-edge curves (the corner paths) — inherently smooth from
        // the tractrix integration, so the client draws clean boundary/wheel
        // tracks with no staircase. Lightly decimated to keep the blob small.
        let e_stride = (swept.bodies.len() / 240).max(1);
        let corner = |k: usize| -> Vec<Value> {
            swept
                .bodies
                .iter()
                .step_by(e_stride)
                .map(|q| json!([q[k][0], q[k][1]]))
                .collect()
        };
        let edges = json!({
            "fl": corner(0),
            "fr": corner(1),
            "rr": corner(2),
            "rl": corner(3),
        });

        let pass = clips.is_empty();
        let result = json!({
            "pass": pass,
            "clipCount": clips.len(),
            "vehicle": vehicle.name,
        });
        let result_geometry = json!({
            "envelope": points_json(&swept.envelope),
            "frontTrack": points_json(&swept.front_track),
            "rearTrack": points_json(&swept.rear_track),
            "bodies": bodies,
            "edges": edges,
            "clips": points_json(&clips),
            "obstacles": obstacles_json,
        });
        let params = json!({
            "vehicleTemplateId": input.vehicle_template_id,
            "stepResolution": step,
        });
        // The drawn path, stored verbatim as the analysis input geometry.
        let input_geo: Value =
            serde_json::from_str(input.path.trim()).unwrap_or_else(|_| json!([]));

        let row: AnalysisRow = sqlx::query_as(&format!(
            "INSERT INTO analysis \
               (project_id, type, name, status, params, input_geometry, result, result_geometry, created_by) \
             VALUES ($1, 'turning', $2, 'complete', $3, $4, $5, $6, $7) RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(project_id)
        .bind(&input.name)
        .bind(sqlx::types::Json(params))
        .bind(sqlx::types::Json(input_geo))
        .bind(sqlx::types::Json(result))
        .bind(sqlx::types::Json(result_geometry))
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }

    /// Runs a parking analysis: tiles stalls along the drawn bays at the given
    /// module + angle, counts them, and checks the ADA §208 accessible-stall
    /// requirement and an optional required-count. Synchronous.
    async fn run_parking_analysis(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: ParkingInput,
    ) -> Result<Analysis> {
        require_feature(ctx, Feature::SiteAnalysis).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let bays = parse_polylines(&input.bays)?;
        // Keep a JSON copy of the drawn bays for the render blob + input geometry
        // (the parsed copy moves into the compute closure).
        let bays_json: Vec<Value> = bays.iter().map(|line| points_json(line)).collect();
        let spec = parking::StallSpec {
            length: input.stall_length,
            width: input.stall_width,
            angle_deg: input.angle,
        };
        // CPU-bound tiling off the async runtime.
        let layout = tokio::task::spawn_blocking(move || parking::tile_bays(&bays, &spec))
            .await
            .map_err(|e| async_graphql::Error::new(format!("parking task failed: {e}")))?
            .map_err(async_graphql::Error::new)?;

        let count = layout.stalls.len() as u32;
        let ada = parking::ada_required(count);
        let van = parking::van_required(ada);

        // Code checks: each is `None` (not configured) until the user supplies an
        // input, so an unconfigured check never fails the run.
        let ratio_pass = input.required_count.map(|rc| count as i32 >= rc);
        let accessible = input.accessible_provided.map(|a| a.max(0) as u32);
        let ada_pass = accessible.map(|a| a >= ada);
        let pass = ratio_pass.unwrap_or(true) && ada_pass.unwrap_or(true);

        let stalls: Vec<Value> = layout.stalls.iter().map(|q| points_json(q)).collect();
        let result = json!({
            "pass": pass,
            "stallCount": count,
            "adaRequired": ada,
            "adaVanRequired": van,
            "accessibleProvided": input.accessible_provided,
            "adaPass": ada_pass,
            "requiredCount": input.required_count,
            "ratioPass": ratio_pass,
            "moduleDepth": layout.module_depth,
        });
        let result_geometry = json!({
            "stalls": stalls,
            "bays": bays_json.clone(),
        });
        let params = json!({
            "stallLength": input.stall_length,
            "stallWidth": input.stall_width,
            "angle": input.angle,
            "aisleWidth": input.aisle_width,
            "oneWay": input.one_way,
            "requiredCount": input.required_count,
            "accessibleProvided": input.accessible_provided,
        });
        // The drawn bays, stored verbatim as the analysis input geometry.
        let input_geo = Value::Array(bays_json);

        let row: AnalysisRow = sqlx::query_as(&format!(
            "INSERT INTO analysis \
               (project_id, type, name, status, params, input_geometry, result, result_geometry, created_by) \
             VALUES ($1, 'parking', $2, 'complete', $3, $4, $5, $6, $7) RETURNING {ANALYSIS_COLUMNS}"
        ))
        .bind(project_id)
        .bind(&input.name)
        .bind(sqlx::types::Json(params))
        .bind(sqlx::types::Json(input_geo))
        .bind(sqlx::types::Json(result))
        .bind(sqlx::types::Json(result_geometry))
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_analysis(row))
    }
}
