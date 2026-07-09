use serde_json::{json, Value};

use crate::models::{
    BreaklineImportResult, BreaklineInput, BreaklineKind, BreaklineLayerMapping, DemGridInput,
    PointScope, Surface, SurfaceBreakline, SurfaceInput, Volume, VolumeComparison, VolumeInput,
};
use crate::schema::*;
use crate::surface::geom;

use super::shared::*;

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

    /// Computes a reproducible cut/fill volume between a base surface and either a
    /// compare surface (surface↔surface) or a reference elevation (surface↔elevation),
    /// snapshotting the surface versions + params so the result never changes.
    async fn compute_volume(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: VolumeInput,
    ) -> Result<Volume> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        // The comparison target must match the requested comparison kind.
        match input.comparison {
            VolumeComparison::SurfaceToSurface if input.compare_surface_id.is_none() => {
                return Err(async_graphql::Error::new(
                    "a surface-to-surface volume needs a compare surface",
                ));
            }
            VolumeComparison::SurfaceToElevation if input.reference_elev.is_none() => {
                return Err(async_graphql::Error::new(
                    "a surface-to-elevation volume needs a reference elevation",
                ));
            }
            _ => {}
        }

        let (base_proj, base_version, base_key) =
            load_surface_for_volume(pool, input.base_surface_id, auth.org_id).await?;
        if base_proj != project_id {
            return Err(async_graphql::Error::new(
                "base surface is not in this project",
            ));
        }
        let store = storage(ctx)?;
        let base_bytes = store
            .get(&base_key)
            .await
            .map_err(async_graphql::Error::new)?;

        // Only load a compare surface for a surface-to-surface volume.
        let (compare_version, compare_bytes) = match input.comparison {
            VolumeComparison::SurfaceToSurface => {
                let cid = input.compare_surface_id.unwrap();
                let (c_proj, c_ver, c_key) =
                    load_surface_for_volume(pool, cid, auth.org_id).await?;
                if c_proj != project_id {
                    return Err(async_graphql::Error::new(
                        "compare surface is not in this project",
                    ));
                }
                let bytes = store.get(&c_key).await.map_err(async_graphql::Error::new)?;
                (Some(c_ver), Some(bytes))
            }
            VolumeComparison::SurfaceToElevation => (None, None),
        };
        // For a surface-to-elevation volume the reference is the target; for
        // surface-to-surface there's no reference elevation.
        let reference_elev = match input.comparison {
            VolumeComparison::SurfaceToElevation => input.reference_elev,
            VolumeComparison::SurfaceToSurface => None,
        };

        let cell_size = input.cell_size;
        let out = tokio::task::spawn_blocking(move || {
            compute_volume_blob(
                &base_bytes,
                compare_bytes.as_deref(),
                reference_elev,
                cell_size,
            )
        })
        .await
        .map_err(|e| async_graphql::Error::new(format!("volume task failed: {e}")))?
        .map_err(async_graphql::Error::new)?;

        let id = Uuid::new_v4();
        let heatmap_key = format!("volume/{project_id}/{id}.bin");
        store
            .put(&heatmap_key, &out.blob)
            .await
            .map_err(async_graphql::Error::new)?;

        let row: VolumeRow = sqlx::query_as(&format!(
            "INSERT INTO volumes \
               (id, project_id, name, method, comparison, base_surface_id, base_version, \
                compare_surface_id, compare_version, reference_elev, cell_size, \
                cut_volume, fill_volume, net_volume, area, heatmap_key, computed_by) \
             VALUES ($1, $2, $3, 'grid', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) \
             RETURNING {VOLUME_COLUMNS}"
        ))
        .bind(id)
        .bind(project_id)
        .bind(&input.name)
        .bind(input.comparison.as_db_str())
        .bind(input.base_surface_id)
        .bind(base_version)
        .bind(input.compare_surface_id)
        .bind(compare_version)
        .bind(reference_elev)
        .bind(cell_size)
        .bind(out.cut)
        .bind(out.fill)
        .bind(out.net)
        .bind(out.area)
        .bind(&heatmap_key)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_volume(row))
    }

    /// Deletes a volume computation and its heatmap grid blob.
    async fn delete_volume(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "DELETE FROM volumes v USING projects p \
             WHERE v.id = $1 AND p.id = v.project_id AND p.org_id = $2 \
             RETURNING v.heatmap_key",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (heatmap_key,) = found_in_org(row, "volume")?;
        if let Some(key) = heatmap_key {
            let _ = storage(ctx)?.delete(&key).await;
        }
        Ok(true)
    }

    /// Builds a `dem`-kind surface from an uploaded GeoTIFF the client parsed with
    /// geotiff.js into a downsampled `grid`. The raw file is stored (for re-export)
    /// and the grid is triangulated + reprojected to a mesh that renders and takes
    /// part in volumes exactly like a point-built TIN.
    async fn build_dem_surface(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        name: String,
        filename: String,
        content_base64: String,
        grid: DemGridInput,
    ) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let store = storage(ctx)?;

        // Persist the original GeoTIFF (for re-download / GeoTIFF export).
        let raw = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(content_base64.trim())
                .map_err(|e| async_graphql::Error::new(format!("invalid GeoTIFF base64: {e}")))?
        };
        let dem_id = Uuid::new_v4();
        let dem_key = format!("surface-dem/{project_id}/{dem_id}.tif");
        store
            .put(&dem_key, &raw)
            .await
            .map_err(async_graphql::Error::new)?;
        let bbox = json!({
            "west": grid.origin_e,
            "north": grid.origin_n,
            "east": grid.origin_e + f64::from((grid.width - 1).max(0)) * grid.pixel_x,
            "south": grid.origin_n - f64::from((grid.height - 1).max(0)) * grid.pixel_y,
        });
        sqlx::query(
            "INSERT INTO surface_dems (id, project_id, filename, storage_key, bbox, source_crs, uploaded_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(dem_id)
        .bind(project_id)
        .bind(&filename)
        .bind(&dem_key)
        .bind(sqlx::types::Json(&bbox))
        .bind(format!("EPSG:{}", grid.epsg))
        .bind(auth.user_id)
        .execute(pool)
        .await?;

        let epsg = grid.epsg;
        let (width, height) = (grid.width, grid.height);
        let (blob, vertex_count, triangle_count) = build_dem_mesh_blob(grid).await?;
        let surface_id = Uuid::new_v4();
        let storage_key = format!("surface/{project_id}/{surface_id}.bin");
        store
            .put(&storage_key, &blob)
            .await
            .map_err(async_graphql::Error::new)?;

        let inputs = json!({
            "kind": "dem",
            "demId": dem_id,
            "filename": filename,
            "epsg": epsg,
            "width": width,
            "height": height,
        });
        let row: SurfaceRow = sqlx::query_as(&format!(
            "INSERT INTO surfaces \
               (id, project_id, name, version, kind, status, inputs, storage_key, \
                vertex_count, triangle_count, created_by) \
             VALUES ($1, $2, $3, 1, 'dem', 'ready', $4, $5, $6, $7, $8) \
             RETURNING {SURFACE_COLUMNS}"
        ))
        .bind(surface_id)
        .bind(project_id)
        .bind(&name)
        .bind(sqlx::types::Json(inputs))
        .bind(&storage_key)
        .bind(vertex_count)
        .bind(triangle_count)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_surface(row))
    }
}
