//! Grid-based earthwork volumes between surfaces.
//!
//! A surface is sampled as a height field: for a query `(x, y)` we find the
//! triangle containing it and barycentrically interpolate `z`. A uniform spatial
//! grid buckets triangles by their bounding box so each sample tests only a
//! handful of candidates (near-`O(cells)` overall).
//!
//! Volume is Riemann-summed over a regular grid of `cell_size` cells: at each
//! cell center we take `Δz = compare_z − base_z` (or `reference_elev − base_z`),
//! adding `Δz·cell_area` to **fill** where positive and to **cut** where negative.
//! `net = fill − cut`; `area` is the footprint of cells with data. Inputs are a
//! planar metric frame (meters); the caller handles geo ↔ metric conversion.

/// A triangle-mesh height field with a uniform spatial index for point queries.
pub struct SurfaceSampler {
    /// Vertex positions `(x, y, z)` in meters.
    verts: Vec<[f64; 3]>,
    /// Triangles (indices into `verts`).
    tris: Vec<[u32; 3]>,
    /// Planar bounds of all vertices: `[min_x, min_y, max_x, max_y]`.
    bounds: [f64; 4],
    /// Buckets of triangle indices, row-major `ny × nx`.
    buckets: Vec<Vec<u32>>,
    nx: usize,
    ny: usize,
    cell_w: f64,
    cell_h: f64,
}

/// Small tolerance so points on a shared triangle edge still resolve.
const BARY_TOL: f64 = 1e-9;

impl SurfaceSampler {
    /// Builds a sampler + spatial index from a metric mesh. Returns `None` if the
    /// mesh is empty or planar-degenerate (zero-area bounds).
    pub fn new(verts: Vec<[f64; 3]>, tris: Vec<[u32; 3]>) -> Option<SurfaceSampler> {
        if verts.is_empty() || tris.is_empty() {
            return None;
        }
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for v in &verts {
            b[0] = b[0].min(v[0]);
            b[1] = b[1].min(v[1]);
            b[2] = b[2].max(v[0]);
            b[3] = b[3].max(v[1]);
        }
        let (w, h) = (b[2] - b[0], b[3] - b[1]);
        if w <= 0.0 || h <= 0.0 {
            return None;
        }

        // Aim for roughly one triangle per bucket.
        let target = (tris.len() as f64).sqrt().ceil().max(1.0) as usize;
        let nx = target;
        let ny = target;
        let cell_w = w / nx as f64;
        let cell_h = h / ny as f64;
        let mut buckets: Vec<Vec<u32>> = vec![Vec::new(); nx * ny];

        let col = |x: f64| (((x - b[0]) / cell_w) as isize).clamp(0, nx as isize - 1) as usize;
        let row = |y: f64| (((y - b[1]) / cell_h) as isize).clamp(0, ny as isize - 1) as usize;
        for (ti, t) in tris.iter().enumerate() {
            let (mut tminx, mut tminy) = (f64::INFINITY, f64::INFINITY);
            let (mut tmaxx, mut tmaxy) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
            for &vi in t {
                let v = verts[vi as usize];
                tminx = tminx.min(v[0]);
                tminy = tminy.min(v[1]);
                tmaxx = tmaxx.max(v[0]);
                tmaxy = tmaxy.max(v[1]);
            }
            for gy in row(tminy)..=row(tmaxy) {
                for gx in col(tminx)..=col(tmaxx) {
                    buckets[gy * nx + gx].push(ti as u32);
                }
            }
        }

        Some(SurfaceSampler {
            verts,
            tris,
            bounds: b,
            buckets,
            nx,
            ny,
            cell_w,
            cell_h,
        })
    }

    /// Planar bounds `[min_x, min_y, max_x, max_y]`.
    pub fn bounds(&self) -> [f64; 4] {
        self.bounds
    }

    /// Interpolated surface elevation at `(x, y)`, or `None` outside the mesh.
    pub fn sample(&self, x: f64, y: f64) -> Option<f64> {
        if x < self.bounds[0] || x > self.bounds[2] || y < self.bounds[1] || y > self.bounds[3] {
            return None;
        }
        let gx =
            (((x - self.bounds[0]) / self.cell_w) as isize).clamp(0, self.nx as isize - 1) as usize;
        let gy =
            (((y - self.bounds[1]) / self.cell_h) as isize).clamp(0, self.ny as isize - 1) as usize;
        for &ti in &self.buckets[gy * self.nx + gx] {
            let t = self.tris[ti as usize];
            if let Some(z) = interp_in_triangle(
                self.verts[t[0] as usize],
                self.verts[t[1] as usize],
                self.verts[t[2] as usize],
                x,
                y,
            ) {
                return Some(z);
            }
        }
        None
    }
}

