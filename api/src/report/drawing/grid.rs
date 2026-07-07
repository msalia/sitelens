//! The indigo annotation layer: coordinate/building gridlines, grid bubbles,
//! dashed extensions, and dimension chains.

use super::fit::Fit;
use super::model::Sheet;
use super::svg::{line, nice, text, vadd, vscale, vsub, vunit, Lines, V2};

/// A labeled grid line's key screen points: endpoints (`a`, `b`), dashed-extension
/// ends (`ea`, `eb`), and bubble centers (`ba`, `bb`), plus its world position and
/// label. Single source of truth for bubbles, extensions, and dimension anchors —
/// so rendering and collision-box computation can never drift apart.
struct AxisTick {
    pos: f64,
    a: V2,
    b: V2,
    ea: V2,
    eb: V2,
    ba: V2,
    bb: V2,
    label: String,
}

impl Sheet {
    pub(super) fn grid_and_dims(&self, f: &Fit) -> String {
        let th = &self.theme;
        let (px0, py0, px1, py1) = f.frame();
        let (vlines, hlines) = self.axis_lines(f);

        let mut s = format!(
            "<rect x=\"{px0:.1}\" y=\"{py0:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"none\" stroke=\"{}\" stroke-width=\"0.7\"/>",
            px1 - px0,
            py1 - py0,
            th.mute
        );
        s.push_str(&self.draw_axis_family(f, &vlines, true));
        s.push_str(&self.draw_axis_family(f, &hlines, false));
        s
    }

    /// The (vertical, horizontal) grid lines actually drawn — the project's real
    /// axes or an auto coordinate grid — filtered to the data extent and sorted.
    /// `vlines` are world-x lines; `hlines` world-y lines.
    fn axis_lines(&self, f: &Fit) -> (Lines, Lines) {
        let (min_x, max_x, min_y, max_y) = (f.min_x, f.max_x, f.min_y, f.max_y);
        let (mut vlines, mut hlines): (Lines, Lines) = match &self.grid.axes {
            Some(ax) => (ax.vertical.clone(), ax.horizontal.clone()),
            None => {
                let step = nice(((max_x - min_x).max(max_y - min_y)) / 5.0).max(1e-6);
                let start = |mn: f64| (mn / step).ceil() * step;
                let mut v = Vec::new();
                let (mut gx, mut i) = (start(min_x), 0u8);
                while gx <= max_x + 1e-6 {
                    v.push((gx, ((b'A' + (i % 26)) as char).to_string()));
                    gx += step;
                    i += 1;
                }
                let mut h = Vec::new();
                let (mut gy, mut j) = (start(min_y), 1u32);
                while gy <= max_y + 1e-6 {
                    h.push((gy, j.to_string()));
                    gy += step;
                    j += 1;
                }
                (v, h)
            }
        };
        vlines.retain(|(x, _)| *x >= min_x - 1e-6 && *x <= max_x + 1e-6);
        hlines.retain(|(y, _)| *y >= min_y - 1e-6 && *y <= max_y + 1e-6);
        vlines.sort_by(|a, b| a.0.total_cmp(&b.0));
        hlines.sort_by(|a, b| a.0.total_cmp(&b.0));
        (vlines, hlines)
    }

    /// The labeled ticks for one family, thinned to ~9 so a dense building grid
    /// stays legible, with every key screen point resolved. Orientation-agnostic
    /// (works off `Fit::project`, so it's correct under the 90° auto-rotation).
    fn axis_ticks(&self, f: &Fit, lines: &[(f64, String)], vertical: bool) -> Vec<AxisTick> {
        if lines.is_empty() {
            return Vec::new();
        }
        let bub = 44.0;
        let r = 9.0;
        let ext = bub - r;
        let ends = |pos: f64| -> (V2, V2) {
            if vertical {
                (f.project(pos, f.min_y), f.project(pos, f.max_y))
            } else {
                (f.project(f.min_x, pos), f.project(f.max_x, pos))
            }
        };
        let dir = vunit(vsub(ends(lines[0].0).1, ends(lines[0].0).0));
        let n = lines.len();
        let stride = (n.div_ceil(9)).max(1);
        let mut out = Vec::new();
        for (i, (pos, label)) in lines.iter().enumerate() {
            if !(i.is_multiple_of(stride) || i + 1 == n) {
                continue;
            }
            let (a, b) = ends(*pos);
            out.push(AxisTick {
                pos: *pos,
                a,
                b,
                ea: vsub(a, vscale(dir, ext)),
                eb: vadd(b, vscale(dir, ext)),
                ba: vsub(a, vscale(dir, bub)),
                bb: vadd(b, vscale(dir, bub)),
                label: label.clone(),
            });
        }
        out
    }

