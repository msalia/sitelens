//! CSV codec keyed by a per-app preset: a fixed column order, delimiter, and
//! header, over the shared `ParsedPoint` / `ExportPoint` shapes. Bounded by the
//! same size/row caps as the generic importer.

use crate::export::ExportPoint;
use crate::import::{ImportError, ParsedPoint, MAX_BYTES, MAX_ROWS};

use super::preset::{FieldColumn, FieldPreset};
use super::FieldCodec;

pub struct CsvPresetCodec<'a> {
    preset: &'a FieldPreset,
}

impl<'a> CsvPresetCodec<'a> {
    pub fn new(preset: &'a FieldPreset) -> Self {
        Self { preset }
    }
}

impl FieldCodec for CsvPresetCodec<'_> {
    fn encode(&self, points: &[ExportPoint]) -> String {
        let p = self.preset;
        let mut wtr = csv::WriterBuilder::new()
            .delimiter(p.delimiter)
            .from_writer(vec![]);
        if p.has_header {
            let header: Vec<&str> = p.columns.iter().map(|c| header_label(*c)).collect();
            wtr.write_record(&header).expect("write header");
        }
        for pt in points {
            let row: Vec<String> = p.columns.iter().map(|c| cell(*c, pt)).collect();
            wtr.write_record(&row).expect("write row");
        }
        let bytes = wtr.into_inner().expect("flush csv");
        String::from_utf8(bytes).expect("utf8 csv")
    }

    fn decode(&self, content: &str) -> Result<Vec<ParsedPoint>, ImportError> {
        if content.len() > MAX_BYTES {
            return Err(ImportError::TooLarge);
        }
        let p = self.preset;
        let pos = |want: FieldColumn| p.columns.iter().position(|c| *c == want);
        let n_col = pos(FieldColumn::Northing).ok_or_else(|| miss("northing"))?;
        let e_col = pos(FieldColumn::Easting).ok_or_else(|| miss("easting"))?;
        let p_col = pos(FieldColumn::Point);
        let z_col = pos(FieldColumn::Elevation);
        let d_col = pos(FieldColumn::Code);

        let mut reader = csv::ReaderBuilder::new()
            .has_headers(p.has_header)
            .delimiter(p.delimiter)
            .flexible(true)
            .trim(csv::Trim::All)
            .from_reader(content.as_bytes());

        let mut points = Vec::new();
        for (i, result) in reader.records().enumerate() {
            if points.len() >= MAX_ROWS {
                return Err(ImportError::TooManyRows);
            }
            let record = result.map_err(|e| ImportError::Parse(e.to_string()))?;
            if record.iter().all(|f| f.trim().is_empty()) {
                continue;
            }
            let northing = num(&record, n_col, "northing")?;
            let easting = num(&record, e_col, "easting")?;
            let elevation = match z_col {
                Some(c) => match record.get(c).map(str::trim) {
                    Some(s) if !s.is_empty() => Some(
                        s.parse::<f64>()
                            .map_err(|_| ImportError::Parse(format!("invalid elevation: '{s}'")))?,
                    ),
                    _ => None,
                },
                None => None,
            };
            let label = p_col
                .and_then(|c| record.get(c))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| (i + 1).to_string());
            let description = d_col
                .and_then(|c| record.get(c))
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            points.push(ParsedPoint {
                label,
                description,
                northing,
                easting,
                elevation,
            });
        }
        Ok(points)
    }
}

fn miss(what: &str) -> ImportError {
    ImportError::Parse(format!("preset has no {what} column"))
}

fn num(record: &csv::StringRecord, col: usize, what: &str) -> Result<f64, ImportError> {
    let raw = record
        .get(col)
        .ok_or_else(|| ImportError::Parse(format!("missing column {col}")))?;
    raw.trim()
        .parse::<f64>()
        .map_err(|_| ImportError::Parse(format!("invalid {what}: '{raw}'")))
}

fn header_label(c: FieldColumn) -> &'static str {
    match c {
        FieldColumn::Point => "Point",
        FieldColumn::Northing => "Northing",
        FieldColumn::Easting => "Easting",
        FieldColumn::Elevation => "Elevation",
        FieldColumn::Code => "Code",
    }
}

fn cell(c: FieldColumn, p: &ExportPoint) -> String {
    match c {
        FieldColumn::Point => p.name.clone(),
        FieldColumn::Northing => format!("{:.4}", p.northing),
        FieldColumn::Easting => format!("{:.4}", p.easting),
        FieldColumn::Elevation => p.elevation.map(|z| format!("{z:.4}")).unwrap_or_default(),
        FieldColumn::Code => p.description.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::field::preset_by_id;

    fn sample() -> Vec<ExportPoint> {
        vec![
            ExportPoint {
                name: "1".into(),
                description: "MON".into(),
                northing: 100.1234,
                easting: 200.5678,
                elevation: Some(5.25),
            },
            ExportPoint {
                name: "2".into(),
                description: String::new(),
                northing: 101.0,
                easting: 201.0,
                elevation: None,
            },
        ]
    }

    #[test]
    fn pnezd_column_order_and_header() {
        let preset = preset_by_id("generic_csv").unwrap(); // PNEZD + header
        let out = CsvPresetCodec::new(&preset).encode(&sample());
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "Point,Northing,Easting,Elevation,Code");
        assert_eq!(lines[1], "1,100.1234,200.5678,5.2500,MON");
        assert_eq!(lines[2], "2,101.0000,201.0000,,"); // blank Z + code
    }

    #[test]
    fn penzd_swaps_north_east() {
        let preset = preset_by_id("trimble_csv").unwrap(); // PENZD, no header
        let out = CsvPresetCodec::new(&preset).encode(&sample());
        // First data row: Point,Easting,Northing,Elevation,Code
        assert_eq!(
            out.lines().next().unwrap(),
            "1,200.5678,100.1234,5.2500,MON"
        );
    }

    #[test]
    fn round_trip_identity_pnezd() {
        let preset = preset_by_id("carlson_pnezd").unwrap();
        let codec = CsvPresetCodec::new(&preset);
        let back = codec.decode(&codec.encode(&sample())).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].label, "1");
        assert_eq!(back[0].northing, 100.1234);
        assert_eq!(back[0].easting, 200.5678);
        assert_eq!(back[0].elevation, Some(5.25));
        assert_eq!(back[0].description, "MON");
        assert_eq!(back[1].elevation, None);
    }

    #[test]
    fn round_trip_identity_penzd() {
        let preset = preset_by_id("trimble_csv").unwrap();
        let codec = CsvPresetCodec::new(&preset);
        let back = codec.decode(&codec.encode(&sample())).unwrap();
        assert_eq!(back[0].northing, 100.1234);
        assert_eq!(back[0].easting, 200.5678);
    }

    #[test]
    fn decode_rejects_bad_number() {
        let preset = preset_by_id("carlson_pnezd").unwrap();
        assert!(matches!(
            CsvPresetCodec::new(&preset).decode("1,abc,200,,\n"),
            Err(ImportError::Parse(_))
        ));
    }

    #[test]
    fn decode_rejects_oversized() {
        let preset = preset_by_id("carlson_pnezd").unwrap();
        let big = "x".repeat(MAX_BYTES + 1);
        assert_eq!(
            CsvPresetCodec::new(&preset).decode(&big),
            Err(ImportError::TooLarge)
        );
    }
}
