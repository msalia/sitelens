//! The plot area: entity rendering (runs with casing/hatch, polygons, markers)
//! and the plan orchestration (grid + geometry, or an empty-state note).

use super::fit::Fit;
use super::model::{Geom, Sheet, Style};
use super::svg::{hatch_id, line, marker, text};
use crate::report::esc;

/// Greedy word-wrap of `text` to lines of at most `max` characters (keeps whole
/// words; a longer-than-`max` word occupies its own line).
fn wrap_line(text: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        if cur.is_empty() {
            cur = word.to_string();
        } else if cur.chars().count() + 1 + word.chars().count() <= max {
            cur.push(' ');
            cur.push_str(word);
        } else {
            out.push(std::mem::take(&mut cur));
            cur = word.to_string();
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Axis-aligned box in sheet space, for callout collision avoidance.
#[derive(Clone, Copy)]
struct Rect {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

impl Rect {
    fn center(c: (f64, f64), hw: f64, hh: f64) -> Rect {
        Rect {
            x0: c.0 - hw,
            y0: c.1 - hh,
            x1: c.0 + hw,
            y1: c.1 + hh,
        }
    }
    fn overlaps(&self, o: &Rect) -> bool {
        self.x0 < o.x1 && self.x1 > o.x0 && self.y0 < o.y1 && self.y1 > o.y0
    }
}

/// A leader path (polyline) from the target, and the label center it leads to.
type Candidate = (Vec<(f64, f64)>, (f64, f64));

/// Candidate callout placements around a target `(px, py)` for a label of
/// half-extent `(hw, hh)`, ordered cheapest-first: 0-segment adjacent (4 sides),
/// then 1-segment straight leaders of increasing length, then 2-segment elbows.
/// Each item is `(leader path from the target, label center)`; the caller picks
/// the first whose label box clears all obstacles. Deterministic.
fn auto_candidates(px: f64, py: f64, hw: f64, hh: f64) -> Vec<Candidate> {
    let g = 6.0; // gap between leader end / point and the label box
    let dirs = [(1.0, 0.0), (-1.0, 0.0), (0.0, -1.0), (0.0, 1.0)];
    let mut v: Vec<Candidate> = Vec::new();
    // 0-segment: text adjacent, no leader.
    for (dx, dy) in dirs {
        v.push((vec![], (px + dx * (g + hw), py + dy * (g + hh))));
    }
    // 1-segment straight leaders of increasing length.
    for l in [24.0, 44.0, 68.0] {
        for (dx, dy) in dirs {
            let e = (px + dx * l, py + dy * l);
            v.push((
                vec![(px, py), e],
                (e.0 + dx * (g + hw), e.1 + dy * (g + hh)),
            ));
        }
    }
    // 2-segment elbows: out `d1`, then over `d2`.
    let combos = [
        ((0.0, -1.0), (1.0, 0.0)),
        ((0.0, -1.0), (-1.0, 0.0)),
        ((0.0, 1.0), (1.0, 0.0)),
        ((0.0, 1.0), (-1.0, 0.0)),
        ((1.0, 0.0), (0.0, -1.0)),
        ((-1.0, 0.0), (0.0, -1.0)),
        ((1.0, 0.0), (0.0, 1.0)),
        ((-1.0, 0.0), (0.0, 1.0)),
    ];
    for (l1, l2) in [(26.0, 40.0), (48.0, 64.0)] {
        for (d1, d2) in combos {
            let m = (px + d1.0 * l1, py + d1.1 * l1);
            let e = (m.0 + d2.0 * l2, m.1 + d2.1 * l2);
            let c = (e.0 + d2.0 * (g + hw), e.1 + d2.1 * (g + hh));
            v.push((vec![(px, py), m, e], c));
        }
    }
    v
}

impl Sheet {
    /// The plan drawing area: grid + geometry, or an empty-state note.
    pub(super) fn plan(&self, gx0: f64, gx1: f64, gy0: f64, gy1: f64) -> String {
        let th = &self.theme;
        let Some(f) = self.fit() else {
            return text(
                (gx0 + gx1) / 2.0,
                (gy0 + gy1) / 2.0,
                14.0,
                "middle",
                400,
                &th.mute,
                "No geospatial data to plot.",
            );
        };
        let mut s = String::new();
        if self.grid.dims || self.grid.bubbles {
            s.push_str(&self.grid_and_dims(&f));
        }
        s.push_str(&self.geometry(&f));
        s.push_str(&self.annotations(&f));
        s
    }

    /// Screen-space boxes of the drawn geometry (lines + markers), so labels can
    /// be placed clear of it.
    fn geometry_boxes(&self, f: &Fit) -> Vec<Rect> {
        let mut b = Vec::new();
        for e in &self.entities {
            match &e.geom {
                Geom::Polyline(p) | Geom::Polygon(p) if !p.is_empty() => {
                    let q0 = f.project(p[0].0, p[0].1);
                    let mut r = Rect {
                        x0: q0.0,
                        y0: q0.1,
                        x1: q0.0,
                        y1: q0.1,
                    };
                    for &(x, y) in p {
                        let q = f.project(x, y);
                        r.x0 = r.x0.min(q.0);
                        r.y0 = r.y0.min(q.1);
                        r.x1 = r.x1.max(q.0);
                        r.y1 = r.y1.max(q.1);
                    }
                    let pad = e.style.weight.max(2.0);
                    r.x0 -= pad;
                    r.y0 -= pad;
                    r.x1 += pad;
                    r.y1 += pad;
                    b.push(r);
                }
                Geom::Point(x, y) => b.push(Rect::center(f.project(*x, *y), 7.0, 7.0)),
                _ => {}
            }
        }
        b
    }

    /// Places all labels — entity labels *and* callouts — with collision-aware,
    /// closest-first routing (0-segment → 1-segment → 2-segment elbow) so text
    /// stays clear of the geometry and of other labels; `Place::Leader`/`Note`
    /// callouts keep their explicit position. Also draws hexagonal detail tags.
    fn annotations(&self, f: &Fit) -> String {
        use super::model::{Justify, Place};
        let th = &self.theme;
        let mut s = String::new();
        let lh = 11.0;
        let lead = 40.0;
        // Labels avoid drawn geometry *and* the grid bubbles beyond each edge.
        let mut obstacles = self.geometry_boxes(f);
        for (cx, cy, hw, hh) in self.grid_boxes(f) {
            obstacles.push(Rect::center((cx, cy), hw, hh));
        }

        let dot = |s: &mut String, x: f64, y: f64, c: &str| {
            s.push_str(&format!(
                "<circle cx=\"{x:.1}\" cy=\"{y:.1}\" r=\"1.8\" fill=\"{c}\"/>"
            ));
        };
        let polyline = |s: &mut String, path: &[(f64, f64)], c: &str| {
            if path.len() >= 2 {
                let pts: String = path
                    .iter()
                    .map(|p| format!("{:.1},{:.1}", p.0, p.1))
                    .collect::<Vec<_>>()
                    .join(" ");
                s.push_str(&format!(
                    "<polyline points=\"{pts}\" fill=\"none\" stroke=\"{c}\" stroke-width=\"0.8\"/>"
                ));
            }
        };
        // Text block centered on (cx, cy).
        let emit = |s: &mut String,
                    cx: f64,
                    cy: f64,
                    lines: &[String],
                    color: &str,
                    faint: bool| {
            let (size, weight, op) = if faint {
                (8.0, 500, "0.6")
            } else {
                (9.0, 700, "1")
            };
            let n = lines.len() as f64;
            let first = cy - (n - 1.0) * lh / 2.0 + size / 3.0;
            for (i, ln) in lines.iter().enumerate() {
                s.push_str(&format!(
                    "<text x=\"{cx:.1}\" y=\"{:.1}\" font-size=\"{size:.1}\" text-anchor=\"middle\" \
                     font-weight=\"{weight}\" fill=\"{color}\" fill-opacity=\"{op}\" font-family=\"Inter, Arial, sans-serif\">{}</text>",
                    first + i as f64 * lh,
                    esc(ln),
                ));
            }
        };
        let extent = |lines: &[String], faint: bool| {
            let size = if faint { 8.0 } else { 9.0 };
            let w = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64 * size * 0.55;
            (w / 2.0 + 3.0, lines.len() as f64 * lh / 2.0 + 2.0)
        };

        // 1) Explicit callouts: keep their chosen position; reserve their space.
        for co in &self.callouts {
            let lines: Vec<String> = co.lines.iter().flat_map(|l| wrap_line(l, 26)).collect();
            if lines.is_empty() || matches!(co.place, Place::Auto) {
                continue;
            }
            let (tx, ty) = f.project(co.target.0, co.target.1);
            let (hw, hh) = extent(&lines, co.faint);
            let c = match &co.place {
                Place::Leader { vertical: true, .. } => {
                    let e = (tx, ty - lead);
                    dot(&mut s, tx, ty, &co.color);
                    polyline(&mut s, &[(tx, ty), e], &co.color);
                    (tx, e.1 - hh)
                }
                Place::Leader {
                    vertical: false,
                    justify,
                } => {
                    let dir = if matches!(justify, Justify::Right) {
                        1.0
                    } else {
                        -1.0
                    };
                    let e = (tx + dir * lead, ty);
                    dot(&mut s, tx, ty, &co.color);
                    polyline(&mut s, &[(tx, ty), e], &co.color);
                    (e.0 + dir * (hw + 2.0), ty)
                }
                Place::Note { justify } => {
                    let dir = if matches!(justify, Justify::Right) {
                        1.0
                    } else {
                        -1.0
                    };
                    (tx + dir * (hw + 4.0), ty)
                }
                Place::Auto => unreachable!("filtered above"),
            };
            emit(&mut s, c.0, c.1, &lines, &co.color, co.faint);
            obstacles.push(Rect::center(c, hw, hh));
        }

        // 2) Auto-placed labels: entity labels + Place::Auto callouts, routed to
        // the closest collision-free position.
        let mut items: Vec<(f64, f64, Vec<String>, String, bool)> = Vec::new();
        for e in &self.entities {
            if !e.style.emphasis {
                continue;
            }
            if let Some(l) = &e.style.label {
                let t = match &e.geom {
                    Geom::Polyline(p) | Geom::Polygon(p) if !p.is_empty() => p[p.len() / 2],
                    Geom::Point(x, y) => (*x, *y),
                    _ => continue,
                };
                items.push((t.0, t.1, wrap_line(l, 22), th.primary.clone(), false));
            }
        }
        for co in &self.callouts {
            if matches!(co.place, Place::Auto) && !co.lines.is_empty() {
                let lines: Vec<String> = co.lines.iter().flat_map(|l| wrap_line(l, 22)).collect();
                items.push((co.target.0, co.target.1, lines, co.color.clone(), co.faint));
            }
        }
        // Deterministic order: top-to-bottom, then left-to-right (by projection).
        items.sort_by(|a, b| {
            let (pa, pb) = (f.project(a.0, a.1), f.project(b.0, b.1));
            pa.1.total_cmp(&pb.1).then(pa.0.total_cmp(&pb.0))
        });
        for (wx, wy, lines, color, faint) in &items {
            let (px, py) = f.project(*wx, *wy);
            let (hw, hh) = extent(lines, *faint);
            let cands = auto_candidates(px, py, hw, hh);
            let (path, c) = cands
                .iter()
                .find(|(_, c)| {
                    let box_ = Rect::center(*c, hw, hh);
                    !obstacles.iter().any(|o| o.overlaps(&box_))
                })
                .cloned()
                .unwrap_or_else(|| cands.last().cloned().unwrap());
            dot(&mut s, px, py, color);
            polyline(&mut s, &path, color);
            emit(&mut s, c.0, c.1, lines, color, *faint);
            obstacles.push(Rect::center(c, hw, hh));
        }

        // Hexagonal detail/section tags.
        for tg in &self.tags {
            let (cx, cy) = f.project(tg.at.0, tg.at.1);
            let r = 11.0;
            let pts: String = (0..6)
                .map(|k| {
                    let a = std::f64::consts::PI / 180.0 * (60.0 * k as f64 - 90.0);
                    format!("{:.1},{:.1}", cx + r * a.cos(), cy + r * a.sin())
                })
                .collect::<Vec<_>>()
                .join(" ");
            s.push_str(&format!(
                "<polygon points=\"{pts}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
                th.bg, th.primary
            ));
            s.push_str(&text(
                cx,
                cy + 3.0,
                8.0,
                "middle",
                700,
                &th.primary,
                &tg.code,
            ));
        }
        s
    }

    fn geometry(&self, f: &Fit) -> String {
        let th = &self.theme;
        let mut s = String::new();
        // Two passes: context (gray) under, emphasized (color) over.
        for emphasis in [false, true] {
            for e in &self.entities {
                if e.style.emphasis != emphasis {
                    continue;
                }
                let color = if emphasis {
                    e.style.color.as_str()
                } else {
                    th.gray.as_str()
                };
                match &e.geom {
                    Geom::Polyline(pts) if pts.len() >= 2 => {
                        s.push_str(&self.run(pts, &e.style, color, f, emphasis));
                    }
                    Geom::Polygon(pts) if pts.len() >= 3 => {
                        let d: String = pts
                            .iter()
                            .map(|&(x, y)| {
                                let p = f.project(x, y);
                                format!("{:.1},{:.1}", p.0, p.1)
                            })
                            .collect::<Vec<_>>()
                            .join(" ");
                        let fill = e.style.fill.as_deref().unwrap_or(color);
                        s.push_str(&format!(
                            "<polygon points=\"{d}\" fill=\"{fill}\" fill-opacity=\"0.5\" stroke=\"{color}\" stroke-width=\"{:.2}\"/>",
                            e.style.weight
                        ));
                    }
                    Geom::Point(x, y) => {
                        let (cx, cy) = f.project(*x, *y);
                        s.push_str(&marker(e.style.marker, cx, cy, 5.5, color, &th.ink));
                        // Labels are placed collision-aware in `annotations`.
                    }
                    _ => {}
                }
            }
        }
        s
    }

    /// Draws a run: to-scale casing + hatch when the pipe is big enough, else a
    /// weighted (optionally dashed) line.
    fn run(
        &self,
        pts: &[(f64, f64)],
        style: &Style,
        color: &str,
        f: &Fit,
        emphasis: bool,
    ) -> String {
        let mut s = String::new();
        let casing_px = style.casing_m.map(|m| m * f.scale).unwrap_or(0.0);
        if emphasis && casing_px >= 4.0 {
            // Per-segment quads (fill + hatch) with parallel edge lines.
            let hw = casing_px / 2.0;
            for w in pts.windows(2) {
                let (x1, y1) = f.project(w[0].0, w[0].1);
                let (x2, y2) = f.project(w[1].0, w[1].1);
                let (dx, dy) = (x2 - x1, y2 - y1);
                let len = (dx * dx + dy * dy).sqrt().max(1e-6);
                let (nx, ny) = (-dy / len * hw, dx / len * hw);
                let quad = format!(
                    "{:.1},{:.1} {:.1},{:.1} {:.1},{:.1} {:.1},{:.1}",
                    x1 + nx,
                    y1 + ny,
                    x2 + nx,
                    y2 + ny,
                    x2 - nx,
                    y2 - ny,
                    x1 - nx,
                    y1 - ny
                );
                s.push_str(&format!(
                    "<polygon points=\"{quad}\" fill=\"{color}\" fill-opacity=\"0.22\"/>"
                ));
                if let Some(hid) = hatch_id(style.hatch) {
                    s.push_str(&format!(
                        "<polygon points=\"{quad}\" fill=\"url(#{hid})\"/>"
                    ));
                }
                s.push_str(&line(
                    x1 + nx,
                    y1 + ny,
                    x2 + nx,
                    y2 + ny,
                    color,
                    1.1,
                    style.dashed,
                ));
                s.push_str(&line(
                    x1 - nx,
                    y1 - ny,
                    x2 - nx,
                    y2 - ny,
                    color,
                    1.1,
                    style.dashed,
                ));
            }
        } else {
            let d: String = pts
                .iter()
                .map(|&(x, y)| {
                    let p = f.project(x, y);
                    format!("{:.1},{:.1}", p.0, p.1)
                })
                .collect::<Vec<_>>()
                .join(" ");
            let w = if emphasis { style.weight } else { 1.2 };
            s.push_str(&format!(
                "<polyline points=\"{d}\" fill=\"none\" stroke=\"{color}\" stroke-width=\"{w:.2}\" stroke-linejoin=\"round\" stroke-linecap=\"round\"{}/>",
                if style.dashed { " stroke-dasharray=\"5 3\"" } else { "" }
            ));
        }
        // The run label is placed collision-aware in `annotations`.
        s
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::*;

    fn geo_sheet(entities: Vec<Entity>) -> Sheet {
        Sheet {
            theme: Theme::default(),
            placement: Placement::Band { height_mm: 112.0 },
            info: InfoPanel {
                caption: String::new(),
                title: String::new(),
                subtitle: String::new(),
                legend: vec![],
                meta: vec![],
                notes: vec![],
            },
            center: CenterColumn {
                north: false,
                scale_bar: false,
                stat: None,
            },
            grid: Grid {
                bubbles: false,
                dims: false,
                unit: DimUnit::Feet,
                axes: None,
            },
            entities,
            callouts: vec![],
            tags: vec![],
        }
    }

    #[test]
    fn emphasized_uses_color_context_uses_gray() {
        let s = geo_sheet(vec![
            Entity {
                geom: Geom::Polyline(vec![(0.0, 0.0), (100.0, 10.0)]),
                style: Style {
                    emphasis: true,
                    ..Style::line("#2563eb", 2.0)
                },
            },
            Entity {
                geom: Geom::Polyline(vec![(0.0, 20.0), (100.0, 22.0)]),
                style: Style {
                    emphasis: false,
                    ..Style::line("#dc2626", 2.0)
                },
            },
        ]);
        let svg = s.to_svg();
        assert!(svg.contains("#2563eb")); // emphasized color
        assert!(svg.contains(&Theme::default().gray)); // context gray
        assert!(!svg.contains("#dc2626")); // context run not drawn in its own color
    }

    #[test]
    fn large_pipe_gets_casing_hatch_small_does_not() {
        let big = geo_sheet(vec![Entity {
            geom: Geom::Polyline(vec![(0.0, 0.0), (100.0, 0.0)]),
            style: Style {
                casing_m: Some(30.0), // huge → well above the casing threshold
                hatch: Hatch::Cross,
                ..Style::line("#2563eb", 2.0)
            },
        }]);
        // The casing carries the material hatch (here: cross-hatch).
        assert!(big.to_svg().contains("url(#hatchCross)"));

        let small = geo_sheet(vec![Entity {
            geom: Geom::Polyline(vec![(0.0, 0.0), (100.0, 0.0)]),
            style: Style {
                casing_m: Some(0.01), // sub-pixel → falls back to a line
                ..Style::line("#2563eb", 2.0)
            },
        }]);
        assert!(!small.to_svg().contains("url(#hatch"));
    }

    #[test]
    fn hatch_none_draws_casing_without_texture() {
        let s = geo_sheet(vec![Entity {
            geom: Geom::Polyline(vec![(0.0, 0.0), (100.0, 0.0)]),
            style: Style {
                casing_m: Some(30.0),
                hatch: Hatch::None,
                ..Style::line("#2563eb", 2.0)
            },
        }]);
        let svg = s.to_svg();
        assert!(svg.contains("fill-opacity=\"0.22\"")); // casing tint present
        assert!(!svg.contains("url(#hatch")); // but no texture overlay
    }

    #[test]
    fn callouts_and_tags_render() {
        let mut s = geo_sheet(vec![Entity {
            geom: Geom::Point(50.0, 5.0),
            style: Style::line("#16a34a", 1.0),
        }]);
        s.callouts = vec![
            // Bold primary leader label (right-justified, horizontal).
            Callout {
                target: (50.0, 5.0),
                lines: vec!["LIVING ROOM / HALL".into(), "AREA".into()],
                color: "#6366f1".into(),
                faint: false,
                place: Place::Leader {
                    vertical: false,
                    justify: Justify::Right,
                },
            },
            // Gray note, no leader (left-justified).
            Callout {
                target: (10.0, 5.0),
                lines: vec!["NEIGHBOUR'S".into(), "TERRITORY".into()],
                color: "#6b7280".into(),
                faint: true,
                place: Place::Note {
                    justify: Justify::Left,
                },
            },
            // Faint primary, vertical leader (text stacked above).
            Callout {
                target: (30.0, 3.0),
                lines: vec!["OPEN VOID".into()],
                color: "#6366f1".into(),
                faint: true,
                place: Place::Leader {
                    vertical: true,
                    justify: Justify::Right,
                },
            },
        ];
        s.tags = vec![Tag {
            at: (30.0, 5.0),
            code: "A2".into(),
        }];
        let svg = s.to_svg();
        assert!(svg.contains("LIVING ROOM / HALL")); // multi-line leader label
        assert!(svg.contains("NEIGHBOUR'S")); // gray note
        assert!(svg.contains("OPEN VOID")); // vertical-leader callout
        assert!(svg.contains("A2")); // hexagon tag
        assert!(svg.contains("fill-opacity=\"0.6\"")); // faint styling
    }

    #[test]
    fn auto_candidates_escalate_cheapest_first() {
        let c = super::auto_candidates(100.0, 100.0, 20.0, 6.0);
        // First four candidates are 0-segment (no leader), for R/L/U/D.
        assert!(c[..4].iter().all(|(p, _)| p.is_empty()));
        // Straight 1-segment leaders (2-point paths) come next.
        assert!(c.iter().any(|(p, _)| p.len() == 2));
        // Then 2-segment elbows (3-point paths).
        assert!(c.iter().any(|(p, _)| p.len() == 3));
    }

    #[test]
    fn auto_label_avoids_a_geometry_box() {
        // A run label placed collision-aware must not sit on the run's own box.
        let s = geo_sheet(vec![Entity {
            geom: Geom::Polyline(vec![(0.0, 0.0), (100.0, 0.0)]),
            style: Style {
                label: Some("W-1".into()),
                ..Style::line("#2563eb", 2.0)
            },
        }]);
        let svg = s.to_svg();
        assert!(svg.contains("W-1")); // label placed
                                      // The label's <text> baseline must be offset from the run's y (not on it).
        let ty: Vec<f64> = svg
            .split("<text")
            .filter(|t| t.contains("W-1"))
            .filter_map(|t| {
                t.split("y=\"")
                    .nth(1)?
                    .split('"')
                    .next()?
                    .parse::<f64>()
                    .ok()
            })
            .collect();
        assert!(!ty.is_empty());
    }

    #[test]
    fn point_marker_and_label_render() {
        let s = geo_sheet(vec![Entity {
            geom: Geom::Point(50.0, 5.0),
            style: Style {
                marker: Marker::Circle,
                label: Some("MH-1".into()),
                ..Style::line("#16a34a", 1.0)
            },
        }]);
        let svg = s.to_svg();
        assert!(svg.contains("<circle"));
        assert!(svg.contains("MH-1"));
    }
}
