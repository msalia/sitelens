#![allow(clippy::too_many_arguments)]
use super::*;
use crate::geo::{solve_helmert, Correspondence, GeoError};

const CAD_OVERLAY_COLUMNS: &str = "id, project_id, original_filename, offset_e, offset_n, \
    rotation_deg, scale, elevation, assume_real_world, visible";

/// Returns the storage key of a CAD overlay if it belongs to the org.
async fn overlay_key_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT co.storage_key FROM cad_overlays co JOIN projects p ON co.project_id = p.id \
         WHERE co.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    found_in_org(row.map(|(k,)| k), "overlay")
}

/// A 2D point in DXF drawing units.
#[derive(async_graphql::SimpleObject)]
pub struct DxfPoint {
    pub x: f64,
    pub y: f64,
}

/// A layer-grouped polyline of a parsed DXF overlay.
#[derive(async_graphql::SimpleObject)]
pub struct DxfPolylineGql {
    pub layer: String,
    pub points: Vec<DxfPoint>,
}

/// Server-parsed geometry of a DXF overlay (replaces client-side parsing).
#[derive(async_graphql::SimpleObject)]
pub struct DxfGeometry {
    pub layers: Vec<String>,
    pub polylines: Vec<DxfPolylineGql>,
}

/// A planar point in projected meters — an alignment pick (a DXF vertex's current
/// world position, or a grid intersection).
#[derive(async_graphql::InputObject)]
pub struct AlignPoint {
    pub e: f64,
    pub n: f64,
}

#[derive(Default)]
pub struct OverlayQuery;

#[Object]
impl OverlayQuery {
    /// DXF overlays for a project. DXF is a Crew feature: non-paid orgs simply see
    /// no overlays (empty list) so the bundled scene query still loads — the upload
    /// path is what's gated with an upgrade prompt.
    async fn cad_overlays(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<CadOverlay>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        if !crate::billing::org_billing(pool, auth.org_id)
            .await?
            .has_feature(Feature::DxfOverlays)
        {
            return Ok(Vec::new());
        }
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<CadOverlay> = sqlx::query_as(&format!(
            "SELECT {CAD_OVERLAY_COLUMNS} FROM cad_overlays WHERE project_id = $1 ORDER BY created_at"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// The raw DXF text of an overlay (kept for export / debugging).
    async fn cad_overlay_content(&self, ctx: &Context<'_>, id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::DxfOverlays).await?;
        let key = overlay_key_in_org(pool(ctx)?, id, auth.org_id).await?;
        let storage = storage(ctx)?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        String::from_utf8(bytes)
            .map_err(|_| async_graphql::Error::new("overlay is not valid UTF-8"))
    }

    /// The overlay parsed into layer-grouped polylines (server-side DXF codec),
    /// for the 3D scene to render without shipping a DXF parser to the browser.
    async fn cad_overlay_geometry(&self, ctx: &Context<'_>, id: Uuid) -> Result<DxfGeometry> {
        let auth = require_auth(ctx)?;
        require_feature(ctx, Feature::DxfOverlays).await?;
        let key = overlay_key_in_org(pool(ctx)?, id, auth.org_id).await?;
        let bytes = storage(ctx)?
            .get(&key)
            .await
            .map_err(async_graphql::Error::new)?;
        let text = String::from_utf8(bytes)
            .map_err(|_| async_graphql::Error::new("overlay is not UTF-8"))?;
        let parsed = crate::dxf::parse(&text).map_err(async_graphql::Error::new)?;
        Ok(DxfGeometry {
            layers: parsed.layers,
            polylines: parsed
                .polylines
                .into_iter()
                .map(|pl| DxfPolylineGql {
                    layer: pl.layer,
                    points: pl
                        .points
                        .into_iter()
                        .map(|(x, y)| DxfPoint { x, y })
                        .collect(),
                })
                .collect(),
        })
    }
}

#[derive(Default)]
pub struct OverlayMutation;

#[Object]
impl OverlayMutation {
    // ----- DXF overlays -----

    /// Uploads a DXF file: stores the raw text and creates an overlay record
    /// (defaulting to real-world georeferencing). Editor role required.
    async fn upload_dxf(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        filename: String,
        content: String,
    ) -> Result<CadOverlay> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::DxfOverlays).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if content.len() > import::MAX_DXF_BYTES {
            return Err(async_graphql::Error::new(
                "DXF exceeds the maximum allowed size (10 MB)",
            ));
        }
        if content.trim().is_empty() {
            return Err(async_graphql::Error::new("DXF content is empty"));
        }

        let storage = storage(ctx)?;
        let id = Uuid::new_v4();
        let key = format!("dxf/{project_id}/{id}.dxf");
        storage
            .put(&key, content.as_bytes())
            .await
            .map_err(async_graphql::Error::new)?;

        let row: CadOverlay = sqlx::query_as(&format!(
            "INSERT INTO cad_overlays (id, project_id, original_filename, storage_key) \
             VALUES ($1, $2, $3, $4) RETURNING {CAD_OVERLAY_COLUMNS}"
        ))
        .bind(id)
        .bind(project_id)
        .bind(filename.trim())
        .bind(&key)
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row)
    }

