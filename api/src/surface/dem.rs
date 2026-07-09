//! DEM ingestion: a regular elevation grid (parsed client-side from an uploaded
//! GeoTIFF with geotiff.js, then downsampled and sent here) → a triangulated
//! mesh. Nodes are in the DEM's own CRS; the resolver reprojects the output
//! vertices to geographic before serializing the STIN blob, so a `dem` surface
//! renders + volumes exactly like a point-built TIN.
//!
//! Row 0 of the grid is the **north** edge: node `(row, col)` sits at
//! `(origin_e + col·pixel_x, origin_n − row·pixel_y)`. A grid cell becomes two
//! triangles only when all four corners are valid, so NODATA holes are cut out.

use super::tin::TinMesh;

/// A regular elevation grid to triangulate.
pub struct DemInput {
    pub width: usize,
    pub height: usize,
    pub origin_e: f64,
    pub origin_n: f64,
    pub pixel_x: f64,
    pub pixel_y: f64,
    /// Explicit NODATA sentinel, if the source declares one.
    pub nodata: Option<f64>,
    /// Row-major `width * height` samples (row 0 = north).
    pub values: Vec<f64>,
}

/// Whether a sample is real elevation (finite, not NODATA, not a huge float
/// sentinel — many DEMs use ±3.4e38 / -9999).
fn is_valid(v: f64, nodata: Option<f64>) -> bool {
    if !v.is_finite() || v.abs() > 1e30 {
        return false;
    }
    match nodata {
        Some(nd) if nd.is_finite() => (v - nd).abs() > 1e-6,
        _ => true,
    }
}

/// Triangulates the grid into an indexed mesh (positions in the grid's CRS).
/// Errors if the grid is malformed or has no usable cell.
pub fn grid_to_mesh(g: &DemInput) -> Result<TinMesh, String> {
    if g.width < 2 || g.height < 2 {
        return Err("a DEM needs at least a 2×2 grid".into());
    }
    if !(g.pixel_x > 0.0 && g.pixel_y > 0.0) {
        return Err("DEM pixel size must be positive".into());
    }
    if g.values.len() != g.width * g.height {
        return Err(format!(
            "DEM value count {} does not match {}×{}",
            g.values.len(),
            g.width,
            g.height
        ));
    }

    // One output vertex per valid node, remapped to a compact buffer.
    let mut remap = vec![u32::MAX; g.values.len()];
    let mut vertices: Vec<[f64; 3]> = Vec::new();
    let mut vertex_of = |idx: usize, vertices: &mut Vec<[f64; 3]>| -> Option<u32> {
        if !is_valid(g.values[idx], g.nodata) {
            return None;
        }
        if remap[idx] == u32::MAX {
            let (row, col) = (idx / g.width, idx % g.width);
            let e = g.origin_e + col as f64 * g.pixel_x;
            let n = g.origin_n - row as f64 * g.pixel_y;
            remap[idx] = vertices.len() as u32;
            vertices.push([e, n, g.values[idx]]);
        }
        Some(remap[idx])
    };

    let mut indices: Vec<[u32; 3]> = Vec::new();
    for row in 0..g.height - 1 {
        for col in 0..g.width - 1 {
            let tl = row * g.width + col;
            let tr = tl + 1;
            let bl = tl + g.width;
            let br = bl + 1;
            // Emit the two triangles of the cell only when every corner is data.
            let (Some(vtl), Some(vtr), Some(vbl), Some(vbr)) = (
                vertex_of(tl, &mut vertices),
                vertex_of(tr, &mut vertices),
                vertex_of(bl, &mut vertices),
                vertex_of(br, &mut vertices),
            ) else {
                continue;
            };
            // CCW winding when viewed from above (north up, +z out of ground).
            indices.push([vtl, vbl, vbr]);
            indices.push([vtl, vbr, vtr]);
        }
    }

    if indices.is_empty() {
        return Err("the DEM has no usable data cells".into());
    }
    Ok(TinMesh { vertices, indices })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_grid_triangulates_every_cell() {
        // 3×2 grid → 2 cells → 4 triangles, 6 vertices.
        let g = DemInput {
            width: 3,
            height: 2,
            origin_e: 100.0,
            origin_n: 200.0,
            pixel_x: 10.0,
            pixel_y: 10.0,
            nodata: None,
            values: vec![1.0, 2.0, 3.0, 1.5, 2.5, 3.5],
        };
        let m = grid_to_mesh(&g).unwrap();
        assert_eq!(m.vertices.len(), 6);
        assert_eq!(m.indices.len(), 4);
        // Row 0 = north: node (0,0) at (100, 200); node (1,0) one pixel south.
        assert_eq!(m.vertices[0], [100.0, 200.0, 1.0]);
        assert!(m.vertices.iter().any(|v| v[1] == 190.0));
    }

    #[test]
    fn nodata_cells_are_cut_out() {
        // A 3×3 grid (4 cells → 8 triangles) with a single NODATA corner node.
        // Only the one cell touching that corner is dropped → 6 triangles remain,
        // and the nodata node produces no vertex (8 of 9 nodes used).
        let g = DemInput {
            width: 3,
            height: 3,
            origin_e: 0.0,
            origin_n: 0.0,
            pixel_x: 1.0,
            pixel_y: 1.0,
            nodata: Some(-9999.0),
            values: vec![-9999.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        };
        let m = grid_to_mesh(&g).unwrap();
        assert_eq!(m.indices.len(), 6);
        assert_eq!(m.vertices.len(), 8);
    }

    #[test]
    fn huge_float_sentinels_count_as_nodata() {
        let g = DemInput {
            width: 2,
            height: 2,
            origin_e: 0.0,
            origin_n: 0.0,
            pixel_x: 1.0,
            pixel_y: 1.0,
            nodata: None,
            values: vec![1.0, 2.0, 3.0, -3.4e38],
        };
        // The one cell has a sentinel corner → no triangles.
        assert!(grid_to_mesh(&g).is_err());
    }

    #[test]
    fn malformed_grids_error() {
        let base = |values: Vec<f64>, w: usize, h: usize| DemInput {
            width: w,
            height: h,
            origin_e: 0.0,
            origin_n: 0.0,
            pixel_x: 1.0,
            pixel_y: 1.0,
            nodata: None,
            values,
        };
        assert!(grid_to_mesh(&base(vec![1.0], 1, 1)).is_err()); // too small
        assert!(grid_to_mesh(&base(vec![1.0, 2.0, 3.0], 2, 2)).is_err()); // count mismatch
    }
}
