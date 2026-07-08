//! Pure triangulation: survey points (projected meters) → an indexed Delaunay
//! mesh. Phase 1 is bare-point Delaunay; breaklines/boundary constraints arrive
//! in Phase 2 (this is where the `spade` constrained-Delaunay path will live).
//!
//! Output positions stay in the canonical projected frame `(e, n, z)`; the
//! resolver converts them to geographic before serializing the render blob.

use spade::{DelaunayTriangulation, HasPosition, Point2, Triangulation};

/// One input vertex in projected meters.
#[derive(Clone, Copy, Debug)]
pub struct InputPoint {
    pub e: f64,
    pub n: f64,
    pub z: f64,
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

/// Builds a Delaunay TIN from projected points. Coincident points are deduped by
/// the triangulator. Fewer than three points, or an all-collinear / all-coincident
/// set (which yields no triangles), is a structured error.
pub fn triangulate(points: &[InputPoint]) -> Result<TinMesh, String> {
    if points.len() < 3 {
        return Err(format!(
            "a surface needs at least 3 points (got {})",
            points.len()
        ));
    }

    let mut t: DelaunayTriangulation<Vtx> = DelaunayTriangulation::new();
    for p in points {
        if !(p.e.is_finite() && p.n.is_finite() && p.z.is_finite()) {
            return Err("a point has a non-finite coordinate".into());
        }
        t.insert(Vtx {
            pos: Point2::new(p.e, p.n),
            z: p.z,
        })
        .map_err(|err| format!("could not triangulate points: {err:?}"))?;
    }

    // Fixed vertex indices are contiguous 0..num_vertices after insert-only use
    // (no removals), so they index the buffer directly.
    let mut vertices = vec![[0.0_f64; 3]; t.num_vertices()];
    for v in t.vertices() {
        let pos = v.position();
        vertices[v.fix().index()] = [pos.x, pos.y, v.data().z];
    }

    let mut indices = Vec::new();
    for f in t.inner_faces() {
        let [a, b, c] = f.vertices();
        indices.push([
            a.fix().index() as u32,
            b.fix().index() as u32,
            c.fix().index() as u32,
        ]);
    }

    if indices.is_empty() {
        return Err("points are collinear or coincident — no surface could be triangulated".into());
    }

    Ok(TinMesh { vertices, indices })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(e: f64, n: f64, z: f64) -> InputPoint {
        InputPoint { e, n, z }
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
        // Every index is in range and each triangle is non-degenerate.
        for tri in &mesh.indices {
            for &i in tri {
                assert!((i as usize) < mesh.vertices.len());
            }
            assert!(tri[0] != tri[1] && tri[1] != tri[2] && tri[0] != tri[2]);
        }
    }

    #[test]
    fn regular_grid_triangulates_every_cell() {
        // 3x3 grid -> 4 cells -> 8 triangles, 9 vertices.
        let mut pts = Vec::new();
        for r in 0..3 {
            for c in 0..3 {
                pts.push(pt(c as f64, r as f64, (r + c) as f64));
            }
        }
        let mesh = triangulate(&pts).unwrap();
        assert_eq!(mesh.vertices.len(), 9);
        assert_eq!(mesh.indices.len(), 8);
    }

    #[test]
    fn coincident_points_are_deduped() {
        let mesh = triangulate(&[
            pt(0.0, 0.0, 0.0),
            pt(1.0, 0.0, 0.0),
            pt(0.0, 1.0, 0.0),
            pt(0.0, 0.0, 0.0), // duplicate of the first
        ])
        .unwrap();
        assert_eq!(mesh.vertices.len(), 3);
        assert_eq!(mesh.indices.len(), 1);
    }

    #[test]
    fn preserves_elevation_on_vertices() {
        let mesh =
            triangulate(&[pt(0.0, 0.0, 10.0), pt(5.0, 0.0, 20.0), pt(0.0, 5.0, 30.0)]).unwrap();
        let zs: Vec<f64> = mesh.vertices.iter().map(|v| v[2]).collect();
        for expected in [10.0, 20.0, 30.0] {
            assert!(zs.contains(&expected), "missing elevation {expected}");
        }
    }

    #[test]
    fn too_few_points_is_an_error() {
        assert!(triangulate(&[pt(0.0, 0.0, 0.0), pt(1.0, 1.0, 0.0)]).is_err());
        assert!(triangulate(&[]).is_err());
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
    fn non_finite_coordinate_is_an_error() {
        assert!(
            triangulate(&[pt(0.0, 0.0, 0.0), pt(1.0, 0.0, 0.0), pt(0.0, f64::NAN, 0.0),]).is_err()
        );
    }
}
