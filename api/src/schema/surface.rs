//! Surface modeling resolvers (Phase 1): build/rebuild/delete a point-built TIN
//! and stream its render mesh. All resolvers are Crew-gated and org/project
//! scoped; mutations also require an editor role + an active subscription.
//!
//! Triangulation runs synchronously (inside the mutation) via `spawn_blocking`,
//! following the codebase's existing no-background-worker convention. Vertices are
//! converted to geographic with the *same* rotation + projection pipeline
//! `scene.rs` uses for survey points, so the TIN registers on the point cloud.
use serde_json::{json, Value};

use super::*;
use crate::models::{FileBlob, PointScope, Surface, SurfaceInput, SurfaceKind, SurfaceStatus};
use crate::surface::{self, tin};

/// Read columns for a `surfaces` row, in the order [`row_to_surface`] expects.
const SURFACE_COLUMNS: &str =
    "id, project_id, name, version, kind, status, failure_reason, inputs, \
     vertex_count, triangle_count, created_at";

type SurfaceRow = (
    Uuid,           // id
    Uuid,           // project_id
    String,         // name
    i32,            // version
    String,         // kind
    String,         // status
    Option<String>, // failure_reason
    Value,          // inputs (jsonb)
    i32,            // vertex_count
    i32,            // triangle_count
    DateTime<Utc>,  // created_at
);

fn row_to_surface(r: SurfaceRow) -> Surface {
    Surface {
        id: r.0,
        project_id: r.1,
        name: r.2,
        version: r.3,
        kind: SurfaceKind::from_db_str(&r.4),
        status: SurfaceStatus::from_db_str(&r.5),
        failure_reason: r.6,
        inputs: r.7.to_string(),
        vertex_count: r.8,
        triangle_count: r.9,
        created_at: r.10,
    }
}

/// The JSON snapshot persisted in `surfaces.inputs`.
fn inputs_snapshot(input: &SurfaceInput) -> Value {
    json!({
        "name": input.name,
        "scope": input.scope.as_db_str(),
        "scopeRef": input.scope_ref,
        "excludeCategoryIds": input.exclude_category_ids,
        "excludeTags": input.exclude_tags,
        "excludePointIds": input.exclude_point_ids,
        "maxEdgeLength": input.max_edge_length,
    })
}

