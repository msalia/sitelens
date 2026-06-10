//! Domain models and their GraphQL projections. DB row structs deliberately
//! exclude sensitive columns (password hashes, tokens) from anything that maps
//! into a GraphQL object.

use async_graphql::{Enum, InputObject, SimpleObject};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::auth::Role;
use crate::units::LengthUnit;

/// A user as exposed over GraphQL. Never carries the password hash or tokens.
#[derive(SimpleObject, Clone)]
pub struct User {
    pub id: Uuid,
    pub org_id: Uuid,
    pub email: String,
    pub role: Role,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
}

/// An organization as exposed over GraphQL.
#[derive(SimpleObject, Clone)]
pub struct Org {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// Row shape for safe user reads.
#[derive(sqlx::FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub email: String,
    pub role: String,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
}

impl From<UserRow> for User {
    fn from(r: UserRow) -> Self {
        User {
            id: r.id,
            org_id: r.org_id,
            email: r.email,
            role: Role::parse(&r.role).unwrap_or(Role::Viewer),
            email_verified: r.email_verified,
            created_at: r.created_at,
        }
    }
}

/// Row shape for login: includes the password hash and verification state.
#[derive(sqlx::FromRow)]
pub struct LoginRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub role: String,
    pub email_verified: bool,
    pub password_hash: Option<String>,
}

/// Result returned from signup. The verification token is surfaced here only
/// because no email provider is wired yet (deferred); it will be delivered by
/// email in a later phase.
#[derive(SimpleObject)]
pub struct SignupResult {
    pub user: User,
    pub org: Org,
    pub verification_token: String,
}

/// Result returned from inviting a user. The invite token is surfaced for the
/// same reason as above (no email provider yet).
#[derive(SimpleObject)]
pub struct InviteResult {
    pub user: User,
    pub invite_token: String,
}

// ---------------------------------------------------------------------------
// Phase 2: projects, grid, control points
// ---------------------------------------------------------------------------

/// A building site. All stored coordinates are canonical meters.
#[derive(SimpleObject, Clone)]
pub struct Project {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub description: String,
    pub epsg_code: i32,
    pub display_unit: LengthUnit,
    pub combined_scale_factor: f64,
    pub site_origin_lat: Option<f64>,
    pub site_origin_lon: Option<f64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct ProjectRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub description: String,
    pub epsg_code: i32,
    pub display_unit: String,
    pub combined_scale_factor: f64,
    pub site_origin_lat: Option<f64>,
    pub site_origin_lon: Option<f64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<ProjectRow> for Project {
    fn from(r: ProjectRow) -> Self {
        Project {
            id: r.id,
            org_id: r.org_id,
            name: r.name,
            description: r.description,
            epsg_code: r.epsg_code,
            display_unit: LengthUnit::from_db_str(&r.display_unit).unwrap_or(LengthUnit::Meter),
            combined_scale_factor: r.combined_scale_factor,
            site_origin_lat: r.site_origin_lat,
            site_origin_lon: r.site_origin_lon,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

/// Which family a grid axis belongs to.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum GridFamily {
    Lettered,
    Numbered,
}

impl GridFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            GridFamily::Lettered => "lettered",
            GridFamily::Numbered => "numbered",
        }
    }
    pub fn parse(s: &str) -> Option<GridFamily> {
        match s {
            "lettered" => Some(GridFamily::Lettered),
            "numbered" => Some(GridFamily::Numbered),
            _ => None,
        }
    }
}

/// A single grid axis. `position` is in meters (grid space).
#[derive(SimpleObject, Clone)]
pub struct GridAxis {
    pub id: Uuid,
    pub project_id: Uuid,
    pub family: GridFamily,
    pub label: String,
    pub position: f64,
}

#[derive(sqlx::FromRow)]
pub struct GridAxisRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub family: String,
    pub label: String,
    pub position: f64,
}

impl From<GridAxisRow> for GridAxis {
    fn from(r: GridAxisRow) -> Self {
        GridAxis {
            id: r.id,
            project_id: r.project_id,
            family: GridFamily::parse(&r.family).unwrap_or(GridFamily::Lettered),
            label: r.label,
            position: r.position,
        }
    }
}

