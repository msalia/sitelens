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

/// A length unit used at I/O boundaries. The canonical internal unit is meters.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum LengthUnit {
    UsSurveyFoot,
    InternationalFoot,
    Meter,
}

impl LengthUnit {
    /// Converts a value expressed in this unit to meters.
    pub fn to_meters(self, value: f64) -> f64 {
        match self {
            LengthUnit::UsSurveyFoot => us_survey_feet_to_meters(value),
            LengthUnit::InternationalFoot => international_feet_to_meters(value),
            LengthUnit::Meter => value,
        }
    }

    /// Converts a value in meters to this unit.
    pub fn from_meters(self, meters: f64) -> f64 {
        match self {
            LengthUnit::UsSurveyFoot => meters_to_us_survey_feet(meters),
            LengthUnit::InternationalFoot => meters_to_international_feet(meters),
            LengthUnit::Meter => meters,
        }
    }

    /// The DB string for the `projects.display_unit` column.
    pub fn as_db_str(self) -> &'static str {
        match self {
            LengthUnit::UsSurveyFoot => "us_survey_foot",
            LengthUnit::InternationalFoot => "international_foot",
            LengthUnit::Meter => "meter",
        }
    }

    pub fn from_db_str(s: &str) -> Option<LengthUnit> {
        match s {
            "us_survey_foot" => Some(LengthUnit::UsSurveyFoot),
            "international_foot" => Some(LengthUnit::InternationalFoot),
            "meter" => Some(LengthUnit::Meter),
            _ => None,
        }
    }
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

    #[test]
    fn length_unit_to_from_meters_roundtrip() {
        for unit in [
            LengthUnit::UsSurveyFoot,
            LengthUnit::InternationalFoot,
            LengthUnit::Meter,
        ] {
            let meters = unit.to_meters(1234.567);
            assert!((unit.from_meters(meters) - 1234.567).abs() < 1e-9);
        }
        // Meter is the identity.
        assert_eq!(LengthUnit::Meter.to_meters(42.0), 42.0);
    }
}
