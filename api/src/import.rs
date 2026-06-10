//! Parsers for survey-machine exports: delimited CSV (with a column mapping)
//! and LandXML CgPoints. Coordinates come out in the file's own unit — the
//! caller converts to meters. Size and row caps guard against hostile input.

pub const MAX_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_ROWS: usize = 100_000;

/// One parsed point, in the source file's unit (not yet meters).
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedPoint {
    pub label: String,
    pub description: String,
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
}

/// Which 0-based CSV columns map to which field.
#[derive(Debug, Clone)]
pub struct CsvMapping {
    pub has_header: bool,
    pub label_col: Option<usize>,
    pub northing_col: usize,
    pub easting_col: usize,
    pub elevation_col: Option<usize>,
    pub description_col: Option<usize>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ImportError {
    TooLarge,
    TooManyRows,
    Parse(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::TooLarge => write!(f, "file exceeds the maximum allowed size"),
            ImportError::TooManyRows => write!(f, "file exceeds the maximum allowed point count"),
            ImportError::Parse(m) => write!(f, "parse error: {m}"),
        }
    }
}

fn check_size(content: &str) -> Result<(), ImportError> {
    if content.len() > MAX_BYTES {
        return Err(ImportError::TooLarge);
    }
    Ok(())
}

fn field(record: &csv::StringRecord, col: usize) -> Result<&str, ImportError> {
    record
        .get(col)
        .ok_or_else(|| ImportError::Parse(format!("missing column {col}")))
}

fn parse_num(s: &str, what: &str) -> Result<f64, ImportError> {
    s.trim()
        .parse::<f64>()
        .map_err(|_| ImportError::Parse(format!("invalid {what}: '{s}'")))
}

pub fn parse_csv(content: &str, mapping: &CsvMapping) -> Result<Vec<ParsedPoint>, ImportError> {
    check_size(content)?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(mapping.has_header)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(content.as_bytes());

    let mut points = Vec::new();
    for (i, result) in reader.records().enumerate() {
        if points.len() >= MAX_ROWS {
            return Err(ImportError::TooManyRows);
        }
        let record = result.map_err(|e| ImportError::Parse(e.to_string()))?;
        // Skip fully empty rows.
        if record.iter().all(|f| f.trim().is_empty()) {
            continue;
        }
        let northing = parse_num(field(&record, mapping.northing_col)?, "northing")?;
        let easting = parse_num(field(&record, mapping.easting_col)?, "easting")?;
        let elevation = match mapping.elevation_col {
            Some(c) => {
                let raw = field(&record, c)?.trim();
                if raw.is_empty() {
                    None
                } else {
                    Some(parse_num(raw, "elevation")?)
                }
            }
            None => None,
        };
        let label = match mapping.label_col {
            Some(c) => field(&record, c)?.trim().to_string(),
            None => (i + 1).to_string(),
        };
        let description = match mapping.description_col {
            Some(c) => field(&record, c)?.trim().to_string(),
            None => String::new(),
        };
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

/// Parses LandXML `<CgPoint>` elements. Default coordinate order is
/// `northing easting elevation`; `name` is the label, `code`/`desc` the note.
pub fn parse_landxml(content: &str) -> Result<Vec<ParsedPoint>, ImportError> {
    check_size(content)?;
    let doc = roxmltree::Document::parse(content).map_err(|e| ImportError::Parse(e.to_string()))?;
    let mut points = Vec::new();
    for node in doc.descendants().filter(|n| n.has_tag_name("CgPoint")) {
        if points.len() >= MAX_ROWS {
            return Err(ImportError::TooManyRows);
        }
        let text = node.text().unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }
        let nums: Vec<&str> = text.split_whitespace().collect();
        if nums.len() < 2 {
            return Err(ImportError::Parse(format!("CgPoint needs N E: '{text}'")));
        }
        let northing = parse_num(nums[0], "northing")?;
        let easting = parse_num(nums[1], "easting")?;
        let elevation = nums.get(2).map(|s| parse_num(s, "elevation")).transpose()?;
        let label = node
            .attribute("name")
            .map(|s| s.to_string())
            .unwrap_or_else(|| (points.len() + 1).to_string());
        let description = node
            .attribute("code")
            .or_else(|| node.attribute("desc"))
            .unwrap_or("")
            .to_string();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn pnezd_mapping(has_header: bool) -> CsvMapping {
        // P, N, E, Z, D
        CsvMapping {
            has_header,
            label_col: Some(0),
            northing_col: 1,
            easting_col: 2,
            elevation_col: Some(3),
            description_col: Some(4),
        }
    }

    #[test]
    fn parses_pnezd_with_header() {
        let csv = "P,N,E,Z,D\n1,100.0,200.0,5.0,MON\n2,101,201,,IP\n";
        let pts = parse_csv(csv, &pnezd_mapping(true)).unwrap();
        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].label, "1");
        assert_eq!(pts[0].northing, 100.0);
        assert_eq!(pts[0].easting, 200.0);
        assert_eq!(pts[0].elevation, Some(5.0));
        assert_eq!(pts[0].description, "MON");
        assert_eq!(pts[1].elevation, None); // blank Z
    }

    #[test]
    fn parses_alternate_column_order_e_n() {
        // Columns: E, N (no header, no label/elev/desc) → label auto-numbered.
        let mapping = CsvMapping {
            has_header: false,
            label_col: None,
            northing_col: 1,
            easting_col: 0,
            elevation_col: None,
            description_col: None,
        };
        let pts = parse_csv("200,100\n201,101\n", &mapping).unwrap();
        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].easting, 200.0);
        assert_eq!(pts[0].northing, 100.0);
        assert_eq!(pts[0].label, "1");
    }

    #[test]
    fn rejects_invalid_number() {
        let csv = "1,abc,200,,\n";
        assert!(matches!(
            parse_csv(csv, &pnezd_mapping(false)),
            Err(ImportError::Parse(_))
        ));
    }

    #[test]
    fn rejects_oversized_input() {
        let big = "x".repeat(MAX_BYTES + 1);
        assert_eq!(
            parse_csv(&big, &pnezd_mapping(false)),
            Err(ImportError::TooLarge)
        );
        assert_eq!(parse_landxml(&big), Err(ImportError::TooLarge));
    }

    #[test]
    fn parses_landxml_cgpoints() {
        let xml = r#"<?xml version="1.0"?>
            <LandXML><CgPoints>
              <CgPoint name="1" code="MON">100.0 200.0 5.0</CgPoint>
              <CgPoint name="2">101.0 201.0</CgPoint>
            </CgPoints></LandXML>"#;
        let pts = parse_landxml(xml).unwrap();
        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].label, "1");
        assert_eq!(pts[0].northing, 100.0);
        assert_eq!(pts[0].easting, 200.0);
        assert_eq!(pts[0].elevation, Some(5.0));
        assert_eq!(pts[0].description, "MON");
        assert_eq!(pts[1].elevation, None);
    }

    #[test]
    fn rejects_malformed_xml() {
        assert!(matches!(
            parse_landxml("<LandXML><CgPoint>oops"),
            Err(ImportError::Parse(_))
        ));
    }
}
