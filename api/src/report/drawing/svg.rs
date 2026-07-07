//! Low-level SVG string builders + 2D vector helpers shared by the renderer.

use super::model::{Hatch, Marker};
use crate::report::esc;

/// A 2D point/vector in sheet coordinates.
pub(super) type V2 = (f64, f64);
/// A set of grid lines as (position, label) pairs.
pub(super) type Lines = Vec<(f64, String)>;

pub(super) fn vsub(a: V2, b: V2) -> V2 {
    (a.0 - b.0, a.1 - b.1)
}
pub(super) fn vadd(a: V2, b: V2) -> V2 {
    (a.0 + b.0, a.1 + b.1)
}
pub(super) fn vscale(a: V2, k: f64) -> V2 {
    (a.0 * k, a.1 * k)
}
pub(super) fn vunit(a: V2) -> V2 {
    let l = (a.0 * a.0 + a.1 * a.1).sqrt().max(1e-9);
    (a.0 / l, a.1 / l)
}

pub(super) fn line(x1: f64, y1: f64, x2: f64, y2: f64, stroke: &str, w: f64, dash: bool) -> String {
    let da = if dash {
        " stroke-dasharray=\"5 3\""
    } else {
        ""
    };
    format!(
        "<line x1=\"{x1:.1}\" y1=\"{y1:.1}\" x2=\"{x2:.1}\" y2=\"{y2:.1}\" stroke=\"{stroke}\" stroke-width=\"{w:.2}\"{da}/>"
    )
}

pub(super) fn text(
    x: f64,
    y: f64,
    size: f64,
    anchor: &str,
    weight: u32,
    fill: &str,
    s: &str,
) -> String {
    format!(
        "<text x=\"{x:.1}\" y=\"{y:.1}\" font-size=\"{size:.1}\" text-anchor=\"{anchor}\" \
         font-weight=\"{weight}\" fill=\"{fill}\" font-family=\"Inter, Arial, sans-serif\">{}</text>",
        esc(s)
    )
}

/// Largest 1 / 2 / 5 × 10^k not exceeding `v`.
pub(super) fn nice(v: f64) -> f64 {
    if v <= 0.0 {
        return 1.0;
    }
    let base = 10f64.powf(v.log10().floor());
    for m in [5.0, 2.0, 1.0] {
        if base * m <= v {
            return base * m;
        }
    }
    base
}

/// The SVG `<pattern>` id for a hatch (None → no fill overlay).
pub(super) fn hatch_id(h: Hatch) -> Option<&'static str> {
    match h {
        Hatch::None => None,
        Hatch::Diagonal => Some("hatchDiag"),
        Hatch::Cross => Some("hatchCross"),
        Hatch::Dots => Some("hatchDots"),
        Hatch::Horizontal => Some("hatchHoriz"),
    }
}

/// `<defs>` block with every hatch pattern, drawn in `color`. Included once per
/// sheet; entities reference a pattern by [`hatch_id`].
pub(super) fn hatch_defs(color: &str) -> String {
    format!(
        "<defs>\
         <pattern id=\"hatchDiag\" width=\"6\" height=\"6\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\">\
         <line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"{color}\" stroke-width=\"0.7\"/></pattern>\
         <pattern id=\"hatchCross\" width=\"6\" height=\"6\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\">\
         <line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"{color}\" stroke-width=\"0.7\"/>\
         <line x1=\"0\" y1=\"0\" x2=\"6\" y2=\"0\" stroke=\"{color}\" stroke-width=\"0.7\"/></pattern>\
         <pattern id=\"hatchDots\" width=\"2.6\" height=\"2.6\" patternUnits=\"userSpaceOnUse\">\
         <circle cx=\"1.3\" cy=\"1.3\" r=\"0.45\" fill=\"{color}\"/></pattern>\
         <pattern id=\"hatchHoriz\" width=\"5\" height=\"5\" patternUnits=\"userSpaceOnUse\">\
         <line x1=\"0\" y1=\"2.5\" x2=\"5\" y2=\"2.5\" stroke=\"{color}\" stroke-width=\"0.7\"/></pattern>\
         </defs>"
    )
}

