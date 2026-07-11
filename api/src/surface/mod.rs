//! Surface modeling: server-side geometry for TIN surfaces (volumes land in a
//! later phase). `tin` holds the pure triangulation, `contour` extracts iso-lines;
//! this module owns the render-blob wire formats the client decodes.
//!
//! ## STIN mesh blob (little-endian)
//!
//! Vertices are **geographic** (lat, lon, height-meters) so the client can place
//! them with the same `toLocal` transform the point/terrain layers use — the mesh
//! then registers exactly on the rendered survey points.
//!
//! **v2** quantizes each position component to a `u16` over its axis range from the
//! header bbox (dequant = `min + q/65535 · (max − min)`), a 4× shrink vs the v1
//! `f64` layout — negligible visual error (sub-mm on a survey site) on a render
//! mesh. Indices stay `u32`. [`deserialize_mesh`] reads **both** v1 (stored
//! surfaces predate v2) and v2.
//!
//! ```text
//! offset  bytes  field
//! 0       4      magic "STIN"
//! 4       4      version (u32) — 1 (legacy f64) or 2 (quantized)
//! 8       4      vertex_count V (u32)
//! 12      4      triangle_count T (u32)
//! 16      48     bbox: min_lat, min_lon, min_h, max_lat, max_lon, max_h (6 x f64)
//! 64      V*6    v2: vertices [lat, lon, h] (3 x u16 quantized) each
//!         V*24   v1: vertices [lat, lon, h] (3 x f64) each
//! ...     T*12   triangles: [a, b, c] (3 x u32) each, indices into vertices
//! ```

pub mod contour;
pub mod dem;
pub mod export;
pub mod geom;
pub mod geotiff;
pub mod tin;
pub mod volume;

/// Magic prefix identifying a SiteLens TIN blob.
pub const STIN_MAGIC: &[u8; 4] = b"STIN";
/// Current blob format version. v2 = `u16`-quantized positions (see module docs).
pub const STIN_VERSION: u32 = 2;

/// Quantizes `v` in `[min, max]` to a `u16` (0..=65535). A degenerate axis
/// (`max <= min`) collapses to 0.
pub(crate) fn quantize(v: f64, min: f64, max: f64) -> u16 {
    if max <= min {
        return 0;
    }
    let t = ((v - min) / (max - min)).clamp(0.0, 1.0);
    (t * 65535.0).round() as u16
}

/// Inverse of [`quantize`]: maps a `u16` back into `[min, max]`.
pub(crate) fn dequantize(q: u16, min: f64, max: f64) -> f64 {
    if max <= min {
        return min;
    }
    min + (q as f64 / 65535.0) * (max - min)
}

/// Magic prefix identifying a SiteLens contour blob.
pub const SCTR_MAGIC: &[u8; 4] = b"SCTR";
/// Current contour-blob format version.
pub const SCTR_VERSION: u32 = 1;

/// Magic prefix identifying a SiteLens volume-heatmap blob.
pub const SVOL_MAGIC: &[u8; 4] = b"SVOL";
/// Current volume-heatmap-blob format version. v2 carries the base surface mesh
/// with a per-vertex Δz (so the heatmap follows the surface outline exactly).
pub const SVOL_VERSION: u32 = 2;
/// Earthwork solid mesh — a clean cut/fill volume clipped to the design footprint,
/// for display (vertical walls + straight edges). Layout: `ESOL` magic, vCount u32,
/// tCount u32, then vCount × (lat,lon,z,r,g,b as f64), then tCount × 3 u32.
pub const ESOL_MAGIC: &[u8; 4] = b"ESOL";

/// An indexed mesh decoded from a blob: `(vertices [x/lat, y/lon, z], triangles)`.
pub type MeshData = (Vec<[f64; 3]>, Vec<[u32; 3]>);

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

    let mut buf = Vec::with_capacity(16 + 48 + vertices.len() * 6 + indices.len() * 12);
    buf.extend_from_slice(STIN_MAGIC);
    buf.extend_from_slice(&STIN_VERSION.to_le_bytes());
    buf.extend_from_slice(&(vertices.len() as u32).to_le_bytes());
    buf.extend_from_slice(&(indices.len() as u32).to_le_bytes());
    for v in [min[0], min[1], min[2], max[0], max[1], max[2]] {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    for v in vertices {
        for k in 0..3 {
            buf.extend_from_slice(&quantize(v[k], min[k], max[k]).to_le_bytes());
        }
    }
    for tri in indices {
        for i in tri {
            buf.extend_from_slice(&i.to_le_bytes());
        }
    }
    buf
}

