use async_graphql::{Enum, InputObject, SimpleObject};
use uuid::Uuid;

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
