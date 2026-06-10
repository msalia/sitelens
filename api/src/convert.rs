//! Coordinate conversion across all representations a surveyor cares about:
//! building grid, projected (grid and ground), and geographic. All linear
//! values are meters; geographic is degrees.

use crate::crs;
use crate::geo::HelmertParams;

/// A 2D point in meters.
type Point = (f64, f64);

/// Which space an input coordinate is expressed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Space {
    Grid,
    Projected,
}

/// Every representation we can derive from the input (None where not derivable —
/// e.g. grid requires a solved transform; geographic requires a known CRS).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CoordinateSet {
    pub grid_x: Option<f64>,
    pub grid_y: Option<f64>,
    pub projected_grid_e: Option<f64>,
    pub projected_grid_n: Option<f64>,
    pub projected_ground_e: Option<f64>,
    pub projected_ground_n: Option<f64>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

/// Builds the full representation set from one input coordinate (in meters).
///
/// `transform` ties grid↔projected; `epsg` enables geographic; `csf` is the
/// combined scale factor (grid→ground divides projected coords by it).
pub fn convert(
    space: Space,
    x_m: f64,
    y_m: f64,
    transform: Option<HelmertParams>,
    epsg: i32,
    csf: f64,
) -> CoordinateSet {
    let mut set = CoordinateSet::default();

    // Resolve grid (x, y) and projected-grid (E, N) from the input.
    let (grid, projected_grid): (Option<Point>, Option<Point>) = match space {
        Space::Grid => (Some((x_m, y_m)), transform.map(|t| t.apply(x_m, y_m))),
        Space::Projected => (transform.map(|t| t.inverse(x_m, y_m)), Some((x_m, y_m))),
    };

    if let Some((gx, gy)) = grid {
        set.grid_x = Some(gx);
        set.grid_y = Some(gy);
    }
    if let Some((e, n)) = projected_grid {
        set.projected_grid_e = Some(e);
        set.projected_grid_n = Some(n);
        if csf != 0.0 {
            set.projected_ground_e = Some(e / csf);
            set.projected_ground_n = Some(n / csf);
        }
        if let Some((lat, lon)) = crs::projected_to_geographic(epsg, e, n) {
            set.latitude = Some(lat);
            set.longitude = Some(lon);
        }
    }

    set
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projected_input_without_transform_has_no_grid() {
        let set = convert(Space::Projected, 1000.0, 2000.0, None, 2229, 1.0);
        assert_eq!(set.projected_grid_e, Some(1000.0));
        assert!(set.grid_x.is_none());
        // Geographic is still derivable from the projected coordinate + EPSG.
        assert!(set.latitude.is_some());
    }

    #[test]
    fn grid_and_projected_are_inverse_through_transform() {
        let t = HelmertParams::from_components(1.0, 0.0, 100.0, 200.0);
        // Input grid (10, 20) → projected (110, 220).
        let from_grid = convert(Space::Grid, 10.0, 20.0, Some(t), 2229, 1.0);
        assert!((from_grid.projected_grid_e.unwrap() - 110.0).abs() < 1e-9);
        assert!((from_grid.projected_grid_n.unwrap() - 220.0).abs() < 1e-9);
        // Input projected (110, 220) → grid (10, 20).
        let from_proj = convert(Space::Projected, 110.0, 220.0, Some(t), 2229, 1.0);
        assert!((from_proj.grid_x.unwrap() - 10.0).abs() < 1e-9);
        assert!((from_proj.grid_y.unwrap() - 20.0).abs() < 1e-9);
    }

    #[test]
    fn ground_divides_projected_by_combined_scale_factor() {
        let set = convert(Space::Projected, 1000.0, 2000.0, None, 2229, 0.9999);
        assert!((set.projected_ground_e.unwrap() - 1000.0 / 0.9999).abs() < 1e-9);
        assert!((set.projected_ground_n.unwrap() - 2000.0 / 0.9999).abs() < 1e-9);
    }

    #[test]
    fn grid_input_without_transform_has_no_projected_or_geographic() {
        // Grid coords can't be placed without a transform — nothing downstream
        // is derivable (no projected, so no ground, so no lat/long).
        let set = convert(Space::Grid, 10.0, 20.0, None, 2229, 1.0);
        assert_eq!(set.grid_x, Some(10.0));
        assert_eq!(set.grid_y, Some(20.0));
        assert!(set.projected_grid_e.is_none());
        assert!(set.projected_ground_e.is_none());
        assert!(set.latitude.is_none());
        assert!(set.longitude.is_none());
    }

    #[test]
    fn invalid_epsg_yields_no_geographic_but_keeps_projected() {
        let set = convert(Space::Projected, 1000.0, 2000.0, None, 999_999, 1.0);
        assert_eq!(set.projected_grid_e, Some(1000.0));
        assert!(set.latitude.is_none());
        assert!(set.longitude.is_none());
    }
}
