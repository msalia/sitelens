//! Low-speed **tractrix** swept-path for turning analysis.
//!
//! The user draws the **front-axle** path (a polyline). The rear axle trails it
//! by the wheelbase along a tractrix (pursuit) curve — at each step the rear axle
//! moves straight toward the current front-axle position, staying exactly one
//! wheelbase behind. From the two axles + overhangs + width we build the vehicle
//! body at each step; their union is the swept area, and off-tracking (the rear
//! cutting inside the front) is what clips curbs.
//!
//! Single-unit model (one wheelbase): exact for cars, single-unit trucks, buses,
//! and fire apparatus. Articulated tractor-trailers (WB-*) are approximated as a
//! single unit at the tractor wheelbase — a documented v1 limitation.
//!
//! All coordinates are planar meters `[e, n]` (the caller works in the site frame).

/// Vehicle dimensions (meters).
pub struct Vehicle {
    pub wheelbase: f64,
    pub front_overhang: f64,
    pub rear_overhang: f64,
    pub width: f64,
}

/// The computed swept path.
#[derive(Debug, Clone, PartialEq)]
pub struct SweptPath {
    /// Densified front-axle path (the drawn centerline).
    pub front_track: Vec<[f64; 2]>,
    /// Rear-axle tractrix path (the off-tracking curve).
    pub rear_track: Vec<[f64; 2]>,
    /// Vehicle body quads `[FL, FR, RR, RL]` per step (the swept area = their union).
    pub bodies: Vec<[[f64; 2]; 4]>,
    /// Outer swept boundary: left body edge forward, right body edge back — a ring.
    pub envelope: Vec<[f64; 2]>,
}

fn sub(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}
fn add(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] + b[0], a[1] + b[1]]
}
fn scale(a: [f64; 2], s: f64) -> [f64; 2] {
    [a[0] * s, a[1] * s]
}
fn hypot(a: [f64; 2]) -> f64 {
    a[0].hypot(a[1])
}
fn unit(a: [f64; 2]) -> [f64; 2] {
    let l = hypot(a);
    if l < 1e-12 {
        [0.0, 0.0]
    } else {
        [a[0] / l, a[1] / l]
    }
}
/// Left normal (90° CCW).
fn perp(a: [f64; 2]) -> [f64; 2] {
    [-a[1], a[0]]
}

/// Resamples a polyline to points spaced ~`step` apart (endpoints kept).
fn densify(path: &[[f64; 2]], step: f64) -> Vec<[f64; 2]> {
    let mut out = vec![path[0]];
    for w in path.windows(2) {
        let (a, b) = (w[0], w[1]);
        let seg = sub(b, a);
        let len = hypot(seg);
        if len < 1e-9 {
            continue;
        }
        let dir = scale(seg, 1.0 / len);
        let n = (len / step).floor() as usize;
        for i in 1..=n {
            let d = i as f64 * step;
            if d < len - 1e-9 {
                out.push(add(a, scale(dir, d)));
            }
        }
        out.push(b);
    }
    out
}

/// Computes the swept path from a drawn front-axle polyline.
pub fn swept_path(path: &[[f64; 2]], v: &Vehicle, step: f64) -> Result<SweptPath, String> {
    if path.len() < 2 {
        return Err("draw a path with at least two points".into());
    }
    if !step.is_finite() || step <= 0.0 {
        return Err("step resolution must be positive".into());
    }
    if v.wheelbase <= 0.0 || v.width <= 0.0 {
        return Err("vehicle wheelbase and width must be positive".into());
    }

    let front = densify(path, step);
    if front.len() < 2 {
        return Err("path is too short to sweep".into());
    }

    let half = v.width / 2.0;
    // Rear axle starts one wheelbase behind the first point, along initial heading.
    let h0 = unit(sub(front[1], front[0]));
    let mut r = sub(front[0], scale(h0, v.wheelbase));

    let mut rear_track = Vec::with_capacity(front.len());
    let mut bodies = Vec::with_capacity(front.len());
    let mut left = Vec::with_capacity(front.len());
    let mut right = Vec::with_capacity(front.len());

    for &f in &front {
        // Tractrix step: pull the rear axle straight toward the front axle, held
        // one wheelbase behind.
        let d = sub(f, r);
        let dist = hypot(d);
        let h = if dist < 1e-12 { h0 } else { unit(d) };
        r = sub(f, scale(h, v.wheelbase));
        rear_track.push(r);

        let p = perp(h);
        let fc = add(f, scale(h, v.front_overhang));
        let rc = sub(r, scale(h, v.rear_overhang));
        let fl = add(fc, scale(p, half));
        let fr = sub(fc, scale(p, half));
        let rl = add(rc, scale(p, half));
        let rr = sub(rc, scale(p, half));
        bodies.push([fl, fr, rr, rl]);
        left.push(fl);
        right.push(fr);
    }

    // Envelope ring: left bumper corners forward, right bumper corners back, plus
    // the rear corners at the two ends so the body caps are enclosed.
    let mut envelope = Vec::with_capacity(left.len() * 2 + 4);
    if let Some(first) = bodies.first() {
        envelope.push(first[3]); // rear-left of the start cap
    }
    envelope.extend(left.iter().copied());
    if let Some(last) = bodies.last() {
        envelope.push(last[2]); // rear-right of the end cap
    }
    envelope.extend(right.iter().rev().copied());

    Ok(SweptPath {
        front_track: front,
        rear_track,
        bodies,
        envelope,
    })
}

