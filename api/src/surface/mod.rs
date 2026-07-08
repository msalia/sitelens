//! Surface modeling: server-side geometry for TIN surfaces (contours + volumes
//! land in later phases). `tin` holds the pure triangulation; this module owns
//! the render-blob wire format the client decodes into a `BufferGeometry`.
//!
//! ## STIN mesh blob (little-endian)
//!
//! Vertices are **geographic** (lat, lon, height-meters) so the client can place
//! them with the same `toLocal` transform the point/terrain layers use — the mesh
//! then registers exactly on the rendered survey points.
//!
//! ```text
//! offset  bytes  field
//! 0       4      magic "STIN"
//! 4       4      version (u32)
//! 8       4      vertex_count V (u32)
//! 12      4      triangle_count T (u32)
//! 16      48     bbox: min_lat, min_lon, min_h, max_lat, max_lon, max_h (6 x f64)
//! 64      V*24   vertices: [lat, lon, h] (3 x f64) each
//! ...     T*12   triangles: [a, b, c] (3 x u32) each, indices into vertices
//! ```

pub mod tin;

/// Magic prefix identifying a SiteLens TIN blob.
pub const STIN_MAGIC: &[u8; 4] = b"STIN";
/// Current blob format version.
pub const STIN_VERSION: u32 = 1;

/// Serializes a geographic indexed mesh into the STIN blob. `vertices` are
/// `[lat, lon, height]` (degrees, degrees, meters); `indices` are triangles.
pub fn serialize_mesh(vertices: &[[f64; 3]], indices: &[[u32; 3]]) -> Vec<u8> {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for v in vertices {
        for k in 0..3 {
            min[k] = min[k].min(v[k]);
            max[k] = max[k].max(v[k]);
        }
    }
    // Empty mesh: keep the bbox finite/zeroed rather than ±inf.
    if vertices.is_empty() {
        min = [0.0; 3];
        max = [0.0; 3];
    }

    let mut buf = Vec::with_capacity(16 + 48 + vertices.len() * 24 + indices.len() * 12);
    buf.extend_from_slice(STIN_MAGIC);
    buf.extend_from_slice(&STIN_VERSION.to_le_bytes());
    buf.extend_from_slice(&(vertices.len() as u32).to_le_bytes());
    buf.extend_from_slice(&(indices.len() as u32).to_le_bytes());
    for v in [min[0], min[1], min[2], max[0], max[1], max[2]] {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    for v in vertices {
        for c in v {
            buf.extend_from_slice(&c.to_le_bytes());
        }
    }
    for tri in indices {
        for i in tri {
            buf.extend_from_slice(&i.to_le_bytes());
        }
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_has_expected_header_and_size() {
        let verts = vec![
            [40.0, -74.0, 10.0],
            [40.1, -74.0, 20.0],
            [40.0, -74.1, 30.0],
        ];
        let tris = vec![[0u32, 1, 2]];
        let blob = serialize_mesh(&verts, &tris);

        assert_eq!(&blob[0..4], STIN_MAGIC);
        assert_eq!(
            u32::from_le_bytes(blob[4..8].try_into().unwrap()),
            STIN_VERSION
        );
        assert_eq!(u32::from_le_bytes(blob[8..12].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(blob[12..16].try_into().unwrap()), 1);
        assert_eq!(blob.len(), 16 + 48 + 3 * 24 + 12);

        // bbox min/max on the height channel (index 2 / 5).
        let min_h = f64::from_le_bytes(blob[16 + 16..16 + 24].try_into().unwrap());
        let max_h = f64::from_le_bytes(blob[16 + 40..16 + 48].try_into().unwrap());
        assert_eq!(min_h, 10.0);
        assert_eq!(max_h, 30.0);
    }

    #[test]
    fn empty_mesh_serializes_with_zero_bbox() {
        let blob = serialize_mesh(&[], &[]);
        assert_eq!(blob.len(), 16 + 48);
        for k in 0..6 {
            let off = 16 + k * 8;
            assert_eq!(
                f64::from_le_bytes(blob[off..off + 8].try_into().unwrap()),
                0.0
            );
        }
    }
}
