//! Export formatters: CSV (configurable column order) and LandXML. Coordinate
//! conversion happens in the resolver; these take already-formatted values.

/// One point's projected/grid coordinates for LandXML, in the export unit.
pub struct ExportPoint {
    pub name: String,
    pub description: String,
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
}

/// Renders rows to CSV with a header. Quotes fields containing separators.
pub fn to_csv(headers: &[String], rows: &[Vec<String>]) -> String {
    let mut wtr = csv::WriterBuilder::new().from_writer(vec![]);
    wtr.write_record(headers).expect("write header");
    for row in rows {
        wtr.write_record(row).expect("write row");
    }
    let bytes = wtr.into_inner().expect("flush csv");
    String::from_utf8(bytes).expect("utf8 csv")
}

/// Renders points as a minimal LandXML CgPoints block (northing easting elevation).
pub fn to_landxml(points: &[ExportPoint]) -> String {
    fn esc(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\"?>\n");
    out.push_str("<LandXML xmlns=\"http://www.landxml.org/schema/LandXML-1.2\">\n");
    out.push_str("  <CgPoints>\n");
    for p in points {
        let coords = match p.elevation {
            Some(z) => format!("{} {} {}", p.northing, p.easting, z),
            None => format!("{} {}", p.northing, p.easting),
        };
        out.push_str(&format!(
            "    <CgPoint name=\"{}\" desc=\"{}\">{}</CgPoint>\n",
            esc(&p.name),
            esc(&p.description),
            coords
        ));
    }
    out.push_str("  </CgPoints>\n");
    out.push_str("</LandXML>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_has_header_and_rows() {
        let csv = to_csv(
            &["P".into(), "N".into(), "E".into()],
            &[
                vec!["1".into(), "100".into(), "200".into()],
                vec!["2".into(), "101".into(), "201".into()],
            ],
        );
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "P,N,E");
        assert_eq!(lines[1], "1,100,200");
        assert_eq!(lines[2], "2,101,201");
    }

    #[test]
    fn csv_quotes_fields_with_commas() {
        let csv = to_csv(&["D".into()], &[vec!["a,b".into()]]);
        assert!(csv.contains("\"a,b\""));
    }

    #[test]
    fn landxml_emits_cgpoints() {
        let xml = to_landxml(&[
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
                northing: 101.0,
                easting: 201.0,
                elevation: None,
            },
        ]);
        assert!(xml.contains(r#"<CgPoint name="1" desc="MON">100 200 5</CgPoint>"#));
        assert!(xml.contains(r#"<CgPoint name="2" desc="">101 201</CgPoint>"#));
    }

    #[test]
    fn csv_escapes_embedded_quotes() {
        // RFC 4180: a double-quote inside a quoted field is doubled.
        let csv = to_csv(&["D".into()], &[vec![r#"say "hi""#.into()]]);
        assert!(csv.contains(r#""say ""hi""""#), "got: {csv}");
    }

    #[test]
    fn csv_handles_empty_rows() {
        let csv = to_csv(&["A".into(), "B".into()], &[]);
        assert_eq!(csv.trim(), "A,B");
    }

    #[test]
    fn landxml_with_no_points_is_well_formed() {
        let xml = to_landxml(&[]);
        assert!(xml.contains("<CgPoints"));
        assert!(!xml.contains("<CgPoint "));
    }
}
