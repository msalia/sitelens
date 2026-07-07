//! The left column: the info/metadata panel (top) and the north + measurements
//! block (bottom-left).

use super::model::{Sheet, Swatch};
use super::svg::{line, marker, nice, text, vadd, vscale, vsub};

impl Sheet {
    /// Top-left info panel: caption, title, subtitle, legend, metadata, notes.
    pub(super) fn info_panel(&self, x0: f64, y0: f64, x1: f64, _y1: f64) -> String {
        let th = &self.theme;
        let info = &self.info;
        let mut s = String::new();
        let mut y = y0 + 14.0;
        s.push_str(&text(x0, y, 10.0, "start", 400, &th.mute, &info.caption));
        y += 26.0;
        s.push_str(&text(x0, y, 20.0, "start", 800, &th.primary, &info.title));
        y += 22.0;
        s.push_str(&text(x0, y, 12.0, "start", 500, &th.ink, &info.subtitle));
        y += 16.0;
        s.push_str(&line(x0, y, x1, y, &th.mute, 0.6, false));
        y += 22.0;

        // Legend.
        if !info.legend.is_empty() {
            s.push_str(&text(x0, y, 9.0, "start", 700, &th.mute, "LEGEND"));
            y += 16.0;
            for it in &info.legend {
                match &it.swatch {
                    Swatch::Color(c) => s.push_str(&format!(
                        "<rect x=\"{x0:.1}\" y=\"{:.1}\" width=\"11\" height=\"11\" fill=\"{c}\"/>",
                        y - 9.0
                    )),
                    Swatch::Symbol(m, c) => {
                        s.push_str(&marker(*m, x0 + 5.5, y - 3.5, 5.5, c, &th.ink))
                    }
                }
                s.push_str(&text(x0 + 20.0, y, 9.5, "start", 500, &th.ink, &it.label));
                if let Some(n) = &it.note {
                    s.push_str(&text(x1, y, 8.5, "end", 400, &th.mute, n));
                }
                y += 16.0;
            }
            y += 8.0;
            s.push_str(&line(x0, y, x1, y, &th.mute, 0.6, false));
            y += 22.0;
        }

        // Metadata rows.
        for (k, v) in &info.meta {
            s.push_str(&text(x0, y, 9.5, "start", 400, &th.mute, k));
            s.push_str(&text(x1, y, 9.5, "end", 700, &th.ink, v));
            y += 16.0;
        }
        if !info.notes.is_empty() {
            y += 8.0;
            for n in &info.notes {
                s.push_str(&text(x0, y, 8.0, "start", 400, &th.mute, n));
                y += 12.0;
            }
        }
        s
    }

    /// Column-1 row 2: north indicator + headline stat + scale bar, bottom-left.
    pub(super) fn center_column(&self, x0: f64, _x1: f64, _y0: f64, y1: f64) -> String {
        let th = &self.theme;
        let c = &self.center;
        let mut s = String::new();
        // Bottom-align the block: estimate its height and start there.
        let mut h = 0.0;
        if c.north {
            h += 52.0;
        }
        if c.stat.is_some() {
            h += 66.0;
        }
        if c.scale_bar {
            h += 24.0;
        }
        let mut y = y1 - h;
        if c.north {
            // North indicator: a needle pointing in the plan's actual north
            // direction (rotates with the auto-orientation).
            let nd = self.fit().map(|f| f.north_dir()).unwrap_or((0.0, -1.0));
            let (ncx, cyc) = (x0 + 15.0, y + 26.0);
            s.push_str(&format!(
                "<circle cx=\"{ncx:.1}\" cy=\"{cyc:.1}\" r=\"14\" fill=\"none\" stroke=\"{}\" stroke-width=\"1\"/>",
                th.ink
            ));
            let tail = vsub((ncx, cyc), vscale(nd, 12.0));
            let tip = vadd((ncx, cyc), vscale(nd, 12.0));
            s.push_str(&line(tail.0, tail.1, tip.0, tip.1, &th.ink, 1.4, false));
            let lbl = vadd((ncx, cyc), vscale(nd, 22.0));
            s.push_str(&text(lbl.0, lbl.1 + 3.5, 11.0, "middle", 700, &th.ink, "N"));
            y += 52.0;
        }
        if let Some(stat) = &c.stat {
            s.push_str(&text(x0, y + 24.0, 30.0, "start", 800, &th.ink, &stat.big));
            y += 34.0;
            s.push_str(&text(x0, y, 10.0, "start", 500, &th.mute, &stat.sub));
            y += 15.0;
            s.push_str(&text(x0, y, 9.0, "start", 400, &th.mute, &stat.note));
            y += 17.0;
        }
        if c.scale_bar {
            // Fit a scale bar to a tidy world length using the plan's own scale;
            // recomputed here from the same extent so it stays honest.
            if let Some(f) = self.fit() {
                let world = nice(self.extent().map(|(w, _)| w * 0.2).unwrap_or(10.0)).max(0.001);
                let len = world * f.scale;
                let bx = x0; // left-justified
                let unit = self.grid.unit;
                let val = unit.conv(world);
                // Alternating 4-segment bar.
                let seg = len / 4.0;
                for i in 0..4 {
                    let fill = if i % 2 == 0 { &th.ink } else { &th.bg };
                    s.push_str(&format!(
                        "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{seg:.1}\" height=\"5\" fill=\"{fill}\" stroke=\"{}\" stroke-width=\"0.5\"/>",
                        bx + i as f64 * seg,
                        y,
                        th.ink
                    ));
                }
                s.push_str(&text(bx, y + 14.0, 8.0, "start", 500, &th.mute, "0"));
                s.push_str(&text(
                    bx + len,
                    y + 14.0,
                    8.0,
                    "end",
                    500,
                    &th.mute,
                    &format!("{val:.0} {}", unit.label()),
                ));
            }
        }
        s
    }
}
