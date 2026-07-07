//! Shared resolver toolkit — the prelude every schema submodule pulls in via
//! `use super::*`.
//!
//! This module re-exports the imports the resolver modules rely on and defines
//! the cross-cutting helpers they share: context accessors, auth/tenancy guards,
//! the plan (Crew) gate, and the coordinate-reference helpers. Domain-specific
//! support (per-table column lists, row structs, feature helpers) lives in the
//! owning resolver module, not here.

use std::sync::Arc;

// Re-exported prelude: these flow to every sibling resolver module through
// `mod.rs`'s `pub(crate) use common::*` + each module's `use super::*`.
pub(crate) use async_graphql::{Context, Object, Result};
pub(crate) use chrono::{DateTime, Utc};
pub(crate) use sqlx::PgPool;
pub(crate) use uuid::Uuid;

pub(crate) use crate::archive;
pub(crate) use crate::auth::{
    build_clearing_cookie, build_session_cookie, hash_password, issue_jwt, verify_password,
    AuthConfig, AuthContext, Role,
};
pub(crate) use crate::convert::{self, Space};
pub(crate) use crate::crs;
pub(crate) use crate::export::{self, ExportPoint};
pub(crate) use crate::geo::{solve_helmert, Correspondence, HelmertParams};
pub(crate) use crate::import::{self, CsvMapping};
pub(crate) use crate::mail::Mailer;
pub(crate) use crate::models::{
    CadOverlay, ControlPoint, CoordinateSet, CoordinateSpace, CsvMappingInput, EpsgEntry,
    ExportColumn, ExportFormat, ExportSpace, GridAxis, GridAxisInput, GridAxisRow, ImportBatch,
    ImportFormat, ImportProfile, ImportProfileRow, InviteResult, LoginRow, Org, OrgMember,
    OrgMemberRow, PointCategory, PointGroup, Project, ProjectBuildings, ProjectRow, ProjectTerrain,
    PublicConfig, SceneData, SceneLine, ScenePoint, SceneUtilityRun, SceneUtilityStructure,
    SignupResult, SurveyPoint, Transform, TransformResidual, User, UserRow,
};
pub(crate) use crate::plan::{Feature, Plan};
pub(crate) use crate::pubsub::ScenePubSub;
pub(crate) use crate::ratelimit::{ClientIp, RateLimiter};
pub(crate) use crate::storage::Storage;
pub(crate) use crate::units::LengthUnit;

// --- Context accessors -----------------------------------------------------

pub(crate) fn pool<'a>(ctx: &'a Context) -> Result<&'a PgPool> {
    ctx.data::<PgPool>()
}

pub(crate) fn config<'a>(ctx: &'a Context) -> Result<&'a AuthConfig> {
    ctx.data::<AuthConfig>()
}

pub(crate) fn storage<'a>(ctx: &'a Context) -> Result<&'a Arc<dyn Storage>> {
    ctx.data::<Arc<dyn Storage>>()
}

pub(crate) fn mailer<'a>(ctx: &'a Context) -> Result<&'a Mailer> {
    ctx.data::<Mailer>()
}

// --- Tenancy + small utilities ---------------------------------------------

/// Maps a missing org-scoped lookup to the uniform "not found in your
/// organization" error (e.g. `found_in_org(row, "project")`).
pub(crate) fn found_in_org<T>(opt: Option<T>, what: &str) -> Result<T> {
    opt.ok_or_else(|| async_graphql::Error::new(format!("{what} not found in your organization")))
}

