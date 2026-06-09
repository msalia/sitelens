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

/// A city-published control point. Coordinates are meters.
#[derive(SimpleObject, Clone, sqlx::FromRow)]
pub struct ControlPoint {
    pub id: Uuid,
    pub project_id: Uuid,
    pub label: String,
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
    pub source: String,
}
