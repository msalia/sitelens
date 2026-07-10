#![allow(clippy::too_many_arguments)]
use super::*;

const PROJECT_COLUMNS: &str = "id, org_id, name, description, epsg_code, display_unit, \
    combined_scale_factor, site_origin_lat, site_origin_lon, site_origin_rotation_deg, \
    tol_h_warn, tol_h_fail, tol_v_warn, tol_v_fail, boundary, created_at, updated_at";

/// Blocks creating another project once a free org is at the Solo project cap.
async fn require_project_quota(ctx: &Context<'_>) -> Result<()> {
    let auth = require_auth(ctx)?;
    let b = crate::billing::org_billing(pool(ctx)?, auth.org_id).await?;
    if !b.paid() && b.projects >= Plan::Solo.limits().projects {
        return Err(async_graphql::Error::new(
            "The Solo plan is limited to 1 project. Upgrade to Crew for unlimited projects.",
        ));
    }
    Ok(())
}

#[derive(Default)]
pub struct ProjectQuery;

#[Object]
impl ProjectQuery {
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

    /// Looks up the property parcel containing the project's site origin from an
    /// **ArcGIS parcel Feature Service** (a county/state GIS layer REST URL). Returns
    /// the parcel's outer ring as a JSON `[[e,n],…]` string in the site's projected
    /// meters — ready to drop into the boundary editor — or null when the service
    /// covers no parcel at that point. Assessor/GIS parcels are approximate reference
    /// data, **not** a legal survey; the user refines against monuments.
    async fn parcel_at_site(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        service_url: String,
    ) -> Result<Option<String>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<(Option<f64>, Option<f64>, i32)> = sqlx::query_as(
            "SELECT site_origin_lat, site_origin_lon, epsg_code FROM projects \
             WHERE id = $1 AND org_id = $2",
        )
        .bind(project_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (lat, lon, epsg) = match found_in_org(row, "project")? {
            (Some(la), Some(lo), e) => (la, lo, e),
            _ => return Err(async_graphql::Error::new("set the site origin first")),
        };

        // Basic SSRF guard: only public ArcGIS REST layer URLs over https.
        let url = service_url.trim().trim_end_matches('/');
        if !url.starts_with("https://") || !url.contains("/rest/services") {
            return Err(async_graphql::Error::new(
                "provide an https ArcGIS REST layer URL (…/rest/services/…/FeatureServer/0)",
            ));
        }
        let query = format!(
            "{url}/query?f=geojson&geometryType=esriGeometryPoint&inSR=4326&outSR=4326\
             &spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=\
             &geometry={lon}%2C{lat}"
        );
        let client = reqwest::Client::new();
        let resp = client
            .get(&query)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| {
                async_graphql::Error::new(format!("parcel service request failed: {e}"))
            })?;
        if !resp.status().is_success() {
            return Err(async_graphql::Error::new(format!(
                "parcel service returned HTTP {}",
                resp.status()
            )));
        }
        let body = resp
            .text()
            .await
            .map_err(|e| async_graphql::Error::new(format!("parcel service read failed: {e}")))?;
        let gj: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
            async_graphql::Error::new(format!("parcel service returned invalid GeoJSON: {e}"))
        })?;

        // First feature's outer ring: Polygon → coords[0]; MultiPolygon → coords[0][0].
        let geom = &gj["features"][0]["geometry"];
        let ring = match geom["type"].as_str() {
            Some("Polygon") => geom["coordinates"].get(0usize),
            Some("MultiPolygon") => geom["coordinates"].get(0usize).and_then(|p| p.get(0usize)),
            _ => None,
        };
        let Some(ring) = ring.and_then(|r| r.as_array()) else {
            return Ok(None); // no parcel at this point
        };
        // Reproject [lon,lat] → site projected meters; drop the closed-ring duplicate.
        let mut out: Vec<[f64; 2]> = Vec::with_capacity(ring.len());
        for pt in ring {
            let (Some(lo), Some(la)) = (pt[0].as_f64(), pt[1].as_f64()) else {
                continue;
            };
            if let Some((e, n)) = crate::crs::geographic_to_projected(epsg, la, lo) {
                out.push([e, n]);
            }
        }
        if out.len() > 1 && out.first() == out.last() {
            out.pop();
        }
        if out.len() < 3 {
            return Ok(None);
        }
        Ok(Some(serde_json::to_string(&out).unwrap()))
    }

    /// Exports a project as a self-contained `.slx` archive (JSON text) with all
    /// of its authored data. Re-import with `importProject`.
    async fn project_export(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        require_export(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let storage = storage(ctx)?;
        archive::export_project(pool, storage.as_ref(), project_id)
            .await
            .map_err(async_graphql::Error::new)
    }
}

