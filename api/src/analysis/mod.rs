//! Site-analysis compute: pure, Rust-authoritative geometry for the civil
//! analyses (turning radius + parking here; hydrology / traffic land in later
//! phases). Kept separate from the `schema::analysis` resolvers so the math is
//! unit-tested in isolation and never diverges from a client-side copy.

pub mod parking;
pub mod turning;
mod vec2;
