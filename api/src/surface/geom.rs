//! Small, dependency-free computational geometry for surface constraints:
//! point-in-polygon (boundary/hole clipping), segment intersection (breakline
//! validation), a concave hull (auto-boundary), and nearest-point elevation
//! (z-fill for 2D constraint vertices). Pure functions, unit-tested — mirrors the
//! style of [`crate::utilities::geom`]. All coordinates are projected meters
//! `[easting, northing]` (planar); elevation is carried separately.

use spade::{DelaunayTriangulation, HasPosition, Point2, Triangulation};

/// Ray-casting point-in-polygon. `ring` is an ordered polygon (implicitly closed;
/// the last→first edge is added automatically). Points exactly on the boundary are
/// reported inconsistently (as with any ray cast) — fine for centroid clipping.
pub fn point_in_polygon(pt: [f64; 2], ring: &[[f64; 2]]) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let (x, y) = (pt[0], pt[1]);
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (ring[i][0], ring[i][1]);
        let (xj, yj) = (ring[j][0], ring[j][1]);
        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn orient(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// True if `p` lies on segment `a`–`b` (assumes the three are collinear).
fn on_segment(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> bool {
    p[0] <= a[0].max(b[0])
        && p[0] >= a[0].min(b[0])
        && p[1] <= a[1].max(b[1])
        && p[1] >= a[1].min(b[1])
}

/// Whether segments `a`–`b` and `c`–`d` intersect (including touching endpoints
/// and collinear overlap).
pub fn segments_intersect(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let d1 = orient(c, d, a);
    let d2 = orient(c, d, b);
    let d3 = orient(a, b, c);
    let d4 = orient(a, b, d);
    // Proper crossing: a,b straddle line c-d and vice versa.
    if ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0)) {
        return true;
    }
    // Collinear / touching cases.
    (d1 == 0.0 && on_segment(c, d, a))
        || (d2 == 0.0 && on_segment(c, d, b))
        || (d3 == 0.0 && on_segment(a, b, c))
        || (d4 == 0.0 && on_segment(a, b, d))
}

/// Whether an (open or closed) polyline crosses or touches itself between
/// non-adjacent segments. Adjacent segments legitimately share their joining
/// vertex, so they're skipped; a non-adjacent shared vertex counts as a
/// self-intersection (the polyline revisits a point).
pub fn polyline_self_intersects(verts: &[[f64; 2]], closed: bool) -> bool {
    let n = verts.len();
    if n < 3 {
        return false;
    }
    // Segment i connects verts[i] → verts[i+1] (wrapping when closed).
    let seg_count = if closed { n } else { n - 1 };
    let seg = |i: usize| -> ([f64; 2], [f64; 2]) { (verts[i], verts[(i + 1) % n]) };
    for i in 0..seg_count {
        for k in (i + 1)..seg_count {
            // Skip adjacent segments (share a vertex by construction).
            if k == i + 1 {
                continue;
            }
            if closed && i == 0 && k == seg_count - 1 {
                continue; // last segment is adjacent to the first when closed
            }
            let (a, b) = seg(i);
            let (c, d) = seg(k);
            if segments_intersect(a, b, c, d) {
                return true;
            }
        }
    }
    false
}

/// Elevation of the survey point nearest (in 2D) to `(e, n)`, for filling z on
/// constraint vertices that lack it. `pts` are `(easting, northing, z)`.
pub fn nearest_point_z(pts: &[(f64, f64, f64)], e: f64, n: f64) -> Option<f64> {
    pts.iter()
        .map(|&(pe, pn, pz)| {
            let (de, dn) = (pe - e, pn - n);
            (de * de + dn * dn, pz)
        })
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, z)| z)
}

// --- Convex + concave hull -------------------------------------------------

