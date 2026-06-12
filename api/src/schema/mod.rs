//! GraphQL schema: health, auth, and tenancy-scoped user management.
// Resolvers idiomatically take many arguments (each maps to a GraphQL field arg).
#![allow(clippy::too_many_arguments)]

use std::sync::Arc;

use async_graphql::{Context, MergedObject, Object, Result};
use base64::Engine as _;
use chrono::{DateTime, Utc};
use rand::{distributions::Alphanumeric, Rng};
use sqlx::PgPool;
use uuid::Uuid;

use crate::archive;
use crate::auth::{
    build_clearing_cookie, build_session_cookie, hash_password, issue_jwt, verify_password,
    AuthConfig, AuthContext, Role,
};
use crate::convert::{self, Space};
use crate::crs;
use crate::export::{self, ExportPoint};
use crate::geo::{solve_helmert, Correspondence, HelmertParams};
use crate::import::{self, CsvMapping};
use crate::mail::Mailer;
use crate::models::{
    CadOverlay, ControlPoint, CoordinateSet, CoordinateSpace, CsvMappingInput, EpsgEntry,
    ExportColumn, ExportFormat, ExportSpace, GridAxis, GridAxisInput, GridAxisRow, ImportBatch,
    ImportFormat, ImportProfile, ImportProfileRow, InviteResult, LoginRow, Org, OrgMember,
    OrgMemberRow, PointCategory, PointGroup, Project, ProjectBuildings, ProjectRow, ProjectTerrain,
    PublicConfig, SceneData, SceneLine, ScenePoint, SignupResult, SurveyPoint, Transform,
    TransformResidual, User, UserRow,
};
use crate::pubsub::ScenePubSub;
use crate::ratelimit::{ClientIp, RateLimiter};
use crate::storage::Storage;

const CAD_OVERLAY_COLUMNS: &str = "id, project_id, original_filename, offset_e, offset_n, \
    rotation_deg, scale, elevation, assume_real_world, visible";
const TERRAIN_COLUMNS: &str = "project_id, demtype, south, north, west, east, fetched_at";
const BUILDINGS_COLUMNS: &str = "project_id, count, fetched_at";

/// Best-effort building height (meters) from OSM tags: `height`, else
/// `building:levels` × 3 m, else a 2-storey default.
fn building_height(tags: &serde_json::Value) -> f64 {
    if let Some(h) = tags.get("height").and_then(|v| v.as_str()) {
        if let Some(n) = h
            .split_whitespace()
            .next()
            .and_then(|s| s.parse::<f64>().ok())
        {
            if n > 0.0 {
                return n;
            }
        }
    }
    if let Some(l) = tags.get("building:levels").and_then(|v| v.as_str()) {
        if let Ok(n) = l.trim().parse::<f64>() {
            return (n * 3.0).max(2.0);
        }
    }
    6.0
}

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
use crate::units::LengthUnit;

const CATEGORY_COLUMNS: &str = "id, org_id, name, color, icon, is_default";
const SURVEY_POINT_COLUMNS: &str = "id, project_id, label, northing, easting, elevation, \
    description, category_id, tags, import_batch_id";

/// The default category set seeded for every new organization.
const DEFAULT_CATEGORIES: &[(&str, &str, &str)] = &[
    ("Control/Reference", "#ef4444", "target"),
    ("Station/Setup", "#f59e0b", "station"),
    ("Column", "#3b82f6", "column"),
    ("Corner", "#8b5cf6", "corner"),
    ("Spot/Elevation", "#10b981", "spot"),
    ("Utility", "#6b7280", "utility"),
    ("Other", "#94a3b8", "other"),
];

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

fn storage<'a>(ctx: &'a Context) -> Result<&'a Arc<dyn Storage>> {
    ctx.data::<Arc<dyn Storage>>()
}

fn mailer<'a>(ctx: &'a Context) -> Result<&'a Mailer> {
    ctx.data::<Mailer>()
}

