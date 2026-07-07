//! Utility archive export: turn the captured record into portable formats that
//! outlive SiteLens — **GeoJSON** (WGS84 geometry + full attrs), **DXF** (3D
//! linework + node circles on APWA-named layers), **LandXML** (generic
//! PlanFeatures/CgPoints — a documented weak-support fallback), and a **PDF
//! schedule** (via the shared WeasyPrint report template). Pure builders; the
//! resolver does DB reads + coordinate projection + the PDF HTTP call.
//!
//! Linear values are canonical **meters** (documented in each output).
//!
//! Layout:
//! - [`ExVertex`]/[`ExRun`]/[`ExStruct`] — the shared input model (here).
//! - `codecs` — the geometry codecs ([`to_geojson`]/[`to_dxf`]/[`to_landxml`]).
//! - `schedule` — the architectural plan sheet + PDF [`schedule_document`].

mod codecs;
mod schedule;

pub use codecs::{to_dxf, to_geojson, to_landxml};
pub use schedule::schedule_document;

/// One run vertex, carrying both projected (meters) and geographic coords so
/// each format can use the space it needs.
#[derive(Clone)]
pub struct ExVertex {
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
    pub lat: f64,
    pub lon: f64,
}

/// A run to export, with its resolved attributes + geometry.
#[derive(Clone)]
pub struct ExRun {
    pub type_key: String,
    pub label: String,
    pub material: Option<String>,
    pub diameter_m: Option<f64>,
    pub invert_up: Option<f64>,
    pub invert_down: Option<f64>,
    pub slope: Option<f64>,
    pub length_m: Option<f64>,
    pub tags: Vec<String>,
    pub vertices: Vec<ExVertex>,
    /// APWA hex color for this run's type.
    pub color: String,
    /// Free-text condition; a notable value is flagged with a plan callout.
    pub condition: Option<String>,
    /// Provenance (`field_survey`/`locate_company` = measured → solid line;
    /// `dxf`/`geojson`/`other` = record/imported → dashed).
    pub source: String,
    /// True when this run matches the active inventory filter (colored in the
    /// plan view + listed in the schedule); false = context-only (drawn gray).
    pub in_report: bool,
}

/// A structure to export.
#[derive(Clone)]
pub struct ExStruct {
    pub type_key: String,
    pub label: String,
    pub material: Option<String>,
    pub rim_elev: Option<f64>,
    pub northing: f64,
    pub easting: f64,
    pub lat: f64,
    pub lon: f64,
    pub tags: Vec<String>,
    /// APWA hex color for this structure's type.
    pub color: String,
    /// Free-text condition; a notable value is flagged with a plan callout.
    pub condition: Option<String>,
    /// Provenance (see [`ExRun::source`]).
    pub source: String,
    /// See [`ExRun::in_report`].
    pub in_report: bool,
}

/// Representative fixtures shared by the codec + schedule unit tests.
#[cfg(test)]
pub(crate) mod fixtures {
    use super::{ExRun, ExStruct, ExVertex};

    pub(crate) fn run() -> ExRun {
        ExRun {
            type_key: "water".into(),
            label: "W-1".into(),
            material: Some("DIP".into()),
            diameter_m: Some(0.1524),
            invert_up: Some(-1.0),
            invert_down: Some(-1.5),
            slope: Some(0.01),
            length_m: Some(12.0),
            tags: vec!["main".into()],
            vertices: vec![
                ExVertex {
                    northing: 0.0,
                    easting: 0.0,
                    elevation: Some(-1.0),
                    lat: 40.7,
                    lon: -74.0,
                },
                ExVertex {
                    northing: 3.0,
                    easting: 4.0,
                    elevation: Some(-1.5),
                    lat: 40.701,
                    lon: -74.001,
                },
            ],
            color: "#2563eb".into(),
            condition: None,
            source: "field_survey".into(),
            in_report: true,
        }
    }

    pub(crate) fn structure() -> ExStruct {
        ExStruct {
            type_key: "manhole".into(),
            label: "MH-1".into(),
            material: None,
            rim_elev: Some(0.05),
            northing: 5.0,
            easting: 5.0,
            lat: 40.7,
            lon: -74.0,
            tags: vec![],
            color: "#16a34a".into(),
            condition: None,
            source: "field_survey".into(),
            in_report: true,
        }
    }
}
