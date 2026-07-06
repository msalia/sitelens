use async_graphql::{Enum, InputObject, SimpleObject};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::field::FieldFormat;
use crate::units::LengthUnit;

use super::ExportSpace;

/// A curated field-app export preset, surfaced to the client for the picker.
#[derive(SimpleObject)]
pub struct FieldPresetInfo {
    pub id: String,
    pub app: String,
    pub format: FieldFormat,
    pub default_space: ExportSpace,
    pub default_unit: LengthUnit,
    pub description: String,
}

/// An encoded field file ready for download.
#[derive(SimpleObject)]
pub struct FieldExportResult {
    pub filename: String,
    pub mime_type: String,
    pub content_base64: String,
}

/// Which point attribute becomes the exported feature code.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum CodeField {
    /// The point's free-text description (default).
    Description,
    /// The point's category name.
    Category,
}

/// The design-point set an as-built import is compared against.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum BaselineScope {
    All,
    Category,
    Group,
}

impl BaselineScope {
    pub fn as_db_str(self) -> &'static str {
        match self {
            BaselineScope::All => "all",
            BaselineScope::Category => "category",
            BaselineScope::Group => "group",
        }
    }
    pub fn from_db_str(s: &str) -> BaselineScope {
        match s {
            "category" => BaselineScope::Category,
            "group" => BaselineScope::Group,
            _ => BaselineScope::All,
        }
    }
}

/// How an as-built row was paired to a design point.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum FieldMatchMethod {
    Number,
    Manual,
    Unmatched,
}

impl FieldMatchMethod {
    pub fn from_db_str(s: &str) -> FieldMatchMethod {
        match s {
            "number" => FieldMatchMethod::Number,
            "manual" => FieldMatchMethod::Manual,
            _ => FieldMatchMethod::Unmatched,
        }
    }
}

/// Tolerance classification of a compared point.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ComparisonStatus {
    Pass,
    Warn,
    Fail,
    Unmatched,
    NoVertical,
}

impl ComparisonStatus {
    pub fn from_db_str(s: &str) -> ComparisonStatus {
        match s {
            "pass" => ComparisonStatus::Pass,
            "warn" => ComparisonStatus::Warn,
            "fail" => ComparisonStatus::Fail,
            "no_vertical" => ComparisonStatus::NoVertical,
            _ => ComparisonStatus::Unmatched,
        }
    }
}

/// An inbound as-built import + comparison run (snapshots the tolerance spec).
#[derive(SimpleObject)]
pub struct AsBuiltBatch {
    pub id: Uuid,
    pub project_id: Uuid,
    pub source_filename: String,
    pub format: FieldFormat,
    pub baseline_scope: BaselineScope,
    pub baseline_ref_id: Option<Uuid>,
    pub delta_space: String,
    pub tol_h_warn: f64,
    pub tol_h_fail: f64,
    pub tol_v_warn: f64,
    pub tol_v_fail: f64,
    pub report_unit: LengthUnit,
    pub created_at: DateTime<Utc>,
}

/// One paired/unpaired as-built point. Coords + deltas are canonical meters
/// (projected-ground frame for the primary deltas, building-grid for the grid
/// deltas); the client converts to `AsBuiltBatch.reportUnit`.
#[derive(SimpleObject, Clone)]
pub struct ComparisonRow {
    pub id: Uuid,
    pub as_built_label: String,
    pub as_built_n: f64,
    pub as_built_e: f64,
    pub as_built_z: Option<f64>,
    pub design_point_id: Option<Uuid>,
    pub design_n: Option<f64>,
    pub design_e: Option<f64>,
    pub design_z: Option<f64>,
    pub match_method: FieldMatchMethod,
    pub delta_n: Option<f64>,
    pub delta_e: Option<f64>,
    pub delta_z: Option<f64>,
    pub delta_h_radial: Option<f64>,
    pub delta_grid_n: Option<f64>,
    pub delta_grid_e: Option<f64>,
    pub status: ComparisonStatus,
    // Geographic coords (degrees) for the 3D scene overlay. As-built is always
    // present; design is set only for matched rows. Height is meters (Z or 0).
    pub as_built_latitude: Option<f64>,
    pub as_built_longitude: Option<f64>,
    pub as_built_height: Option<f64>,
    pub design_latitude: Option<f64>,
    pub design_longitude: Option<f64>,
    pub design_height: Option<f64>,
}

/// Rollup counts + horizontal miss stats for a comparison.
#[derive(SimpleObject)]
pub struct ComparisonSummary {
    pub pass: i64,
    pub warn: i64,
    pub fail: i64,
    pub unmatched: i64,
    pub no_vertical: i64,
    pub max_miss: Option<f64>,
    pub rms_miss: Option<f64>,
}

/// A full comparison: batch metadata + per-point rows + summary.
#[derive(SimpleObject)]
pub struct Comparison {
    pub batch: AsBuiltBatch,
    pub rows: Vec<ComparisonRow>,
    pub summary: ComparisonSummary,
}

/// Result of auto-detecting an uploaded file's format.
#[derive(SimpleObject)]
pub struct DetectedFormat {
    pub format: FieldFormat,
    /// CSV needs a preset/column mapping chosen before import.
    pub needs_mapping: bool,
}

/// Optional per-import tolerance override (canonical meters).
#[derive(InputObject)]
pub struct ToleranceInput {
    pub h_warn: f64,
    pub h_fail: f64,
    pub v_warn: f64,
    pub v_fail: f64,
}
