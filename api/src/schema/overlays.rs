#![allow(clippy::too_many_arguments)]
use super::*;

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
        if !crate::billing::org_billing(pool, auth.org_id).await?.paid() {
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

    /// The raw DXF text of an overlay (for client-side parsing/rendering).
    async fn cad_overlay_content(&self, ctx: &Context<'_>, id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        require_paid(ctx, "DXF overlays").await?;
        let key = overlay_key_in_org(pool(ctx)?, id, auth.org_id).await?;
        let storage = storage(ctx)?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        String::from_utf8(bytes)
            .map_err(|_| async_graphql::Error::new("overlay is not valid UTF-8"))
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
        require_paid(ctx, "DXF overlays").await?;
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
        require_paid(ctx, "DXF overlays").await?;
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

    /// Deletes an overlay and its stored file. Editor role required.
    async fn delete_cad_overlay(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        require_paid(ctx, "DXF overlays").await?;
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
