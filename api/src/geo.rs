//! The geo-core: the 4-parameter Helmert (similarity) transform that ties the
//! building grid to projected coordinates.
//!
//! The model maps grid (x, y) → projected (E, N):
//!
//! ```text
//! E = a·x − b·y + tx
//! N = b·x + a·y + ty
//! ```
//!
//! where `a = s·cosθ`, `b = s·sinθ`, so scale `s = √(a²+b²)` and rotation
//! `θ = atan2(b, a)`. The four unknowns (a, b, tx, ty) are linear, so we solve
//! by least squares over all correspondences (exact when exactly two points).

use nalgebra::{DMatrix, DVector};

/// A grid↔projected correspondence (all values in meters).
#[derive(Debug, Clone, Copy)]
pub struct Correspondence {
    pub grid_x: f64,
    pub grid_y: f64,
    pub proj_e: f64,
    pub proj_n: f64,
}

/// The solved similarity-transform parameters.
#[derive(Debug, Clone, Copy)]
pub struct HelmertParams {
    pub a: f64,
    pub b: f64,
    pub tx: f64,
    pub ty: f64,
}

impl HelmertParams {
    pub fn scale(&self) -> f64 {
        self.a.hypot(self.b)
    }

    /// Rotation in radians, in (−π, π].
    pub fn rotation_rad(&self) -> f64 {
        self.b.atan2(self.a)
    }

    /// Applies the transform to a grid point, returning projected (E, N).
    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x - self.b * y + self.tx,
            self.b * x + self.a * y + self.ty,
        )
    }

    /// Inverse: projected (E, N) → grid (x, y).
    pub fn inverse(&self, e: f64, n: f64) -> (f64, f64) {
        let d = self.a * self.a + self.b * self.b;
        let (de, dn) = (e - self.tx, n - self.ty);
        ((self.a * de + self.b * dn) / d, (-self.b * de + self.a * dn) / d)
    }

    /// Rebuilds parameters from the persisted scale/rotation/translation form.
    pub fn from_components(scale: f64, rotation_rad: f64, tx: f64, ty: f64) -> Self {
        Self {
            a: scale * rotation_rad.cos(),
            b: scale * rotation_rad.sin(),
            tx,
            ty,
        }
    }
}

/// Residual at one correspondence: observed − computed, in meters.
#[derive(Debug, Clone, Copy)]
pub struct PointResidual {
    pub index: usize,
    pub de: f64,
    pub dn: f64,
    pub magnitude: f64,
}

#[derive(Debug, Clone)]
pub struct Solution {
    pub params: HelmertParams,
    pub residuals: Vec<PointResidual>,
    /// RMS of the residual magnitudes (meters): √(Σ(de²+dn²) / 2n).
    pub rms: f64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum GeoError {
    /// Fewer than two correspondences were supplied.
    TooFewPoints,
    /// The configuration is rank-deficient (e.g. all grid points coincident).
    Degenerate,
}

impl std::fmt::Display for GeoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GeoError::TooFewPoints => write!(f, "at least two control points are required"),
            GeoError::Degenerate => {
                write!(
                    f,
                    "control points are degenerate (e.g. coincident in grid space)"
                )
            }
        }
    }
}