/// Andrew's monotone-chain convex hull (CCW, no repeated last point). Fewer than
/// three points returns them unchanged.
pub fn convex_hull(points: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut pts: Vec<[f64; 2]> = points.to_vec();
    pts.sort_by(|a, b| {
        a[0].partial_cmp(&b[0])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a[1].partial_cmp(&b[1]).unwrap_or(std::cmp::Ordering::Equal))
    });
    pts.dedup();
    let n = pts.len();
    if n < 3 {
        return pts;
    }
    let mut hull: Vec<[f64; 2]> = Vec::with_capacity(2 * n);
    for &p in &pts {
        while hull.len() >= 2 && orient(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len() + 1;
    for &p in pts.iter().rev() {
        while hull.len() >= lower && orient(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    hull
}

struct HullVtx {
    pos: Point2<f64>,
}
impl HasPosition for HullVtx {
    type Scalar = f64;
    fn position(&self) -> Point2<f64> {
        self.pos
    }
}

/// An **alpha-shape concave hull**: triangulate the points, drop triangles whose
/// longest edge exceeds `alpha_k × median_edge_length`, then stitch the boundary
/// edges (those in exactly one surviving triangle) into a ring. Falls back to the
/// convex hull when the point set is too small or the boundary can't be stitched
/// into a single loop. Returns an open CCW ring (no repeated first point).
pub fn concave_hull(points: &[[f64; 2]], alpha_k: f64) -> Vec<[f64; 2]> {
    if points.len() < 4 {
        return convex_hull(points);
    }
    let mut t: DelaunayTriangulation<HullVtx> = DelaunayTriangulation::new();
    for &p in points {
        if p[0].is_finite() && p[1].is_finite() {
            let _ = t.insert(HullVtx {
                pos: Point2::new(p[0], p[1]),
            });
        }
    }

    // Collect triangles (as vertex indices) and every edge length.
    let verts: Vec<[f64; 2]> = {
        let mut v = vec![[0.0; 2]; t.num_vertices()];
        for h in t.vertices() {
            let p = h.position();
            v[h.fix().index()] = [p.x, p.y];
        }
        v
    };
    let dist = |a: usize, b: usize| -> f64 {
        let (dx, dy) = (verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]);
        (dx * dx + dy * dy).sqrt()
    };
    let tris: Vec<[usize; 3]> = t
        .inner_faces()
        .map(|f| {
            let [a, b, c] = f.vertices();
            [a.fix().index(), b.fix().index(), c.fix().index()]
        })
        .collect();
    if tris.is_empty() {
        return convex_hull(points);
    }
    let mut lengths: Vec<f64> = Vec::new();
    for tri in &tris {
        lengths.push(dist(tri[0], tri[1]));
        lengths.push(dist(tri[1], tri[2]));
        lengths.push(dist(tri[2], tri[0]));
    }
    lengths.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = lengths[lengths.len() / 2];
    let alpha = alpha_k * median;

    // Directed boundary edges of the kept region: a directed edge whose reverse
    // is not itself a kept-triangle edge lies on the boundary. Kept faces are CCW
    // (spade inner_faces), so chaining these yields a CCW loop.
    use std::collections::HashSet;
    let mut directed: HashSet<(usize, usize)> = HashSet::new();
    for tri in &tris {
        let longest = dist(tri[0], tri[1])
            .max(dist(tri[1], tri[2]))
            .max(dist(tri[2], tri[0]));
        if longest > alpha {
            continue;
        }
        for &(a, b) in &[(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
            directed.insert((a, b));
        }
    }
    if directed.is_empty() {
        return convex_hull(points);
    }
    let boundary: Vec<(usize, usize)> = directed
        .iter()
        .filter(|&&(a, b)| !directed.contains(&(b, a)))
        .copied()
        .collect();
    if boundary.is_empty() {
        return convex_hull(points);
    }

    // Chain boundary edges tail→head into a single loop.
    let mut next: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for &(a, b) in &boundary {
        next.insert(a, b);
    }
    let start = boundary[0].0;
    let mut ring: Vec<[f64; 2]> = Vec::with_capacity(boundary.len());
    let mut cur = start;
    for _ in 0..=boundary.len() {
        ring.push(verts[cur]);
        match next.get(&cur) {
            Some(&nxt) if nxt == start => break,
            Some(&nxt) => cur = nxt,
            None => return convex_hull(points), // dangling → not a clean loop
        }
    }
    // A clean single loop visits every boundary edge exactly once.
    if ring.len() != boundary.len() {
        return convex_hull(points);
    }
    ring
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: [[f64; 2]; 4] = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];

    #[test]
    fn pip_inside_and_outside() {
        assert!(point_in_polygon([5.0, 5.0], &SQUARE));
        assert!(!point_in_polygon([15.0, 5.0], &SQUARE));
        assert!(!point_in_polygon([-1.0, 5.0], &SQUARE));
    }

    #[test]
    fn segments_cross_and_miss() {
        assert!(segments_intersect(
            [0.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [10.0, 0.0]
        ));
        assert!(!segments_intersect(
            [0.0, 0.0],
            [1.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0]
        ));
    }

    #[test]
    fn self_intersection_detected() {
        // A bowtie polyline crosses itself.
        let bowtie = [[0.0, 0.0], [10.0, 10.0], [10.0, 0.0], [0.0, 10.0]];
        assert!(polyline_self_intersects(&bowtie, false));
        // A monotone open polyline does not.
        let clean = [[0.0, 0.0], [5.0, 1.0], [10.0, 0.0], [15.0, 2.0]];
        assert!(!polyline_self_intersects(&clean, false));
        // A simple closed square does not self-intersect.
        assert!(!polyline_self_intersects(&SQUARE, true));
    }

    #[test]
    fn nearest_z_picks_closest() {
        let pts = [(0.0, 0.0, 10.0), (10.0, 0.0, 20.0), (0.0, 10.0, 30.0)];
        assert_eq!(nearest_point_z(&pts, 1.0, 1.0), Some(10.0));
        assert_eq!(nearest_point_z(&pts, 9.0, 1.0), Some(20.0));
    }

    #[test]
    fn convex_hull_of_square_with_interior_point() {
        let pts = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [5.0, 5.0],
        ];
        let hull = convex_hull(&pts);
        assert_eq!(hull.len(), 4); // interior point excluded
    }

    #[test]
    fn concave_hull_encloses_all_points() {
        // A dense grid → the concave hull should enclose every point and be a
        // simple (non-self-intersecting) ring.
        let mut pts = Vec::new();
        for r in 0..6 {
            for c in 0..6 {
                pts.push([c as f64, r as f64]);
            }
        }
        let hull = concave_hull(&pts, 2.0);
        assert!(hull.len() >= 4, "hull too small: {}", hull.len());
        assert!(
            !polyline_self_intersects(&hull, true),
            "hull self-intersects"
        );
        // Every input point is inside or on the hull.
        for &p in &pts {
            let inside = point_in_polygon(p, &hull) || hull.contains(&p);
            assert!(inside, "point {p:?} outside concave hull");
        }
    }

    #[test]
    fn concave_hull_falls_back_for_tiny_sets() {
        let pts = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];
        assert_eq!(concave_hull(&pts, 1.5).len(), 3);
    }
}
