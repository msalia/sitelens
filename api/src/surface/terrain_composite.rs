//! Boundary-split composite terrain (terrain-rendering Phase 2b).
//!
//! Given a coarse DEM (context) and a high-res detail DEM (both decoded from 3DEP
//! GeoTIFFs, EPSG:4326 → nodes are lon/lat) plus the property boundary polygon in
//! **lon/lat**, build one continuous mesh: coarse nodes **outside** the boundary +
//! detail nodes **inside** it, joined at a **shared boundary ring** so the two
//! resolutions read as a single ground with no gap. The boundary ring is inserted
//! as a triangulation constraint (a breakline, not a clip), so both sides align to
//! it exactly. Output triangles are tagged coarse/detail by centroid, so the
//! client can render — and independently toggle — the detail region.
//!
//! Triangulation runs in a local, roughly-isotropic planar frame (lon scaled by
//! `cos(lat0)`); vertices are emitted **geographic `[lat, lon, h]`** so the client
//! places them with the same `toLocal` as every other layer.

use crate::surface::geom::point_in_polygon;
use crate::surface::geotiff::DecodedDem;
use crate::surface::tin::{triangulate_constrained, Constraint, InputPoint};

/// A composite mesh: geographic vertices `[lat, lon, h]` plus triangles split into
/// the coarse (outside-boundary) and detail (inside-boundary) regions.
#[derive(Debug, Clone)]
pub struct CompositeMesh {
    pub vertices: Vec<[f64; 3]>,
    /// Per-vertex fade alpha (0..1): opaque inside the boundary, dissolving to the
    /// coarse edge so the context tile has no hard silhouette. Index-aligned.
    pub alpha: Vec<f32>,
    pub coarse_tris: Vec<[u32; 3]>,
    pub detail_tris: Vec<[u32; 3]>,
}

/// Target vertex count for the inside-boundary detail region; larger boundaries
/// uniformly decimate to fit (adaptive/slope-aware decimation is a refinement).
const DETAIL_VERTEX_BUDGET: usize = 120_000;

/// Whether a raster sample is real ground (finite, not a ±3.4e38 / declared
/// nodata sentinel). Mirrors `dem::is_valid`.
pub(crate) fn valid(v: f32, nodata: Option<f64>) -> bool {
    let v = v as f64;
    if !v.is_finite() || v.abs() > 1e30 {
        return false;
    }
    match nodata {
        Some(nd) => (v - nd).abs() >= 1e-6,
        None => true,
    }
}

/// The lon/lat of DEM node `(row, col)` — row 0 is the north edge.
fn node_lonlat(dem: &DecodedDem, row: usize, col: usize) -> (f64, f64) {
    (
        dem.origin_x + col as f64 * dem.pixel_x,
        dem.origin_y - row as f64 * dem.pixel_y,
    )
}

/// Bilinear sample of a DEM at `(lon, lat)`; `None` outside the grid or over
/// nodata corners.
pub(crate) fn sample(dem: &DecodedDem, lon: f64, lat: f64) -> Option<f64> {
    if dem.width < 2 || dem.height < 2 || dem.pixel_x == 0.0 || dem.pixel_y == 0.0 {
        return None;
    }
    let (w1, h1) = ((dem.width - 1) as f64, (dem.height - 1) as f64);
    let cf = (lon - dem.origin_x) / dem.pixel_x;
    let rf = (dem.origin_y - lat) / dem.pixel_y;
    // Reject clearly-outside; clamp the tiny float overshoot at the far/near edges
    // (a node landing at exactly width-1 can round just past it).
    const EPS: f64 = 1e-6;
    if cf < -EPS || rf < -EPS || cf > w1 + EPS || rf > h1 + EPS {
        return None;
    }
    let cf = cf.clamp(0.0, w1);
    let rf = rf.clamp(0.0, h1);
    let (c0, r0) = (cf.floor() as usize, rf.floor() as usize);
    let c1 = (c0 + 1).min(dem.width - 1);
    let r1 = (r0 + 1).min(dem.height - 1);
    let (fx, fy) = (cf - c0 as f64, rf - r0 as f64);
    let at = |r: usize, c: usize| -> Option<f64> {
        let v = dem.data[r * dem.width + c];
        valid(v, dem.nodata).then_some(v as f64)
    };
    let (v00, v01, v10, v11) = (at(r0, c0)?, at(r0, c1)?, at(r1, c0)?, at(r1, c1)?);
    let top = v00 + (v01 - v00) * fx;
    let bot = v10 + (v11 - v10) * fx;
    Some(top + (bot - top) * fy)
}

