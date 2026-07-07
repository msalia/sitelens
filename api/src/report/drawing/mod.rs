//! Reusable, domain-agnostic **plan-view drawing sheet** for PDF exports.
//!
//! A caller builds a [`Sheet`] — a [`Theme`], a [`Placement`], a left [`InfoPanel`],
//! a [`CenterColumn`], a [`Grid`] config, and generic [`Entity`] geometry — and
//! [`Sheet::to_svg`] returns a self-contained SVG styled like a modern
//! architectural title sheet: a warm beige block (no border, sharp corners), a
//! single indigo accent for the whole grid/dimension/label system, and content
//! colored by importance over an otherwise grayscale base.
//!
//! The renderer knows only generic primitives (polylines, points with a generic
//! [`Marker`], polygons) — never "manhole" or "contour". Each feature maps its own
//! data onto the model, so utilities (today) and surface/volume/field reports
//! (later) share one renderer. See
//! `docs/features/_shared-foundation/plan-view-drawing.md`.
//!
//! Module layout:
//! - [`model`] — the public data types a caller fills in.
//! - `svg` — low-level SVG builders + 2D vector helpers.
//! - `fit` — world→sheet transform, bbox, and 90° auto-orientation.
//! - `panels` — the left info panel + north/measurements block.
//! - `grid` — gridlines, bubbles, and dimension chains.
//! - `geometry` — entity rendering (runs/casing, polygons, markers) + plan.

mod fit;
mod geometry;
mod grid;
mod model;
mod panels;
mod svg;

pub use model::*;

impl Sheet {
    /// Renders the whole sheet to a self-contained SVG string.
    pub fn to_svg(&self) -> String {
        let (vw, vh) = self.viewbox();
        let th = &self.theme;
        let mut s = format!(
            "<svg viewBox=\"0 0 {vw:.0} {vh:.0}\" preserveAspectRatio=\"xMidYMid meet\" width=\"100%\" height=\"100%\" xmlns=\"http://www.w3.org/2000/svg\">"
        );
        // Beige ground (no border, sharp corners) + the reusable hatch patterns.
        s.push_str(&svg::hatch_defs(&th.mute));
        s.push_str(&format!(
            "<rect x=\"0\" y=\"0\" width=\"{vw:.0}\" height=\"{vh:.0}\" fill=\"{}\"/>",
            th.bg
        ));

        // Column 1 stacks two rows — info/metadata (top) then north + measurements
        // (bottom); the plan fills the remaining right two columns × both rows.
        let pad = 0.03 * vw;
        let vpad = 0.05 * vh;
        let col1_x0 = pad;
        let col1_x1 = 0.30 * vw;
        let mid_y = vpad + 0.60 * (vh - 2.0 * vpad);
        s.push_str(&self.info_panel(col1_x0, vpad, col1_x1, mid_y));
        s.push_str(&self.center_column(col1_x0, col1_x1, mid_y, vh - vpad));
        s.push_str(&self.plan(0.33 * vw, vw - pad, vpad, vh - vpad));

        s.push_str("</svg>");
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Sheet {
        Sheet {
            theme: Theme::default(),
            placement: Placement::Band { height_mm: 112.0 },
            info: InfoPanel {
                caption: "As-built utility network".into(),
                title: "Utility Plan".into(),
                subtitle: "BAPS Mandir".into(),
                legend: vec![
                    LegendItem {
                        swatch: Swatch::Color("#2563eb".into()),
                        label: "Water".into(),
                        note: Some("2".into()),
                    },
                    LegendItem {
                        swatch: Swatch::Symbol(Marker::Circle, "#16a34a".into()),
                        label: "Manhole".into(),
                        note: None,
                    },
                ],
                meta: vec![
                    ("Drawing No.".into(), "UTIL-01".into()),
                    ("Scale".into(), "N.T.S".into()),
                ],
                notes: vec!["Gray = context. Dashed = record.".into()],
            },
            center: CenterColumn {
                north: true,
                scale_bar: true,
                stat: Some(Stat {
                    big: "198 ft".into(),
                    sub: "60.4 m".into(),
                    note: "2 runs · 1 structure".into(),
                }),
            },
            grid: Grid {
                bubbles: true,
                dims: true,
                unit: DimUnit::Feet,
                axes: None,
            },
            entities: vec![
                Entity {
                    geom: Geom::Polyline(vec![(0.0, 0.0), (30.0, 5.0), (60.0, 4.0)]),
                    style: Style {
                        casing_m: Some(0.3),
                        label: Some("W-1 · 12\" PVC".into()),
                        ..Style::line("#2563eb", 3.0)
                    },
                },
                Entity {
                    geom: Geom::Point(60.0, 4.0),
                    style: Style {
                        marker: Marker::Circle,
                        label: Some("MH-1".into()),
                        ..Style::line("#16a34a", 1.0)
                    },
                },
                Entity {
                    geom: Geom::Polyline(vec![(0.0, 40.0), (60.0, 42.0)]),
                    style: Style {
                        dashed: true,
                        emphasis: false,
                        ..Style::line("#dc2626", 2.0)
                    },
                },
            ],
            callouts: vec![Callout {
                target: (30.0, 5.0),
                lines: vec!["TIE-IN".into()],
                color: "#6366f1".into(),
                faint: false,
                place: Place::Leader {
                    vertical: false,
                    justify: Justify::Right,
                },
            }],
            tags: vec![Tag {
                at: (10.0, 40.0),
                code: "A1".into(),
            }],
        }
    }

    #[test]
    fn renders_beige_sheet_with_panels_grid_and_geometry() {
        let svg = sample().to_svg();
        assert!(svg.starts_with("<svg"));
        assert!(svg.ends_with("</svg>"));
        assert!(svg.contains("#fff8e7")); // beige bg (Cosmic Latte)
        assert!(svg.contains("Utility Plan"));
        assert!(svg.contains("LEGEND"));
        assert!(svg.contains("UTIL-01"));
        assert!(svg.contains(">N<")); // north
        assert!(svg.contains("198 ft")); // stat
        assert!(svg.contains("#2563eb")); // emphasized water color
        assert!(svg.contains("#6366f1")); // indigo annotation
    }

    #[test]
    fn context_is_gray_emphasized_is_color() {
        let svg = sample().to_svg();
        assert!(svg.contains("#b4b8c0")); // gray context run
        assert!(svg.contains("stroke-dasharray")); // dashed context (record)
        assert!(svg.contains("W-1")); // emphasized label
    }

    #[test]
    fn empty_geometry_is_handled() {
        let mut sh = sample();
        sh.entities.clear();
        assert!(sh.to_svg().contains("No geospatial data"));
    }
}
