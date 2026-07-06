//! Native Trimble JobXML (.jxl) codec. Encodes a minimal but Trimble-shaped
//! `JOBFile` whose `Reductions` carry grid-coordinate `Point` records; decodes
//! `Point`/`Grid` records back to `ParsedPoint`s. ASCII/XML, bounded, and parsed
//! with `roxmltree` (no entity expansion).
//!
//! The exact element set is validated on-device in Phase 7 (real Trimble Access
//! import/export); this v1 subset round-trips and decodes real-sample fixtures.

use crate::export::ExportPoint;
use crate::import::{ImportError, ParsedPoint, MAX_BYTES, MAX_ROWS};

use super::FieldCodec;

pub struct JobXmlCodec;

impl FieldCodec for JobXmlCodec {
    fn encode(&self, points: &[ExportPoint]) -> String {
        let mut out = String::new();
        out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        out.push_str("<JOBFile jobName=\"SiteLens\" version=\"5.90\" product=\"SiteLens\">\n");
        out.push_str("  <Reductions>\n");
        for p in points {
            out.push_str("    <Point>\n");
            out.push_str(&format!("      <Name>{}</Name>\n", esc(&p.name)));
            out.push_str(&format!("      <Code>{}</Code>\n", esc(&p.description)));
            out.push_str("      <Grid>\n");
            out.push_str(&format!("        <North>{}</North>\n", p.northing));
            out.push_str(&format!("        <East>{}</East>\n", p.easting));
            if let Some(z) = p.elevation {
                out.push_str(&format!("        <Elevation>{z}</Elevation>\n"));
            }
            out.push_str("      </Grid>\n");
            out.push_str("    </Point>\n");
        }
        out.push_str("  </Reductions>\n");
        out.push_str("</JOBFile>\n");
        out
    }

    fn decode(&self, content: &str) -> Result<Vec<ParsedPoint>, ImportError> {
        if content.len() > MAX_BYTES {
            return Err(ImportError::TooLarge);
        }
        let doc =
            roxmltree::Document::parse(content).map_err(|e| ImportError::Parse(e.to_string()))?;
        let mut points = Vec::new();
        for node in doc.descendants().filter(|n| n.has_tag_name("Point")) {
            // Only Points carrying a Grid child are coordinates; skip others.
            let Some(grid) = node.children().find(|c| c.has_tag_name("Grid")) else {
                continue;
            };
            if points.len() >= MAX_ROWS {
                return Err(ImportError::TooManyRows);
            }
            let (Some(northing), Some(easting)) =
                (child_num(grid, "North"), child_num(grid, "East"))
            else {
                return Err(ImportError::Parse("Point/Grid missing North/East".into()));
            };
            let elevation = child_num(grid, "Elevation");
            let label = child_text(node, "Name")
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| (points.len() + 1).to_string());
            let description = child_text(node, "Code").unwrap_or_default();
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

fn child_num(parent: roxmltree::Node, tag: &str) -> Option<f64> {
    parent
        .children()
        .find(|c| c.has_tag_name(tag))
        .and_then(|c| c.text())
        .and_then(|t| t.trim().parse::<f64>().ok())
}

fn child_text(parent: roxmltree::Node, tag: &str) -> Option<String> {
    parent
        .children()
        .find(|c| c.has_tag_name(tag))
        .and_then(|c| c.text())
        .map(|t| t.trim().to_string())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<ExportPoint> {
        vec![
            ExportPoint {
                name: "1".into(),
                description: "MON".into(),
                northing: 100.0,
                easting: 200.0,
                elevation: Some(5.0),
            },
            ExportPoint {
                name: "2".into(),
                description: String::new(),
                northing: 101.5,
                easting: 201.5,
                elevation: None,
            },
        ]
    }

    #[test]
    fn encodes_jobfile_reductions() {
        let out = JobXmlCodec.encode(&sample());
        assert!(out.contains("<JOBFile"));
        assert!(out.contains("<Reductions>"));
        assert!(out.contains("<Name>1</Name>"));
        assert!(out.contains("<North>100</North>"));
        assert!(out.contains("<East>200</East>"));
        assert!(out.contains("<Elevation>5</Elevation>"));
    }

    #[test]
    fn round_trip_identity() {
        let back = JobXmlCodec.decode(&JobXmlCodec.encode(&sample())).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].label, "1");
        assert_eq!(back[0].northing, 100.0);
        assert_eq!(back[0].easting, 200.0);
        assert_eq!(back[0].elevation, Some(5.0));
        assert_eq!(back[0].description, "MON");
        assert_eq!(back[1].elevation, None);
    }

    #[test]
    fn decodes_known_fixture() {
        let jxl = r#"<?xml version="1.0" encoding="UTF-8"?>
            <JOBFile version="5.90">
              <Reductions>
                <Point>
                  <Name>STA1</Name>
                  <Code>CP</Code>
                  <Grid><North>5000.123</North><East>7000.456</East><Elevation>12.5</Elevation></Grid>
                </Point>
                <Point>
                  <Name>OBS</Name>
                  <Circle><HorizontalCircle>90.0</HorizontalCircle></Circle>
                </Point>
              </Reductions>
            </JOBFile>"#;
        let pts = JobXmlCodec.decode(jxl).unwrap();
        // The observation-only Point (no Grid) is skipped.
        assert_eq!(pts.len(), 1);
        assert_eq!(pts[0].label, "STA1");
        assert_eq!(pts[0].northing, 5000.123);
        assert_eq!(pts[0].easting, 7000.456);
        assert_eq!(pts[0].elevation, Some(12.5));
        assert_eq!(pts[0].description, "CP");
    }

    #[test]
    fn rejects_malformed_xml() {
        assert!(matches!(
            JobXmlCodec.decode("<JOBFile><Point>oops"),
            Err(ImportError::Parse(_))
        ));
    }

    #[test]
    fn rejects_oversized() {
        let big = "x".repeat(MAX_BYTES + 1);
        assert_eq!(JobXmlCodec.decode(&big), Err(ImportError::TooLarge));
    }

    #[test]
    fn grid_missing_coords_errors() {
        let jxl = "<JOBFile><Reductions><Point><Name>1</Name><Grid><North>1.0</North></Grid></Point></Reductions></JOBFile>";
        assert!(matches!(
            JobXmlCodec.decode(jxl),
            Err(ImportError::Parse(_))
        ));
    }
}
