use async_graphql::SimpleObject;
use chrono::{DateTime, Utc};
use uuid::Uuid;

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
    /// Flat placement height (meters) in the project's vertical datum.
    pub elevation: f64,
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
