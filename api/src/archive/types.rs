use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const ARCHIVE_FORMAT: &str = "sitelens-project";
pub const ARCHIVE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveProject {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) epsg_code: i32,
    pub(crate) display_unit: String,
    pub(crate) combined_scale_factor: f64,
    pub(crate) site_origin_lat: Option<f64>,
    pub(crate) site_origin_lon: Option<f64>,
    #[serde(default)]
    pub(crate) site_origin_rotation_deg: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveGridAxis {
    pub(crate) family: String,
    pub(crate) label: String,
    pub(crate) position: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveControlPoint {
    pub(crate) label: String,
    pub(crate) northing: f64,
    pub(crate) easting: f64,
    pub(crate) elevation: Option<f64>,
    pub(crate) grid_x: Option<f64>,
    pub(crate) grid_y: Option<f64>,
    pub(crate) source: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveTransform {
    pub(crate) translation_e: f64,
    pub(crate) translation_n: f64,
    pub(crate) rotation_rad: f64,
    pub(crate) scale: f64,
    pub(crate) rms_error: f64,
    pub(crate) point_count: i32,
    pub(crate) residuals: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveCategory {
    /// Original category id — survey points reference it via `category_ref`.
    pub(crate) r#ref: Uuid,
    pub(crate) name: String,
    pub(crate) color: String,
    pub(crate) icon: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveSurveyPoint {
    /// Original point id — point groups reference it via `member_refs`.
    pub(crate) r#ref: Uuid,
    pub(crate) label: String,
    pub(crate) northing: f64,
    pub(crate) easting: f64,
    pub(crate) elevation: Option<f64>,
    pub(crate) description: String,
    pub(crate) category_ref: Option<Uuid>,
    pub(crate) tags: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivePointGroup {
    pub(crate) name: String,
    pub(crate) member_refs: Vec<Uuid>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveCadOverlay {
    pub(crate) original_filename: String,
    pub(crate) offset_e: f64,
    pub(crate) offset_n: f64,
    pub(crate) rotation_deg: f64,
    pub(crate) scale: f64,
    #[serde(default)]
    pub(crate) elevation: f64,
    pub(crate) assume_real_world: bool,
    pub(crate) visible: bool,
    /// The DXF drawing, inline (DXF is UTF-8 text).
    pub(crate) content: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Archive {
    pub(crate) format: String,
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) exported_at: String,
    pub(crate) project: ArchiveProject,
    pub(crate) grid_axes: Vec<ArchiveGridAxis>,
    pub(crate) control_points: Vec<ArchiveControlPoint>,
    pub(crate) transform: Option<ArchiveTransform>,
    pub(crate) categories: Vec<ArchiveCategory>,
    pub(crate) survey_points: Vec<ArchiveSurveyPoint>,
    pub(crate) point_groups: Vec<ArchivePointGroup>,
    pub(crate) cad_overlays: Vec<ArchiveCadOverlay>,
}