#[derive(Default)]
pub struct ProjectMutation;

#[Object]
impl ProjectMutation {
    // ----- Projects -----

    /// Creates a project in the caller's organization. Editor role required.
    async fn create_project(
        &self,
        ctx: &Context<'_>,
        name: String,
        description: Option<String>,
        epsg_code: i32,
        display_unit: LengthUnit,
        combined_scale_factor: Option<f64>,
        site_origin_lat: Option<f64>,
        site_origin_lon: Option<f64>,
        site_origin_rotation_deg: Option<f64>,
    ) -> Result<Project> {
        let auth = require_editor_active(ctx).await?;
        require_project_quota(ctx).await?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("project name is required"));
        }
        let row: ProjectRow = sqlx::query_as(&format!(
            "INSERT INTO projects \
             (org_id, name, description, epsg_code, display_unit, combined_scale_factor, \
              site_origin_lat, site_origin_lon, site_origin_rotation_deg) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(name.trim())
        .bind(description.unwrap_or_default())
        .bind(epsg_code)
        .bind(display_unit.as_db_str())
        .bind(combined_scale_factor.unwrap_or(1.0))
        .bind(site_origin_lat)
        .bind(site_origin_lon)
        .bind(site_origin_rotation_deg.unwrap_or(0.0))
        .fetch_one(pool(ctx)?)
        .await?;
        Ok(row.into())
    }

    /// Imports a `.slx` archive as a new project in the caller's org. Editor role
    /// required.
    async fn import_project(&self, ctx: &Context<'_>, content: String) -> Result<Project> {
        let auth = require_editor_active(ctx).await?;
        require_project_quota(ctx).await?;
        let pool = pool(ctx)?;
        let storage = storage(ctx)?;
        let id = archive::import_project(pool, storage.as_ref(), auth.org_id, &content)
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectRow = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLUMNS} FROM projects WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        Ok(row.into())
    }

    /// Updates mutable project fields. Editor role required.
    async fn update_project(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        name: Option<String>,
        description: Option<String>,
        epsg_code: Option<i32>,
        display_unit: Option<LengthUnit>,
        combined_scale_factor: Option<f64>,
        site_origin_lat: Option<f64>,
        site_origin_lon: Option<f64>,
        site_origin_rotation_deg: Option<f64>,
    ) -> Result<Project> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, id, auth.org_id).await?;
        // COALESCE keeps existing values when an argument is omitted.
        let row: ProjectRow = sqlx::query_as(&format!(
            "UPDATE projects SET \
               name = COALESCE($2, name), \
               description = COALESCE($3, description), \
               epsg_code = COALESCE($4, epsg_code), \
               display_unit = COALESCE($5, display_unit), \
               combined_scale_factor = COALESCE($6, combined_scale_factor), \
               site_origin_lat = COALESCE($7, site_origin_lat), \
               site_origin_lon = COALESCE($8, site_origin_lon), \
               site_origin_rotation_deg = COALESCE($10, site_origin_rotation_deg), \
               updated_at = now() \
             WHERE id = $1 AND org_id = $9 RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(epsg_code)
        .bind(display_unit.map(|u| u.as_db_str()))
        .bind(combined_scale_factor)
        .bind(site_origin_lat)
        .bind(site_origin_lon)
        .bind(auth.org_id)
        .bind(site_origin_rotation_deg)
        .fetch_one(pool)
        .await?;
        // Scale / origin / rotation changes move the whole scene.
        publish_scene(ctx, id);
        Ok(row.into())
    }

    /// Sets the project's default stakeout tolerances (values in canonical
    /// meters). These are copied into an as-built comparison's snapshot at run
    /// time and are overridable per import. Editor role required.
    async fn set_project_tolerances(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        tol_h_warn: f64,
        tol_h_fail: f64,
        tol_v_warn: f64,
        tol_v_fail: f64,
    ) -> Result<Project> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::FieldExchange).await?;
        let pool = pool(ctx)?;
        let row: Option<ProjectRow> = sqlx::query_as(&format!(
            "UPDATE projects SET \
               tol_h_warn = $2, tol_h_fail = $3, tol_v_warn = $4, tol_v_fail = $5, \
               updated_at = now() \
             WHERE id = $1 AND org_id = $6 RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(project_id)
        .bind(tol_h_warn)
        .bind(tol_h_fail)
        .bind(tol_v_warn)
        .bind(tol_v_fail)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(found_in_org(row, "project")?.into())
    }

    /// Sets (or clears) the project's property boundary — an ordered polygon of
    /// `[[e,n],…]` vertices in projected meters, passed as a JSON string. Passing
    /// null/empty clears it. The boundary is the area-of-interest for the detailed
    /// hydrology terrain fetch. Editor role required.
    async fn set_project_boundary(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        boundary: Option<String>,
    ) -> Result<Project> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        // Parse + validate the ring (null/empty clears the boundary).
        let parsed: Option<serde_json::Value> =
            match boundary.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(s) => {
                    let pts: Vec<[f64; 2]> = serde_json::from_str(s).map_err(|e| {
                        async_graphql::Error::new(format!("invalid boundary JSON: {e}"))
                    })?;
                    if pts.len() < 3 {
                        return Err(async_graphql::Error::new(
                            "a boundary needs at least three points",
                        ));
                    }
                    Some(serde_json::to_value(pts).unwrap())
                }
                None => None,
            };
        let row: Option<ProjectRow> = sqlx::query_as(&format!(
            "UPDATE projects SET boundary = $2, updated_at = now() \
             WHERE id = $1 AND org_id = $3 RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(project_id)
        .bind(parsed.map(sqlx::types::Json))
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let row = found_in_org(row, "project")?;
        publish_scene(ctx, project_id);
        Ok(row.into())
    }

    /// Permanently deletes a project: removes every uploaded file (DXF overlays,
    /// terrain, buildings) and all database rows (cascades to grid, control
    /// points, survey points, transforms, imports, groups, categories links).
    /// Nothing is left behind. Editor role required.
    async fn delete_project(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let storage = storage(ctx)?;

        // Verify the project belongs to the caller's org before touching anything.
        ensure_project_in_org(pool, id, auth.org_id).await?;

        // Purge uploads first (deterministic per-project keys), then DB rows.
        purge_project_files(storage.as_ref(), id).await;
        sqlx::query("DELETE FROM projects WHERE id = $1 AND org_id = $2")
            .bind(id)
            .bind(auth.org_id)
            .execute(pool)
            .await?;
        Ok(true)
    }
}