/// Reads a STIN blob back into `(vertices, indices)` — the inverse of
/// [`serialize_mesh`]. Returns `None` if the blob is truncated or lacks the magic.
/// Vertices come back in the frame they were written in (geographic in
/// production).
pub fn deserialize_mesh(blob: &[u8]) -> Option<MeshData> {
    if blob.len() < 64 || &blob[0..4] != STIN_MAGIC {
        return None;
    }
    let rd_u16 = |o: usize| u16::from_le_bytes(blob[o..o + 2].try_into().unwrap());
    let rd_u32 = |o: usize| u32::from_le_bytes(blob[o..o + 4].try_into().unwrap());
    let rd_f64 = |o: usize| f64::from_le_bytes(blob[o..o + 8].try_into().unwrap());
    let version = rd_u32(4);
    let v_count = rd_u32(8) as usize;
    let t_count = rd_u32(12) as usize;
    let min = [rd_f64(16), rd_f64(24), rd_f64(32)];
    let max = [rd_f64(40), rd_f64(48), rd_f64(56)];
    let vert_start = 64;

    // v1 stored f64 positions; v2 quantizes them to u16 over the header bbox.
    let (vertex_stride, read_vertex): (usize, Box<dyn Fn(usize) -> [f64; 3]>) = match version {
        1 => (
            24,
            Box::new(move |o| [rd_f64(o), rd_f64(o + 8), rd_f64(o + 16)]),
        ),
        2 => (
            6,
            Box::new(move |o| {
                [
                    dequantize(rd_u16(o), min[0], max[0]),
                    dequantize(rd_u16(o + 2), min[1], max[1]),
                    dequantize(rd_u16(o + 4), min[2], max[2]),
                ]
            }),
        ),
        _ => return None,
    };

    let idx_start = vert_start + v_count * vertex_stride;
    if blob.len() < idx_start + t_count * 12 {
        return None;
    }
    let vertices = (0..v_count)
        .map(|i| read_vertex(vert_start + i * vertex_stride))
        .collect();
    let indices = (0..t_count)
        .map(|i| {
            let o = idx_start + i * 12;
            [rd_u32(o), rd_u32(o + 4), rd_u32(o + 8)]
        })
        .collect();
    Some((vertices, indices))
}

/// Serializes extracted contours into the **SCTR** blob (little-endian). Points
/// are horizontal `[x, y]` (geographic `[lat, lon]` in production); each point's
/// elevation is its level's `level` field.
///
/// ```text
/// offset  bytes  field
/// 0       4      magic "SCTR"
/// 4       4      version (u32)
/// 8       4      level_count L (u32)
/// then per level:
///   8      level (f64)
///   4      is_major (u32; 0 or 1)
///   4      polyline_count P (u32)
///   then per polyline:
///     4    point_count N (u32)
///     N*16 points: [x, y] (2 x f64) each
/// ```
pub fn serialize_contours(levels: &[contour::ContourLevel]) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(SCTR_MAGIC);
    buf.extend_from_slice(&SCTR_VERSION.to_le_bytes());
    buf.extend_from_slice(&(levels.len() as u32).to_le_bytes());
    for lv in levels {
        buf.extend_from_slice(&lv.level.to_le_bytes());
        buf.extend_from_slice(&u32::from(lv.is_major).to_le_bytes());
        buf.extend_from_slice(&(lv.polylines.len() as u32).to_le_bytes());
        for pl in &lv.polylines {
            buf.extend_from_slice(&(pl.len() as u32).to_le_bytes());
            for p in pl {
                buf.extend_from_slice(&p[0].to_le_bytes());
                buf.extend_from_slice(&p[1].to_le_bytes());
            }
        }
    }
    buf
}

