//! EPSG projections (projected ↔ geographic) via pure-Rust proj4rs + the
//! crs-definitions EPSG→proj4 database. No libproj system dependency.
//!
//! Projected coordinates are passed in/out as **meters** (SiteLens canonical);
//! we convert to/from the CRS's native unit (e.g. US survey feet for State
//! Plane zones) using the `+units`/`+to_meter` token in its proj4 string.

use proj4rs::adaptors::transform_xy;
use proj4rs::Proj;

const WGS84: &str = "+proj=longlat +datum=WGS84 +no_defs";
const US_SURVEY_FOOT_M: f64 = 1200.0 / 3937.0;
const INTERNATIONAL_FOOT_M: f64 = 0.3048;

/// The metres-per-unit factor declared by a proj4 string (defaults to 1.0 = m).
fn to_meter(proj4: &str) -> f64 {
    if proj4.contains("+units=us-ft") {
        return US_SURVEY_FOOT_M;
    }
    if proj4.contains("+units=ft") {
        return INTERNATIONAL_FOOT_M;
    }
    if let Some(idx) = proj4.find("+to_meter=") {
        let tail = &proj4[idx + "+to_meter=".len()..];
        let token: String = tail.chars().take_while(|c| !c.is_whitespace()).collect();
        if let Ok(v) = token.parse::<f64>() {
            return v;
        }
    }
    1.0
}

/// Resolves an EPSG code to its projection plus metres-per-unit factor.
fn crs_for(epsg: i32) -> Option<(Proj, f64)> {
    let code = u16::try_from(epsg).ok()?;
    let def = crs_definitions::from_code(code)?;
    let proj = Proj::from_proj_string(def.proj4).ok()?;
    Some((proj, to_meter(def.proj4)))
}

fn wgs84() -> Option<Proj> {
    Proj::from_proj_string(WGS84).ok()
}

/// Projected (meters) → geographic (degrees), returning (latitude, longitude).
pub fn projected_to_geographic(epsg: i32, easting_m: f64, northing_m: f64) -> Option<(f64, f64)> {
    let (crs, m_per_unit) = crs_for(epsg)?;
    let wgs = wgs84()?;
    // proj4rs works in the CRS's native units (projected) and radians (geographic).
    let (lon, lat) =
        transform_xy(&crs, &wgs, easting_m / m_per_unit, northing_m / m_per_unit).ok()?;
    Some((lat.to_degrees(), lon.to_degrees()))
}

/// Geographic (degrees) → projected (meters), returning (easting, northing).
pub fn geographic_to_projected(epsg: i32, latitude: f64, longitude: f64) -> Option<(f64, f64)> {
    let (crs, m_per_unit) = crs_for(epsg)?;
    let wgs = wgs84()?;
    let (e, n) = transform_xy(&wgs, &crs, longitude.to_radians(), latitude.to_radians()).ok()?;
    Some((e * m_per_unit, n * m_per_unit))
}

#[cfg(test)]
mod tests {
    use super::*;

    // EPSG:2229 — NAD83 / California zone 5 (US survey feet). Default US zone.
    const CA5: i32 = 2229;

    #[test]
    fn unknown_epsg_returns_none() {
        assert!(projected_to_geographic(999_999, 0.0, 0.0).is_none());
    }

    #[test]
    fn geographic_projected_roundtrip() {
        // Near downtown Los Angeles.
        let (lat, lon) = (34.0537, -118.2428);
        let (e, n) = geographic_to_projected(CA5, lat, lon).expect("project");
        let (lat2, lon2) = projected_to_geographic(CA5, e, n).expect("unproject");
        assert!((lat - lat2).abs() < 1e-7, "lat {lat} vs {lat2}");
        assert!((lon - lon2).abs() < 1e-7, "lon {lon} vs {lon2}");
    }

    #[test]
    fn la_projects_into_plausible_state_plane_range() {
        // Coarse sanity check that the projection is real (not a no-op/garbage).
        // CA zone 5 false origin is ~ (609600 m E, 152400 m N); LA sits well NE.
        let (e, n) = geographic_to_projected(CA5, 34.0537, -118.2428).expect("project");
        assert!((1.5e6..2.5e6).contains(&e), "easting {e} m out of range");
        assert!((4.0e5..8.0e5).contains(&n), "northing {n} m out of range");
    }

    #[test]
    fn us_survey_foot_unit_is_detected() {
        assert!((to_meter("+proj=lcc +units=us-ft +no_defs") - US_SURVEY_FOOT_M).abs() < 1e-12);
        assert!((to_meter("+proj=tmerc +to_meter=0.3048 +no_defs") - 0.3048).abs() < 1e-12);
        assert_eq!(to_meter("+proj=lcc +no_defs"), 1.0);
    }
}
