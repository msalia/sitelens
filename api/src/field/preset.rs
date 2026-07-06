//! Curated per-app export presets over CSV / LandXML / JobXML. Each names the
//! column order, delimiter, header, and default coordinate space + unit a given
//! field app expects. Real-device acceptance (Phase 7) locks these as verified.

use crate::models::ExportSpace;
use crate::units::LengthUnit;

use super::FieldFormat;

/// A CSV column in a preset's fixed order. `Code` carries the point's feature
/// code (the description, or a chosen code field upstream).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FieldColumn {
    Point,
    Northing,
    Easting,
    Elevation,
    Code,
}

/// A curated export profile for a specific field app.
#[derive(Clone, Debug)]
pub struct FieldPreset {
    /// Stable id used by the client picker and `exportField`.
    pub id: &'static str,
    /// Human app label, e.g. "Trimble Access".
    pub app: &'static str,
    pub format: FieldFormat,
    /// CSV column order (empty for the XML formats).
    pub columns: &'static [FieldColumn],
    pub delimiter: u8,
    pub has_header: bool,
    pub default_space: ExportSpace,
    pub default_unit: LengthUnit,
    pub description: &'static str,
}

use FieldColumn::{Code, Easting, Elevation, Northing, Point};

const PNEZD: &[FieldColumn] = &[Point, Northing, Easting, Elevation, Code];
const PENZD: &[FieldColumn] = &[Point, Easting, Northing, Elevation, Code];

/// All curated presets, in display order.
pub fn presets() -> Vec<FieldPreset> {
    vec![
        FieldPreset {
            id: "trimble_jobxml",
            app: "Trimble Access (JobXML)",
            format: FieldFormat::JobXml,
            columns: &[],
            delimiter: b',',
            has_header: false,
            default_space: ExportSpace::ProjectedGrid,
            default_unit: LengthUnit::UsSurveyFoot,
            description: "Native Trimble JobXML (.jxl) — opens directly in Trimble Access.",
        },
        FieldPreset {
            id: "trimble_csv",
            app: "Trimble Access (CSV)",
            format: FieldFormat::Csv,
            columns: PENZD,
            delimiter: b',',
            has_header: false,
            default_space: ExportSpace::ProjectedGround,
            default_unit: LengthUnit::UsSurveyFoot,
            description: "Comma-delimited P,E,N,Z,Code for Trimble Access CSV import.",
        },
        FieldPreset {
            id: "carlson_pnezd",
            app: "Carlson / MicroSurvey",
            format: FieldFormat::Csv,
            columns: PNEZD,
            delimiter: b',',
            has_header: false,
            default_space: ExportSpace::ProjectedGround,
            default_unit: LengthUnit::UsSurveyFoot,
            description: "PNEZD comma CSV for Carlson SurvCE/SurvPC and MicroSurvey FieldGenius.",
        },
        FieldPreset {
            id: "topcon_csv",
            app: "Topcon / Sokkia Magnet",
            format: FieldFormat::Csv,
            columns: PNEZD,
            delimiter: b',',
            has_header: false,
            default_space: ExportSpace::ProjectedGround,
            default_unit: LengthUnit::UsSurveyFoot,
            description: "PNEZD comma CSV for Topcon / Sokkia Magnet Field.",
        },
        FieldPreset {
            id: "generic_csv",
            app: "Generic CSV",
            format: FieldFormat::Csv,
            columns: PNEZD,
            delimiter: b',',
            has_header: true,
            default_space: ExportSpace::ProjectedGround,
            default_unit: LengthUnit::UsSurveyFoot,
            description: "PNEZD CSV with a header row — a safe default for any app.",
        },
        FieldPreset {
            id: "landxml",
            app: "LandXML",
            format: FieldFormat::LandXml,
            columns: &[],
            delimiter: b',',
            has_header: false,
            default_space: ExportSpace::ProjectedGrid,
            default_unit: LengthUnit::UsSurveyFoot,
            description: "LandXML CgPoints — widely importable across desktop packages.",
        },
    ]
}

/// Looks up a preset by its stable id.
pub fn preset_by_id(id: &str) -> Option<FieldPreset> {
    presets().into_iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_ids_are_unique_and_findable() {
        let all = presets();
        let mut ids: Vec<&str> = all.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        let n = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), n, "duplicate preset id");
        assert!(preset_by_id("carlson_pnezd").is_some());
        assert!(preset_by_id("nope").is_none());
    }

    #[test]
    fn csv_presets_have_columns_xml_presets_dont() {
        for p in presets() {
            match p.format {
                FieldFormat::Csv => assert!(!p.columns.is_empty(), "{} needs columns", p.id),
                FieldFormat::LandXml | FieldFormat::JobXml => {
                    assert!(p.columns.is_empty(), "{} should have no columns", p.id)
                }
            }
        }
    }

    #[test]
    fn carlson_is_pnezd_order() {
        let p = preset_by_id("carlson_pnezd").unwrap();
        assert_eq!(p.columns, PNEZD);
        assert_eq!(p.delimiter, b',');
        assert!(!p.has_header);
    }

    #[test]
    fn trimble_csv_is_penzd_order() {
        let p = preset_by_id("trimble_csv").unwrap();
        assert_eq!(p.columns, PENZD);
    }
}
