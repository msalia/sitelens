//! GraphQL schema: health, auth, and tenancy-scoped user management.
// Resolvers idiomatically take many arguments (each maps to a GraphQL field arg).
#![allow(clippy::too_many_arguments)]

use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use rand::{distributions::Alphanumeric, Rng};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{
    build_clearing_cookie, build_session_cookie, hash_password, issue_jwt, verify_password,
    AuthConfig, AuthContext, Role,
};
use crate::convert::{self, Space};
use crate::crs;
use crate::export::{self, ExportPoint};
use crate::geo::{solve_helmert, Correspondence, HelmertParams};
use crate::import::{self, CsvMapping};
use crate::models::{
    CadOverlay, ControlPoint, CoordinateSet, CoordinateSpace, CsvMappingInput, EpsgEntry,
    ExportColumn, ExportFormat, ExportSpace, GridAxis, GridAxisInput, GridAxisRow, ImportBatch,
    ImportFormat, ImportProfile, ImportProfileRow, InviteResult, LoginRow, Org, PointCategory,
    PointGroup, Project, ProjectRow, PublicConfig, SceneData, SceneLine, ScenePoint, SignupResult,
    SurveyPoint, Transform, TransformResidual, User, UserRow,
};
use crate::ratelimit::{ClientIp, RateLimiter};
use crate::storage::Storage;

