//! Bay-based **parking-stall tiling** and code checks.
//!
//! The user draws one or more **bay baselines** (the aisle-side edge of a row of
//! stalls) as polylines. Along each straight segment we tile stalls to one side
//! (the left of the drawn direction), at the given stall size and angle. The
//! result is deterministic geometry — every stall is a parallelogram we can draw,
//! export to DXF, and count — never a physics/packing heuristic.
//!
//! ## Angled-stall geometry
//! For stall angle `θ` (90° = perpendicular), a stall's frontage along the aisle
//! (the tiling pitch, or "module") is `width / sin θ`; its perpendicular reach
//! into the lot (the module depth) is `length · sin θ`. At θ = 90° a stall is a
//! `width × length` rectangle with pitch = `width` and depth = `length`. Each
//! stall stays exactly `width` wide measured perpendicular to its own long axis.
//!
//! All coordinates are planar meters `[e, n]` in the site frame.

use super::vec2::{add, hypot, perp, scale, sub, unit};

/// A stall footprint: `[front-near, front-far, back-far, back-near]`, wound
/// consistently (front edge lies on the aisle, sides run into the lot).
pub type Stall = [[f64; 2]; 4];

/// Stall dimensions + angle (meters, degrees).
pub struct StallSpec {
    /// Stall depth into the lot, along the stall's long axis.
    pub length: f64,
    /// Stall width, measured perpendicular to the stall's long axis.
    pub width: f64,
    /// Stall angle to the aisle: 90 = perpendicular, 60/45 = angled.
    pub angle_deg: f64,
}

/// The tiled layout for a set of bays.
#[derive(Debug, Clone, PartialEq)]
pub struct ParkingLayout {
    /// Every tiled stall footprint.
    pub stalls: Vec<Stall>,
    /// Perpendicular reach of a stall into the lot (`length · sin θ`).
    pub module_depth: f64,
}

/// Tiles stalls along one bay baseline (each straight segment tiled independently
/// so an L-shaped bay works). Stalls extend to the **left** of the drawn
/// direction. Returns the stall footprints for this bay.
fn tile_baseline(baseline: &[[f64; 2]], spec: &StallSpec, pitch: f64, dir_up: f64) -> Vec<Stall> {
    let mut stalls = Vec::new();
    let sin = spec.angle_deg.to_radians().sin();
    let cos = spec.angle_deg.to_radians().cos();
    for w in baseline.windows(2) {
        let (a, b) = (w[0], w[1]);
        let seg = sub(b, a);
        let seg_len = hypot(seg);
        if seg_len < pitch {
            continue;
        }
        let d = unit(seg);
        let p = perp(d); // left normal — into the lot
                         // Stall long axis: forward-leaning by the stall angle.
        let s = add(scale(d, cos * dir_up), scale(p, sin));
        let n = (seg_len / pitch).floor() as usize;
        for i in 0..n {
            let near = add(a, scale(d, i as f64 * pitch));
            let far = add(a, scale(d, (i + 1) as f64 * pitch));
            let back_near = add(near, scale(s, spec.length));
            let back_far = add(far, scale(s, spec.length));
            stalls.push([near, far, back_far, back_near]);
        }
    }
    stalls
}

/// Tiles stalls across every bay. Errors on non-positive dimensions or an angle
/// outside `(0, 90]` (a degenerate stall).
pub fn tile_bays(bays: &[Vec<[f64; 2]>], spec: &StallSpec) -> Result<ParkingLayout, String> {
    if spec.length <= 0.0 || spec.width <= 0.0 {
        return Err("stall length and width must be positive".into());
    }
    if !spec.angle_deg.is_finite() || spec.angle_deg <= 0.0 || spec.angle_deg > 90.0 {
        return Err("stall angle must be between 0 and 90 degrees".into());
    }
    let sin = spec.angle_deg.to_radians().sin();
    // Tiling pitch (curb frontage per stall): width / sin θ.
    let pitch = spec.width / sin;
    let mut stalls = Vec::new();
    for bay in bays {
        if bay.len() >= 2 {
            stalls.extend(tile_baseline(bay, spec, pitch, 1.0));
        }
    }
    Ok(ParkingLayout {
        stalls,
        module_depth: spec.length * sin,
    })
}

/// Minimum accessible stalls required by ADA 2010 Standards **§208.2** for a lot
/// of `total` spaces. 1–25→1, then stepping up to 500; above 500 it is 2% of the
/// total; above 1000 it is 20 plus one per additional 100 (rounding up).
pub fn ada_required(total: u32) -> u32 {
    match total {
        0 => 0,
        1..=25 => 1,
        26..=50 => 2,
        51..=75 => 3,
        76..=100 => 4,
        101..=150 => 5,
        151..=200 => 6,
        201..=300 => 7,
        301..=400 => 8,
        401..=500 => 9,
        501..=1000 => (total * 2).div_ceil(100), // 2% of total, rounded up
        _ => 20 + (total - 1000).div_ceil(100),
    }
}

