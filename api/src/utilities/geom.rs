//! Pure derivations for utility records: 3D run length, slope from inverts,
//! depth-of-cover against a surface, and diameter unit normalization. All linear
//! values are canonical meters. Grid/ground/geographic reps come from
//! [`crate::convert`] (already tested there), so they aren't duplicated here.

/// One run vertex in canonical projected meters. Elevation is optional (a run
/// digitized without Z is treated as planimetric for length).
#[derive(Debug, Clone, Copy)]
pub struct Vertex {
    pub northing: f64,
    pub easting: f64,
    pub elevation: Option<f64>,
}

const INCH_M: f64 = 0.0254;

/// Inches → meters (diameters are entered in inches, stored canonical).
pub fn inches_to_meters(inches: f64) -> f64 {
    inches * INCH_M
}

/// Meters → inches (for display/export of a stored diameter).
pub fn meters_to_inches(meters: f64) -> f64 {
    meters / INCH_M
}

/// Total 3D length of a run (meters). Segments where either endpoint lacks an
/// elevation are measured planimetrically (Δz = 0). Fewer than two vertices → 0.
pub fn run_length_3d(vertices: &[Vertex]) -> f64 {
    vertices
        .windows(2)
        .map(|w| {
            let (a, b) = (w[0], w[1]);
            let de = b.easting - a.easting;
            let dn = b.northing - a.northing;
            let dz = match (a.elevation, b.elevation) {
                (Some(za), Some(zb)) => zb - za,
                _ => 0.0,
            };
            (de * de + dn * dn + dz * dz).sqrt()
        })
        .sum()
}

/// Planimetric (2D) length of a run (meters) — ignores elevation.
pub fn run_length_2d(vertices: &[Vertex]) -> f64 {
    vertices
        .windows(2)
        .map(|w| {
            let de = w[1].easting - w[0].easting;
            let dn = w[1].northing - w[0].northing;
            (de * de + dn * dn).sqrt()
        })
        .sum()
}

/// Pipe slope as a fraction (rise/run) from upstream/downstream inverts over a
/// horizontal `length`. Positive = falls from up to down. `None` if either
/// invert is missing or `length` is non-positive.
pub fn slope_from_inverts(
    invert_up: Option<f64>,
    invert_down: Option<f64>,
    length: f64,
) -> Option<f64> {
    match (invert_up, invert_down) {
        (Some(up), Some(down)) if length > 0.0 => Some((up - down) / length),
        _ => None,
    }
}

/// Depth of cover (meters) = ground surface Z − utility Z. `None` when either is
/// unknown (e.g. no terrain surface, or a run without elevation).
pub fn depth_of_cover(surface_z: Option<f64>, utility_z: Option<f64>) -> Option<f64> {
    match (surface_z, utility_z) {
        (Some(s), Some(u)) => Some(s - u),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(n: f64, e: f64, z: Option<f64>) -> Vertex {
        Vertex {
            northing: n,
            easting: e,
            elevation: z,
        }
    }

    #[test]
    fn length_3d_uses_elevation() {
        // 3-4-? triangle: horizontal 5, rise 12 → 13.
        let pts = [v(0.0, 0.0, Some(0.0)), v(4.0, 3.0, Some(12.0))];
        assert!((run_length_3d(&pts) - 13.0).abs() < 1e-9);
        // 2D ignores the rise → 5.
        assert!((run_length_2d(&pts) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn length_planimetric_when_z_missing() {
        let pts = [v(0.0, 0.0, None), v(0.0, 3.0, Some(9.0))];
        // One endpoint has no Z → that segment is planimetric (3).
        assert!((run_length_3d(&pts) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn length_of_short_run_is_zero() {
        assert_eq!(run_length_3d(&[]), 0.0);
        assert_eq!(run_length_3d(&[v(1.0, 1.0, Some(1.0))]), 0.0);
    }

    #[test]
    fn slope_is_rise_over_run() {
        // up 105, down 100 over 100 m → 5% fall.
        assert_eq!(
            slope_from_inverts(Some(105.0), Some(100.0), 100.0),
            Some(0.05)
        );
        assert_eq!(slope_from_inverts(None, Some(100.0), 100.0), None);
        assert_eq!(slope_from_inverts(Some(105.0), Some(100.0), 0.0), None);
    }

    #[test]
    fn cover_is_surface_minus_utility() {
        assert_eq!(depth_of_cover(Some(10.0), Some(7.5)), Some(2.5));
        assert_eq!(depth_of_cover(None, Some(7.5)), None);
        assert_eq!(depth_of_cover(Some(10.0), None), None);
    }

    #[test]
    fn diameter_unit_roundtrip() {
        let m = inches_to_meters(12.0);
        assert!((m - 0.3048).abs() < 1e-9);
        assert!((meters_to_inches(m) - 12.0).abs() < 1e-9);
    }
}
