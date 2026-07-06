//! As-built QC comparison: match imported field points to design points by
//! number, compute stakeout deltas in the projected-ground (primary) and
//! building-grid (secondary) frames, and classify each against a tolerance spec.
//!
//! Pure functions — the resolver handles decode / coordinate conversion /
//! persistence. All coordinates in are canonical **projected-grid meters**;
//! ground deltas divide the grid miss by the combined scale factor. Elevation is
//! never scaled.

use std::collections::HashMap;

use uuid::Uuid;

use crate::geo::HelmertParams;

/// Stakeout tolerance thresholds (meters): horizontal + vertical, warn + fail.
#[derive(Debug, Clone, Copy)]
pub struct Tolerance {
    pub h_warn: f64,
    pub h_fail: f64,
    pub v_warn: f64,
    pub v_fail: f64,
}

/// A design (baseline) point in canonical projected-grid meters.
#[derive(Debug, Clone)]
pub struct DesignPoint {
    pub id: Uuid,
    pub label: String,
    pub n: f64,
    pub e: f64,
    pub z: Option<f64>,
}

/// An imported as-built point in canonical projected-grid meters.
#[derive(Debug, Clone)]
pub struct AsBuiltPoint {
    pub label: String,
    pub n: f64,
    pub e: f64,
    pub z: Option<f64>,
}

/// How an as-built was paired to its design point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchMethod {
    Number,
    Manual,
    Unmatched,
}

impl MatchMethod {
    pub fn as_db_str(self) -> &'static str {
        match self {
            MatchMethod::Number => "number",
            MatchMethod::Manual => "manual",
            MatchMethod::Unmatched => "unmatched",
        }
    }
}

/// Tolerance classification of a compared point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pass,
    Warn,
    Fail,
    Unmatched,
    /// Horizontal passed but no vertical delta was computable (a Z was missing).
    NoVertical,
}

impl Status {
    pub fn as_db_str(self) -> &'static str {
        match self {
            Status::Pass => "pass",
            Status::Warn => "warn",
            Status::Fail => "fail",
            Status::Unmatched => "unmatched",
            Status::NoVertical => "no_vertical",
        }
    }
}

/// One compared as-built point: snapshotted both sides + deltas in both frames.
#[derive(Debug, Clone)]
pub struct Comparison {
    pub as_built_label: String,
    pub as_built_n: f64,
    pub as_built_e: f64,
    pub as_built_z: Option<f64>,
    pub design_id: Option<Uuid>,
    pub design_n: Option<f64>,
    pub design_e: Option<f64>,
    pub design_z: Option<f64>,
    pub match_method: MatchMethod,
    // projected-ground frame (primary)
    pub delta_n: Option<f64>,
    pub delta_e: Option<f64>,
    pub delta_z: Option<f64>,
    pub delta_h_radial: Option<f64>,
    // building-grid frame (secondary)
    pub delta_grid_n: Option<f64>,
    pub delta_grid_e: Option<f64>,
    pub status: Status,
}

fn h_status(radial: f64, tol: &Tolerance) -> Status {
    if radial <= tol.h_warn {
        Status::Pass
    } else if radial <= tol.h_fail {
        Status::Warn
    } else {
        Status::Fail
    }
}

fn v_status(dz: f64, tol: &Tolerance) -> Status {
    let a = dz.abs();
    if a <= tol.v_warn {
        Status::Pass
    } else if a <= tol.v_fail {
        Status::Warn
    } else {
        Status::Fail
    }
}

/// Severity rank for combining horizontal + vertical verdicts (higher = worse).
fn rank(s: Status) -> u8 {
    match s {
        Status::Pass => 0,
        Status::NoVertical => 1,
        Status::Warn => 2,
        Status::Fail => 3,
        Status::Unmatched => 4,
    }
}

fn worse(a: Status, b: Status) -> Status {
    if rank(a) >= rank(b) {
        a
    } else {
        b
    }
}