/// Prefixes each comma-separated column with `alias.` — for the RETURNING clause
/// of an org-scoped `UPDATE ... FROM projects p` join.
pub(crate) fn qualify_columns(columns: &str, alias: &str) -> String {
    columns
        .split(", ")
        .map(|c| format!("{alias}.{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Normalizes a coordinate input to the converter's units: geographic stays in
/// degrees (x = lon, y = lat); every other space is linear, converted to meters.
pub(crate) fn normalize_input(space: Space, x: f64, y: f64, unit: LengthUnit) -> (f64, f64) {
    match space {
        Space::Geographic => (x, y),
        _ => (unit.to_meters(x), unit.to_meters(y)),
    }
}

/// Verifies a project exists and belongs to the org, returning an error otherwise.
pub(crate) async fn ensure_project_in_org(
    pool: &PgPool,
    project_id: Uuid,
    org_id: Uuid,
) -> Result<()> {
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

// --- Auth / plan guards ----------------------------------------------------

/// The authenticated principal, or an error if the request is unauthenticated.
pub(crate) fn require_auth<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    ctx.data_opt::<AuthContext>()
        .ok_or_else(|| async_graphql::Error::new("not authenticated"))
}

pub(crate) fn require_admin<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    let auth = require_auth(ctx)?;
    if auth.role != Role::Admin {
        return Err(async_graphql::Error::new("forbidden: admin role required"));
    }
    Ok(auth)
}

/// An authenticated principal who may edit project data (Admin or Surveyor).
pub(crate) fn require_editor<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
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
pub(crate) async fn require_editor_active<'a>(ctx: &'a Context<'a>) -> Result<&'a AuthContext> {
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

/// Blocks a gated feature unless the org's plan unlocks it (per the `plan`
/// catalog). The error message is built from the feature's catalog label, so
/// call sites never hard-code feature names.
pub(crate) async fn require_feature(ctx: &Context<'_>, feature: Feature) -> Result<()> {
    let auth = require_auth(ctx)?;
    if !crate::billing::org_billing(pool(ctx)?, auth.org_id)
        .await?
        .has_feature(feature)
    {
        let meta = feature.meta();
        return Err(async_graphql::Error::new(format!(
            "{} is a Crew feature. Upgrade to use it.",
            meta.label
        )));
    }
    Ok(())
}

/// Blocks exports unless the org's plan includes the export feature.
pub(crate) async fn require_export(ctx: &Context<'_>) -> Result<()> {
    require_feature(ctx, Feature::Export).await
}

// --- Live scene notifications ----------------------------------------------

/// Notifies live scene subscribers that the project changed. Best-effort: a
/// missing hub (e.g. in a minimal test schema) is silently ignored.
pub(crate) fn publish_scene(ctx: &Context<'_>, project_id: Uuid) {
    if let Ok(hub) = ctx.data::<ScenePubSub>() {
        hub.publish(project_id);
    }
}

// --- Coordinate-reference helpers ------------------------------------------

/// Loads the persisted transform's parameters for a project, if solved.
pub(crate) async fn load_transform_params(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<Option<HelmertParams>> {
    let row: Option<(f64, f64, f64, f64)> = sqlx::query_as(
        "SELECT scale, rotation_rad, translation_e, translation_n FROM transforms WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(scale, rot, tx, ty)| HelmertParams::from_components(scale, rot, tx, ty)))
}

/// Builds the site rotation about a given projected pivot, or None when there's
/// no rotation or no pivot. The pivot is the centroid of the project's points
/// (see `points_centroid`) so the site spins about the middle of the survey
/// rather than an arbitrary origin. Rotation is purely in the easting/northing
/// plane — i.e. about the vertical (Z) axis — so elevations are unaffected, and
/// only the points and grid turn (terrain/buildings are placed geographically).
pub(crate) fn site_rotation(
    pivot: Option<(f64, f64)>,
    rotation_deg: f64,
) -> Option<convert::SiteRotation> {
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
pub(crate) async fn points_centroid(pool: &PgPool, project_id: Uuid) -> Result<Option<(f64, f64)>> {
    let row: (Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT AVG(easting), AVG(northing) FROM ( \
            SELECT easting, northing FROM control_points WHERE project_id = $1 \
            UNION ALL \
            SELECT easting, northing FROM survey_points \
                WHERE project_id = $1 AND point_type = 'design' \
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

/// A project's coordinate-reference context: EPSG, combined scale factor, the
/// solved Helmert params (if any), and the site rotation about the points'
/// centroid (if any) — everything a coordinate-aware resolver needs. Org-scoped:
/// errors with the uniform "not found" if the project isn't in `org_id`, so it
/// also serves as the ownership check (no separate `ensure_project_in_org`).
pub(crate) struct ProjectCrs {
    pub epsg: i32,
    pub csf: f64,
    pub params: Option<HelmertParams>,
    pub rotation: Option<convert::SiteRotation>,
}

pub(crate) async fn load_project_crs(
    pool: &PgPool,
    project_id: Uuid,
    org_id: Uuid,
) -> Result<ProjectCrs> {
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
