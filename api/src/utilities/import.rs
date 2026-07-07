//! Utility import: turn pre-drawn linework (DXF via the shared `crate::dxf`
//! codec, or GeoJSON) into importable runs + structures. Pure parsing +
//! layer→type mapping here; the resolver does DB writes + reprojection.

use serde_json::Value;

/// Geometry kind a source feature maps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeatureKind {
    /// A polyline → a utility run.
    Line,
    /// A point/node → a utility structure.
    Point,
}

/// A parsed feature ready to be mapped to a utility type and imported. Coords
/// are in the source's own space (drawing units for DXF, lon/lat for GeoJSON) —
/// the resolver reprojects/scales to canonical meters.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportFeature {
    /// Grouping key: DXF layer, or a GeoJSON property value / "geojson".
    pub layer: String,
    pub kind: FeatureKind,
    pub label: Option<String>,
    /// (x, y) pairs — a single pair for a point.
    pub points: Vec<(f64, f64)>,
}

/// A layer/group in the source, with a suggested APWA type for the mapping UI.
#[derive(Debug, Clone, PartialEq)]
pub struct LayerSummary {
    pub layer: String,
    pub kind: FeatureKind,
    pub count: usize,
    pub suggested_type: Option<String>,
}

/// Guess an APWA utility-type key from a CAD layer / GeoJSON group name using
/// common survey/CAD naming. Case-insensitive substring match; `None` when
/// nothing fits (the user maps it manually). Structure keywords win over linear
/// ones so "SSMH" (sanitary manhole) maps to a structure.
pub fn guess_type(name: &str) -> Option<&'static str> {
    let n = name.to_ascii_uppercase();
    let has = |kw: &str| n.contains(kw);

    // Structures first.
    if has("MANHOLE") || has("MH") {
        return Some("manhole");
    }
    if has("CATCH") || has("CB") || has("INLET") {
        return Some("catch_basin");
    }
    if has("CLEANOUT") || has("CO") {
        return Some("cleanout");
    }
    if has("HYDRANT") || has("FH") {
        return Some("hydrant");
    }
    if has("VALVE") || has("GV") || has("WV") {
        return Some("valve");
    }
    if has("VAULT") {
        return Some("vault");
    }
    // Linear.
    if has("SANITARY") || has("SAN") || has("SS") || has("SEWER") {
        return Some("sanitary_sewer");
    }
    if has("STORM") || has("STM") || has("SD") {
        return Some("storm_sewer");
    }
    if has("DRAIN") {
        return Some("drainage");
    }
    if has("RECLAIM") || has("RCW") || has("PURPLE") {
        return Some("reclaimed");
    }
    if has("WATER") || has("WAT") || has("DWTR") {
        return Some("water");
    }
    if has("GAS") {
        return Some("gas");
    }
    if has("ELEC") || has("POWER") || has("PWR") {
        return Some("electric");
    }
    if has("COMM") || has("TEL") || has("FIBER") || has("CATV") || has("DATA") {
        return Some("comms");
    }
    None
}

/// Parse DXF text into import features (polylines → lines, block inserts →
/// points), grouped by layer.
pub fn parse_dxf(text: &str) -> Result<Vec<ImportFeature>, String> {
    let d = crate::dxf::parse(text)?;
    let mut out = Vec::new();
    for pl in d.polylines {
        out.push(ImportFeature {
            layer: pl.layer,
            kind: FeatureKind::Line,
            label: None,
            points: pl.points,
        });
    }
    for ins in d.inserts {
        out.push(ImportFeature {
            layer: ins.layer,
            kind: FeatureKind::Point,
            label: if ins.name.is_empty() {
                None
            } else {
                Some(ins.name)
            },
            points: vec![(ins.x, ins.y)],
        });
    }
    Ok(out)
}