    /// Screen-space boxes (center x, y, half-width, half-height) of the grid
    /// bubbles, so plan labels can be routed clear of them. Empty when bubbles are
    /// disabled. Derived from the same [`AxisTick`]s that draw the bubbles.
    pub(super) fn grid_boxes(&self, f: &Fit) -> Vec<(f64, f64, f64, f64)> {
        if !self.grid.bubbles {
            return Vec::new();
        }
        let (vlines, hlines) = self.axis_lines(f);
        let mut out = Vec::new();
        for (lines, vertical) in [(&vlines, true), (&hlines, false)] {
            for t in self.axis_ticks(f, lines, vertical) {
                for c in [t.ba, t.bb] {
                    out.push((c.0, c.1, 11.0, 11.0)); // bubble r=9 + a small pad
                }
            }
        }
        out
    }

    /// Draws one family of parallel grid lines (all light dashed), plus — for the
    /// thinned, labeled ticks — dashed extensions, bubbles beyond both ends, and a
    /// dimension chain just outside one edge.
    fn draw_axis_family(&self, f: &Fit, lines: &[(f64, String)], vertical: bool) -> String {
        let th = &self.theme;
        let unit = self.grid.unit;
        if lines.is_empty() {
            return String::new();
        }
        let r = 9.0;
        let dim = 22.0;
        let ends = |pos: f64| -> (V2, V2) {
            if vertical {
                (f.project(pos, f.min_y), f.project(pos, f.max_y))
            } else {
                (f.project(f.min_x, pos), f.project(f.max_x, pos))
            }
        };
        let dir = vunit(vsub(ends(lines[0].0).1, ends(lines[0].0).0));
        let seg = |a: V2, b: V2, w: f64, dash: bool| line(a.0, a.1, b.0, b.1, &th.primary, w, dash);

        let mut s = String::new();
        // Light dashed gridline for every line.
        for (pos, _) in lines {
            let (a, b) = ends(*pos);
            s.push_str(&seg(a, b, 0.4, true));
        }

        let ticks = self.axis_ticks(f, lines, vertical);
        // Bubbles + dashed extensions on the labeled subset.
        if self.grid.bubbles {
            for t in &ticks {
                s.push_str(&seg(t.a, t.ea, 0.6, true));
                s.push_str(&seg(t.b, t.eb, 0.6, true));
                for bp in [t.ba, t.bb] {
                    s.push_str(&format!(
                        "<circle cx=\"{:.1}\" cy=\"{:.1}\" r=\"{r}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
                        bp.0, bp.1, th.bg, th.primary
                    ));
                    s.push_str(&text(
                        bp.0,
                        bp.1 + 3.5,
                        9.0,
                        "middle",
                        700,
                        &th.primary,
                        &t.label,
                    ));
                }
            }
        }

        // Dimension chain just outside the A-edge (outward = opposite the lines).
        if self.grid.dims && !ticks.is_empty() {
            let out = vscale(dir, -1.0);
            let pts: Vec<(f64, V2)> = ticks
                .iter()
                .map(|t| (t.pos, vadd(t.a, vscale(out, dim))))
                .collect();
            // Whether the dimension chain runs horizontally (gridlines vertical).
            let chain_horizontal = dir.1.abs() > dir.0.abs();
            for w in pts.windows(2) {
                s.push_str(&seg(w[0].1, w[1].1, 0.6, false));
                // tick along the line direction.
                let t0 = vsub(w[0].1, vscale(dir, 3.0));
                let t1 = vadd(w[0].1, vscale(dir, 3.0));
                s.push_str(&seg(t0, t1, 0.8, false));
                let m = vscale(vadd(w[0].1, w[1].1), 0.5); // segment midpoint
                let val = format!("{:.0}", unit.conv((w[1].0 - w[0].0).abs()));
                if chain_horizontal {
                    // Centered, offset off the line (perpendicular) so it doesn't cross.
                    let p = vadd(m, vscale(out, 8.0));
                    s.push_str(&text(p.0, p.1, 7.5, "middle", 500, &th.primary, &val));
                } else {
                    // Beside a vertical line, vertically centered in the gap.
                    let left = out.0 < 0.0;
                    let anchor = if left { "end" } else { "start" };
                    let p = vadd(m, vscale(out, 4.0));
                    s.push_str(&text(p.0, p.1 + 2.5, 7.5, anchor, 500, &th.primary, &val));
                }
            }
            if let Some(last) = pts.last() {
                let t0 = vsub(last.1, vscale(dir, 3.0));
                let t1 = vadd(last.1, vscale(dir, 3.0));
                s.push_str(&seg(t0, t1, 0.8, false));
            }
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::*;

    fn grid_sheet(axes: Option<GridAxes>, bubbles: bool, dims: bool) -> Sheet {
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
                bubbles,
                dims,
                unit: DimUnit::Feet,
                axes,
            },
            entities: vec![Entity {
                geom: Geom::Polyline(vec![(0.0, 0.0), (100.0, 20.0)]),
                style: Style::line("#000", 1.0),
            }],
            callouts: vec![],
            tags: vec![],
        }
    }