/// Barycentric elevation of `(px, py)` inside triangle `a,b,c`, or `None` if the
/// point is outside (or the triangle is degenerate).
fn interp_in_triangle(a: [f64; 3], b: [f64; 3], c: [f64; 3], px: f64, py: f64) -> Option<f64> {
    let det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if det.abs() < 1e-12 {
        return None;
    }
    let l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
    let l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
    let l3 = 1.0 - l1 - l2;
    if l1 >= -BARY_TOL && l2 >= -BARY_TOL && l3 >= -BARY_TOL {
        Some(l1 * a[2] + l2 * b[2] + l3 * c[2])
    } else {
        None
    }
}

/// One populated heatmap cell: center `(x, y)` (meters), the base elevation there,
/// and the signed `Δz` (compare − base; + = fill, − = cut).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VolumeCell {
    pub x: f64,
    pub y: f64,
    pub base_z: f64,
    pub dz: f64,
}

/// Computed earthwork result: totals + the per-cell Δz grid for the heatmap.
#[derive(Debug, Clone, PartialEq)]
pub struct VolumeResult {
    /// Material removed (m³) — where the compare level is below base.
    pub cut: f64,
    /// Material added (m³) — where the compare level is above base.
    pub fill: f64,
    /// `fill − cut` (m³).
    pub net: f64,
    /// Footprint with data (m²).
    pub area: f64,
    /// Populated cells (heatmap).
    pub cells: Vec<VolumeCell>,
    /// `Δz` range across cells, for legend scaling.
    pub min_dz: f64,
    pub max_dz: f64,
}

/// Ceiling on grid cells so a tiny cell over a large extent can't exhaust memory.
pub const MAX_CELLS: usize = 4_000_000;

