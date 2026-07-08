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
use crate::models::{
    BreaklineImportLayer, BreaklineImportPreview, BreaklineImportResult, BreaklineInput,
    BreaklineKind, BreaklineLayerMapping, BreaklineVertexInput, FileBlob, PointScope, Surface,
    SurfaceBreakline, SurfaceInput, SurfaceKind, SurfaceStatus,
};
use crate::surface::{self, geom, tin};

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
        "breaklineIds": input.breakline_ids,
        "boundaryId": input.boundary_id,
        "holeIds": input.hole_ids,
    })
}

/// Selects the design points that seed the TIN: a scope (all / one category /
/// one group) minus the explicit exclusions. Returns `(easting, northing,
/// elevation)` in projected meters.
async fn select_points(
    pool: &PgPool,
    project_id: Uuid,
    scope: PointScope,
    scope_ref: Option<Uuid>,
    exclude_category_ids: &[Uuid],
    exclude_tags: &[String],
    exclude_point_ids: &[Uuid],
) -> Result<Vec<(f64, f64, Option<f64>)>> {
    if !matches!(scope, PointScope::All) && scope_ref.is_none() {
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
    .bind(scope.as_db_str())
    .bind(scope_ref)
    .bind(exclude_category_ids)
    .bind(exclude_tags)
    .bind(exclude_point_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A constraint loaded from `surface_breaklines`, ready for triangulation.
struct LoadedConstraint {
    kind: BreaklineKind,
    closed: bool,
    /// `(easting, northing, z?)` in projected meters.
    verts: Vec<(f64, f64, Option<f64>)>,
}

/// Parses a stored `vertices` JSON array (`[{n,e,z?}]`) into `(e, n, z?)` tuples.
fn parse_vertices(v: &Value) -> Vec<(f64, f64, Option<f64>)> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|o| {
                    let e = o.get("e")?.as_f64()?;
                    let n = o.get("n")?.as_f64()?;
                    let z = o.get("z").and_then(|z| z.as_f64());
                    Some((e, n, z))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Loads the breakline/boundary/hole rows referenced by a surface's inputs,
/// classified by their stored `kind`.
async fn select_constraints(
    pool: &PgPool,
    project_id: Uuid,
    input: &SurfaceInput,
) -> Result<Vec<LoadedConstraint>> {
    let mut ids: Vec<Uuid> = input.breakline_ids.clone();
    if let Some(b) = input.boundary_id {
        ids.push(b);
    }
    ids.extend(input.hole_ids.iter().copied());
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String, bool, Value)> = sqlx::query_as(
        "SELECT kind, closed, vertices FROM surface_breaklines \
         WHERE project_id = $1 AND id = ANY($2)",
    )
    .bind(project_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(kind, closed, verts)| LoadedConstraint {
            kind: BreaklineKind::from_db_str(&kind),
            closed,
            verts: parse_vertices(&verts),
        })
        .collect())
}

/// Triangulates the selected points and returns the STIN render blob plus the
/// vertex/triangle counts. Runs the CPU-bound triangulation off the async runtime.
async fn build_mesh_blob(
    crs: &ProjectCrs,
    points: Vec<(f64, f64, Option<f64>)>,
    constraints: Vec<LoadedConstraint>,
    max_edge_length: Option<f64>,
) -> Result<(Vec<u8>, i32, i32)> {
    // Known-elevation points, for z-filling constraint vertices that lack z.
    let known: Vec<(f64, f64, f64)> = points
        .iter()
        .filter_map(|&(e, n, z)| z.map(|z| (e, n, z)))
        .collect();
    let z_at = |e: f64, n: f64, z: Option<f64>| -> f64 {
        z.or_else(|| geom::nearest_point_z(&known, e, n))
            .unwrap_or(0.0)
    };

    let inputs: Vec<tin::InputPoint> = points
        .iter()
        .map(|&(e, n, z)| tin::InputPoint {
            e,
            n,
            z: z.unwrap_or(0.0),
        })
        .collect();

    // Split the loaded constraints into breaklines / boundary / holes, z-filling.
    let to_constraint = |c: &LoadedConstraint, force_closed: bool| tin::Constraint {
        closed: force_closed || c.closed,
        verts: c
            .verts
            .iter()
            .map(|&(e, n, z)| tin::InputPoint {
                e,
                n,
                z: z_at(e, n, z),
            })
            .collect(),
    };
    let breaklines: Vec<tin::Constraint> = constraints
        .iter()
        .filter(|c| matches!(c.kind, BreaklineKind::Hard))
        .map(|c| to_constraint(c, false))
        .collect();
    let boundary: Option<tin::Constraint> = constraints
        .iter()
        .find(|c| matches!(c.kind, BreaklineKind::Boundary))
        .map(|c| to_constraint(c, true));
    let holes: Vec<tin::Constraint> = constraints
        .iter()
        .filter(|c| matches!(c.kind, BreaklineKind::Hole))
        .map(|c| to_constraint(c, true))
        .collect();

    let mesh = tokio::task::spawn_blocking(move || {
        tin::triangulate_constrained(
            &inputs,
            &breaklines,
            boundary.as_ref(),
            &holes,
            max_edge_length,
        )
    })
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

// --- Breaklines / boundary / holes -----------------------------------------

const BREAKLINE_COLUMNS: &str =
    "id, project_id, kind, closed, vertices, source, source_layer, created_at, updated_at";

type BreaklineRow = (
    Uuid,
    Uuid,
    String,
    bool,
    Value,
    String,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

fn row_to_breakline(r: BreaklineRow) -> SurfaceBreakline {
    SurfaceBreakline {
        id: r.0,
        project_id: r.1,
        kind: BreaklineKind::from_db_str(&r.2),
        closed: r.3,
        vertices: r.4.to_string(),
        source: r.5,
        source_layer: r.6,
        created_at: r.7,
        updated_at: r.8,
    }
}

/// Serializes vertex inputs into the stored `[{n,e,z?}]` JSON.
fn vertices_json(verts: &[BreaklineVertexInput]) -> Value {
    Value::Array(
        verts
            .iter()
            .map(|v| json!({ "n": v.n, "e": v.e, "z": v.z }))
            .collect(),
    )
}

/// Resolves a breakline's project (org-scoped); errors if not in the org.
async fn breakline_project_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT b.project_id FROM surface_breaklines b JOIN projects p ON p.id = b.project_id \
         WHERE b.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(found_in_org(row, "breakline")?.0)
}

/// Suggests a breakline kind from a DXF layer name.
fn guess_breakline_kind(layer: &str) -> &'static str {
    let n = layer.to_ascii_uppercase();
    if n.contains("BOUND") || n.contains("LIMIT") || n.contains("PERIMETER") {
        "boundary"
    } else if n.contains("HOLE") || n.contains("VOID") || n.contains("EXCLU") {
        "hole"
    } else {
        "hard"
    }
}

/// Decodes a base64 DXF payload to UTF-8 text.
fn decode_dxf(content_base64: &str) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.trim())
        .map_err(|e| async_graphql::Error::new(format!("invalid base64: {e}")))?;
    String::from_utf8(bytes).map_err(|e| async_graphql::Error::new(format!("invalid UTF-8: {e}")))
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

    /// Every constraint (breakline / boundary / hole) in a project.
    async fn breaklines(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<SurfaceBreakline>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<BreaklineRow> = sqlx::query_as(&format!(
            "SELECT {BREAKLINE_COLUMNS} FROM surface_breaklines WHERE project_id = $1 \
             ORDER BY created_at"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_breakline).collect())
    }

    /// Previews a DXF file's polyline layers for breakline import (mapping UI).
    async fn preview_breakline_import(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        content_base64: String,
    ) -> Result<BreaklineImportPreview> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        ensure_project_in_org(pool(ctx)?, project_id, auth.org_id).await?;
        let text = decode_dxf(&content_base64)?;
        let features =
            crate::utilities::import::parse_dxf(&text).map_err(async_graphql::Error::new)?;
        use std::collections::BTreeMap;
        let mut counts: BTreeMap<String, i32> = BTreeMap::new();
        for f in &features {
            if matches!(f.kind, crate::utilities::import::FeatureKind::Line) {
                *counts.entry(f.layer.clone()).or_default() += 1;
            }
        }
        let layers = counts
            .into_iter()
            .map(|(layer, count)| BreaklineImportLayer {
                suggested_kind: guess_breakline_kind(&layer).to_string(),
                layer,
                count,
            })
            .collect();
        Ok(BreaklineImportPreview { layers })
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

        let points = select_points(
            pool,
            project_id,
            input.scope,
            input.scope_ref,
            &input.exclude_category_ids,
            &input.exclude_tags,
            &input.exclude_point_ids,
        )
        .await?;
        let constraints = select_constraints(pool, project_id, &input).await?;
        let (blob, vertex_count, triangle_count) =
            build_mesh_blob(&crs, points, constraints, input.max_edge_length).await?;

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

        let points = select_points(
            pool,
            project_id,
            input.scope,
            input.scope_ref,
            &input.exclude_category_ids,
            &input.exclude_tags,
            &input.exclude_point_ids,
        )
        .await?;
        let constraints = select_constraints(pool, project_id, &input).await?;
        let (blob, vertex_count, triangle_count) =
            build_mesh_blob(&crs, points, constraints, input.max_edge_length).await?;

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

    /// Creates a digitized breakline / boundary / hole.
    async fn create_breakline(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: BreaklineInput,
    ) -> Result<SurfaceBreakline> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row: BreaklineRow = sqlx::query_as(&format!(
            "INSERT INTO surface_breaklines (project_id, kind, closed, vertices, source) \
             VALUES ($1, $2, $3, $4, 'digitized') RETURNING {BREAKLINE_COLUMNS}"
        ))
        .bind(project_id)
        .bind(input.kind.as_db_str())
        .bind(input.closed)
        .bind(sqlx::types::Json(vertices_json(&input.vertices)))
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row_to_breakline(row))
    }

    /// Replaces a breakline's kind + geometry.
    async fn update_breakline(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: BreaklineInput,
    ) -> Result<SurfaceBreakline> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let project_id = breakline_project_in_org(pool, id, auth.org_id).await?;
        let row: BreaklineRow = sqlx::query_as(&format!(
            "UPDATE surface_breaklines SET kind = $2, closed = $3, vertices = $4, updated_at = now() \
             WHERE id = $1 RETURNING {BREAKLINE_COLUMNS}"
        ))
        .bind(id)
        .bind(input.kind.as_db_str())
        .bind(input.closed)
        .bind(sqlx::types::Json(vertices_json(&input.vertices)))
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row_to_breakline(row))
    }

    /// Deletes a breakline.
    async fn delete_breakline(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let project_id = breakline_project_in_org(pool, id, auth.org_id).await?;
        sqlx::query("DELETE FROM surface_breaklines WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    /// Generates an auto concave-hull boundary from a point scope, stored as an
    /// editable `boundary` breakline.
    async fn auto_boundary(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        #[graphql(default_with = "PointScope::All")] scope: PointScope,
        scope_ref: Option<Uuid>,
    ) -> Result<SurfaceBreakline> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let pts = select_points(pool, project_id, scope, scope_ref, &[], &[], &[]).await?;
        if pts.len() < 3 {
            return Err(async_graphql::Error::new(
                "need at least 3 points to derive a boundary",
            ));
        }
        let pts2d: Vec<[f64; 2]> = pts.iter().map(|&(e, n, _)| [e, n]).collect();
        let known: Vec<(f64, f64, f64)> = pts
            .iter()
            .filter_map(|&(e, n, z)| z.map(|z| (e, n, z)))
            .collect();
        let hull = geom::concave_hull(&pts2d, 2.0);
        if hull.len() < 3 {
            return Err(async_graphql::Error::new("could not derive a boundary"));
        }
        let verts = Value::Array(
            hull.iter()
                .map(|&[e, n]| json!({ "n": n, "e": e, "z": geom::nearest_point_z(&known, e, n) }))
                .collect(),
        );
        let row: BreaklineRow = sqlx::query_as(&format!(
            "INSERT INTO surface_breaklines (project_id, kind, closed, vertices, source) \
             VALUES ($1, 'boundary', true, $2, 'digitized') RETURNING {BREAKLINE_COLUMNS}"
        ))
        .bind(project_id)
        .bind(sqlx::types::Json(verts))
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row_to_breakline(row))
    }

    /// Imports breaklines from DXF polylines, one per feature, tagged by layer.
    async fn import_breaklines(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        content_base64: String,
        mappings: Vec<BreaklineLayerMapping>,
        unit: Option<LengthUnit>,
    ) -> Result<BreaklineImportResult> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let unit = unit.unwrap_or(LengthUnit::Meter);
        let text = decode_dxf(&content_base64)?;
        let features =
            crate::utilities::import::parse_dxf(&text).map_err(async_graphql::Error::new)?;
        use std::collections::HashMap;
        let map: HashMap<String, String> = mappings
            .into_iter()
            .filter_map(|m| m.kind.filter(|k| !k.is_empty()).map(|k| (m.layer, k)))
            .collect();

        let mut created = 0;
        let mut skipped = 0;
        let mut tx = pool.begin().await?;
        for f in &features {
            if !matches!(f.kind, crate::utilities::import::FeatureKind::Line) {
                continue;
            }
            // Canonicalize the mapped kind to the db's lowercase form (the client
            // sends the enum-style "HARD"/"BOUNDARY"/"HOLE").
            let kind = match map.get(&f.layer) {
                Some(k) => BreaklineKind::from_db_str(&k.to_lowercase()).as_db_str(),
                None => {
                    skipped += 1;
                    continue;
                }
            };
            let closed = kind != "hard";
            let verts = Value::Array(
                f.points
                    .iter()
                    .map(|&(x, y)| {
                        json!({ "n": unit.to_meters(y), "e": unit.to_meters(x), "z": Value::Null })
                    })
                    .collect(),
            );
            sqlx::query(
                "INSERT INTO surface_breaklines (project_id, kind, closed, vertices, source, source_layer) \
                 VALUES ($1, $2, $3, $4, 'dxf', $5)",
            )
            .bind(project_id)
            .bind(kind)
            .bind(closed)
            .bind(sqlx::types::Json(&verts))
            .bind(&f.layer)
            .execute(&mut *tx)
            .await?;
            created += 1;
        }
        tx.commit().await?;
        publish_scene(ctx, project_id);
        Ok(BreaklineImportResult { created, skipped })
    }
}