/// Builds the boundary-split composite. `boundary_lonlat` is the ordered property
/// ring as `[lon, lat]` (projected→geographic done by the caller). Errors if the
/// ring is degenerate or nothing triangulates.
pub fn build_composite(
    coarse: &DecodedDem,
    detail: &DecodedDem,
    boundary_lonlat: &[[f64; 2]],
) -> Result<CompositeMesh, String> {
    if boundary_lonlat.len() < 3 {
        return Err("boundary needs at least 3 vertices".into());
    }

    // Isotropic-ish planar frame: scale lon by cos(lat0) so Delaunay isn't skewed.
    let lat0 = boundary_lonlat.iter().map(|p| p[1]).sum::<f64>() / boundary_lonlat.len() as f64;
    let cos0 = (lat0.to_radians()).cos().max(1e-6);
    let to_planar = |lon: f64, lat: f64| [lon * cos0, lat];

    // Boundary ring in planar coords (for PIP tests + the constraint).
    let ring_planar: Vec<[f64; 2]> = boundary_lonlat
        .iter()
        .map(|p| to_planar(p[0], p[1]))
        .collect();

    // Coarse cell size in planar units — drives ring sampling + the max-edge filter.
    let coarse_step = (coarse.pixel_x * cos0).abs().max(coarse.pixel_y.abs());
    if coarse_step == 0.0 {
        return Err("coarse DEM has zero pixel size".into());
    }

    let mut points: Vec<InputPoint> = Vec::new();

    // Coarse nodes OUTSIDE the boundary (context).
    for row in 0..coarse.height {
        for col in 0..coarse.width {
            let v = coarse.data[row * coarse.width + col];
            if !valid(v, coarse.nodata) {
                continue;
            }
            let (lon, lat) = node_lonlat(coarse, row, col);
            let p = to_planar(lon, lat);
            if !point_in_polygon(p, &ring_planar) {
                points.push(InputPoint {
                    e: p[0],
                    n: p[1],
                    z: v as f64,
                });
            }
        }
    }

    // Detail nodes INSIDE the boundary, uniformly strided to the vertex budget.
    let mut inside: Vec<InputPoint> = Vec::with_capacity(1024);
    for row in 0..detail.height {
        for col in 0..detail.width {
            let v = detail.data[row * detail.width + col];
            if !valid(v, detail.nodata) {
                continue;
            }
            let (lon, lat) = node_lonlat(detail, row, col);
            let p = to_planar(lon, lat);
            if point_in_polygon(p, &ring_planar) {
                inside.push(InputPoint {
                    e: p[0],
                    n: p[1],
                    z: v as f64,
                });
            }
        }
    }
    let stride = (inside.len() / DETAIL_VERTEX_BUDGET).max(1);
    points.extend(inside.iter().step_by(stride).copied());

    // Shared boundary ring: subdivide each edge to ~coarse-cell spacing, z sampled
    // from the detail DEM (fall back to coarse) so both sides meet at one elevation.
    let mut ring_verts: Vec<InputPoint> = Vec::new();
    let n = boundary_lonlat.len();
    for i in 0..n {
        let a = boundary_lonlat[i];
        let b = boundary_lonlat[(i + 1) % n];
        let ap = to_planar(a[0], a[1]);
        let bp = to_planar(b[0], b[1]);
        let seg = ((bp[0] - ap[0]).powi(2) + (bp[1] - ap[1]).powi(2)).sqrt();
        let steps = ((seg / coarse_step).ceil() as usize).max(1);
        // Emit the start vertex + interior subdivisions (next segment emits its start).
        for s in 0..steps {
            let t = s as f64 / steps as f64;
            let lon = a[0] + (b[0] - a[0]) * t;
            let lat = a[1] + (b[1] - a[1]) * t;
            let z = sample(detail, lon, lat)
                .or_else(|| sample(coarse, lon, lat))
                .unwrap_or(0.0);
            let p = to_planar(lon, lat);
            ring_verts.push(InputPoint {
                e: p[0],
                n: p[1],
                z,
            });
        }
    }
    points.extend(ring_verts.iter().copied());

    if points.len() < 3 {
        return Err("no valid DEM samples inside/around the boundary".into());
    }

    // Ring as a closed breakline (constraint edges, NOT a clip): forces the mesh to
    // align to the boundary so coarse + detail share it.
    let ring_constraint = Constraint {
        verts: ring_verts,
        closed: true,
    };
    let max_edge = coarse_step * 4.0;
    let mesh = triangulate_constrained(&points, &[ring_constraint], None, &[], Some(max_edge))?;

    // Classify each triangle by centroid: inside boundary → detail, else coarse.
    // Emit geographic [lat, lon, h] (planar → lon = x/cos0, lat = y).
    let vertices: Vec<[f64; 3]> = mesh
        .vertices
        .iter()
        .map(|v| [v[1], v[0] / cos0, v[2]])
        .collect();
    let mut coarse_tris = Vec::new();
    let mut detail_tris = Vec::new();
    for tri in &mesh.indices {
        let c = tri_centroid_planar(&mesh.vertices, tri);
        if point_in_polygon(c, &ring_planar) {
            detail_tris.push(*tri);
        } else {
            coarse_tris.push(*tri);
        }
    }

    // Boundary-aware fade alpha: fully opaque inside the boundary (and a margin
    // outside it), then fading to transparent across the coarse surround — so the
    // property reads crisp while the context tile dissolves into the background
    // with no hard edge. Distance is measured to the boundary ring (planar → m).
    let dist_m: Vec<f64> = mesh
        .vertices
        .iter()
        .map(|v| {
            let p = [v[0], v[1]];
            if point_in_polygon(p, &ring_planar) {
                0.0
            } else {
                dist_point_to_ring(p, &ring_planar) * M_PER_PLANAR_UNIT
            }
        })
        .collect();
    let max_dist = dist_m.iter().cloned().fold(0.0_f64, f64::max);
    let band = (max_dist - FADE_MARGIN_M) * FADE_BAND_FRAC;
    let alpha: Vec<f32> = dist_m
        .iter()
        .map(|&d| {
            if band <= 0.0 {
                1.0
            } else {
                (1.0 - smoothstep((d - FADE_MARGIN_M) / band)) as f32
            }
        })
        .collect();

    Ok(CompositeMesh {
        vertices,
        alpha,
        coarse_tris,
        detail_tris,
    })
}