/// Serializes a cut/fill heatmap into the **SVOL** blob (little-endian): the base
/// surface mesh with a signed Δz per vertex (+ fill / − cut), so the rendered
/// heatmap follows the surface's exact outline. Vertices are geographic
/// `[lat, lon, height]`; `min_dz`/`max_dz` drive the color scale + legend.
///
/// ```text
/// offset  bytes  field
/// 0       4      magic "SVOL"
/// 4       4      version (u32)
/// 8       8      min_dz (f64)
/// 16      8      max_dz (f64)
/// 24      4      vertex_count V (u32)
/// 28      4      triangle_count T (u32)
/// 32      V*32   vertices: [lat, lon, height, dz] (4 x f64) each
/// ...     T*12   triangles: [a, b, c] (3 x u32) each
/// ```
pub fn serialize_volume_heatmap(
    vertices: &[[f64; 3]],
    dz: &[f64],
    indices: &[[u32; 3]],
    min_dz: f64,
    max_dz: f64,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(32 + vertices.len() * 32 + indices.len() * 12);
    buf.extend_from_slice(SVOL_MAGIC);
    buf.extend_from_slice(&SVOL_VERSION.to_le_bytes());
    buf.extend_from_slice(&min_dz.to_le_bytes());
    buf.extend_from_slice(&max_dz.to_le_bytes());
    buf.extend_from_slice(&(vertices.len() as u32).to_le_bytes());
    buf.extend_from_slice(&(indices.len() as u32).to_le_bytes());
    for (v, d) in vertices.iter().zip(dz) {
        for c in v {
            buf.extend_from_slice(&c.to_le_bytes());
        }
        buf.extend_from_slice(&d.to_le_bytes());
    }
    for tri in indices {
        for i in tri {
            buf.extend_from_slice(&i.to_le_bytes());
        }
    }
    buf
}