/// Selects the design points that seed the TIN: a scope (all / one category /
/// one group) minus the explicit exclusions. Returns `(easting, northing,
/// elevation)` in projected meters.
async fn select_points(
    pool: &PgPool,
    project_id: Uuid,
    input: &SurfaceInput,
) -> Result<Vec<(f64, f64, Option<f64>)>> {
    if !matches!(input.scope, PointScope::All) && input.scope_ref.is_none() {
        return Err(async_graphql::Error::new(
            "a category or group scope needs a reference id",
        ));
    }
    // Every parameter is referenced unconditionally so the bind count is fixed
    // regardless of scope; empty exclusion arrays exclude nothing.
    let rows: Vec<(f64, f64, Option<f64>)> = sqlx::query_as(
        "SELECT sp.easting, sp.northing, sp.elevation FROM survey_points sp \
         WHERE sp.project_id = $1 AND sp.point_type = 'design' \
           AND ( \
             $2 = 'all' \
             OR ($2 = 'category' AND sp.category_id = $3) \
             OR ($2 = 'group' AND sp.id = ANY(COALESCE( \
                 (SELECT member_ids FROM point_groups WHERE id = $3 AND project_id = $1), \
                 ARRAY[]::uuid[]))) \
           ) \
           AND (sp.category_id IS NULL OR NOT (sp.category_id = ANY($4))) \
           AND NOT (sp.tags && $5) \
           AND NOT (sp.id = ANY($6))",
    )
    .bind(project_id)
    .bind(input.scope.as_db_str())
    .bind(input.scope_ref)
    .bind(&input.exclude_category_ids)
    .bind(&input.exclude_tags)
    .bind(&input.exclude_point_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Triangulates the selected points and returns the STIN render blob plus the
/// vertex/triangle counts. Runs the CPU-bound triangulation off the async runtime.
async fn build_mesh_blob(
    crs: &ProjectCrs,
    points: Vec<(f64, f64, Option<f64>)>,
) -> Result<(Vec<u8>, i32, i32)> {
    let inputs: Vec<tin::InputPoint> = points
        .into_iter()
        .map(|(e, n, z)| tin::InputPoint {
            e,
            n,
            z: z.unwrap_or(0.0),
        })
        .collect();

    let mesh = tokio::task::spawn_blocking(move || tin::triangulate(&inputs))
        .await
        .map_err(|e| async_graphql::Error::new(format!("triangulation task failed: {e}")))?
        .map_err(async_graphql::Error::new)?;

    // Project each TIN vertex to geographic using the same rotation the scene
    // applies to points, so the surface overlays them exactly. Any vertex that
    // fails to project would break index alignment, so that aborts the build.
    let epsg = crs.epsg;
    let rotation = crs.rotation;
    let mut geo = Vec::with_capacity(mesh.vertices.len());
    for [e, n, z] in &mesh.vertices {
        let (te, tn) = rotation.map_or((*e, *n), |r| r.to_true(*e, *n));
        let (lat, lon) = crs::projected_to_geographic(epsg, te, tn).ok_or_else(|| {
            async_graphql::Error::new("could not project a surface vertex to geographic")
        })?;
        geo.push([lat, lon, *z]);
    }

    let blob = surface::serialize_mesh(&geo, &mesh.indices);
    Ok((blob, geo.len() as i32, mesh.indices.len() as i32))
}

#[derive(Default)]
pub struct SurfaceQuery;

#[Object]
impl SurfaceQuery {
    /// Every surface in a project (newest first).
    async fn surfaces(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<Surface>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<SurfaceRow> = sqlx::query_as(&format!(
            "SELECT {SURFACE_COLUMNS} FROM surfaces WHERE project_id = $1 \
             ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_surface).collect())
    }

    /// A single surface by id (org-scoped).
    async fn surface(&self, ctx: &Context<'_>, id: Uuid) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<SurfaceRow> = sqlx::query_as(&format!(
            "SELECT {} FROM surfaces s JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
            qualify_columns(SURFACE_COLUMNS, "s")
        ))
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(row_to_surface(found_in_org(row, "surface")?))
    }

    /// The computed render mesh (STIN binary blob, base64-encoded).
    async fn surface_mesh(&self, ctx: &Context<'_>, id: Uuid) -> Result<FileBlob> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT s.name, s.storage_key FROM surfaces s \
             JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (name, storage_key) = found_in_org(row, "surface")?;
        let key = storage_key
            .ok_or_else(|| async_graphql::Error::new("surface has no computed mesh yet"))?;
        let bytes = storage(ctx)?
            .get(&key)
            .await
            .map_err(async_graphql::Error::new)?;
        let content_base64 = tokio::task::spawn_blocking(move || {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(bytes)
        })
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(FileBlob {
            filename: format!("{name}.stin"),
            mime_type: "application/octet-stream".to_string(),
            content_base64,
        })
    }
}

#[derive(Default)]
pub struct SurfaceMutation;

#[Object]
impl SurfaceMutation {
    /// Builds a new TIN surface from selected survey points.
    async fn build_surface(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: SurfaceInput,
    ) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        // Also serves as the org-ownership check for the project.
        let crs = load_project_crs(pool, project_id, auth.org_id).await?;

        let points = select_points(pool, project_id, &input).await?;
        let (blob, vertex_count, triangle_count) = build_mesh_blob(&crs, points).await?;

        let id = Uuid::new_v4();
        let storage_key = format!("surface/{project_id}/{id}.bin");
        storage(ctx)?
            .put(&storage_key, &blob)
            .await
            .map_err(async_graphql::Error::new)?;

        let row: SurfaceRow = sqlx::query_as(&format!(
            "INSERT INTO surfaces \
               (id, project_id, name, version, kind, status, inputs, storage_key, \
                vertex_count, triangle_count, created_by) \
             VALUES ($1, $2, $3, 1, 'tin', 'ready', $4, $5, $6, $7, $8) \
             RETURNING {SURFACE_COLUMNS}"
        ))
        .bind(id)
        .bind(project_id)
        .bind(&input.name)
        .bind(sqlx::types::Json(inputs_snapshot(&input)))
        .bind(&storage_key)
        .bind(vertex_count)
        .bind(triangle_count)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_surface(row))
    }

    /// Rebuilds an existing surface from (possibly new) inputs → next version.
    async fn rebuild_surface(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: SurfaceInput,
    ) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;

        // Resolve the surface's project (org-scoped) before recomputing.
        let existing: Option<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT s.project_id, s.storage_key FROM surfaces s \
             JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (project_id, old_key) = found_in_org(existing, "surface")?;
        let crs = load_project_crs(pool, project_id, auth.org_id).await?;

        let points = select_points(pool, project_id, &input).await?;
        let (blob, vertex_count, triangle_count) = build_mesh_blob(&crs, points).await?;

        let storage_key = format!("surface/{project_id}/{id}.bin");
        let store = storage(ctx)?;
        store
            .put(&storage_key, &blob)
            .await
            .map_err(async_graphql::Error::new)?;
        // Clean up a superseded blob under a different key (belt-and-suspenders;
        // the key is deterministic so it's usually the same path, overwritten).
        if let Some(k) = old_key {
            if k != storage_key {
                let _ = store.delete(&k).await;
            }
        }

        let row: SurfaceRow = sqlx::query_as(&format!(
            "UPDATE surfaces SET \
               name = $2, version = version + 1, status = 'ready', failure_reason = NULL, \
               inputs = $3, storage_key = $4, vertex_count = $5, triangle_count = $6 \
             WHERE id = $1 \
             RETURNING {SURFACE_COLUMNS}"
        ))
        .bind(id)
        .bind(&input.name)
        .bind(sqlx::types::Json(inputs_snapshot(&input)))
        .bind(&storage_key)
        .bind(vertex_count)
        .bind(triangle_count)
        .fetch_one(pool)
        .await?;
        Ok(row_to_surface(row))
    }

    /// Deletes a surface and its mesh blob.
    async fn delete_surface(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "DELETE FROM surfaces s USING projects p \
             WHERE s.id = $1 AND p.id = s.project_id AND p.org_id = $2 \
             RETURNING s.storage_key",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (storage_key,) = found_in_org(row, "surface")?;
        if let Some(key) = storage_key {
            let _ = storage(ctx)?.delete(&key).await;
        }
        Ok(true)
    }
}
