//! Server-side DXF codec (foundation "shared codecs"). Parses DXF text into
//! simple layer-grouped 2D polylines — mirroring the former web `lib/dxf.ts` so
//! the 3D CAD overlay renders identically — plus block INSERT points used by
//! utility import. Unsupported entities are ignored; malformed input errors.

use std::collections::BTreeSet;
use std::io::Cursor;

// Leading `::` — the extern crate, not this same-named module.
use ::dxf::entities::EntityType;
use ::dxf::Drawing;

/// A 2D polyline on a layer (points in DXF drawing units).
#[derive(Debug, Clone, PartialEq)]
pub struct DxfPolyline {
    pub layer: String,
    pub points: Vec<(f64, f64)>,
}

/// A block reference (INSERT) — a point feature (e.g. a structure symbol).
#[derive(Debug, Clone, PartialEq)]
pub struct DxfInsert {
    pub layer: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
}

/// Parsed drawing: sorted layer names, layer-grouped polylines, block inserts.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedDxf {
    pub layers: Vec<String>,
    pub polylines: Vec<DxfPolyline>,
    pub inserts: Vec<DxfInsert>,
}

const ARC_SEGMENTS: usize = 48;

/// Tessellate an arc (angles in degrees, CCW) into a polyline.
fn tessellate_arc(cx: f64, cy: f64, r: f64, start_deg: f64, end_deg: f64) -> Vec<(f64, f64)> {
    let start = start_deg.to_radians();
    let mut end = end_deg.to_radians();
    if end < start {
        end += std::f64::consts::TAU;
    }
    (0..=ARC_SEGMENTS)
        .map(|i| {
            let t = start + (end - start) * (i as f64) / (ARC_SEGMENTS as f64);
            (cx + r * t.cos(), cy + r * t.sin())
        })
        .collect()
}

/// Parse DXF text into layer-grouped polylines + block inserts.
pub fn parse(text: &str) -> Result<ParsedDxf, String> {
    let drawing = Drawing::load(&mut Cursor::new(text.as_bytes()))
        .map_err(|e| format!("invalid DXF: {e}"))?;

    let mut polylines: Vec<DxfPolyline> = Vec::new();
    let mut inserts: Vec<DxfInsert> = Vec::new();
    let mut layers: BTreeSet<String> = BTreeSet::new();

    for e in drawing.entities() {
        let layer = if e.common.layer.is_empty() {
            "0".to_string()
        } else {
            e.common.layer.clone()
        };
        let mut add = |points: Vec<(f64, f64)>| {
            if points.len() >= 2 {
                layers.insert(layer.clone());
                polylines.push(DxfPolyline {
                    layer: layer.clone(),
                    points,
                });
            }
        };
        match &e.specific {
            EntityType::Line(l) => add(vec![(l.p1.x, l.p1.y), (l.p2.x, l.p2.y)]),
            EntityType::LwPolyline(pl) => {
                let mut pts: Vec<(f64, f64)> = pl.vertices.iter().map(|v| (v.x, v.y)).collect();
                if pl.get_is_closed() {
                    if let Some(&first) = pts.first() {
                        pts.push(first);
                    }
                }
                add(pts);
            }
            EntityType::Polyline(pl) => {
                let mut pts: Vec<(f64, f64)> = pl
                    .vertices()
                    .map(|v| (v.location.x, v.location.y))
                    .collect();
                if pl.get_is_closed() {
                    if let Some(&first) = pts.first() {
                        pts.push(first);
                    }
                }
                add(pts);
            }
            EntityType::Arc(a) => {
                add(tessellate_arc(
                    a.center.x,
                    a.center.y,
                    a.radius,
                    a.start_angle,
                    a.end_angle,
                ));
            }
            EntityType::Circle(c) => {
                add(tessellate_arc(c.center.x, c.center.y, c.radius, 0.0, 360.0));
            }
            EntityType::Insert(ins) => {
                layers.insert(layer.clone());
                inserts.push(DxfInsert {
                    layer: layer.clone(),
                    name: ins.name.clone(),
                    x: ins.location.x,
                    y: ins.location.y,
                });
            }
            _ => {}
        }
    }

    Ok(ParsedDxf {
        layers: layers.into_iter().collect(),
        polylines,
        inserts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wrap DXF entity source in the minimal ENTITIES section envelope.
    fn entities(body: &str) -> String {
        format!("0\nSECTION\n2\nENTITIES\n{body}0\nENDSEC\n0\nEOF\n")
    }

    const LINE: &str = "0\nLINE\n8\nWATER\n10\n0.0\n20\n0.0\n11\n10.0\n21\n5.0\n";
    const LWPOLYLINE: &str =
        "0\nLWPOLYLINE\n8\nSANITARY\n90\n3\n70\n0\n10\n0.0\n20\n0.0\n10\n1.0\n20\n1.0\n10\n2.0\n20\n0.0\n";
    const POINT: &str = "0\nPOINT\n8\n0\n10\n1.0\n20\n1.0\n";

    #[test]
    fn parses_a_line_into_a_two_point_polyline() {
        let p = parse(&entities(LINE)).unwrap();
        assert_eq!(p.layers, vec!["WATER".to_string()]);
        assert_eq!(p.polylines.len(), 1);
        assert_eq!(p.polylines[0].points, vec![(0.0, 0.0), (10.0, 5.0)]);
    }

    #[test]
    fn parses_an_lwpolyline() {
        let p = parse(&entities(LWPOLYLINE)).unwrap();
        assert_eq!(p.polylines.len(), 1);
        assert_eq!(p.polylines[0].layer, "SANITARY");
        assert_eq!(p.polylines[0].points.len(), 3);
    }

    #[test]
    fn collects_sorted_unique_layers() {
        let p = parse(&entities(&format!("{LINE}{LWPOLYLINE}"))).unwrap();
        assert_eq!(p.layers, vec!["SANITARY".to_string(), "WATER".to_string()]);
    }

    #[test]
    fn ignores_sub_two_point_geometry() {
        let p = parse(&entities(POINT)).unwrap();
        assert!(p.polylines.is_empty());
    }

    #[test]
    fn empty_drawing_yields_nothing() {
        let p = parse(&entities("")).unwrap();
        assert!(p.layers.is_empty());
        assert!(p.polylines.is_empty());
    }
}