/// Input for replacing the grid. `position` is expressed in `unit`.
#[derive(InputObject)]
pub struct GridAxisInput {
    pub family: GridFamily,
    pub label: String,
    pub position: f64,
}

/// A city-published control point. Coordinates are meters. `grid_x`/`grid_y` are
/// the point's location in building-grid space, used to solve the transform.
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct ControlPoint {
    pub id: Uuid,
    pub project_id: Uuid,
    pub label: String,
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
    pub grid_x: Option<f64>,
    pub grid_y: Option<f64>,
    pub source: String,
}

/// Per-point transform residual (observed − computed), in meters.
#[derive(SimpleObject, serde::Serialize, serde::Deserialize, Clone)]
pub struct TransformResidual {
    pub label: String,
    pub delta_easting: f64,
    pub delta_northing: f64,
    pub magnitude: f64,
}

/// The space an input coordinate is expressed in (GraphQL enum).
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum CoordinateSpace {
    Grid,
    Projected,
    /// Geographic input: `x` is longitude, `y` is latitude (degrees); `unit` is
    /// ignored. Derives projected/grid/ground via the project's CRS + transform.
    Geographic,
}

/// All derivable representations of a coordinate. Linear fields are meters;
/// latitude/longitude are degrees. `None` where a representation isn't derivable.
#[derive(SimpleObject, Default)]
pub struct CoordinateSet {
    pub grid_x: Option<f64>,
    pub grid_y: Option<f64>,
    pub projected_grid_e: Option<f64>,
    pub projected_grid_n: Option<f64>,
    pub projected_ground_e: Option<f64>,
    pub projected_ground_n: Option<f64>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

impl From<crate::convert::CoordinateSet> for CoordinateSet {
    fn from(c: crate::convert::CoordinateSet) -> Self {
        CoordinateSet {
            grid_x: c.grid_x,
            grid_y: c.grid_y,
            projected_grid_e: c.projected_grid_e,
            projected_grid_n: c.projected_grid_n,
            projected_ground_e: c.projected_ground_e,
            projected_ground_n: c.projected_ground_n,
            latitude: c.latitude,
            longitude: c.longitude,
        }
    }
}

/// A solved Helmert transform. Translations/RMS are meters; rotation in degrees.
#[derive(SimpleObject, Clone)]
pub struct Transform {
    pub translation_e: f64,
    pub translation_n: f64,
    pub rotation_degrees: f64,
    pub scale: f64,
    pub rms_error: f64,
    pub point_count: i32,
    pub residuals: Vec<TransformResidual>,
}

// ---------------------------------------------------------------------------
// Phase 5: survey points, categories, groups, imports
// ---------------------------------------------------------------------------

/// A point category (color/icon). Default set is seeded per org; orgs add custom.
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct PointCategory {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub is_default: bool,
}

/// A surveyed point. Coordinates are meters; one category + free-text tags.
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct SurveyPoint {
    pub id: Uuid,
    pub project_id: Uuid,
    pub label: String,
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
    pub description: String,
    pub category_id: Option<Uuid>,
    pub tags: Vec<String>,
    pub import_batch_id: Option<Uuid>,
}

/// A record of one import.
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct ImportBatch {
    pub id: Uuid,
    pub project_id: Uuid,
    pub source_filename: String,
    pub format: String,
    pub row_count: i32,
}

/// A saved named selection of points.
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct PointGroup {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub member_ids: Vec<Uuid>,
}

/// A reusable CSV import column mapping. `mapping_json` is the serialized mapping.
#[derive(SimpleObject)]
pub struct ImportProfile {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub unit: LengthUnit,
    pub mapping_json: String,
}

#[derive(sqlx::FromRow)]
pub struct ImportProfileRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub unit: String,
    pub mapping: sqlx::types::Json<serde_json::Value>,
}

impl From<ImportProfileRow> for ImportProfile {
    fn from(r: ImportProfileRow) -> Self {
        ImportProfile {
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            unit: LengthUnit::from_db_str(&r.unit).unwrap_or(LengthUnit::Meter),
            mapping_json: r.mapping.0.to_string(),
        }
    }
}

