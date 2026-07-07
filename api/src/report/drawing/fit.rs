//! The fit transform: bounding the data, choosing a uniform scale, and the
//! world → sheet projection (with 90° auto-orientation for landscape bands).

use super::model::{Geom, Placement, Sheet};
use super::svg::{vsub, vunit, V2};

/// Letter portrait printable width (mm) — sets the band's aspect ratio.
const PAGE_W_MM: f64 = 187.0;

/// The fitted plot transform: world bbox, uniform scale, and a `project`
/// (world → sheet) helper. When `rot` is set, the plan is rotated 90° so a
/// taller-than-wide site fills a landscape band; `project` handles both cases so
/// all geometry/grid drawing stays orientation-agnostic.
pub(super) struct Fit {
    pub(super) off_x: f64,
    pub(super) off_y: f64,
    pub(super) scale: f64,
    pub(super) min_x: f64,
    pub(super) min_y: f64,
    pub(super) max_x: f64,
    pub(super) max_y: f64,
    pub(super) rot: bool,
}

impl Fit {
    /// World (x = easting/grid-x, y = northing/grid-y) → sheet coordinates.
    pub(super) fn project(&self, x: f64, y: f64) -> V2 {
        if self.rot {
            // 90° rotation: the long (y) axis runs horizontally.
            (
                self.off_x + (self.max_y - y) * self.scale,
                self.off_y + (self.max_x - x) * self.scale,
            )
        } else {
            (
                self.off_x + (x - self.min_x) * self.scale,
                self.off_y + (self.max_y - y) * self.scale, // north up
            )
        }
    }
    /// Screen-space frame rectangle (px0, py0, px1, py1) bounding the data bbox.
    pub(super) fn frame(&self) -> (f64, f64, f64, f64) {
        let c = [
            self.project(self.min_x, self.min_y),
            self.project(self.max_x, self.min_y),
            self.project(self.max_x, self.max_y),
            self.project(self.min_x, self.max_y),
        ];
        let px0 = c.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
        let px1 = c.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
        let py0 = c.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let py1 = c.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
        (px0, py0, px1, py1)
    }
    /// Direction (unit vector) that world-north (+y) points on the sheet.
    pub(super) fn north_dir(&self) -> V2 {
        vunit(vsub(self.project(0.0, 1.0), self.project(0.0, 0.0)))
    }
}

impl Sheet {
    /// SVG viewBox dimensions for the current placement.
    pub(super) fn viewbox(&self) -> (f64, f64) {
        match self.placement {
            Placement::Band { height_mm } => (1400.0, 1400.0 * height_mm / PAGE_W_MM),
            Placement::FullPage { landscape: true } => (1400.0, 950.0),
            Placement::FullPage { landscape: false } => (1050.0, 1400.0),
        }
    }

    /// World bounding box over every entity vertex + the grid's own extent (so
    /// the whole grid fits even if it extends beyond the utilities).
    pub(super) fn bbox(&self) -> Option<(f64, f64, f64, f64)> {
        let (mut a, mut b, mut c, mut d) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        let mut seen = false;
        let mut acc = |x: f64, y: f64| {
            seen = true;
            a = a.min(x);
            b = b.min(y);
            c = c.max(x);
            d = d.max(y);
        };
        for e in &self.entities {
            match &e.geom {
                Geom::Polyline(p) | Geom::Polygon(p) => p.iter().for_each(|&(x, y)| acc(x, y)),
                Geom::Point(x, y) => acc(*x, *y),
            }
        }
        if let Some(ax) = &self.grid.axes {
            for (x, _) in &ax.vertical {
                for (y, _) in &ax.horizontal {
                    acc(*x, *y);
                }
            }
        }
        seen.then_some((a, b, c, d))
    }

    pub(super) fn extent(&self) -> Option<(f64, f64)> {
        self.bbox().map(|(a, b, c, d)| (c - a, d - b))
    }

