#![allow(clippy::too_many_arguments)]
use super::*;

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

    /// Exports a project as a self-contained `.slx` archive (JSON text) with all
    /// of its authored data. Re-import with `importProject`.
    async fn project_export(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let storage = ctx.data::<Arc<dyn Storage>>()?;
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
        let auth = require_editor(ctx)?;
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
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        let storage = ctx.data::<Arc<dyn Storage>>()?;
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
        let auth = require_editor(ctx)?;
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
        Ok(row.into())
    }

    /// Deletes a project (cascades to its grid and control points). Editor role required.
    async fn delete_project(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query("DELETE FROM projects WHERE id = $1 AND org_id = $2")
            .bind(id)
            .bind(auth.org_id)
            .execute(pool(ctx)?)
            .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "project not found in your organization",
            ));
        }
        Ok(true)
    }
}
