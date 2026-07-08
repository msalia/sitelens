//! Pure triangulation: survey points (projected meters) → an indexed mesh.
//! Phase 2 adds **constrained** Delaunay — breaklines, boundary, and holes are
//! inserted as constraint edges (so mesh edges follow them); boundary + holes
//! also clip the result (centroid inside boundary, outside every hole), plus an
//! optional max-edge-length filter.
//!
//! Output positions stay in the canonical projected frame `(e, n, z)`; the
//! resolver converts them to geographic before serializing the render blob.

use spade::{ConstrainedDelaunayTriangulation, HasPosition, Point2, Triangulation};

use super::geom;

/// One input vertex in projected meters.
#[derive(Clone, Copy, Debug)]
pub struct InputPoint {
    pub e: f64,
    pub n: f64,
    pub z: f64,
}

/// A constraint polyline (breakline / boundary / hole) whose vertices already
/// carry resolved elevations (the resolver z-fills any missing z before this).
#[derive(Clone, Debug)]
pub struct Constraint {
    pub verts: Vec<InputPoint>,
    pub closed: bool,
}

impl Constraint {
    fn ring2d(&self) -> Vec<[f64; 2]> {
        self.verts.iter().map(|p| [p.e, p.n]).collect()
    }
}

/// A vertex carried through the triangulation: 2D position drives Delaunay, `z`
/// rides along so the output mesh keeps elevation.
struct Vtx {
    pos: Point2<f64>,
    z: f64,
}

impl HasPosition for Vtx {
    type Scalar = f64;
    fn position(&self) -> Point2<f64> {
        self.pos
    }
}

/// An indexed triangle mesh in projected meters.
#[derive(Debug, Clone, PartialEq)]
pub struct TinMesh {
    /// Vertex positions `(e, n, z)`, meters. Index-aligned with `indices`.
    pub vertices: Vec<[f64; 3]>,
    /// CCW triangles, each three indices into `vertices`.
    pub indices: Vec<[u32; 3]>,
}

type Cdt = ConstrainedDelaunayTriangulation<Vtx>;

/// Builds a bare-point Delaunay TIN — the no-constraint path (a CDT with no
/// constraint edges is a Delaunay triangulation).
pub fn triangulate(points: &[InputPoint]) -> Result<TinMesh, String> {
    triangulate_constrained(points, &[], None, &[], None)
}

/// Inserts a point, returning its handle. Rejects non-finite coordinates.
fn insert_point(
    cdt: &mut Cdt,
    p: &InputPoint,
) -> Result<spade::handles::FixedVertexHandle, String> {
    if !(p.e.is_finite() && p.n.is_finite() && p.z.is_finite()) {
        return Err("a point has a non-finite coordinate".into());
    }
    cdt.insert(Vtx {
        pos: Point2::new(p.e, p.n),
        z: p.z,
    })
    .map_err(|err| format!("could not triangulate points: {err:?}"))
}

/// Adds a polyline's segments as CDT constraint edges. Crossing constraints are
/// skipped (via `can_add_constraint`) rather than panicking.
fn add_constraint_polyline(cdt: &mut Cdt, c: &Constraint) -> Result<(), String> {
    let n = c.verts.len();
    if n < 2 {
        return Ok(());
    }
    let mut handles = Vec::with_capacity(n);
    for p in &c.verts {
        handles.push(insert_point(cdt, p)?);
    }
    let seg_count = if c.closed { n } else { n - 1 };
    for i in 0..seg_count {
        let (a, b) = (handles[i], handles[(i + 1) % n]);
        if a != b && cdt.can_add_constraint(a, b) {
            cdt.add_constraint(a, b);
        }
    }
    Ok(())
}

/// Remaps an original vertex index into the compacted output buffer (only
/// triangle-referenced vertices survive clipping).
fn remap_vertex(i: usize, all: &[[f64; 3]], remap: &mut [u32], out: &mut Vec<[f64; 3]>) -> u32 {
    if remap[i] == u32::MAX {
        remap[i] = out.len() as u32;
        out.push(all[i]);
    }
    remap[i]
}