/// Import file format.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ImportFormat {
    Csv,
    Landxml,
}

/// CSV column mapping (0-based indices).
#[derive(InputObject)]
pub struct CsvMappingInput {
    pub has_header: bool,
    pub label_col: Option<i32>,
    pub northing_col: i32,
    pub easting_col: i32,
    pub elevation_col: Option<i32>,
    pub description_col: Option<i32>,
}

// ---------------------------------------------------------------------------
// Phase 6: 3D scene data (everything in geographic coords for rendering)
// ---------------------------------------------------------------------------

/// A geographic position (degrees) with height in meters.
#[derive(SimpleObject, Clone, Copy)]
pub struct LatLng {
    pub latitude: f64,
    pub longitude: f64,
    pub height: f64,
}

/// A renderable point in geographic coordinates. `easting`/`northing` (meters)
/// are carried so the client can open the coordinate inspector from a 3D pick.
#[derive(SimpleObject, Clone)]
pub struct ScenePoint {
    pub id: Option<Uuid>,
    pub label: String,
    pub latitude: f64,
    pub longitude: f64,
    pub height: f64,
    pub easting: f64,
    pub northing: f64,
    pub category_id: Option<Uuid>,
}

/// A renderable polyline (e.g. a grid axis) in geographic coordinates.
#[derive(SimpleObject, Clone)]
pub struct SceneLine {
    pub label: String,
    pub coordinates: Vec<LatLng>,
}

/// Everything the 3D viewer needs, pre-projected to geographic coordinates.
#[derive(SimpleObject, Default)]
pub struct SceneData {
    pub origin: Option<LatLng>,
    /// The origin's projected easting/northing (meters) — lets the client place
    /// DXF overlays in a local east-north frame anchored at the origin.
    pub origin_projected_e: Option<f64>,
    pub origin_projected_n: Option<f64>,
    pub control_points: Vec<ScenePoint>,
    pub survey_points: Vec<ScenePoint>,
    pub grid_lines: Vec<SceneLine>,
}

// ---------------------------------------------------------------------------
// Phase 2 completion: EPSG search
// ---------------------------------------------------------------------------

/// An EPSG coordinate-reference-system entry for the picker.
#[derive(SimpleObject)]
pub struct EpsgEntry {
    pub code: i32,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Phase 7: DXF overlays
// ---------------------------------------------------------------------------

/// A georeferenced DXF overlay. The raw file lives in storage (key not exposed).
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct CadOverlay {
    pub id: Uuid,
    pub project_id: Uuid,
    pub original_filename: String,
    pub offset_e: f64,
    pub offset_n: f64,
    pub rotation_deg: f64,
    pub scale: f64,
    pub assume_real_world: bool,
    pub visible: bool,
}

/// Cached OpenTopography DEM metadata for a project (the GeoTIFF bytes live in
/// storage; `storage_key` is intentionally not exposed via GraphQL).
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct ProjectTerrain {
    pub project_id: Uuid,
    pub demtype: String,
    pub south: f64,
    pub north: f64,
    pub west: f64,
    pub east: f64,
    pub fetched_at: DateTime<Utc>,
}

/// Cached OpenStreetMap building footprints for a project (the footprint JSON
/// lives in storage; `storage_key` is intentionally not exposed via GraphQL).
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct ProjectBuildings {
    pub project_id: Uuid,
    pub count: i32,
    pub fetched_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Phase 8: export
// ---------------------------------------------------------------------------

#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ExportFormat {
    Csv,
    Landxml,
}

/// Which coordinate space the exported northing/easting are in.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ExportSpace {
    ProjectedGrid,
    ProjectedGround,
    Grid,
    Geographic,
}

/// A selectable CSV column (caller chooses inclusion + order).
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ExportColumn {
    Point,
    Northing,
    Easting,
    Elevation,
    Description,
    Latitude,
    Longitude,
}

/// Public, non-secret runtime config the client needs (e.g. the shared Cesium
/// Ion token used for World Terrain — Ion tokens are client-exposed by design).
#[derive(SimpleObject)]
pub struct PublicConfig {
    pub cesium_ion_token: String,
}