    /// Updates an overlay's georeference / visibility. Editor role required.
    async fn set_cad_georeference(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        offset_e: Option<f64>,
        offset_n: Option<f64>,
        rotation_deg: Option<f64>,
        scale: Option<f64>,
        elevation: Option<f64>,
        assume_real_world: Option<bool>,
        visible: Option<bool>,
    ) -> Result<CadOverlay> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::DxfOverlays).await?;
        let row: Option<CadOverlay> = sqlx::query_as(&format!(
            "UPDATE cad_overlays co SET \
               offset_e = COALESCE($2, co.offset_e), \
               offset_n = COALESCE($3, co.offset_n), \
               rotation_deg = COALESCE($4, co.rotation_deg), \
               scale = COALESCE($5, co.scale), \
               assume_real_world = COALESCE($6, co.assume_real_world), \
               visible = COALESCE($7, co.visible), \
               elevation = COALESCE($9, co.elevation) \
             FROM projects p \
             WHERE co.id = $1 AND co.project_id = p.id AND p.org_id = $8 \
             RETURNING {}",
            qualify_columns(CAD_OVERLAY_COLUMNS, "co")
        ))
        .bind(id)
        .bind(offset_e)
        .bind(offset_n)
        .bind(rotation_deg)
        .bind(scale)
        .bind(assume_real_world)
        .bind(visible)
        .bind(auth.org_id)
        .bind(elevation)
        .fetch_optional(pool(ctx)?)
        .await?;
        let row = found_in_org(row, "overlay")?;
        publish_scene(ctx, row.project_id);
        Ok(row)
    }

    /// Aligns a DXF overlay to the grid from two point correspondences: two picked
    /// DXF vertices (their current world E/N) mapped onto two grid intersections.
    /// Solves the 2-point Helmert similarity — the same solver that ties control
    /// points — and persists the resulting offset / rotation / scale. Rust owns the
    /// geometry so the placement never diverges from what's drawn.
    async fn align_cad_overlay(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        // `src`: two picked DXF vertices in their current rendered world E/N.
        // `dst`: the two grid intersections they should land on, in E/N.
        src: Vec<AlignPoint>,
        dst: Vec<AlignPoint>,
    ) -> Result<CadOverlay> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::DxfOverlays).await?;
        let pool = pool(ctx)?;
        if src.len() != 2 || dst.len() != 2 {
            return Err(async_graphql::Error::new(
                "alignment needs exactly two DXF points and two grid intersections",
            ));
        }

        // The overlay's current transform — what the picked vertices were rendered
        // under (org-scoped).
        let cur: Option<(f64, f64, f64, f64)> = sqlx::query_as(
            "SELECT co.offset_e, co.offset_n, co.rotation_deg, co.scale \
             FROM cad_overlays co JOIN projects p ON co.project_id = p.id \
             WHERE co.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (oe, on, rot_deg, sc) = found_in_org(cur, "overlay")?;

        // Solve S: current-world → target-world, then compose it onto the overlay's
        // current transform. offset' = S(offset), scale' = S.scale·scale,
        // rotation' = S.rotation + rotation.
        //
        // Center the source points first. DXF picks are large projected-world
        // coordinates (~1e6); two points a few meters apart at that magnitude make
        // the Helmert normal matrix ill-conditioned, tripping its relative
        // rank check as a false "degenerate". Centering keeps it well-conditioned;
        // `S(world) = p.apply(world − origin)` recovers the same transform.
        let (ox, oy) = (src[0].e, src[0].n);
        let corr: Vec<Correspondence> = src
            .iter()
            .zip(dst.iter())
            .map(|(s, d)| Correspondence {
                grid_x: s.e - ox,
                grid_y: s.n - oy,
                proj_e: d.e,
                proj_n: d.n,
            })
            .collect();
        let sol = solve_helmert(&corr).map_err(|e| {
            async_graphql::Error::new(match e {
                GeoError::Degenerate => {
                    "the two points coincide — pick two separated points".to_string()
                }
                other => format!("could not align the overlay: {other:?}"),
            })
        })?;
        let p = sol.params;
        let (new_oe, new_on) = p.apply(oe - ox, on - oy);
        let new_scale = sc * p.scale();
        let new_rot = {
            let d = rot_deg + p.rotation_rad().to_degrees();
            ((d % 360.0) + 360.0) % 360.0
        };

        let row: Option<CadOverlay> = sqlx::query_as(&format!(
            "UPDATE cad_overlays co SET offset_e = $2, offset_n = $3, rotation_deg = $4, scale = $5 \
             FROM projects p WHERE co.id = $1 AND co.project_id = p.id AND p.org_id = $6 \
             RETURNING {}",
            qualify_columns(CAD_OVERLAY_COLUMNS, "co")
        ))
        .bind(id)
        .bind(new_oe)
        .bind(new_on)
        .bind(new_rot)
        .bind(new_scale)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let row = found_in_org(row, "overlay")?;
        publish_scene(ctx, row.project_id);
        Ok(row)
    }

    /// Deletes an overlay and its stored file. Editor role required.
    async fn delete_cad_overlay(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        require_feature(ctx, Feature::DxfOverlays).await?;
        let pool = pool(ctx)?;
        let key = overlay_key_in_org(pool, id, auth.org_id).await?;
        let row: Option<(Uuid,)> =
            sqlx::query_as("DELETE FROM cad_overlays WHERE id = $1 RETURNING project_id")
                .bind(id)
                .fetch_optional(pool)
                .await?;
        // Best-effort file cleanup.
        let storage = storage(ctx)?;
        let _ = storage.delete(&key).await;
        if let Some((project_id,)) = row {
            publish_scene(ctx, project_id);
        }
        Ok(true)
    }
}
