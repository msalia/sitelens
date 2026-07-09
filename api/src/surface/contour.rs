//! Contour (iso-line) extraction from a triangulated surface.
//!
//! Marching-triangles: every contour level between a triangle's min and max
//! vertex elevation cuts it into exactly one segment. Each crossing is keyed by
//! the mesh **edge** it lies on — two triangles sharing an edge interpolate the
//! *same* crossing point there, so the keys match exactly and segments chain into
//! continuous polylines with no floating-point endpoint matching.
//!
//! Coordinates pass through verbatim: the input vertex's first two components are
//! the horizontal plane, the third is elevation. The caller may pass projected
//! meters (unit tests) or geographic lat/lon (production) — interpolation is
//! linear either way and lands exactly on the rendered mesh edges.

use std::collections::HashMap;

/// One iso-elevation's extracted contours.
#[derive(Debug, Clone, PartialEq)]
pub struct ContourLevel {
    /// Iso elevation, in the input's z unit (meters in production).
    pub level: f64,
    /// A major (labeled, heavier-drawn) contour vs. a minor one.
    pub is_major: bool,
    /// Contour polylines at this level; each is a run of horizontal `[x, y]`
    /// points (the elevation of every point is `level`). A closed loop repeats
    /// its first point as its last.
    pub polylines: Vec<Vec<[f64; 2]>>,
}

/// Options for [`contours`].
pub struct ContourOptions {
    /// Minor interval between contours (must be finite and > 0).
    pub interval: f64,
    /// Major interval — levels at a multiple of this are flagged `is_major`.
    /// Should be a multiple of `interval`; `None` → every 5th minor.
    pub major_interval: Option<f64>,
    /// Chaikin smoothing passes (0 = polylines follow the triangle edges exactly).
    pub smoothing: u32,
}

/// Hard cap on the number of levels, so a tiny interval over a large range can't
/// blow up compute / payload — surfaced as an error instead.
const MAX_LEVELS: usize = 2000;
/// Chaikin passes are capped — 3 is already visually smooth.
const MAX_SMOOTHING: u32 = 3;

/// Extracts contour polylines from an indexed triangle mesh at every level that
/// is a multiple of `interval` and falls strictly inside the elevation range.
///
/// Returns `Ok(empty)` for an empty mesh or a flat/degenerate elevation range,
/// and `Err` for a non-positive interval or an interval so fine it would exceed
/// [`MAX_LEVELS`].
pub fn contours(
    vertices: &[[f64; 3]],
    indices: &[[u32; 3]],
    opts: &ContourOptions,
) -> Result<Vec<ContourLevel>, String> {
    if !opts.interval.is_finite() || opts.interval <= 0.0 {
        return Err("contour interval must be a positive number".into());
    }
    if vertices.is_empty() || indices.is_empty() {
        return Ok(Vec::new());
    }

    let (mut zmin, mut zmax) = (f64::INFINITY, f64::NEG_INFINITY);
    for v in vertices {
        zmin = zmin.min(v[2]);
        zmax = zmax.max(v[2]);
    }
    if !zmin.is_finite() || !zmax.is_finite() || zmax <= zmin {
        return Ok(Vec::new()); // flat or degenerate → nothing to contour
    }

    let interval = opts.interval;
    let major = opts
        .major_interval
        .filter(|m| m.is_finite() && *m > 0.0)
        .unwrap_or(interval * 5.0);

    // Levels at k * interval strictly inside (zmin, zmax).
    let k0 = (zmin / interval).floor() as i64 + 1;
    let k1 = (zmax / interval).ceil() as i64 - 1;
    if k1 < k0 {
        return Ok(Vec::new());
    }
    if (k1 - k0 + 1) as usize > MAX_LEVELS {
        return Err(format!(
            "contour interval {interval} is too fine for this surface's elevation \
             range ({:.2}) — increase the interval",
            zmax - zmin
        ));
    }

    let smoothing = opts.smoothing.min(MAX_SMOOTHING);
    let mut out = Vec::new();
    for k in k0..=k1 {
        let level = k as f64 * interval;
        let mut polylines = extract_level(vertices, indices, level);
        if smoothing > 0 {
            for pl in &mut polylines {
                *pl = chaikin(pl, smoothing);
            }
        }
        if !polylines.is_empty() {
            out.push(ContourLevel {
                level,
                is_major: is_multiple(level, major),
                polylines,
            });
        }
    }
    Ok(out)
}

