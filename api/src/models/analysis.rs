//! Site-analysis GraphQL types (Phase 1): the central `Analysis` record + its
//! enums and create/update input. Geometry + params are exposed as JSON strings
//! (stored JSONB), matching the `UtilityStructure::attrs_extra` / `Surface::inputs`
//! convention. Enums are text columns with a `CHECK` (the `as_db_str` /
//! `from_db_str` pattern, no sqlx `Type` derive).

use async_graphql::{Enum, InputObject, SimpleObject};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// The kind of civil analysis.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum AnalysisType {
    Turning,
    Parking,
    Hydrology,
    Traffic,
}

impl AnalysisType {
    pub fn as_db_str(self) -> &'static str {
        match self {
            AnalysisType::Turning => "turning",
            AnalysisType::Parking => "parking",
            AnalysisType::Hydrology => "hydrology",
            AnalysisType::Traffic => "traffic",
        }
    }
    pub fn from_db_str(s: &str) -> AnalysisType {
        match s {
            "parking" => AnalysisType::Parking,
            "hydrology" => AnalysisType::Hydrology,
            "traffic" => AnalysisType::Traffic,
            _ => AnalysisType::Turning,
        }
    }
}

/// Analysis lifecycle. Interactive analyses (turning/parking) go straight to
/// `complete`; external-data ones (hydrology/traffic) pass through `running`.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum AnalysisStatus {
    Draft,
    Running,
    Complete,
    Failed,
}

impl AnalysisStatus {
    pub fn as_db_str(self) -> &'static str {
        match self {
            AnalysisStatus::Draft => "draft",
            AnalysisStatus::Running => "running",
            AnalysisStatus::Complete => "complete",
            AnalysisStatus::Failed => "failed",
        }
    }
    pub fn from_db_str(s: &str) -> AnalysisStatus {
        match s {
            "running" => AnalysisStatus::Running,
            "complete" => AnalysisStatus::Complete,
            "failed" => AnalysisStatus::Failed,
            _ => AnalysisStatus::Draft,
        }
    }
}

/// One analysis instance. `params`, `input_geometry`, `result`, and
/// `result_geometry` are JSON object/array strings (projected meters).
#[derive(SimpleObject)]
pub struct Analysis {
    pub id: Uuid,
    pub project_id: Uuid,
    #[graphql(name = "type")]
    pub kind: AnalysisType,
    pub name: String,
    pub status: AnalysisStatus,
    /// Per-type parameters, as a JSON object string.
    pub params: String,
    /// Drawn input geometry (GeoJSON-ish), as a JSON string; null until drawn.
    pub input_geometry: Option<String>,
    /// Summary metrics + result-geometry references, as a JSON object string.
    pub result: String,
    /// Computed output geometry, as a JSON string; null until a run completes.
    pub result_geometry: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Create/update an analysis. Phase 1 persists the drawn input + params as a
/// `draft`; the per-type run mutations (later phases) compute the result.
#[derive(InputObject, Clone)]
pub struct AnalysisInput {
    #[graphql(name = "type")]
    pub kind: AnalysisType,
    pub name: String,
    /// Per-type parameters as a JSON object string (defaults to `{}`).
    #[graphql(default_with = "default_json_object()")]
    pub params: String,
    /// Drawn input geometry as a JSON string (nullable).
    pub input_geometry: Option<String>,
}

fn default_json_object() -> String {
    "{}".to_string()
}

/// A vehicle in the turning-analysis library. `org_id` null = global preset;
/// set = an org's custom vehicle (only its own org sees/edits it). Dimensions are
/// meters, steering degrees.
#[derive(SimpleObject)]
pub struct VehicleTemplate {
    pub id: Uuid,
    /// Null for a global preset (read-only); the owning org for a custom vehicle.
    pub org_id: Option<Uuid>,
    pub name: String,
    pub vehicle_class: String,
    pub wheelbase: f64,
    pub front_overhang: f64,
    pub rear_overhang: f64,
    pub width: f64,
    pub max_steering_angle: f64,
    pub lock_to_lock_time: Option<f64>,
    pub source: Option<String>,
    /// Whether this is a global preset (`org_id` is null) — presets are read-only.
    pub is_preset: bool,
}

/// Create/update a custom vehicle. Dimensions in meters, steering in degrees.
#[derive(InputObject, Clone)]
pub struct VehicleTemplateInput {
    pub name: String,
    #[graphql(default = "custom")]
    pub vehicle_class: String,
    pub wheelbase: f64,
    #[graphql(default)]
    pub front_overhang: f64,
    #[graphql(default)]
    pub rear_overhang: f64,
    pub width: f64,
    #[graphql(default = 30.0)]
    pub max_steering_angle: f64,
    pub lock_to_lock_time: Option<f64>,
    pub source: Option<String>,
}

/// Parameters for a turning run: the vehicle + drawn path + optional obstacles.
#[derive(InputObject, Clone)]
pub struct TurningInput {
    pub name: String,
    pub vehicle_template_id: Uuid,
    /// Front-axle centerline path as a JSON `[[e,n],…]` string (projected meters).
    pub path: String,
    /// Obstacle polylines as a JSON `[[[e,n],…],…]` string (projected meters).
    #[graphql(default_with = "default_json_array()")]
    pub obstacles: String,
    /// Sampling step in meters (default 0.5).
    #[graphql(default = 0.5)]
    pub step_resolution: f64,
}

fn default_json_array() -> String {
    "[]".to_string()
}
