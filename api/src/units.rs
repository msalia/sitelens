//! Unit conversions. SiteLens stores all coordinates canonically in **meters**;
//! conversion happens only at I/O boundaries. The US survey foot and the
//! international foot differ by ~2 ppm, which matters over a site, so they are
//! kept distinct.
//!
//! Conversion helpers below are consumed by the geo-core in later phases; the
//! foundation exercises them via unit tests.
#![allow(dead_code)]

/// One US survey foot in meters (exact: 1200 / 3937).
pub const US_SURVEY_FOOT_M: f64 = 1200.0 / 3937.0;

/// One international foot in meters (exact).
pub const INTERNATIONAL_FOOT_M: f64 = 0.3048;

pub fn us_survey_feet_to_meters(feet: f64) -> f64 {
    feet * US_SURVEY_FOOT_M
}

pub fn meters_to_us_survey_feet(meters: f64) -> f64 {
    meters / US_SURVEY_FOOT_M
}

pub fn international_feet_to_meters(feet: f64) -> f64 {
    feet * INTERNATIONAL_FOOT_M
}

pub fn meters_to_international_feet(meters: f64) -> f64 {
    meters / INTERNATIONAL_FOOT_M
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn us_survey_foot_roundtrip() {
        let meters = us_survey_feet_to_meters(1000.0);
        assert!((meters_to_us_survey_feet(meters) - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn international_foot_roundtrip() {
        let meters = international_feet_to_meters(1000.0);
        assert!((meters_to_international_feet(meters) - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn survey_and_international_feet_are_distinct() {
        // Over 1000 ft the two definitions differ by a small but non-zero amount.
        let diff = us_survey_feet_to_meters(1000.0) - international_feet_to_meters(1000.0);
        assert!(diff.abs() > 1e-6, "expected a measurable difference");
        assert!(
            diff.abs() < 0.01,
            "difference should be sub-centimeter over 1000 ft"
        );
    }
}
