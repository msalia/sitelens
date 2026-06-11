#![allow(clippy::too_many_arguments)]
use super::*;

#[derive(Default)]
pub struct GridQuery;

#[Object]
impl GridQuery {
    /// The grid axes for a project, ordered by family then position.
    async fn grid_axes(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<GridAxis>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<GridAxisRow> = sqlx::query_as(
            "SELECT id, project_id, family, label, position FROM grid_axes \
             WHERE project_id = $1 ORDER BY family, position",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(GridAxis::from).collect())
    }

    /// The control points for a project.
    async fn control_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ControlPoint>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ControlPoint> = sqlx::query_as(&format!(
            "SELECT {CONTROL_POINT_COLUMNS} FROM control_points WHERE project_id = $1 ORDER BY created_at"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// The persisted Helmert transform for a project, if one has been solved.
    async fn transform(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Option<Transform>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row: Option<TransformRow> = sqlx::query_as(
            "SELECT translation_e, translation_n, rotation_rad, scale, rms_error, point_count, residuals \
             FROM transforms WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row.map(Transform::from))
    }
}

#[derive(Default)]
pub struct GridMutation;

#[Object]
impl GridMutation {
    // ----- Grid -----

    /// Replaces a project's entire grid. Axis positions are given in `unit`.
    async fn set_grid_axes(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        unit: LengthUnit,
        axes: Vec<GridAxisInput>,
    ) -> Result<Vec<GridAxis>> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let mut tx = pool.begin().await?;
        sqlx::query("DELETE FROM grid_axes WHERE project_id = $1")
            .bind(project_id)
            .execute(&mut *tx)
            .await?;
        for axis in &axes {
            if axis.label.trim().is_empty() {
                return Err(async_graphql::Error::new("axis label is required"));
            }
            sqlx::query(
                "INSERT INTO grid_axes (project_id, family, label, position) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(project_id)
            .bind(axis.family.as_str())
            .bind(axis.label.trim())
            .bind(unit.to_meters(axis.position))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;

        let rows: Vec<GridAxisRow> = sqlx::query_as(
            "SELECT id, project_id, family, label, position FROM grid_axes \
             WHERE project_id = $1 ORDER BY family, position",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(rows.into_iter().map(GridAxis::from).collect())
    }

    // ----- Control points -----

    /// Adds a control point. Coordinates are given in `unit` and stored as meters.
    async fn add_control_point(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        label: String,
        northing: f64,
        easting: f64,
        elevation: Option<f64>,
        grid_x: Option<f64>,
        grid_y: Option<f64>,
        unit: LengthUnit,
        source: Option<String>,
    ) -> Result<ControlPoint> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if label.trim().is_empty() {
            return Err(async_graphql::Error::new("control point label is required"));
        }
        let cp: ControlPoint = sqlx::query_as(&format!(
            "INSERT INTO control_points \
               (project_id, label, northing, easting, elevation, grid_x, grid_y, source) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {CONTROL_POINT_COLUMNS}"
        ))
        .bind(project_id)
        .bind(label.trim())
        .bind(unit.to_meters(northing))
        .bind(unit.to_meters(easting))
        .bind(elevation.map(|e| unit.to_meters(e)))
        .bind(grid_x.map(|v| unit.to_meters(v)))
        .bind(grid_y.map(|v| unit.to_meters(v)))
        .bind(source.unwrap_or_default())
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(cp)
    }

    /// Updates a control point. Coordinate fields, when provided, are in `unit`.
    async fn update_control_point(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        label: Option<String>,
        northing: Option<f64>,
        easting: Option<f64>,
        elevation: Option<f64>,
        grid_x: Option<f64>,
        grid_y: Option<f64>,
        unit: LengthUnit,
        source: Option<String>,
    ) -> Result<ControlPoint> {
        let auth = require_editor(ctx)?;
        let cp: Option<ControlPoint> = sqlx::query_as(&format!(
            "UPDATE control_points cp SET \
               label = COALESCE($2, cp.label), \
               northing = COALESCE($3, cp.northing), \
               easting = COALESCE($4, cp.easting), \
               elevation = COALESCE($5, cp.elevation), \
               grid_x = COALESCE($6, cp.grid_x), \
               grid_y = COALESCE($7, cp.grid_y), \
               source = COALESCE($8, cp.source) \
             FROM projects p \
             WHERE cp.id = $1 AND cp.project_id = p.id AND p.org_id = $9 \
             RETURNING {}",
            CONTROL_POINT_COLUMNS
                .split(", ")
                .map(|c| format!("cp.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .bind(id)
        .bind(label)
        .bind(northing.map(|v| unit.to_meters(v)))
        .bind(easting.map(|v| unit.to_meters(v)))
        .bind(elevation.map(|v| unit.to_meters(v)))
        .bind(grid_x.map(|v| unit.to_meters(v)))
        .bind(grid_y.map(|v| unit.to_meters(v)))
        .bind(source)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        let cp = cp.ok_or_else(|| {
            async_graphql::Error::new("control point not found in your organization")
        })?;
        publish_scene(ctx, cp.project_id);
        Ok(cp)
    }

    /// Deletes a control point in the caller's organization. Editor role required.
    async fn delete_control_point(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let row: Option<(Uuid,)> = sqlx::query_as(
            "DELETE FROM control_points cp USING projects p \
             WHERE cp.id = $1 AND cp.project_id = p.id AND p.org_id = $2 \
             RETURNING cp.project_id",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        let (project_id,) = row.ok_or_else(|| {
            async_graphql::Error::new("control point not found in your organization")
        })?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    // ----- Transform -----

    /// Solves the Helmert transform from the project's control points (those with
    /// grid coordinates) and persists it. Editor role required.
    async fn solve_transform(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Transform> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let rows: Vec<SolvePointRow> = sqlx::query_as(
            "SELECT label, grid_x, grid_y, northing, easting FROM control_points \
             WHERE project_id = $1 AND grid_x IS NOT NULL AND grid_y IS NOT NULL \
             ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let correspondences: Vec<Correspondence> = rows
            .iter()
            .map(|r| Correspondence {
                grid_x: r.grid_x,
                grid_y: r.grid_y,
                proj_e: r.easting,
                proj_n: r.northing,
            })
            .collect();

        let solution = solve_helmert(&correspondences)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let residuals: Vec<TransformResidual> = solution
            .residuals
            .iter()
            .map(|res| TransformResidual {
                label: rows[res.index].label.clone(),
                delta_easting: res.de,
                delta_northing: res.dn,
                magnitude: res.magnitude,
            })
            .collect();

        // Upsert the single transform per project.
        sqlx::query(
            "INSERT INTO transforms \
               (project_id, translation_e, translation_n, rotation_rad, scale, rms_error, point_count, residuals) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             ON CONFLICT (project_id) DO UPDATE SET \
               translation_e = EXCLUDED.translation_e, translation_n = EXCLUDED.translation_n, \
               rotation_rad = EXCLUDED.rotation_rad, scale = EXCLUDED.scale, \
               rms_error = EXCLUDED.rms_error, point_count = EXCLUDED.point_count, \
               residuals = EXCLUDED.residuals, created_at = now()",
        )
        .bind(project_id)
        .bind(solution.params.tx)
        .bind(solution.params.ty)
        .bind(solution.params.rotation_rad())
        .bind(solution.params.scale())
        .bind(solution.rms)
        .bind(rows.len() as i32)
        .bind(sqlx::types::Json(&residuals))
        .execute(pool)
        .await?;
        publish_scene(ctx, project_id);

        Ok(Transform {
            translation_e: solution.params.tx,
            translation_n: solution.params.ty,
            rotation_degrees: solution.params.rotation_rad().to_degrees(),
            scale: solution.params.scale(),
            rms_error: solution.rms,
            point_count: rows.len() as i32,
            residuals,
        })
    }
}