    /// Fits the geometry bbox into the plot region for the current placement.
    /// Recomputed on demand (cheap) so the center column's scale bar matches the
    /// plan exactly.
    pub(super) fn fit(&self) -> Option<Fit> {
        let (vw, vh) = self.viewbox();
        let pad = 0.03 * vw;
        let vpad = 0.05 * vh;
        let (gx0, gx1, gy0, gy1) = (0.33 * vw, vw - pad, vpad, vh - vpad);
        let (pw, ph) = (gx1 - gx0, gy1 - gy0);
        let (px0, px1) = (gx0 + 0.14 * pw, gx1 - 0.07 * pw);
        let (py0, py1) = (gy0 + 0.15 * ph, gy1 - 0.08 * ph);
        let (min_x, min_y, max_x, max_y) = self.bbox()?;
        let dw = (max_x - min_x).max(1e-6);
        let dh = (max_y - min_y).max(1e-6);
        // Auto-orient: rotate 90° when a taller-than-wide site would fit a
        // landscape plot area better, so the plan fills the band.
        let plot_w = px1 - px0;
        let plot_h = py1 - py0;
        let rot = dh > dw && plot_w >= plot_h;
        // Effective world dimensions along the horizontal/vertical plot axes.
        let (span_h, span_v) = if rot { (dh, dw) } else { (dw, dh) };
        let scale = (plot_w / span_h).min(plot_h / span_v);
        let off_x = px0 + (plot_w - span_h * scale) / 2.0;
        let off_y = py0 + (plot_h - span_v * scale) / 2.0;
        Some(Fit {
            off_x,
            off_y,
            scale,
            min_x,
            min_y,
            max_x,
            max_y,
            rot,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::*;

    fn sheet(entities: Vec<Entity>, axes: Option<GridAxes>) -> Sheet {
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
                axes,
            },
            entities,
            callouts: vec![],
            tags: vec![],
        }
    }
    fn poly(pts: &[(f64, f64)]) -> Entity {
        Entity {
            geom: Geom::Polyline(pts.to_vec()),
            style: Style::line("#000", 1.0),
        }
    }

    #[test]
    fn bbox_includes_grid_axes_extent() {
        let s = sheet(
            vec![poly(&[(10.0, 10.0), (20.0, 20.0)])],
            Some(GridAxes {
                vertical: vec![(0.0, "A".into()), (50.0, "B".into())],
                horizontal: vec![(0.0, "1".into()), (40.0, "2".into())],
            }),
        );
        let (a, b, c, d) = s.bbox().unwrap();
        assert_eq!((a, b, c, d), (0.0, 0.0, 50.0, 40.0));
    }

    #[test]
    fn wide_site_is_not_rotated_tall_site_is() {
        let wide = sheet(vec![poly(&[(0.0, 0.0), (100.0, 10.0)])], None);
        assert!(!wide.fit().unwrap().rot);
        let tall = sheet(vec![poly(&[(0.0, 0.0), (10.0, 100.0)])], None);
        assert!(tall.fit().unwrap().rot);
    }

    #[test]
    fn project_is_north_up_without_rotation() {
        let s = sheet(vec![poly(&[(0.0, 0.0), (100.0, 10.0)])], None);
        let f = s.fit().unwrap();
        assert!(!f.rot);
        // Higher northing → smaller screen-y (up).
        assert!(f.project(0.0, 10.0).1 < f.project(0.0, 0.0).1);
        // north points up.
        assert!(f.north_dir().1 < 0.0);
    }

    #[test]
    fn rotated_north_points_sideways() {
        let s = sheet(vec![poly(&[(0.0, 0.0), (10.0, 100.0)])], None);
        let f = s.fit().unwrap();
        assert!(f.rot);
        // Under 90° rotation, north is horizontal, not vertical.
        assert!(f.north_dir().0.abs() > f.north_dir().1.abs());
    }

    #[test]
    fn empty_sheet_has_no_fit() {
        assert!(sheet(vec![], None).fit().is_none());
    }
}