/// Removes every stored file for a project so a delete leaves no traces. Keys are
/// deterministic (see overlays/terrain modules): `dxf/{id}/…`, `terrain/{id}.tif`,
/// `buildings/{id}.json`. Best-effort: a missing file is fine; failures are logged
/// but don't block the delete (the DB rows that reference them are removed anyway).
pub(crate) async fn purge_project_files(storage: &dyn Storage, project_id: Uuid) {
    let dxf_dir = format!("dxf/{project_id}");
    let terrain = format!("terrain/{project_id}.tif");
    let detailed = format!("terrain-detailed/{project_id}.tif");
    let buildings = format!("buildings/{project_id}.json");
    if let Err(e) = storage.delete_prefix(&dxf_dir).await {
        eprintln!("purge_project_files: {dxf_dir}: {e}");
    }
    if let Err(e) = storage.delete(&terrain).await {
        // Ignore not-found; only log unexpected errors.
        if storage.exists(&terrain).await {
            eprintln!("purge_project_files: {terrain}: {e}");
        }
    }
    if let Err(e) = storage.delete(&detailed).await {
        if storage.exists(&detailed).await {
            eprintln!("purge_project_files: {detailed}: {e}");
        }
    }
    if let Err(e) = storage.delete(&buildings).await {
        if storage.exists(&buildings).await {
            eprintln!("purge_project_files: {buildings}: {e}");
        }
    }
}
