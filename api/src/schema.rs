//! GraphQL schema: health, auth, and tenancy-scoped user management.
// Resolvers idiomatically take many arguments (each maps to a GraphQL field arg).
#![allow(clippy::too_many_arguments)]

use async_graphql::{Context, Object, Result};
use rand::{distributions::Alphanumeric, Rng};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{
    build_clearing_cookie, build_session_cookie, hash_password, issue_jwt, verify_password,
    AuthConfig, AuthContext, Role,
};
use crate::convert::{self, Space};
use crate::geo::{solve_helmert, Correspondence, HelmertParams};
use crate::models::{
    ControlPoint, CoordinateSet, CoordinateSpace, GridAxis, GridAxisInput, GridAxisRow,
    InviteResult, LoginRow, Org, Project, ProjectRow, SignupResult, Transform, TransformResidual,
    User, UserRow,
};
use crate::units::LengthUnit;

/// Loads the persisted transform's parameters for a project, if solved.
async fn load_transform_params(pool: &PgPool, project_id: Uuid) -> Result<Option<HelmertParams>> {
    let row: Option<(f64, f64, f64, f64)> = sqlx::query_as(
        "SELECT scale, rotation_rad, translation_e, translation_n FROM transforms WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(scale, rot, tx, ty)| HelmertParams::from_components(scale, rot, tx, ty)))
}

const USER_COLUMNS: &str = "id, org_id, email, role, email_verified, created_at";
const MIN_PASSWORD_LEN: usize = 8;

fn gen_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn pool<'a>(ctx: &'a Context) -> Result<&'a PgPool> {
    ctx.data::<PgPool>()
}

fn config<'a>(ctx: &'a Context) -> Result<&'a AuthConfig> {
    ctx.data::<AuthConfig>()
}

/// The authenticated principal, or an error if the request is unauthenticated.
fn require_auth<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    ctx.data_opt::<AuthContext>()
        .ok_or_else(|| async_graphql::Error::new("not authenticated"))
}

fn require_admin<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    let auth = require_auth(ctx)?;
    if auth.role != Role::Admin {
        return Err(async_graphql::Error::new("forbidden: admin role required"));
    }
    Ok(auth)
}

/// An authenticated principal who may edit project data (Admin or Surveyor).
fn require_editor<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    let auth = require_auth(ctx)?;
    if auth.role == Role::Viewer {
        return Err(async_graphql::Error::new("forbidden: editor role required"));
    }
    Ok(auth)
}

const PROJECT_COLUMNS: &str = "id, org_id, name, description, epsg_code, display_unit, \
    combined_scale_factor, site_origin_lat, site_origin_lon, created_at, updated_at";

const CONTROL_POINT_COLUMNS: &str =
    "id, project_id, label, northing, easting, elevation, grid_x, grid_y, source";

/// Verifies a project exists and belongs to the org, returning an error otherwise.
async fn ensure_project_in_org(pool: &PgPool, project_id: Uuid, org_id: Uuid) -> Result<()> {
    let found: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM projects WHERE id = $1 AND org_id = $2")
            .bind(project_id)
            .bind(org_id)
            .fetch_optional(pool)
            .await?;
    found
        .map(|_| ())
        .ok_or_else(|| async_graphql::Error::new("project not found in your organization"))
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

async fn email_taken(pool: &PgPool, email: &str) -> Result<bool> {
    let existing: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE lower(email) = lower($1)")
            .bind(email)
            .fetch_optional(pool)
            .await?;
    Ok(existing.is_some())
}

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Liveness check.
    async fn health(&self) -> &str {
        "ok"
    }

    /// Database connectivity check.
    async fn db_status(&self, ctx: &Context<'_>) -> String {
        match sqlx::query("SELECT 1").execute(pool(ctx).unwrap()).await {
            Ok(_) => "connected".to_string(),
            Err(_) => "disconnected".to_string(),
        }
    }

    /// The currently authenticated user, or null if not logged in.
    async fn me(&self, ctx: &Context<'_>) -> Result<Option<User>> {
        let Some(auth) = ctx.data_opt::<AuthContext>() else {
            return Ok(None);
        };
        let row: Option<UserRow> = sqlx::query_as(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE id = $1 AND org_id = $2"
        ))
        .bind(auth.user_id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        Ok(row.map(User::from))
    }

    /// All users in the caller's organization. Admin only.
    async fn users(&self, ctx: &Context<'_>) -> Result<Vec<User>> {
        let auth = require_admin(ctx)?;
        let rows: Vec<UserRow> = sqlx::query_as(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE org_id = $1 ORDER BY created_at"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows.into_iter().map(User::from).collect())
    }

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

    /// Converts a coordinate (given in `unit`, in the named `space`) into every
    /// derivable representation: grid, projected (grid + ground), and geographic.
    async fn convert_coordinate(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        space: CoordinateSpace,
        x: f64,
        y: f64,
        unit: LengthUnit,
    ) -> Result<CoordinateSet> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (epsg, csf): (i32, f64) =
            sqlx::query_as("SELECT epsg_code, combined_scale_factor FROM projects WHERE id = $1")
                .bind(project_id)
                .fetch_one(pool)
                .await?;
        let params = load_transform_params(pool, project_id).await?;

        let space = match space {
            CoordinateSpace::Grid => Space::Grid,
            CoordinateSpace::Projected => Space::Projected,
        };
        let result = convert::convert(
            space,
            unit.to_meters(x),
            unit.to_meters(y),
            params,
            epsg,
            csf,
        );
        Ok(result.into())
    }
}