/// Whether a point lies inside a convex quad (consistent winding via cross-signs).
fn point_in_quad(q: &[[f64; 2]; 4], pt: [f64; 2]) -> bool {
    let mut sign = 0.0;
    for i in 0..4 {
        let a = q[i];
        let b = q[(i + 1) % 4];
        let cross = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
        if cross.abs() < 1e-9 {
            continue;
        }
        if sign == 0.0 {
            sign = cross.signum();
        } else if cross.signum() != sign {
            return false;
        }
    }
    true
}

/// Do segments `p1p2` and `p3p4` properly intersect?
fn segments_intersect(p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], p4: [f64; 2]) -> bool {
    let d = |a: [f64; 2], b: [f64; 2], c: [f64; 2]| {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };
    let d1 = d(p3, p4, p1);
    let d2 = d(p3, p4, p2);
    let d3 = d(p1, p2, p3);
    let d4 = d(p1, p2, p4);
    ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0))
}

/// Clip points where any obstacle polyline enters the swept area — obstacle
/// vertices inside a body quad, or obstacle segments crossing a body edge. Empty
/// = the vehicle clears every obstacle.
pub fn clearance(bodies: &[[[f64; 2]; 4]], obstacles: &[Vec<[f64; 2]>]) -> Vec<[f64; 2]> {
    let mut clips: Vec<[f64; 2]> = Vec::new();
    let mut push = |p: [f64; 2]| {
        if !clips
            .iter()
            .any(|c| (c[0] - p[0]).abs() < 1e-6 && (c[1] - p[1]).abs() < 1e-6)
        {
            clips.push(p);
        }
    };
    for obs in obstacles {
        // Vertices inside any body quad.
        for &pt in obs {
            if bodies.iter().any(|q| point_in_quad(q, pt)) {
                push(pt);
            }
        }
        // Segments crossing any body edge.
        for w in obs.windows(2) {
            let (a, b) = (w[0], w[1]);
            'outer: for q in bodies {
                for i in 0..4 {
                    if segments_intersect(a, b, q[i], q[(i + 1) % 4]) {
                        push([(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]);
                        break 'outer;
                    }
                }
            }
        }
    }
    clips
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    fn car() -> Vehicle {
        Vehicle {
            wheelbase: 3.4,
            front_overhang: 0.9,
            rear_overhang: 1.5,
            width: 2.1,
        }
    }

    #[test]
    fn straight_path_rear_trails_by_wheelbase() {
        let v = car();
        let sp = swept_path(&[[0.0, 0.0], [50.0, 0.0]], &v, 1.0).unwrap();
        // On a straight, the rear axle sits exactly one wheelbase behind the front.
        let f = *sp.front_track.last().unwrap();
        let r = *sp.rear_track.last().unwrap();
        assert!((hypot(sub(f, r)) - v.wheelbase).abs() < 1e-6);
        // And directly behind (no lateral offset).
        assert!((r[1]).abs() < 1e-6);
    }

    #[test]
    fn circular_turn_matches_offtracking_closed_form() {
        // Front axle on a circle of radius R: the rear axle settles to radius
        // sqrt(R² − L²) (steady-state off-tracking). Drive >1 full turn so the
        // tractrix reaches steady state, then check the last point.
        let v = car();
        let r_front = 15.0;
        let l = v.wheelbase;
        let mut path = Vec::new();
        let steps = 900; // ~1.4 turns, fine resolution
        for i in 0..=steps {
            let a = i as f64 / 200.0; // radians; 200 steps per radian
            path.push([r_front * a.cos(), r_front * a.sin()]);
        }
        let sp = swept_path(&path, &v, 0.25).unwrap();
        let r = *sp.rear_track.last().unwrap();
        let rear_radius = hypot(r); // circle centered at origin
        let expected = (r_front * r_front - l * l).sqrt();
        assert!(
            (rear_radius - expected).abs() < 0.05,
            "rear radius {rear_radius:.3} vs closed-form {expected:.3}"
        );
        // Off-tracking (front radius − rear radius) is positive and sane.
        assert!(r_front - rear_radius > 0.3);
    }

    #[test]
    fn clearance_flags_an_obstacle_in_the_path_and_clears_one_outside() {
        let v = car();
        // A straight sweep down the +x axis, ~2.1 m wide.
        let sp = swept_path(&[[0.0, 0.0], [30.0, 0.0]], &v, 0.5).unwrap();
        // A curb point right on the centerline is clipped.
        let hit = clearance(&sp.bodies, &[vec![[15.0, 0.0]]]);
        assert!(!hit.is_empty(), "expected a clip on the centerline");
        // A point well off to the side clears.
        let clear = clearance(&sp.bodies, &[vec![[15.0, 20.0]]]);
        assert!(clear.is_empty(), "expected clearance far from the path");
        // An obstacle segment crossing the swept band is caught.
        let crossing = clearance(&sp.bodies, &[vec![[15.0, -5.0], [15.0, 5.0]]]);
        assert!(!crossing.is_empty(), "expected a crossing clip");
    }

    #[test]
    fn degenerate_inputs_error() {
        let v = car();
        assert!(swept_path(&[[0.0, 0.0]], &v, 1.0).is_err());
        assert!(swept_path(&[[0.0, 0.0], [1.0, 0.0]], &v, 0.0).is_err());
    }

    #[test]
    fn quarter_turn_produces_a_nonempty_envelope() {
        let v = car();
        let mut path = Vec::new();
        for i in 0..=40 {
            let a = i as f64 / 40.0 * (PI / 2.0);
            path.push([20.0 * a.cos(), 20.0 * a.sin()]);
        }
        let sp = swept_path(&path, &v, 0.5).unwrap();
        assert!(sp.envelope.len() > 10);
        assert_eq!(sp.bodies.len(), sp.front_track.len());
    }
}
