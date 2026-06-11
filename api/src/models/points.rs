use async_graphql::{Enum, InputObject, SimpleObject};
use uuid::Uuid;

use crate::units::LengthUnit;

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