/// Row shape for reading a persisted transform.
#[derive(sqlx::FromRow)]
struct TransformRow {
    translation_e: f64,
    translation_n: f64,
    rotation_rad: f64,
    scale: f64,
    rms_error: f64,
    point_count: i32,
    residuals: sqlx::types::Json<Vec<TransformResidual>>,
}

impl From<TransformRow> for Transform {
    fn from(r: TransformRow) -> Self {
        Transform {
            translation_e: r.translation_e,
            translation_n: r.translation_n,
            rotation_degrees: r.rotation_rad.to_degrees(),
            scale: r.scale,
            rms_error: r.rms_error,
            point_count: r.point_count,
            residuals: r.residuals.0,
        }
    }
}

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    /// Self-service signup: creates a new organization and its first Admin user
    /// (unverified). Returns the verification token (delivered by email later).
    async fn signup(
        &self,
        ctx: &Context<'_>,
        email: String,
        password: String,
        org_name: String,
    ) -> Result<SignupResult> {
        let email = normalize_email(&email);
        if email.is_empty() || !email.contains('@') {
            return Err(async_graphql::Error::new("a valid email is required"));
        }
        if password.len() < MIN_PASSWORD_LEN {
            return Err(async_graphql::Error::new(format!(
                "password must be at least {MIN_PASSWORD_LEN} characters"
            )));
        }
        if org_name.trim().is_empty() {
            return Err(async_graphql::Error::new("organization name is required"));
        }
        let pool = pool(ctx)?;
        if email_taken(pool, &email).await? {
            return Err(async_graphql::Error::new("email is already registered"));
        }

        let password_hash = hash_password(&password).map_err(async_graphql::Error::new)?;
        let verification_token = gen_token();

        let mut tx = pool.begin().await?;
        let org: Org = sqlx::query_as::<_, (Uuid, String, chrono::DateTime<chrono::Utc>)>(
            "INSERT INTO orgs (name) VALUES ($1) RETURNING id, name, created_at",
        )
        .bind(org_name.trim())
        .fetch_one(&mut *tx)
        .await
        .map(|(id, name, created_at)| Org {
            id,
            name,
            created_at,
        })?;

        let user: User = sqlx::query_as::<_, UserRow>(&format!(
            "INSERT INTO users (org_id, email, password_hash, role, verification_token) \
             VALUES ($1, $2, $3, 'admin', $4) RETURNING {USER_COLUMNS}"
        ))
        .bind(org.id)
        .bind(&email)
        .bind(&password_hash)
        .bind(&verification_token)
        .fetch_one(&mut *tx)
        .await
        .map(User::from)?;

        tx.commit().await?;

        Ok(SignupResult {
            user,
            org,
            verification_token,
        })
    }

    /// Verifies an email address using the token issued at signup.
    async fn verify_email(&self, ctx: &Context<'_>, token: String) -> Result<bool> {
        let result =
            sqlx::query("UPDATE users SET email_verified = true, verification_token = NULL WHERE verification_token = $1")
                .bind(&token)
                .execute(pool(ctx)?)
                .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new("invalid or expired token"));
        }
        Ok(true)
    }

    /// Logs in with email + password. Sets an HTTP-only session cookie.
    async fn login(&self, ctx: &Context<'_>, email: String, password: String) -> Result<User> {
        let email = normalize_email(&email);
        let pool = pool(ctx)?;
        let row: Option<LoginRow> = sqlx::query_as(
            "SELECT id, org_id, role, email_verified, password_hash FROM users WHERE lower(email) = $1",
        )
        .bind(&email)
        .fetch_optional(pool)
        .await?;

        let row = row.ok_or_else(|| async_graphql::Error::new("invalid credentials"))?;
        let hash = row
            .password_hash
            .as_deref()
            .ok_or_else(|| async_graphql::Error::new("invalid credentials"))?;
        if !verify_password(&password, hash) {
            return Err(async_graphql::Error::new("invalid credentials"));
        }
        if !row.email_verified {
            return Err(async_graphql::Error::new("email not verified"));
        }
        let role = Role::parse(&row.role)
            .ok_or_else(|| async_graphql::Error::new("user has an invalid role"))?;

        let cfg = config(ctx)?;
        let token = issue_jwt(row.id, row.org_id, role, &cfg.jwt_secret)
            .map_err(async_graphql::Error::new)?;
        ctx.append_http_header(
            "Set-Cookie",
            build_session_cookie(&token, cfg.cookie_secure),
        );

        let user: UserRow =
            sqlx::query_as(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1"))
                .bind(row.id)
                .fetch_one(pool)
                .await?;
        Ok(user.into())
    }

    /// Clears the session cookie.
    async fn logout(&self, ctx: &Context<'_>) -> Result<bool> {
        let cfg = config(ctx)?;
        ctx.append_http_header("Set-Cookie", build_clearing_cookie(cfg.cookie_secure));
        Ok(true)
    }

    /// Invites a user into the caller's organization. Admin only. Returns the
    /// invite token (delivered by email later).
    async fn invite_user(
        &self,
        ctx: &Context<'_>,
        email: String,
        role: Role,
    ) -> Result<InviteResult> {
        let auth = require_admin(ctx)?;
        let email = normalize_email(&email);
        if email.is_empty() || !email.contains('@') {
            return Err(async_graphql::Error::new("a valid email is required"));
        }
        let pool = pool(ctx)?;
        if email_taken(pool, &email).await? {
            return Err(async_graphql::Error::new("email is already registered"));
        }
        let invite_token = gen_token();
        let user: User = sqlx::query_as::<_, UserRow>(&format!(
            "INSERT INTO users (org_id, email, role, invite_token) VALUES ($1, $2, $3, $4) \
             RETURNING {USER_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(&email)
        .bind(role.as_str())
        .bind(&invite_token)
        .fetch_one(pool)
        .await
        .map(User::from)?;

        Ok(InviteResult { user, invite_token })
    }

    /// Accepts an invite: sets the password, verifies the email, and logs in.
    async fn accept_invite(
        &self,
        ctx: &Context<'_>,
        token: String,
        password: String,
    ) -> Result<User> {
        if password.len() < MIN_PASSWORD_LEN {
            return Err(async_graphql::Error::new(format!(
                "password must be at least {MIN_PASSWORD_LEN} characters"
            )));
        }
        let pool = pool(ctx)?;
        let password_hash = hash_password(&password).map_err(async_graphql::Error::new)?;
        let user: Option<UserRow> = sqlx::query_as(&format!(
            "UPDATE users SET password_hash = $1, email_verified = true, invite_token = NULL \
             WHERE invite_token = $2 RETURNING {USER_COLUMNS}"
        ))
        .bind(&password_hash)
        .bind(&token)
        .fetch_optional(pool)
        .await?;
        let user = user.ok_or_else(|| async_graphql::Error::new("invalid or expired invite"))?;
        let user = User::from(user);

        let cfg = config(ctx)?;
        let jwt = issue_jwt(user.id, user.org_id, user.role, &cfg.jwt_secret)
            .map_err(async_graphql::Error::new)?;
        ctx.append_http_header("Set-Cookie", build_session_cookie(&jwt, cfg.cookie_secure));
        Ok(user)
    }

    /// Changes a user's role within the caller's organization. Admin only.
    async fn update_user_role(&self, ctx: &Context<'_>, user_id: Uuid, role: Role) -> Result<User> {
        let auth = require_admin(ctx)?;
        let user: Option<UserRow> = sqlx::query_as(&format!(
            "UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING {USER_COLUMNS}"
        ))
        .bind(role.as_str())
        .bind(user_id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        user.map(User::from)
            .ok_or_else(|| async_graphql::Error::new("user not found in your organization"))
    }

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
    ) -> Result<Project> {
        let auth = require_editor(ctx)?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("project name is required"));
        }
        let row: ProjectRow = sqlx::query_as(&format!(
            "INSERT INTO projects \
             (org_id, name, description, epsg_code, display_unit, combined_scale_factor, \
              site_origin_lat, site_origin_lon) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(name.trim())
        .bind(description.unwrap_or_default())
        .bind(epsg_code)
        .bind(display_unit.as_db_str())
        .bind(combined_scale_factor.unwrap_or(1.0))
        .bind(site_origin_lat)
        .bind(site_origin_lon)
        .fetch_one(pool(ctx)?)
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
        cp.ok_or_else(|| async_graphql::Error::new("control point not found in your organization"))
    }

    /// Deletes a control point in the caller's organization. Editor role required.
    async fn delete_control_point(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM control_points cp USING projects p \
             WHERE cp.id = $1 AND cp.project_id = p.id AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "control point not found in your organization",
            ));
        }
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

/// Row shape for control points used as transform correspondences.
#[derive(sqlx::FromRow)]
struct SolvePointRow {
    label: String,
    grid_x: f64,
    grid_y: f64,
    northing: f64,
    easting: f64,
}
