use async_graphql::{InputObject, SimpleObject};
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

/// A curated utility type (APWA-aligned). `default_geometry` ∈ line|structure|both.
#[derive(SimpleObject)]
pub struct UtilityType {
    pub key: String,
    pub label: String,
    pub apwa_color: String,
    pub default_geometry: String,
}

/// One ordered vertex of a run (canonical meters). `source_point_id` is a
/// provenance-only soft link to the survey point it was snapped from.
#[derive(SimpleObject, Clone)]
pub struct UtilityVertex {
    pub seq: i32,
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
    pub source_point_id: Option<Uuid>,
}

/// A linear utility run with typed attributes + snapshotted geometry.
#[derive(SimpleObject)]
pub struct UtilityRun {
    pub id: Uuid,
    pub project_id: Uuid,
    pub type_key: String,
    pub label: String,
    pub level: Option<String>,
    /// Diameter in canonical meters (entered in inches).
    pub diameter: Option<f64>,
    pub material: Option<String>,
    pub invert_up: Option<f64>,
    pub invert_down: Option<f64>,
    pub slope: Option<f64>,
    pub owner: Option<String>,
    pub install_date: Option<NaiveDate>,
    pub condition: Option<String>,
    /// Free-form attributes as a JSON object string.
    pub attrs_extra: String,
    pub tags: Vec<String>,
    pub source: String,
    pub as_built_date: Option<NaiveDate>,
    pub locate_method: Option<String>,
    pub captured_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub vertices: Vec<UtilityVertex>,
    /// Derived 3D length (meters) from the vertices.
    pub length: Option<f64>,
}

/// A node structure (manhole, valve, hydrant, …).
#[derive(SimpleObject)]
pub struct UtilityStructure {
    pub id: Uuid,
    pub project_id: Uuid,
    pub type_key: String,
    pub label: String,
    pub level: Option<String>,
    pub northing: f64,
    pub easting: f64,
    pub rim_elev: Option<f64>,
    /// Pipe inverts as a JSON array string: `[{label, elev, pipe?}]`.
    pub inverts: String,
    pub material: Option<String>,
    pub owner: Option<String>,
    pub condition: Option<String>,
    pub attrs_extra: String,
    pub tags: Vec<String>,
    pub source: String,
    pub as_built_date: Option<NaiveDate>,
    pub locate_method: Option<String>,
    pub source_point_id: Option<Uuid>,
    pub captured_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A project's utility inventory (filtered runs + structures).
#[derive(SimpleObject)]
pub struct UtilityInventory {
    pub runs: Vec<UtilityRun>,
    pub structures: Vec<UtilityStructure>,
}

/// One append-only audit entry (field-level `diff` as a JSON object string).
#[derive(SimpleObject)]
pub struct UtilityAuditEntry {
    pub id: Uuid,
    pub entity_type: String,
    pub entity_id: Uuid,
    pub action: String,
    pub changed_by: Option<Uuid>,
    pub changed_at: DateTime<Utc>,
    pub diff: String,
}

/// One vertex on capture. `seq` is the array position; coords are canonical meters.
#[derive(InputObject)]
pub struct UtilityVertexInput {
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
    pub source_point_id: Option<Uuid>,
}

/// Run attributes on create/update. All optional; on update, omitted fields keep
/// their current value. `diameter_inches` is stored canonical (meters).
#[derive(InputObject, Default)]
pub struct UtilityRunInput {
    pub type_key: Option<String>,
    pub label: Option<String>,
    pub level: Option<String>,
    pub diameter_inches: Option<f64>,
    pub material: Option<String>,
    pub invert_up: Option<f64>,
    pub invert_down: Option<f64>,
    pub owner: Option<String>,
    pub install_date: Option<NaiveDate>,
    pub condition: Option<String>,
    /// JSON object string.
    pub attrs_extra: Option<String>,
    pub tags: Option<Vec<String>>,
    pub source: Option<String>,
    pub as_built_date: Option<NaiveDate>,
    pub locate_method: Option<String>,
}

/// Structure attributes on create/update. Position is required on create.
#[derive(InputObject, Default)]
pub struct UtilityStructureInput {
    pub type_key: Option<String>,
    pub label: Option<String>,
    pub level: Option<String>,
    pub northing: Option<f64>,
    pub easting: Option<f64>,
    pub rim_elev: Option<f64>,
    /// JSON array string.
    pub inverts: Option<String>,
    pub material: Option<String>,
    pub owner: Option<String>,
    pub condition: Option<String>,
    pub attrs_extra: Option<String>,
    pub tags: Option<Vec<String>>,
    pub source: Option<String>,
    pub as_built_date: Option<NaiveDate>,
    pub locate_method: Option<String>,
    pub source_point_id: Option<Uuid>,
}