/// Compares one as-built against an optional design match. `method` is ignored
/// when `design` is `None` (the row is `unmatched`).
pub fn compare_one(
    ab: &AsBuiltPoint,
    design: Option<&DesignPoint>,
    method: MatchMethod,
    tol: &Tolerance,
    csf: f64,
    params: Option<HelmertParams>,
) -> Comparison {
    let mut row = Comparison {
        as_built_label: ab.label.clone(),
        as_built_n: ab.n,
        as_built_e: ab.e,
        as_built_z: ab.z,
        design_id: None,
        design_n: None,
        design_e: None,
        design_z: None,
        match_method: MatchMethod::Unmatched,
        delta_n: None,
        delta_e: None,
        delta_z: None,
        delta_h_radial: None,
        delta_grid_n: None,
        delta_grid_e: None,
        status: Status::Unmatched,
    };
    let Some(d) = design else {
        return row;
    };

    row.design_id = Some(d.id);
    row.design_n = Some(d.n);
    row.design_e = Some(d.e);
    row.design_z = d.z;
    row.match_method = method;

    // Building-grid deltas (secondary): transform both to grid space, subtract.
    if let Some(t) = params {
        let (abx, aby) = t.inverse(ab.e, ab.n);
        let (dx, dy) = t.inverse(d.e, d.n);
        row.delta_grid_e = Some(abx - dx);
        row.delta_grid_n = Some(aby - dy);
    }

    // Projected-ground deltas (primary): ground miss = grid miss / csf.
    let s = if csf != 0.0 { csf } else { 1.0 };
    let dn = (ab.n - d.n) / s;
    let de = (ab.e - d.e) / s;
    let radial = (dn * dn + de * de).sqrt();
    row.delta_n = Some(dn);
    row.delta_e = Some(de);
    row.delta_h_radial = Some(radial);

    // Elevation delta is unscaled and only computed when both Zs are present.
    let dz = match (ab.z, d.z) {
        (Some(a), Some(b)) => Some(a - b),
        _ => None,
    };
    row.delta_z = dz;

    let h = h_status(radial, tol);
    row.status = match dz {
        Some(z) => worse(h, v_status(z, tol)),
        // No vertical: a passing horizontal is flagged `no_vertical`; a failing
        // horizontal still reports its own (worse) verdict.
        None => {
            if h == Status::Pass {
                Status::NoVertical
            } else {
                h
            }
        }
    };
    row
}

/// Matches every as-built to a design point by exact label, then compares.
/// Duplicate design labels resolve to the first occurrence.
pub fn compare_all(
    as_builts: &[AsBuiltPoint],
    designs: &[DesignPoint],
    tol: &Tolerance,
    csf: f64,
    params: Option<HelmertParams>,
) -> Vec<Comparison> {
    let mut by_label: HashMap<&str, &DesignPoint> = HashMap::with_capacity(designs.len());
    for d in designs {
        by_label.entry(d.label.as_str()).or_insert(d);
    }
    as_builts
        .iter()
        .map(|ab| match by_label.get(ab.label.as_str()) {
            Some(d) => compare_one(ab, Some(d), MatchMethod::Number, tol, csf, params),
            None => compare_one(ab, None, MatchMethod::Unmatched, tol, csf, params),
        })
        .collect()
}

/// Rollup counts + horizontal miss stats over a set of comparison rows.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Summary {
    pub pass: i64,
    pub warn: i64,
    pub fail: i64,
    pub unmatched: i64,
    pub no_vertical: i64,
    pub max_miss: Option<f64>,
    pub rms_miss: Option<f64>,
}