/// Van-accessible stalls required (§208.2.4): at least one of every six (or
/// fraction thereof) accessible stalls must be van-accessible.
pub fn van_required(accessible: u32) -> u32 {
    accessible.div_ceil(6)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(angle: f64) -> StallSpec {
        StallSpec {
            length: 5.5,
            width: 2.5,
            angle_deg: angle,
        }
    }

    /// A perpendicular bay tiles `floor(len / width)` rectangular stalls.
    #[test]
    fn perpendicular_bay_count_and_rectangle() {
        let bay = vec![vec![[0.0, 0.0], [30.0, 0.0]]];
        let layout = tile_bays(&bay, &spec(90.0)).unwrap();
        assert_eq!(layout.stalls.len(), 12); // floor(30 / 2.5)
        assert!((layout.module_depth - 5.5).abs() < 1e-9);

        // First stall is a 2.5 (along the aisle) × 5.5 (into the lot) rectangle,
        // extending to the left (+n) of the +e drawn direction.
        let s = layout.stalls[0];
        assert!((hypot(sub(s[1], s[0])) - 2.5).abs() < 1e-9); // front edge = width
        assert!((hypot(sub(s[3], s[0])) - 5.5).abs() < 1e-9); // side = length
        assert!(s[3][1] > 0.0, "stall should tile to the left (+northing)");
        // Right-angle corner.
        let e1 = sub(s[1], s[0]);
        let e2 = sub(s[3], s[0]);
        assert!((e1[0] * e2[0] + e1[1] * e2[1]).abs() < 1e-9);
    }

    /// Angled bays consume more curb per stall, so fewer fit in the same length.
    #[test]
    fn angled_bays_tile_fewer_stalls() {
        let bay = vec![vec![[0.0, 0.0], [30.0, 0.0]]];
        // pitch = 2.5 / sin θ → 60°: 2.887 → 10; 45°: 3.536 → 8.
        assert_eq!(tile_bays(&bay, &spec(60.0)).unwrap().stalls.len(), 10);
        assert_eq!(tile_bays(&bay, &spec(45.0)).unwrap().stalls.len(), 8);
        // Module depth is shallower for angled stalls (length · sin θ).
        let d45 = tile_bays(&bay, &spec(45.0)).unwrap().module_depth;
        assert!((d45 - 5.5 * (45.0_f64).to_radians().sin()).abs() < 1e-9);
    }

    /// Each stall is exactly `width` wide perpendicular to its own long axis,
    /// even when angled (parallelogram, not a wider slab).
    #[test]
    fn angled_stall_perpendicular_width_is_preserved() {
        let bay = vec![vec![[0.0, 0.0], [40.0, 0.0]]];
        let layout = tile_bays(&bay, &spec(45.0)).unwrap();
        let s = layout.stalls[0];
        let front = sub(s[1], s[0]); // along the aisle, length = pitch
        let side = unit(sub(s[3], s[0])); // stall long axis
                                          // Perpendicular distance of the front edge across the long axis = width.
        let cross = (front[0] * side[1] - front[1] * side[0]).abs();
        assert!((cross - 2.5).abs() < 1e-6, "perpendicular width {cross}");
    }

    /// Multi-segment (L-shaped) bays tile each leg.
    #[test]
    fn multi_segment_bay_tiles_each_leg() {
        let bay = vec![vec![[0.0, 0.0], [30.0, 0.0], [30.0, 30.0]]];
        let layout = tile_bays(&bay, &spec(90.0)).unwrap();
        assert_eq!(layout.stalls.len(), 24); // 12 per 30 m leg
    }

    /// A baseline shorter than one stall pitch tiles nothing.
    #[test]
    fn too_short_bay_tiles_nothing() {
        let bay = vec![vec![[0.0, 0.0], [2.0, 0.0]]];
        assert!(tile_bays(&bay, &spec(90.0)).unwrap().stalls.is_empty());
    }

    #[test]
    fn degenerate_specs_error() {
        let bay = vec![vec![[0.0, 0.0], [10.0, 0.0]]];
        assert!(tile_bays(
            &bay,
            &StallSpec {
                length: 0.0,
                width: 2.5,
                angle_deg: 90.0
            }
        )
        .is_err());
        assert!(tile_bays(
            &bay,
            &StallSpec {
                length: 5.5,
                width: 2.5,
                angle_deg: 0.0
            }
        )
        .is_err());
        assert!(tile_bays(
            &bay,
            &StallSpec {
                length: 5.5,
                width: 2.5,
                angle_deg: 120.0
            }
        )
        .is_err());
    }

    /// ADA §208.2 table across the published boundaries.
    #[test]
    fn ada_table_boundaries() {
        assert_eq!(ada_required(0), 0);
        assert_eq!(ada_required(1), 1);
        assert_eq!(ada_required(25), 1);
        assert_eq!(ada_required(26), 2);
        assert_eq!(ada_required(50), 2);
        assert_eq!(ada_required(51), 3);
        assert_eq!(ada_required(75), 3);
        assert_eq!(ada_required(76), 4);
        assert_eq!(ada_required(100), 4);
        assert_eq!(ada_required(101), 5);
        assert_eq!(ada_required(150), 5);
        assert_eq!(ada_required(200), 6);
        assert_eq!(ada_required(300), 7);
        assert_eq!(ada_required(400), 8);
        assert_eq!(ada_required(500), 9);
        assert_eq!(ada_required(501), 11); // ceil(2% of 501) = ceil(10.02)
        assert_eq!(ada_required(1000), 20); // 2% of 1000
        assert_eq!(ada_required(1001), 21); // 20 + 1
        assert_eq!(ada_required(1100), 21); // 20 + ceil(100/100)
        assert_eq!(ada_required(1101), 22); // 20 + ceil(101/100)
    }

    /// Van-accessible: one per six accessible (or fraction).
    #[test]
    fn van_table() {
        assert_eq!(van_required(0), 0);
        assert_eq!(van_required(1), 1);
        assert_eq!(van_required(6), 1);
        assert_eq!(van_required(7), 2);
        assert_eq!(van_required(12), 2);
    }
}