/// Constrained Delaunay TIN. `breaklines` are hard edges; `boundary` (if given)
/// and `holes` are inserted as edges *and* clip the mesh by triangle centroid;
/// `max_edge_length` drops long sliver triangles.
pub fn triangulate_constrained(
    points: &[InputPoint],
    breaklines: &[Constraint],
    boundary: Option<&Constraint>,
    holes: &[Constraint],
    max_edge_length: Option<f64>,
) -> Result<TinMesh, String> {
    if points.len() < 3 {
        return Err(format!(
            "a surface needs at least 3 points (got {})",
            points.len()
        ));
    }

    // Reject any self-intersecting constraint polyline up front.
    let validate = |c: &Constraint, what: &str| -> Result<(), String> {
        if geom::polyline_self_intersects(&c.ring2d(), c.closed) {
            return Err(format!("{what} self-intersects"));
        }
        Ok(())
    };
    for b in breaklines {
        validate(b, "a breakline")?;
    }
    if let Some(b) = boundary {
        validate(b, "the boundary")?;
    }
    for h in holes {
        validate(h, "a hole")?;
    }

    let mut cdt: Cdt = ConstrainedDelaunayTriangulation::new();
    for p in points {
        insert_point(&mut cdt, p)?;
    }
    for b in breaklines {
        add_constraint_polyline(&mut cdt, b)?;
    }
    if let Some(b) = boundary {
        add_constraint_polyline(&mut cdt, b)?;
    }
    for h in holes {
        add_constraint_polyline(&mut cdt, h)?;
    }

    // All CDT vertices (contiguous fixed indices, insert-only → no removals).
    let mut all = vec![[0.0_f64; 3]; cdt.num_vertices()];
    for v in cdt.vertices() {
        let pos = v.position();
        all[v.fix().index()] = [pos.x, pos.y, v.data().z];
    }

    let boundary_ring = boundary.map(|c| c.ring2d());
    let hole_rings: Vec<Vec<[f64; 2]>> = holes.iter().map(|c| c.ring2d()).collect();
    let edge = |a: usize, b: usize| -> f64 {
        let (dx, dy) = (all[a][0] - all[b][0], all[a][1] - all[b][1]);
        (dx * dx + dy * dy).sqrt()
    };

    let mut remap = vec![u32::MAX; all.len()];
    let mut vertices: Vec<[f64; 3]> = Vec::new();
    let mut indices: Vec<[u32; 3]> = Vec::new();
    for f in cdt.inner_faces() {
        let [ha, hb, hc] = f.vertices();
        let (ia, ib, ic) = (ha.fix().index(), hb.fix().index(), hc.fix().index());

        if let Some(mx) = max_edge_length {
            if edge(ia, ib) > mx || edge(ib, ic) > mx || edge(ic, ia) > mx {
                continue;
            }
        }
        let cx = (all[ia][0] + all[ib][0] + all[ic][0]) / 3.0;
        let cy = (all[ia][1] + all[ib][1] + all[ic][1]) / 3.0;
        if let Some(ref ring) = boundary_ring {
            if !geom::point_in_polygon([cx, cy], ring) {
                continue;
            }
        }
        if hole_rings
            .iter()
            .any(|h| geom::point_in_polygon([cx, cy], h))
        {
            continue;
        }

        indices.push([
            remap_vertex(ia, &all, &mut remap, &mut vertices),
            remap_vertex(ib, &all, &mut remap, &mut vertices),
            remap_vertex(ic, &all, &mut remap, &mut vertices),
        ]);
    }

    if indices.is_empty() {
        let clipped = boundary.is_some() || !holes.is_empty() || max_edge_length.is_some();
        return Err(if clipped {
            "no triangles remained after applying the boundary / holes / max-edge filter".into()
        } else {
            "points are collinear or coincident — no surface could be triangulated".into()
        });
    }

    Ok(TinMesh { vertices, indices })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(e: f64, n: f64, z: f64) -> InputPoint {
        InputPoint { e, n, z }
    }

    /// Whether two coordinates form an edge of some output triangle.
    fn has_edge(mesh: &TinMesh, p: [f64; 2], q: [f64; 2]) -> bool {
        let find = |t: [f64; 2]| {
            mesh.vertices
                .iter()
                .position(|v| (v[0] - t[0]).abs() < 1e-9 && (v[1] - t[1]).abs() < 1e-9)
                .map(|i| i as u32)
        };
        let (pi, qi) = match (find(p), find(q)) {
            (Some(a), Some(b)) => (a, b),
            _ => return false,
        };
        mesh.indices
            .iter()
            .any(|tri| tri.contains(&pi) && tri.contains(&qi))
    }

    fn grid(cols: usize, rows: usize) -> Vec<InputPoint> {
        let mut v = Vec::new();
        for r in 0..rows {
            for c in 0..cols {
                v.push(pt(c as f64, r as f64, (r + c) as f64));
            }
        }
        v
    }

    #[test]
    fn unit_square_makes_two_triangles() {
        let mesh = triangulate(&[
            pt(0.0, 0.0, 0.0),
            pt(1.0, 0.0, 0.0),
            pt(1.0, 1.0, 1.0),
            pt(0.0, 1.0, 1.0),
        ])
        .unwrap();
        assert_eq!(mesh.vertices.len(), 4);
        assert_eq!(mesh.indices.len(), 2);
    }

    #[test]
    fn regular_grid_triangulates_every_cell() {
        let mesh = triangulate(&grid(3, 3)).unwrap();
        assert_eq!(mesh.vertices.len(), 9);
        assert_eq!(mesh.indices.len(), 8);
    }

    #[test]
    fn coincident_points_are_deduped() {
        let mesh = triangulate(&[
            pt(0.0, 0.0, 0.0),
            pt(1.0, 0.0, 0.0),
            pt(0.0, 1.0, 0.0),
            pt(0.0, 0.0, 0.0),
        ])
        .unwrap();
        assert_eq!(mesh.vertices.len(), 3);
        assert_eq!(mesh.indices.len(), 1);
    }

    #[test]
    fn too_few_points_is_an_error() {
        assert!(triangulate(&[pt(0.0, 0.0, 0.0), pt(1.0, 1.0, 0.0)]).is_err());
    }

    #[test]
    fn collinear_points_are_an_error() {
        let err = triangulate(&[
            pt(0.0, 0.0, 0.0),
            pt(1.0, 1.0, 0.0),
            pt(2.0, 2.0, 0.0),
            pt(3.0, 3.0, 0.0),
        ])
        .unwrap_err();
        assert!(err.contains("collinear"));
    }

    #[test]
    fn breakline_edge_is_honored() {
        // A near-square quad whose natural Delaunay diagonal is B–D; forcing the
        // A–C diagonal as a breakline must make A–C an edge of the output.
        let a = pt(0.0, 0.0, 0.0);
        let b = pt(1.0, 0.0, 0.0);
        let c = pt(1.1, 1.0, 0.0);
        let d = pt(0.0, 1.0, 0.0);
        let brk = Constraint {
            verts: vec![a, c],
            closed: false,
        };
        let mesh = triangulate_constrained(&[a, b, c, d], &[brk], None, &[], None).unwrap();
        assert!(
            has_edge(&mesh, [0.0, 0.0], [1.1, 1.0]),
            "breakline diagonal A–C not present in the triangulation"
        );
    }

    #[test]
    fn boundary_clips_outside_triangles() {
        // 5x5 grid; clip to a central 1..3 square → only the inner cells remain.
        let pts = grid(5, 5);
        let boundary = Constraint {
            verts: vec![
                pt(1.0, 1.0, 0.0),
                pt(3.0, 1.0, 0.0),
                pt(3.0, 3.0, 0.0),
                pt(1.0, 3.0, 0.0),
            ],
            closed: true,
        };
        let full = triangulate(&pts).unwrap();
        let clipped = triangulate_constrained(&pts, &[], Some(&boundary), &[], None).unwrap();
        assert!(clipped.indices.len() < full.indices.len());
        assert_eq!(clipped.indices.len(), 8); // 2x2 cells × 2 triangles
    }

    #[test]
    fn hole_removes_interior_triangles() {
        let pts = grid(5, 5);
        let boundary = Constraint {
            verts: vec![
                pt(0.0, 0.0, 0.0),
                pt(4.0, 0.0, 0.0),
                pt(4.0, 4.0, 0.0),
                pt(0.0, 4.0, 0.0),
            ],
            closed: true,
        };
        let hole = Constraint {
            verts: vec![
                pt(1.0, 1.0, 0.0),
                pt(3.0, 1.0, 0.0),
                pt(3.0, 3.0, 0.0),
                pt(1.0, 3.0, 0.0),
            ],
            closed: true,
        };
        let without = triangulate_constrained(&pts, &[], Some(&boundary), &[], None).unwrap();
        let with_hole = triangulate_constrained(
            &pts,
            &[],
            Some(&boundary),
            std::slice::from_ref(&hole),
            None,
        )
        .unwrap();
        assert!(with_hole.indices.len() < without.indices.len());
    }

    #[test]
    fn max_edge_filter_drops_long_slivers() {
        // A tight cluster plus a far outlier → the long triangles to the outlier
        // are dropped by a small max-edge.
        let mut pts = grid(3, 3);
        pts.push(pt(100.0, 100.0, 0.0));
        let full = triangulate(&pts).unwrap();
        let filtered = triangulate_constrained(&pts, &[], None, &[], Some(2.0)).unwrap();
        assert!(filtered.indices.len() < full.indices.len());
    }

    #[test]
    fn self_intersecting_breakline_is_rejected() {
        let pts = grid(4, 4);
        let bowtie = Constraint {
            verts: vec![
                pt(0.0, 0.0, 0.0),
                pt(3.0, 3.0, 0.0),
                pt(3.0, 0.0, 0.0),
                pt(0.0, 3.0, 0.0),
            ],
            closed: false,
        };
        let err = triangulate_constrained(&pts, &[bowtie], None, &[], None).unwrap_err();
        assert!(err.contains("self-intersect"), "got: {err}");
    }
}