/// Serializes an earthwork solid: per-vertex geographic `[lat, lon, z]` + `[r,g,b]`
/// colour, plus triangle indices. See [`ESOL_MAGIC`] for the layout.
pub fn serialize_earthwork_solid(
    vertices: &[[f64; 3]],
    colors: &[[f64; 3]],
    indices: &[[u32; 3]],
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(12 + vertices.len() * 48 + indices.len() * 12);
    buf.extend_from_slice(ESOL_MAGIC);
    buf.extend_from_slice(&(vertices.len() as u32).to_le_bytes());
    buf.extend_from_slice(&(indices.len() as u32).to_le_bytes());
    for (v, c) in vertices.iter().zip(colors) {
        for p in v {
            buf.extend_from_slice(&p.to_le_bytes());
        }
        for ch in c {
            buf.extend_from_slice(&ch.to_le_bytes());
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
        // v2: 3 vertices × 6 bytes (u16 x3) + 1 triangle × 12 bytes (u32 x3).
        assert_eq!(blob.len(), 16 + 48 + 3 * 6 + 12);

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

    #[test]
    fn mesh_roundtrips_through_deserialize() {
        let verts = vec![
            [40.0, -74.0, 10.0],
            [40.1, -74.0, 20.0],
            [40.0, -74.1, 30.0],
            [40.1, -74.1, 25.0],
        ];
        let tris = vec![[0u32, 1, 2], [1, 3, 2]];
        let blob = serialize_mesh(&verts, &tris);
        let (v, t) = deserialize_mesh(&blob).unwrap();
        assert_eq!(t, tris);
        // v2 quantizes positions: each axis is within 1 step of its bbox range.
        // Range here is 0.1° / 20 m; 1/65535 of that is ~1.5e-6° / ~3e-4 m.
        for (got, want) in v.iter().zip(&verts) {
            for k in 0..3 {
                let range = if k == 2 { 20.0 } else { 0.1 };
                assert!(
                    (got[k] - want[k]).abs() <= range / 65535.0 + 1e-12,
                    "axis {k}: {} vs {}",
                    got[k],
                    want[k]
                );
            }
        }
        // Endpoints (bbox min/max) survive quantization exactly.
        assert_eq!(v[0], verts[0]); // [min_lat, max_lon(-74 is max), 10=min_h]
    }

    #[test]
    fn deserialize_reads_legacy_v1_blob() {
        // A hand-built v1 (f64 positions) blob must still decode after the v2 switch
        // — stored surfaces predate v2.
        let verts = [[40.0, -74.0, 10.0], [40.5, -73.5, 20.0]];
        let tris = [[0u32, 1, 0]];
        let mut buf = Vec::new();
        buf.extend_from_slice(STIN_MAGIC);
        buf.extend_from_slice(&1u32.to_le_bytes()); // version 1
        buf.extend_from_slice(&2u32.to_le_bytes());
        buf.extend_from_slice(&1u32.to_le_bytes());
        // bbox (unused by v1 decode but present in the layout)
        for v in [40.0, -74.0, 10.0, 40.5, -73.5, 20.0] {
            buf.extend_from_slice(&f64::to_le_bytes(v));
        }
        for v in verts.iter().flatten() {
            buf.extend_from_slice(&f64::to_le_bytes(*v));
        }
        for i in tris.iter().flatten() {
            buf.extend_from_slice(&u32::to_le_bytes(*i));
        }
        let (v, t) = deserialize_mesh(&buf).unwrap();
        assert_eq!(v, vec![[40.0, -74.0, 10.0], [40.5, -73.5, 20.0]]); // exact f64
        assert_eq!(t, vec![[0, 1, 0]]);
    }

    #[test]
    fn deserialize_rejects_bad_magic_and_truncation() {
        assert!(deserialize_mesh(b"not a mesh blob at all!!").is_none());
        let blob = serialize_mesh(&[[1.0, 2.0, 3.0]], &[]);
        assert!(deserialize_mesh(&blob[..blob.len() - 4]).is_none());
    }

    #[test]
    fn contour_blob_has_expected_header_and_geometry() {
        let levels = vec![
            contour::ContourLevel {
                level: 10.0,
                is_major: true,
                polylines: vec![vec![[1.0, 2.0], [3.0, 4.0]]],
            },
            contour::ContourLevel {
                level: 11.0,
                is_major: false,
                polylines: vec![],
            },
        ];
        let blob = serialize_contours(&levels);
        assert_eq!(&blob[0..4], SCTR_MAGIC);
        assert_eq!(
            u32::from_le_bytes(blob[4..8].try_into().unwrap()),
            SCTR_VERSION
        );
        assert_eq!(u32::from_le_bytes(blob[8..12].try_into().unwrap()), 2);
        // First level header: level=10.0, is_major=1, polyline_count=1.
        assert_eq!(f64::from_le_bytes(blob[12..20].try_into().unwrap()), 10.0);
        assert_eq!(u32::from_le_bytes(blob[20..24].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(blob[24..28].try_into().unwrap()), 1);
        // Its polyline: point_count=2, then [1,2],[3,4].
        assert_eq!(u32::from_le_bytes(blob[28..32].try_into().unwrap()), 2);
        assert_eq!(f64::from_le_bytes(blob[32..40].try_into().unwrap()), 1.0);
        assert_eq!(f64::from_le_bytes(blob[40..48].try_into().unwrap()), 2.0);
    }

    #[test]
    fn volume_heatmap_blob_has_expected_header_and_mesh() {
        let verts = [[40.0, -74.0, 12.5], [40.1, -74.1, 9.0], [40.0, -74.1, 11.0]];
        let dz = [-3.0, 2.5, 0.5];
        let tris = [[0u32, 1, 2]];
        let blob = serialize_volume_heatmap(&verts, &dz, &tris, -3.0, 2.5);
        assert_eq!(&blob[0..4], SVOL_MAGIC);
        assert_eq!(
            u32::from_le_bytes(blob[4..8].try_into().unwrap()),
            SVOL_VERSION
        );
        assert_eq!(f64::from_le_bytes(blob[8..16].try_into().unwrap()), -3.0);
        assert_eq!(f64::from_le_bytes(blob[16..24].try_into().unwrap()), 2.5);
        assert_eq!(u32::from_le_bytes(blob[24..28].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(blob[28..32].try_into().unwrap()), 1);
        assert_eq!(blob.len(), 32 + 3 * 32 + 12);
        // First vertex: lat 40.0 … dz -3.0 at offset 32+24.
        assert_eq!(f64::from_le_bytes(blob[32..40].try_into().unwrap()), 40.0);
        assert_eq!(
            f64::from_le_bytes(blob[32 + 24..32 + 32].try_into().unwrap()),
            -3.0
        );
    }
}