/// Grid-Riemann earthwork between `base` and either `compare` (surface↔surface,
/// on their overlap) or `reference_elev` (surface↔elevation, over `base`). Exactly
/// one of `compare` / `reference_elev` must be given.
pub fn compute_volume(
    base: &SurfaceSampler,
    compare: Option<&SurfaceSampler>,
    reference_elev: Option<f64>,
    cell_size: f64,
) -> Result<VolumeResult, String> {
    if !cell_size.is_finite() || cell_size <= 0.0 {
        return Err("cell size must be a positive number".into());
    }
    if compare.is_some() == reference_elev.is_some() {
        return Err("provide exactly one of a compare surface or a reference elevation".into());
    }

    // Analysis window: the overlap of both surfaces (s↔s) or base's extent (s↔e).
    let bb = base.bounds();
    let window = match compare {
        Some(c) => {
            let cb = c.bounds();
            [
                bb[0].max(cb[0]),
                bb[1].max(cb[1]),
                bb[2].min(cb[2]),
                bb[3].min(cb[3]),
            ]
        }
        None => bb,
    };
    let (w, h) = (window[2] - window[0], window[3] - window[1]);
    if w <= 0.0 || h <= 0.0 {
        // Disjoint surfaces → nothing to compare.
        return Ok(VolumeResult {
            cut: 0.0,
            fill: 0.0,
            net: 0.0,
            area: 0.0,
            cells: Vec::new(),
            min_dz: 0.0,
            max_dz: 0.0,
        });
    }

    let nx = (w / cell_size).ceil() as usize;
    let ny = (h / cell_size).ceil() as usize;
    if nx.saturating_mul(ny) > MAX_CELLS {
        return Err(format!(
            "cell size {cell_size} is too fine for this area ({nx}×{ny} cells) — increase it"
        ));
    }

    let cell_area = cell_size * cell_size;
    let (mut cut, mut fill) = (0.0_f64, 0.0_f64);
    let (mut min_dz, mut max_dz) = (f64::INFINITY, f64::NEG_INFINITY);
    let mut cells = Vec::new();
    for iy in 0..ny {
        let cy = window[1] + (iy as f64 + 0.5) * cell_size;
        for ix in 0..nx {
            let cx = window[0] + (ix as f64 + 0.5) * cell_size;
            let Some(base_z) = base.sample(cx, cy) else {
                continue;
            };
            let other_z = match compare {
                Some(c) => match c.sample(cx, cy) {
                    Some(z) => z,
                    None => continue,
                },
                None => reference_elev.unwrap(),
            };
            let dz = other_z - base_z;
            if dz > 0.0 {
                fill += dz * cell_area;
            } else {
                cut += -dz * cell_area;
            }
            min_dz = min_dz.min(dz);
            max_dz = max_dz.max(dz);
            cells.push(VolumeCell {
                x: cx,
                y: cy,
                base_z,
                dz,
            });
        }
    }

    let area = cells.len() as f64 * cell_area;
    if cells.is_empty() {
        min_dz = 0.0;
        max_dz = 0.0;
    }
    Ok(VolumeResult {
        cut,
        fill,
        net: fill - cut,
        area,
        cells,
        min_dz,
        max_dz,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::tin::{self, InputPoint};

    fn pt(e: f64, n: f64, z: f64) -> InputPoint {
        InputPoint { e, n, z }
    }

    /// A flat `size × size` pad at constant elevation `z` (two triangles).
    fn flat_pad(size: f64, z: f64) -> SurfaceSampler {
        let mesh = tin::triangulate(&[
            pt(0.0, 0.0, z),
            pt(size, 0.0, z),
            pt(size, size, z),
            pt(0.0, size, z),
        ])
        .unwrap();
        SurfaceSampler::new(mesh.vertices, mesh.indices).unwrap()
    }

    #[test]
    fn flat_pad_to_datum_is_length_times_area() {
        // A 100×100 pad at z=10, cut down to datum 0 → cut = 10 · 100² = 100 000.
        let base = flat_pad(100.0, 10.0);
        let r = compute_volume(&base, None, Some(0.0), 1.0).unwrap();
        assert!((r.cut - 100_000.0).abs() < 1.0, "cut = {}", r.cut);
        assert!(r.fill.abs() < 1e-6, "fill = {}", r.fill);
        assert!((r.area - 10_000.0).abs() < 1e-6, "area = {}", r.area);
        assert!((r.net - (-100_000.0)).abs() < 1.0, "net = {}", r.net);
    }

    #[test]
    fn surface_to_surface_pure_fill() {
        // Raising a 100×100 pad from 10 to 13 → fill = 3 · 100² = 30 000, no cut.
        let base = flat_pad(100.0, 10.0);
        let compare = flat_pad(100.0, 13.0);
        let r = compute_volume(&base, Some(&compare), None, 1.0).unwrap();
        assert!((r.fill - 30_000.0).abs() < 1.0, "fill = {}", r.fill);
        assert!(r.cut.abs() < 1e-6, "cut = {}", r.cut);
        assert!((r.net - 30_000.0).abs() < 1.0, "net = {}", r.net);
    }

    #[test]
    fn pyramid_to_datum_matches_closed_form() {
        // Square pyramid: L=100 base at z=0, apex (50,50) at h=30. Its TIN is exact
        // (planar faces), so grid quadrature → the pyramid volume (1/3)·L²·h.
        let l = 100.0;
        let h = 30.0;
        let mesh = tin::triangulate(&[
            pt(0.0, 0.0, 0.0),
            pt(l, 0.0, 0.0),
            pt(l, l, 0.0),
            pt(0.0, l, 0.0),
            pt(l / 2.0, l / 2.0, h),
        ])
        .unwrap();
        let base = SurfaceSampler::new(mesh.vertices, mesh.indices).unwrap();
        // Cut the whole pyramid down to datum 0 (surface is above → all cut).
        let r = compute_volume(&base, None, Some(0.0), 0.5).unwrap();
        let expected = l * l * h / 3.0; // 100 000
        let rel = (r.cut - expected).abs() / expected;
        assert!(
            rel < 0.02,
            "cut {} vs closed-form {expected} (rel {rel})",
            r.cut
        );
        assert!(r.fill.abs() < 1e-6);
    }

    #[test]
    fn disjoint_surfaces_yield_zero() {
        let base = flat_pad(10.0, 5.0);
        // A pad shifted far away so the two bounding boxes don't overlap.
        let mesh = tin::triangulate(&[
            pt(1000.0, 1000.0, 8.0),
            pt(1010.0, 1000.0, 8.0),
            pt(1010.0, 1010.0, 8.0),
            pt(1000.0, 1010.0, 8.0),
        ])
        .unwrap();
        let compare = SurfaceSampler::new(mesh.vertices, mesh.indices).unwrap();
        let r = compute_volume(&base, Some(&compare), None, 1.0).unwrap();
        assert_eq!(r.cut, 0.0);
        assert_eq!(r.fill, 0.0);
        assert_eq!(r.area, 0.0);
        assert!(r.cells.is_empty());
    }

    #[test]
    fn heatmap_cells_carry_signed_dz() {
        let base = flat_pad(4.0, 10.0);
        let compare = flat_pad(4.0, 12.0);
        let r = compute_volume(&base, Some(&compare), None, 1.0).unwrap();
        assert!(!r.cells.is_empty());
        assert!(r.cells.iter().all(|c| (c.dz - 2.0).abs() < 1e-9));
        assert!((r.min_dz - 2.0).abs() < 1e-9 && (r.max_dz - 2.0).abs() < 1e-9);
    }

    #[test]
    fn bad_inputs_error() {
        let base = flat_pad(10.0, 1.0);
        assert!(compute_volume(&base, None, Some(0.0), 0.0).is_err()); // cell size
        assert!(compute_volume(&base, None, None, 1.0).is_err()); // neither target
        let other = flat_pad(10.0, 2.0);
        assert!(compute_volume(&base, Some(&other), Some(0.0), 1.0).is_err()); // both
    }

    #[test]
    fn sampler_returns_none_outside() {
        let s = flat_pad(10.0, 5.0);
        assert_eq!(s.sample(5.0, 5.0), Some(5.0));
        assert_eq!(s.sample(-1.0, 5.0), None);
        assert_eq!(s.sample(100.0, 100.0), None);
    }
}