/// Maps a missing org-scoped lookup to the uniform "not found in your
/// organization" error (e.g. `found_in_org(row, "project")`).
fn found_in_org<T>(opt: Option<T>, what: &str) -> Result<T> {
    opt.ok_or_else(|| async_graphql::Error::new(format!("{what} not found in your organization")))
}

/// Prefixes each comma-separated column with `alias.` — for the RETURNING clause
/// of an org-scoped `UPDATE ... FROM projects p` join.
fn qualify_columns(columns: &str, alias: &str) -> String {
    columns
        .split(", ")
        .map(|c| format!("{alias}.{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Normalizes a coordinate input to the converter's units: geographic stays in
/// degrees (x = lon, y = lat); every other space is linear, converted to meters.
fn normalize_input(space: Space, x: f64, y: f64, unit: LengthUnit) -> (f64, f64) {
    match space {
        Space::Geographic => (x, y),
        _ => (unit.to_meters(x), unit.to_meters(y)),
    }
}

/// Enforces the per-IP auth rate limit for `action` (e.g. "login", "signup").
/// A no-op if no limiter is present in context; errors when the limit is hit.
async fn enforce_rate_limit(ctx: &Context<'_>, action: &str) -> Result<()> {
    if let Some(limiter) = ctx.data_opt::<RateLimiter>() {
        let ip = ctx
            .data_opt::<ClientIp>()
            .map(|c| c.0.as_str())
            .unwrap_or("unknown");
        if !limiter.check(&format!("{action}:{ip}")).await {
            return Err(async_graphql::Error::new(
                "too many attempts; please wait a minute and try again",
            ));
        }
    }
    Ok(())
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

/// Like [`require_editor`], but also blocks every data mutation when the org is in
/// the read-only (restricted) billing state — a lapsed subscription over the Solo
/// caps. Used by all data-editing resolvers; billing mutations intentionally don't
/// call it (so a restricted org can still upgrade).
async fn require_editor_active<'a>(ctx: &'a Context<'a>) -> Result<&'a AuthContext> {
    let auth = require_editor(ctx)?;
    if crate::billing::org_billing(pool(ctx)?, auth.org_id)
        .await?
        .restricted()
    {
        return Err(async_graphql::Error::new(
            "Your organization is read-only — its subscription has lapsed. Upgrade to Crew to make changes.",
        ));
    }
    Ok(auth)
}

/// Blocks a Crew-only feature unless the org is on a paid plan.
async fn require_paid(ctx: &Context<'_>, feature: &str) -> Result<()> {
    let auth = require_auth(ctx)?;
    if !crate::billing::org_billing(pool(ctx)?, auth.org_id)
        .await?
        .paid()
    {
        return Err(async_graphql::Error::new(format!(
            "{feature} is a Crew feature. Upgrade to use it."
        )));
    }
    Ok(())
}

/// Blocks exports unless the org is on a paid plan (Solo has no export).
async fn require_export(ctx: &Context<'_>) -> Result<()> {
    require_paid(ctx, "Exporting points").await
}

/// Blocks creating another project once a free org is at the Solo project cap.
async fn require_project_quota(ctx: &Context<'_>) -> Result<()> {
    let auth = require_auth(ctx)?;
    let b = crate::billing::org_billing(pool(ctx)?, auth.org_id).await?;
    if !b.paid() && b.projects >= crate::billing::FREE_MAX_PROJECTS {
        return Err(async_graphql::Error::new(
            "The Solo plan is limited to 1 project. Upgrade to Crew for unlimited projects.",
        ));
    }
    Ok(())
}

/// Blocks adding a member/admin beyond the Solo caps. `new_admin` = the user being
/// added/promoted will be an admin.
async fn require_member_quota(ctx: &Context<'_>, new_admin: bool) -> Result<()> {
    let auth = require_auth(ctx)?;
    let b = crate::billing::org_billing(pool(ctx)?, auth.org_id).await?;
    if b.paid() {
        return Ok(());
    }
    if new_admin && b.admins >= crate::billing::FREE_MAX_ADMINS {
        return Err(async_graphql::Error::new(
            "The Solo plan allows 1 admin. Upgrade to Crew for more.",
        ));
    }
    if !new_admin && b.non_admin >= crate::billing::FREE_MAX_NON_ADMIN {
        return Err(async_graphql::Error::new(
            "The Solo plan allows up to 5 members. Upgrade to Crew for unlimited members.",
        ));
    }
    Ok(())
}

/// Notifies live scene subscribers that the project changed. Best-effort: a
/// missing hub (e.g. in a minimal test schema) is silently ignored.
fn publish_scene(ctx: &Context<'_>, project_id: Uuid) {
    if let Ok(hub) = ctx.data::<ScenePubSub>() {
        hub.publish(project_id);
    }
}

/// Like [`publish_scene`] for a bulk op spanning possibly several projects;
/// publishes each distinct project once.
fn publish_scenes(ctx: &Context<'_>, project_ids: impl IntoIterator<Item = Uuid>) {
    let Ok(hub) = ctx.data::<ScenePubSub>() else {
        return;
    };
    let mut seen = std::collections::HashSet::new();
    for pid in project_ids {
        if seen.insert(pid) {
            hub.publish(pid);
        }
    }
}

const PROJECT_COLUMNS: &str = "id, org_id, name, description, epsg_code, display_unit, \
    combined_scale_factor, site_origin_lat, site_origin_lon, site_origin_rotation_deg, \
    created_at, updated_at";

/// Builds the site rotation about a given projected pivot, or None when there's
/// no rotation or no pivot. The pivot is the centroid of the project's points
/// (see `points_centroid`) so the site spins about the middle of the survey
/// rather than an arbitrary origin. Rotation is purely in the easting/northing
/// plane — i.e. about the vertical (Z) axis — so elevations are unaffected, and
/// only the points and grid turn (terrain/buildings are placed geographically).
fn site_rotation(pivot: Option<(f64, f64)>, rotation_deg: f64) -> Option<convert::SiteRotation> {
    if rotation_deg == 0.0 {
        return None;
    }
    let (pivot_e, pivot_n) = pivot?;
    Some(convert::SiteRotation {
        pivot_e,
        pivot_n,
        theta_rad: rotation_deg.to_radians(),
    })
}

/// Centroid (projected easting/northing) of every control and survey point in
/// the project — the pivot the site rotation turns about. None when the project
/// has no points yet (nothing to rotate about).
async fn points_centroid(pool: &PgPool, project_id: Uuid) -> Result<Option<(f64, f64)>> {
    let row: (Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT AVG(easting), AVG(northing) FROM ( \
            SELECT easting, northing FROM control_points WHERE project_id = $1 \
            UNION ALL \
            SELECT easting, northing FROM survey_points WHERE project_id = $1 \
         ) pts",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    Ok(match row {
        (Some(e), Some(n)) => Some((e, n)),
        _ => None,
    })
}

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

/// A project's coordinate-reference context: EPSG, combined scale factor, the
/// solved Helmert params (if any), and the site rotation about the points'
/// centroid (if any) — everything a coordinate-aware resolver needs. Org-scoped:
/// errors with the uniform "not found" if the project isn't in `org_id`, so it
/// also serves as the ownership check (no separate `ensure_project_in_org`).
struct ProjectCrs {
    epsg: i32,
    csf: f64,
    params: Option<HelmertParams>,
    rotation: Option<convert::SiteRotation>,
}

async fn load_project_crs(pool: &PgPool, project_id: Uuid, org_id: Uuid) -> Result<ProjectCrs> {
    let row: Option<(i32, f64, f64)> = sqlx::query_as(
        "SELECT epsg_code, combined_scale_factor, site_origin_rotation_deg \
         FROM projects WHERE id = $1 AND org_id = $2",
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let (epsg, csf, rot_deg) = found_in_org(row, "project")?;
    let params = load_transform_params(pool, project_id).await?;
    let rotation = site_rotation(points_centroid(pool, project_id).await?, rot_deg);
    Ok(ProjectCrs {
        epsg,
        csf,
        params,
        rotation,
    })
}

/// Outcome of the refresh cooldown check (see [`refresh_cooldown`]).
enum Refresh<T> {
    /// A cached row exists and no forced refresh was requested — return it.
    Cached(T),
    /// No cache (or a forced refresh past the cooldown) — go fetch.
    Proceed,
}

/// Shared cache + 7-day cooldown gate for the terrain/buildings refresh mutations.
/// Reads `fetched_at` from `table`; if present and not `force`, returns the cached
/// row (`SELECT {columns}`); if present, `force`, and still within 7 days, errors
/// with "{subject} refreshed recently…". `subject` is the full phrase up to the
/// verb (e.g. "Terrain was", "Buildings were") so each message reads naturally.
async fn refresh_cooldown<T>(
    pool: &PgPool,
    table: &str,
    columns: &str,
    subject: &str,
    project_id: Uuid,
    force: bool,
) -> Result<Refresh<T>>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> + Send + Unpin,
{
    let existing: Option<(DateTime<Utc>,)> = sqlx::query_as(&format!(
        "SELECT fetched_at FROM {table} WHERE project_id = $1"
    ))
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    if let Some((fetched_at,)) = existing {
        if !force {
            let row = sqlx::query_as(&format!(
                "SELECT {columns} FROM {table} WHERE project_id = $1"
            ))
            .bind(project_id)
            .fetch_one(pool)
            .await?;
            return Ok(Refresh::Cached(row));
        }
        let age = Utc::now() - fetched_at;
        if age < chrono::Duration::days(7) {
            let days = (7 - age.num_days()).max(1);
            return Err(async_graphql::Error::new(format!(
                "{subject} refreshed recently — try again in {days} day(s)."
            )));
        }
    }
    Ok(Refresh::Proceed)
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

mod auth;
mod billing;
mod coords;
mod grid;
mod overlays;
mod points;
mod projects;
mod scene;
mod subscription;
mod system;
mod terrain;

pub use subscription::SubscriptionRoot;

/// The GraphQL query root — a merge of the per-domain query objects.
#[derive(MergedObject, Default)]
pub struct QueryRoot(
    system::SystemQuery,
    auth::AuthQuery,
    projects::ProjectQuery,
    grid::GridQuery,
    points::PointsQuery,
    overlays::OverlayQuery,
    terrain::TerrainQuery,
    coords::CoordsQuery,
    scene::SceneQuery,
    billing::BillingQuery,
);

/// The GraphQL mutation root — a merge of the per-domain mutation objects.
#[derive(MergedObject, Default)]
pub struct MutationRoot(
    auth::AuthMutation,
    projects::ProjectMutation,
    grid::GridMutation,
    points::PointsMutation,
    overlays::OverlayMutation,
    terrain::TerrainMutation,
    billing::BillingMutation,
);

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

/// CSV header label for an export column.
fn column_header(c: &ExportColumn) -> String {
    match c {
        ExportColumn::Point => "Point",
        ExportColumn::Northing => "Northing",
        ExportColumn::Easting => "Easting",
        ExportColumn::Elevation => "Elevation",
        ExportColumn::Description => "Description",
        ExportColumn::Latitude => "Latitude",
        ExportColumn::Longitude => "Longitude",
    }
    .to_string()
}

/// Converts a GraphQL CSV mapping into the parser's mapping (validating indices).
fn to_csv_mapping(m: &CsvMappingInput) -> Result<CsvMapping> {
    let idx = |v: i32, what: &str| -> Result<usize> {
        usize::try_from(v).map_err(|_| async_graphql::Error::new(format!("invalid {what} column")))
    };
    let opt = |v: Option<i32>, what: &str| -> Result<Option<usize>> {
        v.map(|x| idx(x, what)).transpose()
    };
    Ok(CsvMapping {
        has_header: m.has_header,
        label_col: opt(m.label_col, "label")?,
        northing_col: idx(m.northing_col, "northing")?,
        easting_col: idx(m.easting_col, "easting")?,
        elevation_col: opt(m.elevation_col, "elevation")?,
        description_col: opt(m.description_col, "description")?,
    })
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
