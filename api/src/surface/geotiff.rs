//! A minimal single-band float32 **GeoTIFF** writer (classic little-endian TIFF),
//! enough to export a surface sampled to a DEM raster. Hand-rolled to avoid a
//! TIFF dependency (the repo parses GeoTIFF client-side with geotiff.js; only the
//! export side needs to *write* one).
//!
//! One uncompressed strip, `SampleFormat = IEEE float`, geo-tagged with
//! `ModelPixelScale` + `ModelTiepoint` + a `GeoKeyDirectory` (Projected CS = the
//! surface's EPSG). Cells outside the surface carry a NODATA value.

/// A regular DEM raster to serialize. Row 0 is the **north** edge; `data` is
/// row-major `width * height` in projected CRS units (meters).
pub struct DemGrid {
    pub width: usize,
    pub height: usize,
    /// World coordinate of the top-left pixel's upper-left corner.
    pub origin_e: f64,
    pub origin_n: f64,
    /// Square cell size (meters).
    pub pixel: f64,
    /// Projected CRS EPSG code.
    pub epsg: i32,
    pub nodata: f32,
    pub data: Vec<f32>,
}

/// TIFF field types.
const SHORT: u16 = 3;
const LONG: u16 = 4;
const DOUBLE: u16 = 12;
const ASCII: u16 = 2;