/// Summarizes comparison rows: status counts plus max and RMS horizontal miss
/// over the matched rows.
pub fn summarize(rows: &[Comparison]) -> Summary {
    let mut s = Summary::default();
    let mut sum_sq = 0.0;
    let mut n = 0i64;
    let mut max: Option<f64> = None;
    for r in rows {
        match r.status {
            Status::Pass => s.pass += 1,
            Status::Warn => s.warn += 1,
            Status::Fail => s.fail += 1,
            Status::Unmatched => s.unmatched += 1,
            Status::NoVertical => s.no_vertical += 1,
        }
        if let Some(radial) = r.delta_h_radial {
            sum_sq += radial * radial;
            n += 1;
            max = Some(max.map_or(radial, |m: f64| m.max(radial)));
        }
    }
    s.max_miss = max;
    s.rms_miss = if n > 0 {
        Some((sum_sq / n as f64).sqrt())
    } else {
        None
    };
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tol() -> Tolerance {
        Tolerance {
            h_warn: 0.05,
            h_fail: 0.10,
            v_warn: 0.05,
            v_fail: 0.10,
        }
    }

    fn design(label: &str, n: f64, e: f64, z: Option<f64>) -> DesignPoint {
        DesignPoint {
            id: Uuid::nil(),
            label: label.into(),
            n,
            e,
            z,
        }
    }

    fn ab(label: &str, n: f64, e: f64, z: Option<f64>) -> AsBuiltPoint {
        AsBuiltPoint {
            label: label.into(),
            n,
            e,
            z,
        }
    }

    #[test]
    fn exact_hit_passes() {
        let d = design("1", 100.0, 200.0, Some(5.0));
        let r = compare_one(
            &ab("1", 100.0, 200.0, Some(5.0)),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(r.status, Status::Pass);
        assert_eq!(r.delta_h_radial, Some(0.0));
        assert_eq!(r.delta_z, Some(0.0));
        assert_eq!(r.design_id, Some(Uuid::nil()));
    }

    #[test]
    fn horizontal_warn_and_fail_boundaries() {
        let d = design("1", 0.0, 0.0, Some(0.0));
        // radial exactly 0.05 → pass (<=warn); 0.08 → warn; 0.20 → fail.
        let p = compare_one(
            &ab("1", 0.05, 0.0, Some(0.0)),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(p.status, Status::Pass);
        let w = compare_one(
            &ab("1", 0.08, 0.0, Some(0.0)),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(w.status, Status::Warn);
        let f = compare_one(
            &ab("1", 0.20, 0.0, Some(0.0)),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(f.status, Status::Fail);
    }

    #[test]
    fn vertical_dominates_when_worse() {
        let d = design("1", 0.0, 0.0, Some(0.0));
        // Horizontal pass, vertical fail → overall fail.
        let r = compare_one(
            &ab("1", 0.0, 0.0, Some(0.5)),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(r.delta_z, Some(0.5));
        assert_eq!(r.status, Status::Fail);
    }

    #[test]
    fn no_vertical_when_a_z_is_missing() {
        let d = design("1", 0.0, 0.0, Some(0.0));
        // Horizontal pass, as-built has no Z → no_vertical.
        let r = compare_one(
            &ab("1", 0.0, 0.0, None),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(r.delta_z, None);
        assert_eq!(r.status, Status::NoVertical);
        // Horizontal fail, no Z → still fail (the H problem dominates).
        let f = compare_one(
            &ab("1", 0.30, 0.0, None),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(f.status, Status::Fail);
    }

    #[test]
    fn unmatched_has_null_deltas() {
        let r = compare_one(
            &ab("X", 1.0, 2.0, Some(3.0)),
            None,
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(r.status, Status::Unmatched);
        assert_eq!(r.match_method, MatchMethod::Unmatched);
        assert_eq!(r.delta_h_radial, None);
        assert_eq!(r.design_id, None);
        // As-built coords are still snapshotted.
        assert_eq!(r.as_built_n, 1.0);
    }

    #[test]
    fn ground_delta_divides_by_csf() {
        let d = design("1", 0.0, 0.0, None);
        // 1.0 m grid miss with csf 0.5 → 2.0 m ground miss.
        let r = compare_one(
            &ab("1", 1.0, 0.0, None),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            0.5,
            None,
        );
        assert_eq!(r.delta_n, Some(2.0));
        assert_eq!(r.delta_h_radial, Some(2.0));
    }

    #[test]
    fn grid_deltas_present_only_with_a_transform() {
        let d = design("1", 100.0, 200.0, None);
        let no_t = compare_one(
            &ab("1", 100.5, 200.0, None),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            None,
        );
        assert_eq!(no_t.delta_grid_n, None);
        // Identity transform (scale 1, no rotation/translation): grid == projected.
        let t = HelmertParams::from_components(1.0, 0.0, 0.0, 0.0);
        let with_t = compare_one(
            &ab("1", 100.5, 200.0, None),
            Some(&d),
            MatchMethod::Number,
            &tol(),
            1.0,
            Some(t),
        );
        assert_eq!(with_t.delta_grid_n, Some(0.5));
        assert_eq!(with_t.delta_grid_e, Some(0.0));
    }

    #[test]
    fn compare_all_matches_by_label() {
        let designs = vec![
            design("1", 0.0, 0.0, Some(0.0)),
            design("2", 10.0, 10.0, Some(1.0)),
        ];
        let abs = vec![
            ab("2", 10.0, 10.0, Some(1.0)), // exact hit on #2
            ab("9", 5.0, 5.0, Some(0.0)),   // no match
        ];
        let rows = compare_all(&abs, &designs, &tol(), 1.0, None);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].match_method, MatchMethod::Number);
        assert_eq!(rows[0].status, Status::Pass);
        assert_eq!(rows[1].status, Status::Unmatched);

        let sum = summarize(&rows);
        assert_eq!(sum.pass, 1);
        assert_eq!(sum.unmatched, 1);
        assert_eq!(sum.max_miss, Some(0.0));
        assert_eq!(sum.rms_miss, Some(0.0));
    }
}