const CAD_OVERLAY_COLUMNS: &str = "id, project_id, original_filename, offset_e, offset_n, \
    rotation_deg, scale, assume_real_world, visible";

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
    row.map(|(k,)| k)
        .ok_or_else(|| async_graphql::Error::new("overlay not found in your organization"))
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

    /// Public runtime config the client needs (e.g. the shared Cesium Ion token).
    async fn public_config(&self, ctx: &Context<'_>) -> Result<PublicConfig> {
        let cfg = config(ctx)?;
        Ok(PublicConfig {
            cesium_ion_token: cfg.cesium_ion_token.clone(),
        })
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

    /// The caller organization's point categories (defaults + custom).
    async fn categories(&self, ctx: &Context<'_>) -> Result<Vec<PointCategory>> {
        let auth = require_auth(ctx)?;
        let rows: Vec<PointCategory> = sqlx::query_as(&format!(
            "SELECT {CATEGORY_COLUMNS} FROM point_categories WHERE org_id = $1 \
             ORDER BY is_default DESC, name"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows)
    }

    /// Surveyed points for a project, optionally filtered by free-text search
    /// (label/description/tags) and/or category. Paginated: `limit` is clamped to
    /// [1, 1000] (default 200) so the list query is always bounded.
    async fn survey_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        search: Option<String>,
        category_id: Option<Uuid>,
        limit: Option<i64>,
        offset: Option<i64>,
        sort: Option<String>,
        descending: Option<bool>,
    ) -> Result<Vec<SurveyPoint>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        let offset = offset.unwrap_or(0).max(0);
        // Whitelist the sort column (never interpolate user input directly).
        let sort_col = match sort.as_deref() {
            Some("label") => "label",
            Some("northing") => "northing",
            Some("easting") => "easting",
            Some("elevation") => "elevation",
            _ => "seq",
        };
        let dir = if descending.unwrap_or(false) {
            "DESC"
        } else {
            "ASC"
        };
        let rows: Vec<SurveyPoint> = sqlx::query_as(&format!(
            "SELECT {SURVEY_POINT_COLUMNS} FROM survey_points WHERE project_id = $1 \
             AND ($2::text IS NULL OR label ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' \
                  OR array_to_string(tags, ' ') ILIKE '%'||$2||'%') \
             AND ($3::uuid IS NULL OR category_id = $3) \
             ORDER BY {sort_col} {dir} NULLS LAST, seq ASC LIMIT $4 OFFSET $5"
        ))
        .bind(project_id)
        .bind(search)
        .bind(category_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Total count of surveyed points matching the same filters as `surveyPoints`.
    /// Lets the UI paginate without fetching every row.
    async fn survey_point_count(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        search: Option<String>,
        category_id: Option<Uuid>,
    ) -> Result<i64> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());
        let (count,): (i64,) = sqlx::query_as(
            "SELECT count(*) FROM survey_points WHERE project_id = $1 \
             AND ($2::text IS NULL OR label ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' \
                  OR array_to_string(tags, ' ') ILIKE '%'||$2||'%') \
             AND ($3::uuid IS NULL OR category_id = $3)",
        )
        .bind(project_id)
        .bind(search)
        .bind(category_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// Import batches for a project.
    async fn import_batches(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ImportBatch>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ImportBatch> = sqlx::query_as(
            "SELECT id, project_id, source_filename, format, row_count FROM import_batches \
             WHERE project_id = $1 ORDER BY created_at DESC",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Saved CSV import profiles for a project.
    async fn import_profiles(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ImportProfile>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ImportProfileRow> = sqlx::query_as(
            "SELECT id, project_id, name, unit, mapping FROM import_profiles \
             WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(ImportProfile::from).collect())
    }

    /// Saved point groups (named selections) for a project.
    async fn point_groups(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<PointGroup>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<PointGroup> = sqlx::query_as(
            "SELECT id, project_id, name, member_ids FROM point_groups \
             WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// DXF overlays for a project.
    async fn cad_overlays(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<CadOverlay>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
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
        let key = overlay_key_in_org(pool(ctx)?, id, auth.org_id).await?;
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        String::from_utf8(bytes)
            .map_err(|_| async_graphql::Error::new("overlay is not valid UTF-8"))
    }

    /// Searches the EPSG coordinate-reference-system catalog by code or name.
    async fn search_epsg(
        &self,
        ctx: &Context<'_>,
        query: String,
        limit: Option<i32>,
    ) -> Result<Vec<EpsgEntry>> {
        require_auth(ctx)?;
        let limit = limit.unwrap_or(25).clamp(1, 100) as usize;
        Ok(crs::search_epsg(&query, limit)
            .into_iter()
            .map(|(code, name)| EpsgEntry { code, name })
            .collect())
    }

    /// Exports points as CSV or LandXML in a chosen space + unit + column order.
    /// Filter by explicit `pointIds` and/or `categoryId` (all points if neither).
    async fn export_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: ExportFormat,
        space: ExportSpace,
        unit: LengthUnit,
        columns: Option<Vec<ExportColumn>>,
        point_ids: Option<Vec<Uuid>>,
        category_id: Option<Uuid>,
    ) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (epsg, csf): (i32, f64) =
            sqlx::query_as("SELECT epsg_code, combined_scale_factor FROM projects WHERE id = $1")
                .bind(project_id)
                .fetch_one(pool)
                .await?;
        let params = load_transform_params(pool, project_id).await?;
        if space == ExportSpace::Grid && params.is_none() {
            return Err(async_graphql::Error::new(
                "grid export requires a solved transform",
            ));
        }

        type Row = (Uuid, String, f64, f64, Option<f64>, String);
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT id, label, northing, easting, elevation, description FROM survey_points \
             WHERE project_id = $1 \
               AND ($2::uuid[] IS NULL OR id = ANY($2)) \
               AND ($3::uuid IS NULL OR category_id = $3) \
             ORDER BY created_at",
        )
        .bind(project_id)
        .bind(point_ids.as_deref())
        .bind(category_id)
        .fetch_all(pool)
        .await?;

        let cols = columns.unwrap_or_else(|| {
            vec![
                ExportColumn::Point,
                ExportColumn::Northing,
                ExportColumn::Easting,
                ExportColumn::Elevation,
                ExportColumn::Description,
            ]
        });

        let fmt_lin = |v: f64| format!("{v:.4}");
        let fmt_deg = |v: f64| format!("{v:.8}");

        // Northing/easting for the chosen space, in the export unit (degrees for geographic).
        let space_ne = |e_m: f64, n_m: f64| -> (f64, f64) {
            match space {
                ExportSpace::ProjectedGrid => (unit.from_meters(n_m), unit.from_meters(e_m)),
                ExportSpace::ProjectedGround => {
                    (unit.from_meters(n_m / csf), unit.from_meters(e_m / csf))
                }
                ExportSpace::Grid => {
                    let (x, y) = params.map(|t| t.inverse(e_m, n_m)).unwrap_or((0.0, 0.0));
                    (unit.from_meters(y), unit.from_meters(x))
                }
                ExportSpace::Geographic => {
                    let (lat, lon) =
                        crs::projected_to_geographic(epsg, e_m, n_m).unwrap_or((0.0, 0.0));
                    (lat, lon)
                }
            }
        };

        let mut csv_rows = Vec::with_capacity(rows.len());
        let mut xml_points = Vec::with_capacity(rows.len());
        for (_, label, n_m, e_m, z_m, description) in &rows {
            let (north, east) = space_ne(*e_m, *n_m);
            let latlon = crs::projected_to_geographic(epsg, *e_m, *n_m);
            let z_unit = z_m.map(|z| unit.from_meters(z));
            let is_geo = space == ExportSpace::Geographic;

            let cells: Vec<String> = cols
                .iter()
                .map(|c| match c {
                    ExportColumn::Point => label.clone(),
                    ExportColumn::Description => description.clone(),
                    ExportColumn::Northing => {
                        if is_geo {
                            fmt_deg(north)
                        } else {
                            fmt_lin(north)
                        }
                    }
                    ExportColumn::Easting => {
                        if is_geo {
                            fmt_deg(east)
                        } else {
                            fmt_lin(east)
                        }
                    }
                    ExportColumn::Elevation => z_unit.map(fmt_lin).unwrap_or_default(),
                    ExportColumn::Latitude => latlon.map(|(la, _)| fmt_deg(la)).unwrap_or_default(),
                    ExportColumn::Longitude => {
                        latlon.map(|(_, lo)| fmt_deg(lo)).unwrap_or_default()
                    }
                })
                .collect();
            csv_rows.push(cells);

            xml_points.push(ExportPoint {
                name: label.clone(),
                description: description.clone(),
                northing: north,
                easting: east,
                elevation: z_unit,
            });
        }

        Ok(match format {
            ExportFormat::Csv => {
                let headers: Vec<String> = cols.iter().map(column_header).collect();
                export::to_csv(&headers, &csv_rows)
            }
            ExportFormat::Landxml => export::to_landxml(&xml_points),
        })
    }

    /// Everything the 3D viewer needs, pre-projected to geographic coordinates.
    async fn scene_data(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<SceneData> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (epsg, lat, lon): (i32, Option<f64>, Option<f64>) = sqlx::query_as(
            "SELECT epsg_code, site_origin_lat, site_origin_lon FROM projects WHERE id = $1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?;
        let params = load_transform_params(pool, project_id).await?;

        let to_scene = |id: Option<Uuid>,
                        label: String,
                        e: f64,
                        n: f64,
                        z: Option<f64>,
                        cat: Option<Uuid>|
         -> Option<ScenePoint> {
            crs::projected_to_geographic(epsg, e, n).map(|(latitude, longitude)| ScenePoint {
                id,
                label,
                latitude,
                longitude,
                height: z.unwrap_or(0.0),
                easting: e,
                northing: n,
                category_id: cat,
            })
        };

        let cps: Vec<(String, f64, f64, Option<f64>)> = sqlx::query_as(
            "SELECT label, easting, northing, elevation FROM control_points \
             WHERE project_id = $1 ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let control_points: Vec<ScenePoint> = cps
            .into_iter()
            .filter_map(|(label, e, n, z)| to_scene(None, label, e, n, z, None))
            .collect();

        type SurveyRow = (Uuid, String, f64, f64, Option<f64>, Option<Uuid>);
        let sps: Vec<SurveyRow> = sqlx::query_as(
            "SELECT id, label, easting, northing, elevation, category_id FROM survey_points \
             WHERE project_id = $1 ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let survey_points: Vec<ScenePoint> = sps
            .into_iter()
            .filter_map(|(id, label, e, n, z, cat)| to_scene(Some(id), label, e, n, z, cat))
            .collect();

        // Grid lines need the transform to place axes in projected space.
        let mut grid_lines = Vec::new();
        if let Some(t) = params {
            let axes: Vec<(String, String, f64)> = sqlx::query_as(
                "SELECT family, label, position FROM grid_axes WHERE project_id = $1",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?;
            let span = |vals: Vec<f64>| -> (f64, f64) {
                if vals.is_empty() {
                    (-50.0, 50.0)
                } else {
                    let min = vals.iter().cloned().fold(f64::INFINITY, f64::min);
                    let max = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                    (min, max)
                }
            };
            let (xmin, xmax) = span(
                axes.iter()
                    .filter(|(f, _, _)| f == "numbered")
                    .map(|(_, _, p)| *p)
                    .collect(),
            );
            let (ymin, ymax) = span(
                axes.iter()
                    .filter(|(f, _, _)| f == "lettered")
                    .map(|(_, _, p)| *p)
                    .collect(),
            );
            for (family, label, pos) in &axes {
                let ends = if family == "lettered" {
                    [(xmin, *pos), (xmax, *pos)]
                } else {
                    [(*pos, ymin), (*pos, ymax)]
                };
                let coords: Vec<crate::models::LatLng> = ends
                    .iter()
                    .filter_map(|&(gx, gy)| {
                        let (e, n) = t.apply(gx, gy);
                        crs::projected_to_geographic(epsg, e, n).map(|(latitude, longitude)| {
                            crate::models::LatLng {
                                latitude,
                                longitude,
                                height: 0.0,
                            }
                        })
                    })
                    .collect();
                if coords.len() == 2 {
                    grid_lines.push(SceneLine {
                        label: label.clone(),
                        coordinates: coords,
                    });
                }
            }
        }

        let origin = match (lat, lon) {
            (Some(latitude), Some(longitude)) => Some(crate::models::LatLng {
                latitude,
                longitude,
                height: 0.0,
            }),
            _ => control_points
                .first()
                .or(survey_points.first())
                .map(|p| crate::models::LatLng {
                    latitude: p.latitude,
                    longitude: p.longitude,
                    height: 0.0,
                }),
        };
        let origin_proj = match (lat, lon) {
            (Some(la), Some(lo)) => crs::geographic_to_projected(epsg, la, lo),
            _ => control_points
                .first()
                .or(survey_points.first())
                .map(|p| (p.easting, p.northing)),
        };

        Ok(SceneData {
            origin,
            origin_projected_e: origin_proj.map(|(e, _)| e),
            origin_projected_n: origin_proj.map(|(_, n)| n),
            control_points,
            survey_points,
            grid_lines,
        })
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
        enforce_rate_limit(ctx, "signup").await?;
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

        // Seed the default point categories for the new org.
        for (name, color, icon) in DEFAULT_CATEGORIES {
            sqlx::query(
                "INSERT INTO point_categories (org_id, name, color, icon, is_default) \
                 VALUES ($1, $2, $3, $4, true)",
            )
            .bind(org.id)
            .bind(name)
            .bind(color)
            .bind(icon)
            .execute(&mut *tx)
            .await?;
        }

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
        enforce_rate_limit(ctx, "login").await?;
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

    // ----- Categories -----

    /// Creates a custom point category for the caller's organization.
    async fn create_category(
        &self,
        ctx: &Context<'_>,
        name: String,
        color: String,
        icon: String,
    ) -> Result<PointCategory> {
        let auth = require_editor(ctx)?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("category name is required"));
        }
        let cat: PointCategory = sqlx::query_as(&format!(
            "INSERT INTO point_categories (org_id, name, color, icon, is_default) \
             VALUES ($1, $2, $3, $4, false) RETURNING {CATEGORY_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(name.trim())
        .bind(color)
        .bind(icon)
        .fetch_one(pool(ctx)?)
        .await?;
        Ok(cat)
    }

    // ----- Import -----

    /// Imports points from CSV or LandXML content. Coordinates in `unit` are
    /// stored as meters. Optionally tags all points with a category and saves
    /// the CSV mapping as a reusable profile.
    async fn import_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: ImportFormat,
        content: String,
        unit: LengthUnit,
        mapping: Option<CsvMappingInput>,
        source_filename: Option<String>,
        category_id: Option<Uuid>,
        save_profile_name: Option<String>,
    ) -> Result<ImportBatch> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (parsed, format_str) = match format {
            ImportFormat::Csv => {
                let m = mapping.as_ref().ok_or_else(|| {
                    async_graphql::Error::new("a column mapping is required for CSV")
                })?;
                let csv_mapping = to_csv_mapping(m)?;
                (
                    import::parse_csv(&content, &csv_mapping)
                        .map_err(|e| async_graphql::Error::new(e.to_string()))?,
                    "csv",
                )
            }
            ImportFormat::Landxml => (
                import::parse_landxml(&content)
                    .map_err(|e| async_graphql::Error::new(e.to_string()))?,
                "landxml",
            ),
        };
        if parsed.is_empty() {
            return Err(async_graphql::Error::new("no points found in the file"));
        }

        let mut tx = pool.begin().await?;
        let batch: ImportBatch = sqlx::query_as(
            "INSERT INTO import_batches (project_id, source_filename, format, row_count) \
             VALUES ($1, $2, $3, $4) RETURNING id, project_id, source_filename, format, row_count",
        )
        .bind(project_id)
        .bind(source_filename.unwrap_or_default())
        .bind(format_str)
        .bind(parsed.len() as i32)
        .fetch_one(&mut *tx)
        .await?;

        for p in &parsed {
            sqlx::query(
                "INSERT INTO survey_points \
                   (project_id, label, northing, easting, elevation, description, category_id, import_batch_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(project_id)
            .bind(&p.label)
            .bind(unit.to_meters(p.northing))
            .bind(unit.to_meters(p.easting))
            .bind(p.elevation.map(|e| unit.to_meters(e)))
            .bind(&p.description)
            .bind(category_id)
            .bind(batch.id)
            .execute(&mut *tx)
            .await?;
        }

        // Optionally persist the CSV mapping as a reusable profile.
        if let (Some(name), Some(m)) = (save_profile_name.as_ref(), mapping.as_ref()) {
            if !name.trim().is_empty() {
                let mapping_json = serde_json::json!({
                    "hasHeader": m.has_header,
                    "labelCol": m.label_col,
                    "northingCol": m.northing_col,
                    "eastingCol": m.easting_col,
                    "elevationCol": m.elevation_col,
                    "descriptionCol": m.description_col,
                });
                sqlx::query(
                    "INSERT INTO import_profiles (project_id, name, unit, mapping) \
                     VALUES ($1, $2, $3, $4)",
                )
                .bind(project_id)
                .bind(name.trim())
                .bind(unit.as_db_str())
                .bind(sqlx::types::Json(mapping_json))
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(batch)
    }

    // ----- Survey points -----

    /// Updates a surveyed point's organizational fields (label, description,
    /// category, tags). Editor role required.
    async fn update_survey_point(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        label: Option<String>,
        description: Option<String>,
        category_id: Option<Uuid>,
        tags: Option<Vec<String>>,
    ) -> Result<SurveyPoint> {
        let auth = require_editor(ctx)?;
        let point: Option<SurveyPoint> = sqlx::query_as(&format!(
            "UPDATE survey_points sp SET \
               label = COALESCE($2, sp.label), \
               description = COALESCE($3, sp.description), \
               category_id = COALESCE($4, sp.category_id), \
               tags = COALESCE($5, sp.tags) \
             FROM projects p \
             WHERE sp.id = $1 AND sp.project_id = p.id AND p.org_id = $6 \
             RETURNING {}",
            SURVEY_POINT_COLUMNS
                .split(", ")
                .map(|c| format!("sp.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .bind(id)
        .bind(label)
        .bind(description)
        .bind(category_id)
        .bind(tags)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        point.ok_or_else(|| async_graphql::Error::new("point not found in your organization"))
    }

    /// Deletes a surveyed point. Editor role required.
    async fn delete_survey_point(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM survey_points sp USING projects p \
             WHERE sp.id = $1 AND sp.project_id = p.id AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "point not found in your organization",
            ));
        }
        Ok(true)
    }

    /// Bulk-deletes surveyed points (org-scoped). Returns how many were deleted.
    /// Editor role required.
    async fn delete_survey_points(&self, ctx: &Context<'_>, ids: Vec<Uuid>) -> Result<i64> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM survey_points sp USING projects p \
             WHERE sp.id = ANY($1) AND sp.project_id = p.id AND p.org_id = $2",
        )
        .bind(&ids)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        Ok(result.rows_affected() as i64)
    }

    /// Bulk-assigns (or clears, when `categoryId` is null) the category of
    /// surveyed points (org-scoped). Returns how many were updated. Editor role.
    async fn assign_category(
        &self,
        ctx: &Context<'_>,
        ids: Vec<Uuid>,
        category_id: Option<Uuid>,
    ) -> Result<i64> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "UPDATE survey_points sp SET category_id = $3 FROM projects p \
             WHERE sp.id = ANY($1) AND sp.project_id = p.id AND p.org_id = $2",
        )
        .bind(&ids)
        .bind(auth.org_id)
        .bind(category_id)
        .execute(pool(ctx)?)
        .await?;
        Ok(result.rows_affected() as i64)
    }

    // ----- Point groups -----

    /// Saves a named selection of points. Editor role required.
    async fn create_point_group(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        name: String,
        member_ids: Vec<Uuid>,
    ) -> Result<PointGroup> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("group name is required"));
        }
        let group: PointGroup = sqlx::query_as(
            "INSERT INTO point_groups (project_id, name, member_ids) VALUES ($1, $2, $3) \
             RETURNING id, project_id, name, member_ids",
        )
        .bind(project_id)
        .bind(name.trim())
        .bind(&member_ids)
        .fetch_one(pool)
        .await?;
        Ok(group)
    }

    /// Deletes a point group. Editor role required.
    async fn delete_point_group(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM point_groups pg USING projects p \
             WHERE pg.id = $1 AND pg.project_id = p.id AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "group not found in your organization",
            ));
        }
        Ok(true)
    }

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
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if content.len() > import::MAX_BYTES {
            return Err(async_graphql::Error::new(
                "DXF exceeds the maximum allowed size",
            ));
        }
        if content.trim().is_empty() {
            return Err(async_graphql::Error::new("DXF content is empty"));
        }

        let storage = ctx.data::<Arc<dyn Storage>>()?;
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
        assume_real_world: Option<bool>,
        visible: Option<bool>,
    ) -> Result<CadOverlay> {
        let auth = require_editor(ctx)?;
        let row: Option<CadOverlay> = sqlx::query_as(&format!(
            "UPDATE cad_overlays co SET \
               offset_e = COALESCE($2, co.offset_e), \
               offset_n = COALESCE($3, co.offset_n), \
               rotation_deg = COALESCE($4, co.rotation_deg), \
               scale = COALESCE($5, co.scale), \
               assume_real_world = COALESCE($6, co.assume_real_world), \
               visible = COALESCE($7, co.visible) \
             FROM projects p \
             WHERE co.id = $1 AND co.project_id = p.id AND p.org_id = $8 \
             RETURNING {}",
            CAD_OVERLAY_COLUMNS
                .split(", ")
                .map(|c| format!("co.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .bind(id)
        .bind(offset_e)
        .bind(offset_n)
        .bind(rotation_deg)
        .bind(scale)
        .bind(assume_real_world)
        .bind(visible)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        row.ok_or_else(|| async_graphql::Error::new("overlay not found in your organization"))
    }

    /// Deletes an overlay and its stored file. Editor role required.
    async fn delete_cad_overlay(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        let key = overlay_key_in_org(pool, id, auth.org_id).await?;
        sqlx::query("DELETE FROM cad_overlays WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        // Best-effort file cleanup.
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let _ = storage.delete(&key).await;
        Ok(true)
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