    #[test]
    fn explicit_axis_labels_render() {
        let s = grid_sheet(
            Some(GridAxes {
                vertical: vec![(0.0, "A".into()), (100.0, "B".into())],
                horizontal: vec![(0.0, "1".into()), (20.0, "2".into())],
            }),
            true,
            true,
        );
        let svg = s.to_svg();
        for lbl in [">A<", ">B<", ">1<", ">2<"] {
            assert!(svg.contains(lbl), "missing {lbl}");
        }
    }

    #[test]
    fn dense_grid_is_thinned() {
        // 30 vertical axes → labels thinned to ~9, so not all bubbles are drawn.
        let vertical: Vec<(f64, String)> =
            (0..30).map(|i| (i as f64 * 3.0, format!("V{i}"))).collect();
        let s = grid_sheet(
            Some(GridAxes {
                vertical,
                horizontal: vec![(0.0, "1".into()), (20.0, "2".into())],
            }),
            true,
            false,
        );
        let svg = s.to_svg();
        let bubbles = svg.matches("<circle").count();
        assert!(bubbles < 30 * 2, "expected thinned bubbles, got {bubbles}");
        assert!(bubbles > 0);
    }

    #[test]
    fn no_bubbles_when_disabled() {
        let s = grid_sheet(None, false, false);
        // Bubble circles use r="9"; the hatch-dots pattern circle is much smaller,
        // so absence of r="9" means no grid bubbles were drawn.
        assert!(!s.to_svg().contains("r=\"9\""));
    }

    #[test]
    fn grid_boxes_track_drawn_bubbles() {
        let s = grid_sheet(
            Some(GridAxes {
                vertical: vec![(0.0, "A".into()), (100.0, "B".into())],
                horizontal: vec![(0.0, "1".into())],
            }),
            true,
            false,
        );
        let f = s.fit().expect("fits");
        let boxes = s.grid_boxes(&f);
        // One collision box per drawn bubble (r="9"), so labels avoid every one.
        let drawn = s.to_svg().matches("r=\"9\"").count();
        assert_eq!(boxes.len(), drawn);
        assert!(!boxes.is_empty());

        // Disabling bubbles yields no boxes.
        let mut off = s;
        off.grid.bubbles = false;
        assert!(off.grid_boxes(&f).is_empty());
    }
}
