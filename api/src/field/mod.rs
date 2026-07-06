//! Field-survey-app file interop: per-app format codecs over the shared
//! [`ParsedPoint`] / [`ExportPoint`] shapes. Each codec converts to/from those
//! shapes so the rest of the import/export pipeline stays format-agnostic.
//!
//! This is the shared codec layer (foundation §4), seeded by field-exchange:
//! CSV presets + LandXML + native Trimble JobXML live here now; DXF/GeoJSON join
//! later from utility-records. Keep the [`FieldCodec`] trait and the
//! [`ParsedPoint`]/[`ExportPoint`] contract format-general so those additions
//! slot in without reshaping this layer.

use async_graphql::Enum;

use crate::export::ExportPoint;
use crate::import::{ImportError, ParsedPoint};

pub mod compare;
pub mod csv_preset;
pub mod jobxml;
pub mod landxml;
pub mod preset;
pub mod report;

pub use preset::{preset_by_id, presets, FieldColumn, FieldPreset};

/// The field file formats SiteLens can encode and decode.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum FieldFormat {
    Csv,
    LandXml,
    JobXml,
}

/// A format codec: encode already-converted points (in the target space/unit)
/// to file text, and decode file text into points expressed in the file's own
/// space/unit (the caller converts those to canonical meters).
pub trait FieldCodec {
    fn encode(&self, points: &[ExportPoint]) -> String;
    fn decode(&self, content: &str) -> Result<Vec<ParsedPoint>, ImportError>;
}

/// Sniffs the format from the file's leading bytes: JobXML and LandXML by their
/// XML root element, everything else CSV. Manual override happens upstream.
pub fn detect(content: &str) -> FieldFormat {
    let head = content.trim_start();
    if head.starts_with('<') {
        // Only probe the first chunk so a large file isn't rescanned in full.
        let probe = head.get(..head.len().min(4096)).unwrap_or(head);
        if probe.contains("<JOBFile") {
            return FieldFormat::JobXml;
        }
        if probe.contains("LandXML") {
            return FieldFormat::LandXml;
        }
    }
    FieldFormat::Csv
}

/// Returns the codec for a format. CSV needs a preset (column order/delimiter);
/// the XML formats are self-describing, so their preset arg is ignored.
pub fn codec<'a>(
    format: FieldFormat,
    preset: Option<&'a FieldPreset>,
) -> Result<Box<dyn FieldCodec + 'a>, ImportError> {
    Ok(match format {
        FieldFormat::Csv => {
            let preset = preset.ok_or_else(|| {
                ImportError::Parse("a CSV preset is required to encode/decode CSV".into())
            })?;
            Box::new(csv_preset::CsvPresetCodec::new(preset))
        }
        FieldFormat::LandXml => Box::new(landxml::LandXmlCodec),
        FieldFormat::JobXml => Box::new(jobxml::JobXmlCodec),
    })
}

impl FieldFormat {
    /// Wire/DB string used in `as_built_batches.format` (CHECK: jobxml|landxml|csv).
    pub fn as_db_str(self) -> &'static str {
        match self {
            FieldFormat::Csv => "csv",
            FieldFormat::LandXml => "landxml",
            FieldFormat::JobXml => "jobxml",
        }
    }

    pub fn from_db_str(s: &str) -> Option<FieldFormat> {
        match s {
            "csv" => Some(FieldFormat::Csv),
            "landxml" => Some(FieldFormat::LandXml),
            "jobxml" => Some(FieldFormat::JobXml),
            _ => None,
        }
    }
}

/// The file extension (no dot) for a format.
pub fn extension(format: FieldFormat) -> &'static str {
    match format {
        FieldFormat::Csv => "csv",
        FieldFormat::LandXml => "xml",
        FieldFormat::JobXml => "jxl",
    }
}

/// The MIME type for a format.
pub fn mime_type(format: FieldFormat) -> &'static str {
    match format {
        FieldFormat::Csv => "text/csv",
        FieldFormat::LandXml | FieldFormat::JobXml => "application/xml",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_by_root_element() {
        assert_eq!(detect("  1,100,200\n"), FieldFormat::Csv);
        assert_eq!(
            detect("<?xml version=\"1.0\"?>\n<LandXML></LandXML>"),
            FieldFormat::LandXml
        );
        assert_eq!(
            detect("<?xml version=\"1.0\"?>\n<JOBFile version=\"5.9\"></JOBFile>"),
            FieldFormat::JobXml
        );
    }

    #[test]
    fn unknown_xml_falls_back_to_csv() {
        // Not a field format we recognize → treated as CSV (upstream override).
        assert_eq!(detect("<html><body>nope</body></html>"), FieldFormat::Csv);
    }

    #[test]
    fn codec_requires_preset_for_csv() {
        assert!(codec(FieldFormat::Csv, None).is_err());
        assert!(codec(FieldFormat::LandXml, None).is_ok());
        assert!(codec(FieldFormat::JobXml, None).is_ok());
    }
}
