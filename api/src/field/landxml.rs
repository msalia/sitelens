//! LandXML codec — a thin adapter over the existing LandXML reader/writer so it
//! plugs into the [`FieldCodec`] trait uniformly.

use crate::export::{to_landxml, ExportPoint};
use crate::import::{parse_landxml, ImportError, ParsedPoint};

use super::FieldCodec;

pub struct LandXmlCodec;

impl FieldCodec for LandXmlCodec {
    fn encode(&self, points: &[ExportPoint]) -> String {
        to_landxml(points)
    }

    fn decode(&self, content: &str) -> Result<Vec<ParsedPoint>, ImportError> {
        parse_landxml(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_identity() {
        let points = vec![
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
        ];
        let back = LandXmlCodec.decode(&LandXmlCodec.encode(&points)).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].label, "1");
        assert_eq!(back[0].northing, 100.0);
        assert_eq!(back[0].easting, 200.0);
        assert_eq!(back[0].elevation, Some(5.0));
        assert_eq!(back[0].description, "MON");
        assert_eq!(back[1].elevation, None);
    }
}
