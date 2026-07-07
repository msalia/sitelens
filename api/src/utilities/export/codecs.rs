//! Geometry codecs: portable, self-describing exports of the utility record.
//! All coordinates are canonical **meters** (or WGS84 degrees for GeoJSON).

use serde_json::{json, Value};

use super::{ExRun, ExStruct};

/// DXF/LandXML layer name for a type key (e.g. "storm_sewer" → "STORM_SEWER").
fn layer_name(type_key: &str) -> String {
    type_key.to_ascii_uppercase()
}

fn f4(v: f64) -> f64 {
    (v * 1e4).round() / 1e4
}

fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ---------------------------------------------------------------- GeoJSON

/// A FeatureCollection: runs as LineString, structures as Point, both in WGS84
/// `[lon, lat, elevation]` with the full attribute set as properties.
pub fn to_geojson(runs: &[ExRun], structs: &[ExStruct]) -> String {
    let mut features: Vec<Value> = Vec::new();
    for r in runs {
        let coords: Vec<Value> = r
            .vertices
            .iter()
            .map(|v| json!([f4(v.lon), f4(v.lat), v.elevation.unwrap_or(0.0)]))
            .collect();
        features.push(json!({
            "type": "Feature",
            "geometry": { "type": "LineString", "coordinates": coords },
            "properties": {
                "kind": "run",
                "type": r.type_key,
                "label": r.label,
                "material": r.material,
                "diameter_m": r.diameter_m,
                "invert_up_m": r.invert_up,
                "invert_down_m": r.invert_down,
                "slope": r.slope,
                "length_m": r.length_m,
                "tags": r.tags,
            }
        }));
    }
    for s in structs {
        features.push(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [f4(s.lon), f4(s.lat), s.rim_elev.unwrap_or(0.0)] },
            "properties": {
                "kind": "structure",
                "type": s.type_key,
                "label": s.label,
                "material": s.material,
                "rim_elev_m": s.rim_elev,
                "tags": s.tags,
            }
        }));
    }
    let fc = json!({
        "type": "FeatureCollection",
        "features": features,
        "properties": { "generator": "SiteLens", "crs": "WGS84", "units": "meters" },
    });
    serde_json::to_string_pretty(&fc).unwrap_or_else(|_| "{}".into())
}

// ------------------------------------------------------------------- DXF

/// DXF with runs as 3D LINE segments and structures as CIRCLE nodes, each on a
/// layer named after its utility type. Coordinates are projected meters
/// (easting = X, northing = Y, invert/rim = Z).
pub fn to_dxf(runs: &[ExRun], structs: &[ExStruct]) -> Result<String, String> {
    use dxf::entities::{Circle, Entity, EntityType, Line};
    use dxf::{Drawing, Point};

    let mut d = Drawing::new();
    for r in runs {
        let layer = layer_name(&r.type_key);
        for w in r.vertices.windows(2) {
            let line = Line {
                p1: Point::new(w[0].easting, w[0].northing, w[0].elevation.unwrap_or(0.0)),
                p2: Point::new(w[1].easting, w[1].northing, w[1].elevation.unwrap_or(0.0)),
                ..Default::default()
            };
            let mut e = Entity::new(EntityType::Line(line));
            e.common.layer = layer.clone();
            d.add_entity(e);
        }
    }
    for s in structs {
        let c = Circle {
            center: Point::new(s.easting, s.northing, s.rim_elev.unwrap_or(0.0)),
            radius: 0.5,
            ..Default::default()
        };
        let mut e = Entity::new(EntityType::Circle(c));
        e.common.layer = layer_name(&s.type_key);
        d.add_entity(e);
    }
    let mut buf: Vec<u8> = Vec::new();
    d.save(&mut buf).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

// --------------------------------------------------------------- LandXML

/// LandXML 1.2 — generic `PlanFeatures` (runs as IrregularLine) + `CgPoints`
/// (structures). LandXML has no clean multi-vertex utility model, so this is a
/// **weak-support** geometry-only export (documented for the user); use DXF or
/// GeoJSON for a faithful round-trip. Coordinates are "northing easting elev".
pub fn to_landxml(runs: &[ExRun], structs: &[ExStruct]) -> String {
    let mut features = String::new();
    for r in runs {
        let pnts: String = r
            .vertices
            .iter()
            .map(|v| {
                format!(
                    "{} {} {}",
                    f4(v.northing),
                    f4(v.easting),
                    v.elevation.unwrap_or(0.0)
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        features.push_str(&format!(
            "    <PlanFeature name=\"{}\" desc=\"{}\">\n\
             \x20     <CoordGeom><IrregularLine><PntList3D>{}</PntList3D></IrregularLine></CoordGeom>\n\
             \x20   </PlanFeature>\n",
            xml_esc(&r.label),
            xml_esc(&r.type_key),
            pnts,
        ));
    }
    let mut points = String::new();
    for s in structs {
        points.push_str(&format!(
            "    <CgPoint name=\"{}\" desc=\"{}\">{} {} {}</CgPoint>\n",
            xml_esc(&s.label),
            xml_esc(&s.type_key),
            f4(s.northing),
            f4(s.easting),
            s.rim_elev.unwrap_or(0.0),
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <LandXML xmlns=\"http://www.landxml.org/schema/LandXML-1.2\" version=\"1.2\">\n\
         \x20 <Units><Metric linearUnit=\"meter\" areaUnit=\"squareMeter\" volumeUnit=\"cubicMeter\" \
         angularUnit=\"decimal degrees\" directionUnit=\"decimal degrees\"/></Units>\n\
         \x20 <CgPoints name=\"Utility structures\">\n{points}  </CgPoints>\n\
         \x20 <PlanFeatures name=\"Utility runs\">\n{features}  </PlanFeatures>\n\
         </LandXML>\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utilities::export::fixtures::{run, structure};

    #[test]
    fn geojson_has_line_and_point_features() {
        let s = to_geojson(&[run()], &[structure()]);
        let v: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "FeatureCollection");
        assert_eq!(v["features"][0]["geometry"]["type"], "LineString");
        assert_eq!(v["features"][0]["properties"]["type"], "water");
        assert_eq!(v["features"][1]["geometry"]["type"], "Point");
        assert_eq!(v["features"][1]["properties"]["label"], "MH-1");
    }

    #[test]
    fn dxf_round_trips_layers_and_geometry() {
        let text = to_dxf(&[run()], &[structure()]).unwrap();
        let parsed = crate::dxf::parse(&text).unwrap();
        // The run's segment is a 2-point LINE on the WATER layer; the structure's
        // CIRCLE lands on the MANHOLE layer (parse tessellates it to a polyline).
        let water = parsed
            .polylines
            .iter()
            .find(|p| p.layer == "WATER")
            .expect("run on WATER layer");
        assert_eq!(water.points.len(), 2);
        assert!(parsed.layers.iter().any(|l| l == "MANHOLE"));
    }

    #[test]
    fn landxml_is_well_formed_with_features_and_points() {
        let x = to_landxml(&[run()], &[structure()]);
        assert!(x.contains("<LandXML"));
        assert!(x.contains("<PlanFeature name=\"W-1\""));
        assert!(x.contains("<CgPoint name=\"MH-1\""));
        assert!(x.contains("IrregularLine"));
    }
}
