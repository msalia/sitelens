//! A single-band float32 **GeoTIFF** codec. The writer ([`write_geotiff`], classic
//! little-endian TIFF, one uncompressed strip, `SampleFormat = IEEE float`,
//! geo-tagged with `ModelPixelScale` + `ModelTiepoint` + a `GeoKeyDirectory`) is
//! used to export a surface sampled to a DEM raster.
//!
//! The reader ([`read_geotiff`], via the pure-Rust `tiff` crate) decodes a fetched
//! DEM (e.g. USGS 3DEP, EPSG:4326) into a [`DecodedDem`] grid for the terrain
//! composite — recovering origin/pixel from the geo tags, EPSG from the
//! GeoKeyDirectory, and the NODATA sentinel.

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

/// A decoded single-band DEM raster. Node `(row, col)` sits at world
/// `(origin_x + col*pixel_x, origin_y - row*pixel_y)`; row 0 is the **north** edge
/// (`data` is row-major, top-to-bottom). For a 3DEP EPSG:4326 tiff, world x/y are
/// lon/lat and `pixel_*` are in degrees.
#[derive(Debug, Clone)]
pub struct DecodedDem {
    pub width: usize,
    pub height: usize,
    pub origin_x: f64,
    pub origin_y: f64,
    pub pixel_x: f64,
    pub pixel_y: f64,
    pub epsg: Option<u32>,
    pub nodata: Option<f64>,
    pub data: Vec<f32>,
}

/// Parses the EPSG code out of a GeoKeyDirectory (flat `u16` array): a 4-word
/// header (`version, rev, minor, key_count`) then 4-word keys
/// (`id, location, count, value`). We return the ProjectedCSType (3072) or
/// GeographicType (2048) when stored inline (`location == 0`).
fn epsg_from_geokeys(keys: &[u16]) -> Option<u32> {
    if keys.len() < 4 {
        return None;
    }
    let n = keys[3] as usize;
    for i in 0..n {
        let o = 4 + i * 4;
        if o + 3 >= keys.len() {
            break;
        }
        let (id, location, value) = (keys[o], keys[o + 1], keys[o + 3]);
        if (id == 3072 || id == 2048) && location == 0 && value != 0 && value != 32767 {
            return Some(value as u32);
        }
    }
    None
}

/// Decodes a single-band float32 GeoTIFF into a [`DecodedDem`]. Requires the
/// `ModelPixelScale` + `ModelTiepoint` geo tags (present on 3DEP output and on
/// anything [`write_geotiff`] produced). Returns an error for non-float or
/// ungeoreferenced tiffs.
pub fn read_geotiff(bytes: &[u8]) -> Result<DecodedDem, String> {
    use tiff::decoder::{Decoder, DecodingResult};
    use tiff::tags::Tag;

    let mut d = Decoder::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let (w, h) = d.dimensions().map_err(|e| e.to_string())?;

    let scale = d
        .get_tag_f64_vec(Tag::ModelPixelScaleTag)
        .map_err(|e| format!("GeoTIFF ModelPixelScale: {e}"))?;
    let tie = d
        .get_tag_f64_vec(Tag::ModelTiepointTag)
        .map_err(|e| format!("GeoTIFF ModelTiepoint: {e}"))?;
    if scale.len() < 2 || tie.len() < 6 {
        return Err("GeoTIFF missing ModelPixelScale/ModelTiepoint".into());
    }
    let (pixel_x, pixel_y) = (scale[0], scale[1]);
    // Tiepoint maps raster (tie[0], tie[1]) → world (tie[3], tie[4]); back out the
    // world origin at raster (0, 0). +row (south) steps world y by -pixel_y.
    let origin_x = tie[3] - tie[0] * pixel_x;
    let origin_y = tie[4] + tie[1] * pixel_y;

    let epsg = d
        .get_tag_u16_vec(Tag::GeoKeyDirectoryTag)
        .ok()
        .and_then(|keys| epsg_from_geokeys(&keys));
    let nodata = d
        .get_tag_ascii_string(Tag::GdalNodata)
        .ok()
        .and_then(|s| s.trim_end_matches('\0').trim().parse::<f64>().ok());

    let data = match d.read_image().map_err(|e| e.to_string())? {
        DecodingResult::F32(v) => v,
        _ => return Err("GeoTIFF is not single-band float32".into()),
    };
    if data.len() != (w as usize) * (h as usize) {
        return Err("GeoTIFF raster size mismatch".into());
    }

    Ok(DecodedDem {
        width: w as usize,
        height: h as usize,
        origin_x,
        origin_y,
        pixel_x,
        pixel_y,
        epsg,
        nodata,
        data,
    })
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

    #[test]
    fn read_geotiff_roundtrips_the_writer() {
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
        let dem = read_geotiff(&write_geotiff(&g)).unwrap();

        assert_eq!((dem.width, dem.height), (3, 2));
        assert_eq!(dem.origin_x, 188_500.0);
        assert_eq!(dem.origin_y, 215_050.0);
        assert_eq!(dem.pixel_x, 2.0);
        assert_eq!(dem.pixel_y, 2.0);
        assert_eq!(dem.epsg, Some(32111));
        assert_eq!(dem.nodata, Some(-9999.0));
        // Row 0 is north, row-major, values intact.
        assert_eq!(dem.data, vec![10.0, 11.0, 12.0, 10.5, 11.5, 12.5]);
        // Node (row 1, col 2) sits at the expected world coordinate.
        let (r, c) = (1.0, 2.0);
        assert_eq!(dem.origin_x + c * dem.pixel_x, 188_504.0);
        assert_eq!(dem.origin_y - r * dem.pixel_y, 215_048.0);
    }

    #[test]
    fn read_geotiff_rejects_non_tiff() {
        assert!(read_geotiff(b"not a tiff").is_err());
    }
}
