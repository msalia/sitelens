//! Tiny planar-vector helpers shared by the analysis compute modules. All
//! coordinates are planar meters `[e, n]` in the site frame.

pub fn sub(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}
pub fn add(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] + b[0], a[1] + b[1]]
}
pub fn scale(a: [f64; 2], s: f64) -> [f64; 2] {
    [a[0] * s, a[1] * s]
}
pub fn hypot(a: [f64; 2]) -> f64 {
    a[0].hypot(a[1])
}
pub fn unit(a: [f64; 2]) -> [f64; 2] {
    let l = hypot(a);
    if l < 1e-12 {
        [0.0, 0.0]
    } else {
        [a[0] / l, a[1] / l]
    }
}
/// Left normal (90° CCW).
pub fn perp(a: [f64; 2]) -> [f64; 2] {
    [-a[1], a[0]]
}