/// Parse GeoJSON (FeatureCollection / Feature / bare geometry) into import
/// features. LineString → line, Point → point; MultiLineString/MultiPoint fan
/// out. The grouping layer comes from `layer_prop` (a property name) when set,
/// else a `properties.layer`/`type`, else "geojson". Coordinates are the raw
/// GeoJSON order [x, y] = [lon, lat] for WGS84 sources.
pub fn parse_geojson(text: &str, layer_prop: Option<&str>) -> Result<Vec<ImportFeature>, String> {
    let root: Value = serde_json::from_str(text).map_err(|e| format!("invalid GeoJSON: {e}"))?;
    let features: Vec<Value> = match root.get("type").and_then(Value::as_str) {
        Some("FeatureCollection") => root
            .get("features")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        Some("Feature") => vec![root],
        Some(_) => vec![serde_json::json!({ "type": "Feature", "geometry": root })],
        None => return Err("not a GeoJSON object".into()),
    };

    let mut out = Vec::new();
    for f in &features {
        let props = f.get("properties");
        let layer = props
            .and_then(|p| {
                layer_prop
                    .and_then(|k| p.get(k))
                    .or_else(|| p.get("layer"))
                    .or_else(|| p.get("type"))
            })
            .and_then(Value::as_str)
            .unwrap_or("geojson")
            .to_string();
        let label = props
            .and_then(|p| {
                p.get("label")
                    .or_else(|| p.get("name"))
                    .or_else(|| p.get("id"))
            })
            .and_then(Value::as_str)
            .map(str::to_string);
        let Some(geom) = f.get("geometry") else {
            continue;
        };
        let gtype = geom.get("type").and_then(Value::as_str).unwrap_or("");
        let coords = geom.get("coordinates");
        match gtype {
            "Point" => {
                if let Some(p) = coords.and_then(point) {
                    out.push(ImportFeature {
                        layer,
                        kind: FeatureKind::Point,
                        label,
                        points: vec![p],
                    });
                }
            }
            "MultiPoint" => {
                for c in coords.and_then(Value::as_array).into_iter().flatten() {
                    if let Some(p) = point(c) {
                        out.push(ImportFeature {
                            layer: layer.clone(),
                            kind: FeatureKind::Point,
                            label: label.clone(),
                            points: vec![p],
                        });
                    }
                }
            }
            "LineString" => {
                let pts = line(coords);
                if pts.len() >= 2 {
                    out.push(ImportFeature {
                        layer,
                        kind: FeatureKind::Line,
                        label,
                        points: pts,
                    });
                }
            }
            "MultiLineString" => {
                for c in coords.and_then(Value::as_array).into_iter().flatten() {
                    let pts = line(Some(c));
                    if pts.len() >= 2 {
                        out.push(ImportFeature {
                            layer: layer.clone(),
                            kind: FeatureKind::Line,
                            label: label.clone(),
                            points: pts,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

fn point(v: &Value) -> Option<(f64, f64)> {
    let a = v.as_array()?;
    Some((a.first()?.as_f64()?, a.get(1)?.as_f64()?))
}

fn line(v: Option<&Value>) -> Vec<(f64, f64)> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(point).collect())
        .unwrap_or_default()
}

/// Summarize features into per-layer groups with a suggested APWA type.
pub fn summarize(features: &[ImportFeature]) -> Vec<LayerSummary> {
    use std::collections::BTreeMap;
    // key = (layer, kind) so a layer with both lines + points splits sensibly.
    let mut groups: BTreeMap<(String, bool), usize> = BTreeMap::new();
    for f in features {
        let is_line = f.kind == FeatureKind::Line;
        *groups.entry((f.layer.clone(), is_line)).or_insert(0) += 1;
    }
    groups
        .into_iter()
        .map(|((layer, is_line), count)| LayerSummary {
            suggested_type: guess_type(&layer).map(str::to_string),
            kind: if is_line {
                FeatureKind::Line
            } else {
                FeatureKind::Point
            },
            layer,
            count,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guesses_apwa_types_from_layer_names() {
        assert_eq!(guess_type("V-SSWR-MAIN"), Some("sanitary_sewer"));
        assert_eq!(guess_type("STORM DRAIN"), Some("storm_sewer"));
        assert_eq!(guess_type("W-WATER"), Some("water"));
        assert_eq!(guess_type("GAS-MAIN"), Some("gas"));
        assert_eq!(guess_type("SSMH"), Some("manhole")); // structure wins
        assert_eq!(guess_type("CATCH-BASIN"), Some("catch_basin"));
        assert_eq!(guess_type("RANDOM-LAYER"), None);
    }

    #[test]
    fn parses_geojson_feature_collection() {
        let gj = r#"{
          "type":"FeatureCollection",
          "features":[
            {"type":"Feature","properties":{"layer":"WATER","name":"W1"},
             "geometry":{"type":"LineString","coordinates":[[-74.0,40.7],[-74.001,40.701]]}},
            {"type":"Feature","properties":{"layer":"MANHOLE"},
             "geometry":{"type":"Point","coordinates":[-74.0,40.7]}}
          ]
        }"#;
        let f = parse_geojson(gj, None).unwrap();
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].kind, FeatureKind::Line);
        assert_eq!(f[0].layer, "WATER");
        assert_eq!(f[0].label.as_deref(), Some("W1"));
        assert_eq!(f[0].points.len(), 2);
        assert_eq!(f[1].kind, FeatureKind::Point);
        assert_eq!(f[1].layer, "MANHOLE");
    }

    #[test]
    fn summarize_suggests_types_per_layer() {
        let f = parse_geojson(
            r#"{"type":"FeatureCollection","features":[
              {"type":"Feature","properties":{"layer":"SAN"},"geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}}
            ]}"#,
            None,
        )
        .unwrap();
        let s = summarize(&f);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].layer, "SAN");
        assert_eq!(s[0].suggested_type.as_deref(), Some("sanitary_sewer"));
        assert_eq!(s[0].count, 1);
    }

    #[test]
    fn parses_dxf_lines_into_features() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWATER\n10\n0\n20\n0\n11\n5\n21\n5\n0\nENDSEC\n0\nEOF\n";
        let f = parse_dxf(dxf).unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].layer, "WATER");
        assert_eq!(f[0].kind, FeatureKind::Line);
    }
}