/// Whether `level` is (numerically) a multiple of `base`.
fn is_multiple(level: f64, base: f64) -> bool {
    if base <= 0.0 {
        return false;
    }
    let r = level / base;
    (r - r.round()).abs() < 1e-6
}

/// The horizontal crossing point on edge `a→b` at `level` (linear in z).
fn interp(vertices: &[[f64; 3]], a: u32, b: u32, level: f64) -> [f64; 2] {
    let pa = vertices[a as usize];
    let pb = vertices[b as usize];
    let denom = pb[2] - pa[2];
    let t = if denom.abs() < f64::EPSILON {
        0.0
    } else {
        ((level - pa[2]) / denom).clamp(0.0, 1.0)
    };
    [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
}

/// Undirected edge key (smaller index first) so both triangles sharing an edge
/// produce the same key.
fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

/// Marching-triangles for a single level: collect per-triangle segments (keyed by
/// crossed edge) and chain them into polylines.
fn extract_level(vertices: &[[f64; 3]], indices: &[[u32; 3]], level: f64) -> Vec<Vec<[f64; 2]>> {
    // A vertex counts as "above" only when strictly above; a vertex exactly on
    // the level is treated as below, consistently everywhere it appears, which
    // keeps shared edges classified identically across both incident triangles.
    let above = |i: u32| vertices[i as usize][2] > level;

    let mut points: HashMap<(u32, u32), [f64; 2]> = HashMap::new();
    let mut segments: Vec<[(u32, u32); 2]> = Vec::new();

    for tri in indices {
        let vs = [tri[0], tri[1], tri[2]];
        let mut crossed: Vec<(u32, u32)> = Vec::with_capacity(2);
        for e in 0..3 {
            let (a, b) = (vs[e], vs[(e + 1) % 3]);
            if above(a) != above(b) {
                let key = edge_key(a, b);
                points
                    .entry(key)
                    .or_insert_with(|| interp(vertices, a, b, level));
                crossed.push(key);
            }
        }
        // A triangle straddling the level crosses exactly two of its edges.
        if let [p, q] = crossed[..] {
            if p != q {
                segments.push([p, q]);
            }
        }
    }

    assemble(&segments, &points)
}

/// Chains edge-keyed segments into polylines. Interior crossings have degree 2,
/// mesh-boundary crossings degree 1; we start at degree-1 ends first so open
/// chains stay whole, then pick up any remaining loops.
fn assemble(
    segments: &[[(u32, u32); 2]],
    points: &HashMap<(u32, u32), [f64; 2]>,
) -> Vec<Vec<[f64; 2]>> {
    let mut incident: HashMap<(u32, u32), Vec<usize>> = HashMap::new();
    for (i, s) in segments.iter().enumerate() {
        incident.entry(s[0]).or_default().push(i);
        incident.entry(s[1]).or_default().push(i);
    }

    // Deterministic traversal order: open ends (degree 1) first, then the rest.
    let mut order: Vec<(u32, u32)> = incident
        .iter()
        .filter(|(_, v)| v.len() == 1)
        .map(|(k, _)| *k)
        .collect();
    order.sort_unstable();
    let mut rest: Vec<(u32, u32)> = incident.keys().copied().collect();
    rest.sort_unstable();
    order.extend(rest);

    let mut used = vec![false; segments.len()];
    let next_seg = |key: (u32, u32), used: &[bool]| -> Option<usize> {
        incident
            .get(&key)
            .and_then(|v| v.iter().copied().find(|&i| !used[i]))
    };

    let mut polylines = Vec::new();
    for start in order {
        while let Some(first) = next_seg(start, &used) {
            let mut keys = vec![start];
            let mut cur = start;
            let mut si = first;
            loop {
                used[si] = true;
                let s = segments[si];
                cur = if s[0] == cur { s[1] } else { s[0] };
                keys.push(cur);
                match next_seg(cur, &used) {
                    Some(i) => si = i,
                    None => break,
                }
            }
            let pl: Vec<[f64; 2]> = keys.iter().map(|k| points[k]).collect();
            if pl.len() >= 2 {
                polylines.push(pl);
            }
        }
    }
    polylines
}

/// `passes` iterations of Chaikin corner-cutting. Open polylines keep their end
/// points; closed loops (first point repeated at the end) stay closed. Runs of
/// fewer than 3 points are returned unchanged.
fn chaikin(pl: &[[f64; 2]], passes: u32) -> Vec<[f64; 2]> {
    if pl.len() < 3 {
        return pl.to_vec();
    }
    let last = pl[pl.len() - 1];
    let closed = (pl[0][0] - last[0]).abs() < 1e-12 && (pl[0][1] - last[1]).abs() < 1e-12;
    let mut cur = pl.to_vec();
    for _ in 0..passes {
        cur = chaikin_once(&cur, closed);
    }
    cur
}

fn chaikin_once(pl: &[[f64; 2]], closed: bool) -> Vec<[f64; 2]> {
    let cut =
        |p: [f64; 2], q: [f64; 2], t: f64| [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if closed {
        // Operate on the ring (drop the repeated closing point), then re-close.
        let ring = &pl[..pl.len() - 1];
        let m = ring.len();
        let mut out = Vec::with_capacity(m * 2 + 1);
        for i in 0..m {
            let (p, q) = (ring[i], ring[(i + 1) % m]);
            out.push(cut(p, q, 0.25));
            out.push(cut(p, q, 0.75));
        }
        out.push(out[0]);
        out
    } else {
        let n = pl.len();
        let mut out = Vec::with_capacity(n * 2);
        out.push(pl[0]); // preserve the start
        for i in 0..n - 1 {
            let (p, q) = (pl[i], pl[i + 1]);
            out.push(cut(p, q, 0.25));
            out.push(cut(p, q, 0.75));
        }
        out.push(pl[n - 1]); // preserve the end
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::tin::{self, InputPoint};

    fn opts(interval: f64, smoothing: u32) -> ContourOptions {
        ContourOptions {
            interval,
            major_interval: None,
            smoothing,
        }
    }

    /// A `cols × rows` grid whose elevation is a tilted plane `z = x + 0.5`, so
    /// integer contour levels fall *between* grid columns (never on a vertex).
    fn tilted(cols: usize, rows: usize) -> (Vec<[f64; 3]>, Vec<[u32; 3]>) {
        let mut pts = Vec::new();
        for r in 0..rows {
            for c in 0..cols {
                pts.push(InputPoint {
                    e: c as f64,
                    n: r as f64,
                    z: c as f64 + 0.5,
                });
            }
        }
        let mesh = tin::triangulate(&pts).unwrap();
        (mesh.vertices, mesh.indices)
    }

    #[test]
    fn tilted_plane_yields_straight_evenly_spaced_isolines() {
        let (v, i) = tilted(5, 4); // x in 0..4 → z in 0.5..4.5
        let levels = contours(&v, &i, &opts(1.0, 0)).unwrap();
        // Levels 1..4 fall strictly inside (0.5, 4.5).
        let ls: Vec<f64> = levels.iter().map(|l| l.level).collect();
        assert_eq!(ls, vec![1.0, 2.0, 3.0, 4.0]);

        for lv in &levels {
            let expected_x = lv.level - 0.5; // z = x + 0.5  ⇒  x = level - 0.5
            let mut ys = Vec::new();
            for pl in &lv.polylines {
                for p in pl {
                    assert!(
                        (p[0] - expected_x).abs() < 1e-9,
                        "level {} point off the x={expected_x} iso-line: {p:?}",
                        lv.level
                    );
                    ys.push(p[1]);
                }
            }
            // The iso-line spans the full north extent of the grid.
            let (ymin, ymax) = ys
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &y| {
                    (a.min(y), b.max(y))
                });
            assert!(
                (ymin - 0.0).abs() < 1e-9 && (ymax - 3.0).abs() < 1e-9,
                "y span {ymin}..{ymax}"
            );
        }
    }

    #[test]
    fn major_interval_flags_the_right_levels() {
        let (v, i) = tilted(6, 3); // z in 0.5..5.5 → levels 1..5
        let levels = contours(
            &v,
            &i,
            &ContourOptions {
                interval: 1.0,
                major_interval: Some(2.0),
                smoothing: 0,
            },
        )
        .unwrap();
        for lv in &levels {
            let want = (lv.level as i64) % 2 == 0;
            assert_eq!(lv.is_major, want, "level {} majorness", lv.level);
        }
        assert!(
            levels.iter().any(|l| l.is_major),
            "expected some major levels"
        );
    }

    #[test]
    fn smoothing_preserves_endpoints_and_grows_detail() {
        let (v, i) = tilted(5, 4);
        let raw = contours(&v, &i, &opts(1.0, 0)).unwrap();
        let smooth = contours(&v, &i, &opts(1.0, 2)).unwrap();
        assert_eq!(raw.len(), smooth.len());
        for (r, s) in raw.iter().zip(&smooth) {
            let rp = &r.polylines[0];
            let sp = &s.polylines[0];
            assert!(sp.len() >= rp.len(), "smoothing should add points");
            // Open iso-line endpoints are preserved exactly.
            assert!((rp[0][1] - sp[0][1]).abs() < 1e-9);
            assert!((rp[rp.len() - 1][1] - sp[sp.len() - 1][1]).abs() < 1e-9);
            // Smoothed points stay on the same vertical iso-line (topology kept).
            for p in sp {
                assert!((p[0] - rp[0][0]).abs() < 1e-6);
            }
        }
    }

    #[test]
    fn closed_contour_stays_closed_after_smoothing() {
        // A cone: a center peak ringed by a lower square → a closed iso-loop.
        let pts = vec![
            InputPoint {
                e: 0.0,
                n: 0.0,
                z: 0.0,
            },
            InputPoint {
                e: 10.0,
                n: 0.0,
                z: 0.0,
            },
            InputPoint {
                e: 10.0,
                n: 10.0,
                z: 0.0,
            },
            InputPoint {
                e: 0.0,
                n: 10.0,
                z: 0.0,
            },
            InputPoint {
                e: 5.0,
                n: 5.0,
                z: 10.0,
            },
        ];
        let mesh = tin::triangulate(&pts).unwrap();
        let levels = contours(&mesh.vertices, &mesh.indices, &opts(5.0, 2)).unwrap();
        let loop_level = levels
            .iter()
            .find(|l| (l.level - 5.0).abs() < 1e-9)
            .unwrap();
        let pl = &loop_level.polylines[0];
        let first = pl[0];
        let last = pl[pl.len() - 1];
        assert!(
            (first[0] - last[0]).abs() < 1e-9 && (first[1] - last[1]).abs() < 1e-9,
            "expected a closed loop, got {first:?}..{last:?}"
        );
    }

    #[test]
    fn flat_surface_has_no_contours() {
        let pts = vec![
            InputPoint {
                e: 0.0,
                n: 0.0,
                z: 5.0,
            },
            InputPoint {
                e: 1.0,
                n: 0.0,
                z: 5.0,
            },
            InputPoint {
                e: 0.0,
                n: 1.0,
                z: 5.0,
            },
        ];
        let mesh = tin::triangulate(&pts).unwrap();
        let levels = contours(&mesh.vertices, &mesh.indices, &opts(1.0, 0)).unwrap();
        assert!(levels.is_empty());
    }

    #[test]
    fn non_positive_interval_is_an_error() {
        let (v, i) = tilted(3, 3);
        assert!(contours(&v, &i, &opts(0.0, 0)).is_err());
        assert!(contours(&v, &i, &opts(-1.0, 0)).is_err());
    }

    #[test]
    fn too_fine_an_interval_is_rejected() {
        let (v, i) = tilted(5, 4);
        let err = contours(&v, &i, &opts(1e-6, 0)).unwrap_err();
        assert!(err.contains("too fine"), "got: {err}");
    }
}