/// Serializes the grid to GeoTIFF bytes.
pub fn write_geotiff(g: &DemGrid) -> Vec<u8> {
    let raster: Vec<u8> = g.data.iter().flat_map(|v| v.to_le_bytes()).collect();
    let raster_len = raster.len() as u32;

    // Out-of-line blocks (values that don't fit in a 4-byte IFD field).
    let pixel_scale: Vec<u8> = [g.pixel, g.pixel, 0.0]
        .iter()
        .flat_map(|v: &f64| v.to_le_bytes())
        .collect();
    // Tiepoint: raster (0,0,0) → world (origin_e, origin_n, 0).
    let tiepoint: Vec<u8> = [0.0, 0.0, 0.0, g.origin_e, g.origin_n, 0.0]
        .iter()
        .flat_map(|v: &f64| v.to_le_bytes())
        .collect();
    // GeoKeyDirectory: version 1.1.0, 3 keys → ModelType=Projected, RasterType=
    // PixelIsArea, ProjectedCSType=EPSG.
    let geokeys: [u16; 16] = [
        1,
        1,
        0,
        3, // header + key count
        1024,
        0,
        1,
        1, // GTModelType = Projected
        1025,
        0,
        1,
        1, // GTRasterType = PixelIsArea
        3072,
        0,
        1,
        g.epsg as u16, // ProjectedCSType = EPSG
    ];
    let geokeys_bytes: Vec<u8> = geokeys.iter().flat_map(|v| v.to_le_bytes()).collect();
    let nodata_str = format!("{}\0", g.nodata);
    let nodata_bytes = nodata_str.as_bytes().to_vec();

    // 15 IFD entries.
    let entry_count: u16 = 15;
    let ifd_size = 2 + entry_count as usize * 12 + 4;
    let mut cursor = 8 + ifd_size; // out-of-line region starts after the IFD
    let even = |n: usize| n + (n & 1); // TIFF offsets must be word-aligned

    let pixel_scale_off = cursor;
    cursor = even(cursor + pixel_scale.len());
    let tiepoint_off = cursor;
    cursor = even(cursor + tiepoint.len());
    let geokeys_off = cursor;
    cursor = even(cursor + geokeys_bytes.len());
    let nodata_off = cursor;
    cursor = even(cursor + nodata_bytes.len());
    let raster_off = cursor;

    // --- IFD ----------------------------------------------------------------
    let mut ifd: Vec<u8> = Vec::with_capacity(ifd_size);
    ifd.extend_from_slice(&entry_count.to_le_bytes());
    // One IFD entry: tag, type, count, value-or-offset (4 bytes).
    let mut entry = |tag: u16, ty: u16, count: u32, value: u32| {
        ifd.extend_from_slice(&tag.to_le_bytes());
        ifd.extend_from_slice(&ty.to_le_bytes());
        ifd.extend_from_slice(&count.to_le_bytes());
        ifd.extend_from_slice(&value.to_le_bytes());
    };
    // A single SHORT is stored left-justified in the 4-byte value field.
    entry(256, LONG, 1, g.width as u32); // ImageWidth
    entry(257, LONG, 1, g.height as u32); // ImageLength
    entry(258, SHORT, 1, 32); // BitsPerSample
    entry(259, SHORT, 1, 1); // Compression = none
    entry(262, SHORT, 1, 1); // Photometric = BlackIsZero
    entry(273, LONG, 1, raster_off as u32); // StripOffsets
    entry(277, SHORT, 1, 1); // SamplesPerPixel
    entry(278, LONG, 1, g.height as u32); // RowsPerStrip (one strip)
    entry(279, LONG, 1, raster_len); // StripByteCounts
    entry(284, SHORT, 1, 1); // PlanarConfiguration
    entry(339, SHORT, 1, 3); // SampleFormat = IEEE float
    entry(33550, DOUBLE, 3, pixel_scale_off as u32); // ModelPixelScale
    entry(33922, DOUBLE, 6, tiepoint_off as u32); // ModelTiepoint
    entry(34735, SHORT, geokeys.len() as u32, geokeys_off as u32); // GeoKeyDirectory
    entry(42113, ASCII, nodata_bytes.len() as u32, nodata_off as u32); // GDAL_NODATA
    ifd.extend_from_slice(&0u32.to_le_bytes()); // next IFD = none

    // --- Assemble -----------------------------------------------------------
    let mut out: Vec<u8> = Vec::with_capacity(raster_off + raster.len());
    out.extend_from_slice(b"II"); // little-endian
    out.extend_from_slice(&42u16.to_le_bytes()); // magic
    out.extend_from_slice(&8u32.to_le_bytes()); // IFD offset
    out.extend_from_slice(&ifd);
    let pad_to = |out: &mut Vec<u8>, off: usize| {
        while out.len() < off {
            out.push(0);
        }
    };
    pad_to(&mut out, pixel_scale_off);
    out.extend_from_slice(&pixel_scale);
    pad_to(&mut out, tiepoint_off);
    out.extend_from_slice(&tiepoint);
    pad_to(&mut out, geokeys_off);
    out.extend_from_slice(&geokeys_bytes);
    pad_to(&mut out, nodata_off);
    out.extend_from_slice(&nodata_bytes);
    pad_to(&mut out, raster_off);
    out.extend_from_slice(&raster);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_structurally_valid_geotiff() {
        let g = DemGrid {
            width: 3,
            height: 2,
            origin_e: 188_500.0,
            origin_n: 215_050.0,
            pixel: 2.0,
            epsg: 32111,
            nodata: -9999.0,
            data: vec![10.0, 11.0, 12.0, 10.5, 11.5, 12.5],
        };
        let b = write_geotiff(&g);

        // Little-endian TIFF header.
        assert_eq!(&b[0..2], b"II");
        assert_eq!(u16::from_le_bytes(b[2..4].try_into().unwrap()), 42);
        let ifd_off = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
        assert_eq!(ifd_off, 8);
        let count = u16::from_le_bytes(b[ifd_off..ifd_off + 2].try_into().unwrap());
        assert_eq!(count, 15);

        // The strip offset tag (273) must point at width*height*4 bytes at EOF.
        let mut strip_off = 0usize;
        for i in 0..count as usize {
            let e = ifd_off + 2 + i * 12;
            let tag = u16::from_le_bytes(b[e..e + 2].try_into().unwrap());
            if tag == 273 {
                strip_off = u32::from_le_bytes(b[e + 8..e + 12].try_into().unwrap()) as usize;
            }
        }
        assert!(strip_off > 0);
        assert_eq!(b.len() - strip_off, 3 * 2 * 4);
        // First float sample round-trips.
        assert_eq!(
            f32::from_le_bytes(b[strip_off..strip_off + 4].try_into().unwrap()),
            10.0
        );
    }
}