/// Solves the 4-parameter Helmert transform from grid to projected space.
pub fn solve_helmert(points: &[Correspondence]) -> Result<Solution, GeoError> {
    let n = points.len();
    if n < 2 {
        return Err(GeoError::TooFewPoints);
    }

    // Design matrix A (2n×4) and observation vector L (2n).
    let mut a = DMatrix::<f64>::zeros(2 * n, 4);
    let mut l = DVector::<f64>::zeros(2 * n);
    for (i, p) in points.iter().enumerate() {
        // E row: [x, −y, 1, 0]
        a[(2 * i, 0)] = p.grid_x;
        a[(2 * i, 1)] = -p.grid_y;
        a[(2 * i, 2)] = 1.0;
        l[2 * i] = p.proj_e;
        // N row: [y, x, 0, 1]
        a[(2 * i + 1, 0)] = p.grid_y;
        a[(2 * i + 1, 1)] = p.grid_x;
        a[(2 * i + 1, 3)] = 1.0;
        l[2 * i + 1] = p.proj_n;
    }

    let svd = a.svd(true, true);
    // Rank check: the smallest singular value must be meaningfully non-zero
    // relative to the largest, or the system is rank-deficient.
    let sv = &svd.singular_values;
    let max_sv = sv.max();
    let min_sv = sv.min();
    if max_sv <= 0.0 || min_sv <= 1e-9 * max_sv {
        return Err(GeoError::Degenerate);
    }

    let solution = svd.solve(&l, 1e-12).map_err(|_| GeoError::Degenerate)?;
    let params = HelmertParams {
        a: solution[0],
        b: solution[1],
        tx: solution[2],
        ty: solution[3],
    };
    if !params.a.is_finite() || !params.b.is_finite() || params.scale() < 1e-12 {
        return Err(GeoError::Degenerate);
    }

    let mut sum_sq = 0.0;
    let mut residuals = Vec::with_capacity(n);
    for (i, p) in points.iter().enumerate() {
        let (e, n_) = params.apply(p.grid_x, p.grid_y);
        let de = p.proj_e - e;
        let dn = p.proj_n - n_;
        sum_sq += de * de + dn * dn;
        residuals.push(PointResidual {
            index: i,
            de,
            dn,
            magnitude: de.hypot(dn),
        });
    }
    let rms = (sum_sq / (2.0 * n as f64)).sqrt();

    Ok(Solution {
        params,
        residuals,
        rms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cp(grid_x: f64, grid_y: f64, proj_e: f64, proj_n: f64) -> Correspondence {
        Correspondence {
            grid_x,
            grid_y,
            proj_e,
            proj_n,
        }
    }

    #[test]
    fn fewer_than_two_points_errors() {
        assert!(matches!(solve_helmert(&[]), Err(GeoError::TooFewPoints)));
        assert!(matches!(
            solve_helmert(&[cp(0.0, 0.0, 1.0, 2.0)]),
            Err(GeoError::TooFewPoints)
        ));
    }

    #[test]
    fn coincident_grid_points_are_degenerate() {
        // Two points at the same grid location cannot define a transform.
        let pts = [cp(5.0, 5.0, 100.0, 200.0), cp(5.0, 5.0, 110.0, 210.0)];
        assert_eq!(solve_helmert(&pts).unwrap_err(), GeoError::Degenerate);
    }

    #[test]
    fn pure_translation_two_points() {
        // scale 1, rotation 0, translation (100, 200).
        let pts = [cp(0.0, 0.0, 100.0, 200.0), cp(10.0, 0.0, 110.0, 200.0)];
        let s = solve_helmert(&pts).unwrap();
        assert!((s.params.tx - 100.0).abs() < 1e-9);
        assert!((s.params.ty - 200.0).abs() < 1e-9);
        assert!((s.params.scale() - 1.0).abs() < 1e-9);
        assert!(s.params.rotation_rad().abs() < 1e-9);
        assert!(s.rms < 1e-9);
    }

    #[test]
    fn rotation_90_and_scale_2() {
        // a = s·cosθ = 0, b = s·sinθ = 2 for θ=90°, s=2.
        // (1,0) → (0, 2); (0,1) → (−2, 0); (0,0) → (0,0).
        let pts = [
            cp(0.0, 0.0, 0.0, 0.0),
            cp(1.0, 0.0, 0.0, 2.0),
            cp(0.0, 1.0, -2.0, 0.0),
        ];
        let s = solve_helmert(&pts).unwrap();
        assert!(
            (s.params.scale() - 2.0).abs() < 1e-9,
            "scale {}",
            s.params.scale()
        );
        assert!(
            (s.params.rotation_rad() - std::f64::consts::FRAC_PI_2).abs() < 1e-9,
            "rotation {}",
            s.params.rotation_rad()
        );
        assert!(s.rms < 1e-9);
    }

    #[test]
    fn least_squares_reports_nonzero_rms_for_inconsistent_points() {
        // Three points consistent with identity + one perturbed point.
        let pts = [
            cp(0.0, 0.0, 0.0, 0.0),
            cp(10.0, 0.0, 10.0, 0.0),
            cp(0.0, 10.0, 0.0, 10.0),
            cp(10.0, 10.0, 10.5, 10.0), // 0.5 m off
        ];
        let s = solve_helmert(&pts).unwrap();
        assert!(s.rms > 0.0, "expected non-zero RMS");
        assert!(s.rms < 0.5, "best fit should distribute the error");
        // Scale should still be ~1.
        assert!((s.params.scale() - 1.0).abs() < 0.05);
        assert_eq!(s.residuals.len(), 4);
    }

    #[test]
    fn forward_inverse_are_consistent() {
        let p = HelmertParams::from_components(1.5, 0.4, 100.0, 200.0);
        let (e, n) = p.apply(12.0, -7.0);
        let (x, y) = p.inverse(e, n);
        assert!((x - 12.0).abs() < 1e-9 && (y + 7.0).abs() < 1e-9);
    }

    #[test]
    fn apply_roundtrips_through_solved_params() {
        let pts = [
            cp(0.0, 0.0, 1000.0, 2000.0),
            cp(50.0, 0.0, 1030.0, 2040.0),
            cp(0.0, 50.0, 960.0, 2030.0),
        ];
        let s = solve_helmert(&pts).unwrap();
        for p in &pts {
            let (e, n) = s.params.apply(p.grid_x, p.grid_y);
            assert!((e - p.proj_e).abs() < 1e-6 && (n - p.proj_n).abs() < 1e-6);
        }
    }
}