/// A generic marker glyph centered at (cx, cy).
pub(super) fn marker(m: Marker, cx: f64, cy: f64, r: f64, fill: &str, ink: &str) -> String {
    let sw = 1.0;
    match m {
        Marker::Circle => format!(
            "<circle cx=\"{cx:.1}\" cy=\"{cy:.1}\" r=\"{r:.1}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{sw}\"/>"
        ),
        Marker::Square => format!(
            "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{sw}\"/>",
            cx - r,
            cy - r,
            r * 2.0,
            r * 2.0
        ),
        Marker::Diamond => format!(
            "<polygon points=\"{cx:.1},{:.1} {:.1},{cy:.1} {cx:.1},{:.1} {:.1},{cy:.1}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{sw}\"/>",
            cy - r,
            cx + r,
            cy + r,
            cx - r
        ),
        Marker::Triangle => format!(
            "<polygon points=\"{cx:.1},{:.1} {:.1},{:.1} {:.1},{:.1}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{sw}\"/>",
            cy - r,
            cx + r,
            cy + r,
            cx - r,
            cy + r
        ),
        Marker::Bowtie => format!(
            "<polygon points=\"{:.1},{:.1} {:.1},{:.1} {:.1},{:.1} {:.1},{:.1}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{sw}\"/>",
            cx - r,
            cy - r,
            cx + r,
            cy + r,
            cx + r,
            cy - r,
            cx - r,
            cy + r
        ),
        Marker::Plus => format!(
            "{}{}",
            line(cx - r, cy, cx + r, cy, ink, 1.6, false),
            line(cx, cy - r, cx, cy + r, ink, 1.6, false)
        ),
        Marker::None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nice_picks_1_2_5_decades() {
        assert_eq!(nice(3.0), 2.0);
        assert_eq!(nice(7.0), 5.0);
        assert_eq!(nice(23.0), 20.0);
        assert_eq!(nice(120.0), 100.0);
        assert_eq!(nice(0.0), 1.0); // guard
    }

    #[test]
    fn text_is_xml_escaped() {
        let t = text(0.0, 0.0, 9.0, "start", 400, "#000", "A & <B>");
        assert!(t.contains("A &amp; &lt;B&gt;"));
    }

    #[test]
    fn line_dash_toggles_dasharray() {
        assert!(line(0.0, 0.0, 1.0, 1.0, "#000", 1.0, true).contains("stroke-dasharray"));
        assert!(!line(0.0, 0.0, 1.0, 1.0, "#000", 1.0, false).contains("stroke-dasharray"));
    }

    #[test]
    fn markers_render_expected_shapes() {
        assert!(marker(Marker::Circle, 0.0, 0.0, 5.0, "#f00", "#000").contains("<circle"));
        assert!(marker(Marker::Square, 0.0, 0.0, 5.0, "#f00", "#000").contains("<rect"));
        assert!(marker(Marker::Diamond, 0.0, 0.0, 5.0, "#f00", "#000").contains("<polygon"));
        assert!(marker(Marker::None, 0.0, 0.0, 5.0, "#f00", "#000").is_empty());
    }

    #[test]
    fn hatch_ids_and_defs() {
        assert_eq!(hatch_id(Hatch::None), None);
        assert_eq!(hatch_id(Hatch::Diagonal), Some("hatchDiag"));
        assert_eq!(hatch_id(Hatch::Cross), Some("hatchCross"));
        let defs = hatch_defs("#6b7280");
        for id in ["hatchDiag", "hatchCross", "hatchDots", "hatchHoriz"] {
            assert!(defs.contains(id), "defs missing {id}");
        }
    }

    #[test]
    fn vector_helpers() {
        assert_eq!(vadd((1.0, 2.0), (3.0, 4.0)), (4.0, 6.0));
        assert_eq!(vsub((3.0, 4.0), (1.0, 1.0)), (2.0, 3.0));
        assert_eq!(vscale((2.0, 3.0), 2.0), (4.0, 6.0));
        let u = vunit((3.0, 4.0));
        assert!((u.0 - 0.6).abs() < 1e-9 && (u.1 - 0.8).abs() < 1e-9);
    }
}
