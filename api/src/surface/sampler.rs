//! Compact draping heightfield (terrain-rendering Phase 3).
//!
//! A small regular lat/lon grid over the coarse DEM extent: each node samples the
//! high-res **detail** DEM inside the property boundary and the **coarse** DEM
//! everywhere else. The client bilinear-samples this grid to drape points, grid
//! lines, and buildings onto the ground — replacing the multi-MB client-side
//! GeoTIFF decode with a tiny blob.

use crate::surface::geom::point_in_polygon;
use crate::surface::geotiff::DecodedDem;
use crate::surface::terrain_composite::sample;

/// A regular geographic heightfield. `heights` is row-major, row 0 = north edge;
/// `NaN` marks a node with no data.
#[derive(Debug, Clone)]
pub struct SamplerGrid {
    pub width: usize,
    pub height: usize,
    pub min_lat: f64,
    pub min_lon: f64,
    pub max_lat: f64,
    pub max_lon: f64,
    pub heights: Vec<f32>,
}

/// Builds the draping grid over the coarse DEM's extent at up to `res` nodes per
/// axis. Where a `boundary` + `detail` DEM are given, nodes inside the boundary
/// take the detail elevation (falling back to coarse); everywhere else is coarse.
pub fn build_sampler(
    coarse: &DecodedDem,
    detail: Option<&DecodedDem>,
    boundary_lonlat: Option<&[[f64; 2]]>,
    res: usize,
) -> SamplerGrid {
    // Extent = the coarse grid's geographic bounds (row 0 = north).
    let east = coarse.origin_x + (coarse.width as f64 - 1.0) * coarse.pixel_x;
    let min_lon = coarse.origin_x.min(east);
    let max_lon = coarse.origin_x.max(east);
    let max_lat = coarse.origin_y;
    let min_lat = coarse.origin_y - (coarse.height as f64 - 1.0) * coarse.pixel_y;

    let w = res.min(coarse.width).max(2);
    let h = res.min(coarse.height).max(2);

    // Planar frame (lon·cos lat0) for boundary point-in-polygon.
    let lat0 = (min_lat + max_lat) / 2.0;
    let cos0 = lat0.to_radians().cos().max(1e-6);
    let ring_planar: Option<Vec<[f64; 2]>> =
        boundary_lonlat.map(|b| b.iter().map(|p| [p[0] * cos0, p[1]]).collect());

    let mut heights = vec![f32::NAN; w * h];
    for row in 0..h {
        let lat = max_lat - (row as f64 / (h as f64 - 1.0)) * (max_lat - min_lat);
        for col in 0..w {
            let lon = min_lon + (col as f64 / (w as f64 - 1.0)) * (max_lon - min_lon);
            let inside = match (&ring_planar, detail) {
                (Some(ring), Some(_)) => point_in_polygon([lon * cos0, lat], ring),
                _ => false,
            };
            let z = if inside {
                detail
                    .and_then(|d| sample(d, lon, lat))
                    .or_else(|| sample(coarse, lon, lat))
            } else {
                sample(coarse, lon, lat)
            };
            if let Some(z) = z {
                heights[row * w + col] = z as f32;
            }
        }
    }

    SamplerGrid {
        width: w,
        height: h,
        min_lat,
        min_lon,
        max_lat,
        max_lon,
        heights,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_dem(lon0: f64, lat0: f64, span: f64, n: usize, z: f32) -> DecodedDem {
        let pixel = span / (n - 1) as f64;
        DecodedDem {
            width: n,
            height: n,
            origin_x: lon0,
            origin_y: lat0 + span,
            pixel_x: pixel,
            pixel_y: pixel,
            epsg: Some(4326),
            nodata: Some(-9999.0),
            data: vec![z; n * n],
        }
    }

    #[test]
    fn sampler_uses_detail_inside_and_coarse_outside() {
        let coarse = flat_dem(-74.01, 40.0, 0.02, 21, 10.0);
        let detail = flat_dem(-74.005, 40.005, 0.01, 41, 12.0);
        let boundary = [
            [-74.004, 40.006],
            [-73.996, 40.006],
            [-73.996, 40.014],
            [-74.004, 40.014],
        ];
        let g = build_sampler(&coarse, Some(&detail), Some(&boundary), 21);

        assert_eq!((g.width, g.height), (21, 21));
        assert!((g.max_lat - 40.02).abs() < 1e-9 && (g.min_lat - 40.0).abs() < 1e-9);

        // A node at the grid centre is inside the boundary → detail (12); a corner
        // is outside → coarse (10).
        let at = |r: usize, c: usize| g.heights[r * g.width + c];
        assert!(
            (at(10, 10) - 12.0).abs() < 1e-3,
            "centre should be detail 12"
        );
        assert!((at(0, 0) - 10.0).abs() < 1e-3, "corner should be coarse 10");
    }

    #[test]
    fn sampler_without_boundary_is_all_coarse() {
        let coarse = flat_dem(-74.01, 40.0, 0.02, 11, 10.0);
        let g = build_sampler(&coarse, None, None, 11);
        assert!(g.heights.iter().all(|&z| (z - 10.0).abs() < 1e-3));
    }
}