/// Meters per planar unit: planar coords are degrees (`y = lat`, `x = lon·cos lat0`),
/// so both axes are ~degrees-of-latitude → × this ≈ meters.
const M_PER_PLANAR_UNIT: f64 = 111_320.0;
/// Opaque band (meters) just outside the boundary before the fade begins.
const FADE_MARGIN_M: f64 = 10.0;
/// Fraction of the outside span over which alpha ramps to 0 (0 beyond it).
const FADE_BAND_FRAC: f64 = 0.6;

/// Hermite smoothstep on a clamped `t`.
fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Distance from `p` to the nearest edge of the closed ring (planar units).
fn dist_point_to_ring(p: [f64; 2], ring: &[[f64; 2]]) -> f64 {
    let n = ring.len();
    (0..n).fold(f64::INFINITY, |best, i| {
        best.min(dist_point_to_seg(p, ring[i], ring[(i + 1) % n]))
    })
}

/// Distance from `p` to segment `a→b`.
fn dist_point_to_seg(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    };
    let (cx, cy) = (a[0] + t * dx, a[1] + t * dy);
    ((p[0] - cx).powi(2) + (p[1] - cy).powi(2)).sqrt()
}

/// Planar centroid `[x, y]` of a triangle (planar mesh vertices are `[x, y, z]`).
fn tri_centroid_planar(verts: &[[f64; 3]], tri: &[u32; 3]) -> [f64; 2] {
    let (a, b, c) = (
        verts[tri[0] as usize],
        verts[tri[1] as usize],
        verts[tri[2] as usize],
    );
    [(a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// A flat DEM covering `[lon0, lon0+span] × [lat0, lat0+span]` at `n×n` nodes,
    /// every cell = `z`.
    fn flat_dem(lon0: f64, lat0: f64, span: f64, n: usize, z: f32) -> DecodedDem {
        let pixel = span / (n - 1) as f64;
        DecodedDem {
            width: n,
            height: n,
            origin_x: lon0,
            origin_y: lat0 + span, // row 0 = north edge
            pixel_x: pixel,
            pixel_y: pixel,
            epsg: Some(4326),
            nodata: Some(-9999.0),
            data: vec![z; n * n],
        }
    }

    #[test]
    fn composite_splits_coarse_outside_and_detail_inside_sharing_the_ring() {
        // Coarse over a 0.02° tile @ z=10; detail over the inner 0.01° @ z=12.
        let coarse = flat_dem(-74.01, 40.0, 0.02, 5, 10.0);
        let detail = flat_dem(-74.005, 40.005, 0.01, 11, 12.0);
        // A square boundary well inside the detail extent (lon/lat).
        let boundary = [
            [-74.004, 40.006],
            [-73.996, 40.006],
            [-73.996, 40.014],
            [-74.004, 40.014],
        ];

        let m = build_composite(&coarse, &detail, &boundary).unwrap();

        assert!(
            !m.coarse_tris.is_empty(),
            "expected coarse (outside) triangles"
        );
        assert!(
            !m.detail_tris.is_empty(),
            "expected detail (inside) triangles"
        );

        // Vertices stay geographic [lat, lon, h] within the coarse tile bounds.
        for v in &m.vertices {
            assert!((40.0..=40.02).contains(&v[0]), "lat {} out of range", v[0]);
            assert!(
                (-74.01..=-73.99).contains(&v[1]),
                "lon {} out of range",
                v[1]
            );
            assert!(v[2].is_finite());
        }

        // Both elevations survive (coarse 10 outside, detail/ring 12 inside).
        let has = |z: f64| m.vertices.iter().any(|v| (v[2] - z).abs() < 1e-6);
        assert!(has(10.0) && has(12.0), "both DEM elevations should appear");

        // Watertight: the two regions must SHARE ring vertices (one connected mesh,
        // not two floating meshes with a gap).
        let cset: HashSet<u32> = m.coarse_tris.iter().flatten().copied().collect();
        let dset: HashSet<u32> = m.detail_tris.iter().flatten().copied().collect();
        assert!(
            cset.intersection(&dset).count() > 0,
            "coarse + detail regions must share boundary-ring vertices"
        );

        // Boundary-aware fade: alpha is per-vertex; vertices inside the boundary are
        // fully opaque, and at least one coarse (outside) vertex fades.
        assert_eq!(m.alpha.len(), m.vertices.len());
        for (v, &a) in m.vertices.iter().zip(&m.alpha) {
            // v is geographic [lat, lon, h]; inside the boundary lon/lat ring → opaque.
            let inside = crate::surface::geom::point_in_polygon([v[1], v[0]], &boundary);
            if inside {
                assert!(a > 0.99, "inside-boundary vertex must be opaque, got {a}");
            }
        }
        assert!(
            m.alpha.iter().any(|&a| a < 0.5),
            "the coarse surround should fade toward transparent"
        );
    }

    #[test]
    fn rejects_degenerate_boundary() {
        let coarse = flat_dem(-74.01, 40.0, 0.02, 5, 10.0);
        let detail = flat_dem(-74.005, 40.005, 0.01, 11, 12.0);
        assert!(build_composite(&coarse, &detail, &[[-74.0, 40.0], [-73.99, 40.0]]).is_err());
    }
}
