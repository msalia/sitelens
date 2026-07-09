//! Surface + volume deliverables: LandXML / DXF surfaces (with contour overlay)
//! and volume report CSV + HTML (rendered to PDF by the shared WeasyPrint
//! service). GeoTIFF DEM export lives in [`super::geotiff`].
//!
//! All geometry is **projected meters** `[e, n, z]` (the resolver converts the
//! stored geographic mesh back to the project's projected frame first), so the
//! deliverables land in the surveyor's coordinate system in CAD / Civil 3D.

use super::contour::ContourLevel;

/// XML-escapes text for an attribute / element body.
fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// LandXML 1.2 TIN surface: `Pnts` (1-based ids) + `Faces` (triangles). Point
/// order is LandXML's `northing easting elevation`.
pub fn surface_landxml(name: &str, verts: &[[f64; 3]], tris: &[[u32; 3]]) -> String {
    let mut pnts = String::new();
    for (i, v) in verts.iter().enumerate() {
        pnts.push_str(&format!(
            "        <P id=\"{}\">{:.6} {:.6} {:.6}</P>\n",
            i + 1,
            v[1],
            v[0],
            v[2]
        ));
    }
    let mut faces = String::new();
    for t in tris {
        faces.push_str(&format!(
            "        <F>{} {} {}</F>\n",
            t[0] + 1,
            t[1] + 1,
            t[2] + 1
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <LandXML xmlns=\"http://www.landxml.org/schema/LandXML-1.2\" version=\"1.2\">\n\
         \x20 <Units><Metric linearUnit=\"meter\"/></Units>\n\
         \x20 <Surfaces>\n\
         \x20   <Surface name=\"{}\">\n\
         \x20     <Definition surfType=\"TIN\">\n\
         \x20       <Pnts>\n{}      </Pnts>\n\
         \x20       <Faces>\n{}      </Faces>\n\
         \x20     </Definition>\n\
         \x20   </Surface>\n\
         \x20 </Surfaces>\n\
         </LandXML>\n",
        xml_esc(name),
        pnts,
        faces
    )
}

/// DXF with the TIN as `3DFACE` entities on layer `SURFACE`, plus optional
/// contour polylines on `CONTOUR_MINOR` / `CONTOUR_MAJOR`. Contour points are
/// projected `[e, n]` at their level elevation.
pub fn surface_dxf(
    verts: &[[f64; 3]],
    tris: &[[u32; 3]],
    contours: &[ContourLevel],
) -> Result<String, String> {
    use dxf::entities::{Entity, EntityType, Face3D, Polyline, Vertex};
    use dxf::{Drawing, Point};

    let mut d = Drawing::new();
    let pt = |v: [f64; 3]| Point::new(v[0], v[1], v[2]);
    for t in tris {
        let (a, b, c) = (
            verts[t[0] as usize],
            verts[t[1] as usize],
            verts[t[2] as usize],
        );
        // Triangle → 3DFACE with the fourth corner duplicating the third.
        let face = Face3D::new(pt(a), pt(b), pt(c), pt(c));
        let mut e = Entity::new(EntityType::Face3D(face));
        e.common.layer = "SURFACE".to_string();
        d.add_entity(e);
    }
    for lv in contours {
        let layer = if lv.is_major {
            "CONTOUR_MAJOR"
        } else {
            "CONTOUR_MINOR"
        };
        for pl in &lv.polylines {
            let mut poly = Polyline::default();
            for p in pl {
                poly.add_vertex(&mut d, Vertex::new(Point::new(p[0], p[1], lv.level)));
            }
            let mut e = Entity::new(EntityType::Polyline(poly));
            e.common.layer = layer.to_string();
            d.add_entity(e);
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    d.save(&mut buf).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

/// Parameters a volume report prints (already in report units).
pub struct VolumeReport<'a> {
    pub name: &'a str,
    pub comparison: &'a str,
    pub base_surface: &'a str,
    pub base_version: i32,
    pub compare: Option<(&'a str, i32)>,
    pub reference_elev: Option<f64>,
    pub cell_size: f64,
    pub cut: f64,
    pub fill: f64,
    pub net: f64,
    pub area: f64,
    /// Volume unit label, e.g. "yd³" (the caller converts the m³ values).
    pub vol_unit: &'a str,
    /// Area unit label, e.g. "ft²".
    pub area_unit: &'a str,
}

/// The volume result as a two-column CSV (field,value) — the machine-readable
/// twin of the PDF, carrying the reproducibility metadata (versions, params).
pub fn volume_csv(r: &VolumeReport) -> String {
    let mut s = String::from("field,value\n");
    let mut row = |k: &str, v: String| s.push_str(&format!("{k},{v}\n"));
    row("name", r.name.to_string());
    row("comparison", r.comparison.to_string());
    row(
        "base_surface",
        format!("{} (v{})", r.base_surface, r.base_version),
    );
    if let Some((n, v)) = r.compare {
        row("compare_surface", format!("{n} (v{v})"));
    }
    if let Some(e) = r.reference_elev {
        row("reference_elevation_m", format!("{e:.3}"));
    }
    row("method", "grid".to_string());
    row("cell_size_m", format!("{:.3}", r.cell_size));
    row("cut", format!("{:.2} {}", r.cut, r.vol_unit));
    row("fill", format!("{:.2} {}", r.fill, r.vol_unit));
    row("net", format!("{:.2} {}", r.net, r.vol_unit));
    row("area", format!("{:.2} {}", r.area, r.area_unit));
    s
}

/// The volume report as standalone HTML for the WeasyPrint service.
pub fn volume_html(r: &VolumeReport, org_name: &str) -> String {
    let compare_row = match (r.compare, r.reference_elev) {
        (Some((n, v)), _) => format!(
            "<tr><th>Compare surface</th><td>{} (v{v})</td></tr>",
            xml_esc(n)
        ),
        (None, Some(e)) => format!("<tr><th>Reference elevation</th><td>{e:.3} m</td></tr>"),
        _ => String::new(),
    };
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>\
         body{{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:32px}}\
         h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#666;font-size:12px;margin-bottom:20px}}\
         table{{border-collapse:collapse;width:100%;font-size:13px}}\
         th,td{{text-align:left;padding:6px 10px;border-bottom:1px solid #e5e5e5}}\
         th{{width:40%;color:#444;font-weight:600}}\
         .totals td{{font-size:15px;font-weight:700}}\
         .foot{{color:#888;font-size:11px;margin-top:24px}}</style></head><body>\
         <h1>{name}</h1><div class=\"sub\">Earthwork volume — {org}</div>\
         <table>\
         <tr><th>Comparison</th><td>{comparison}</td></tr>\
         <tr><th>Base surface</th><td>{base} (v{basev})</td></tr>\
         {compare_row}\
         <tr><th>Method</th><td>Grid, {cell:.2} m cells</td></tr>\
         <tr class=\"totals\"><th>Cut</th><td>{cut:.2} {vu}</td></tr>\
         <tr class=\"totals\"><th>Fill</th><td>{fill:.2} {vu}</td></tr>\
         <tr class=\"totals\"><th>Net</th><td>{net:.2} {vu}</td></tr>\
         <tr><th>Area</th><td>{area:.2} {au}</td></tr>\
         </table>\
         <div class=\"foot\">Results snapshot the surface versions + parameters above and \
         do not change if a surface is later rebuilt.</div>\
         </body></html>",
        name = xml_esc(r.name),
        org = xml_esc(org_name),
        comparison = r.comparison,
        base = xml_esc(r.base_surface),
        basev = r.base_version,
        compare_row = compare_row,
        cell = r.cell_size,
        cut = r.cut,
        fill = r.fill,
        net = r.net,
        area = r.area,
        vu = r.vol_unit,
        au = r.area_unit,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tri_mesh() -> (Vec<[f64; 3]>, Vec<[u32; 3]>) {
        (
            vec![
                [0.0, 0.0, 10.0],
                [10.0, 0.0, 11.0],
                [10.0, 10.0, 12.0],
                [0.0, 10.0, 11.5],
            ],
            vec![[0, 1, 2], [0, 2, 3]],
        )
    }

    #[test]
    fn landxml_is_well_formed_with_points_and_faces() {
        let (v, t) = tri_mesh();
        let x = surface_landxml("Existing & Grade", &v, &t);
        assert!(x.contains("<LandXML"));
        assert!(x.contains("surfType=\"TIN\""));
        assert_eq!(x.matches("<P id=").count(), 4);
        assert_eq!(x.matches("<F>").count(), 2);
        // Name is escaped, points are northing-easting-elevation.
        assert!(x.contains("Existing &amp; Grade"));
        assert!(x.contains("<P id=\"2\">0.000000 10.000000 11.000000</P>"));
    }

    #[test]
    fn dxf_has_faces_and_contour_layers() {
        let (v, t) = tri_mesh();
        let contours = vec![ContourLevel {
            level: 11.0,
            is_major: true,
            polylines: vec![vec![[1.0, 1.0], [9.0, 9.0]]],
        }];
        let dxf = surface_dxf(&v, &t, &contours).unwrap();
        assert!(dxf.contains("3DFACE"));
        assert!(dxf.contains("SURFACE"));
        assert!(dxf.contains("CONTOUR_MAJOR"));
    }

    #[test]
    fn volume_csv_carries_totals_and_reproducibility_metadata() {
        let r = VolumeReport {
            name: "Balance",
            comparison: "surface_to_elevation",
            base_surface: "Existing",
            base_version: 2,
            compare: None,
            reference_elev: Some(11.5),
            cell_size: 2.0,
            cut: 858.0,
            fill: 1582.0,
            net: 724.0,
            area: 1348.0,
            vol_unit: "m³",
            area_unit: "m²",
        };
        let csv = volume_csv(&r);
        assert!(csv.starts_with("field,value\n"));
        assert!(csv.contains("base_surface,Existing (v2)"));
        assert!(csv.contains("reference_elevation_m,11.500"));
        assert!(csv.contains("cell_size_m,2.000"));
        assert!(csv.contains("net,724.00 m³"));
        let html = volume_html(&r, "Helix Surveying");
        assert!(html.contains("Balance") && html.contains("Helix Surveying"));
    }
}
