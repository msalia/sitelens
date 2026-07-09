//! Site-analysis compute: pure, Rust-authoritative geometry for the civil
//! analyses (turning radius here; parking / hydrology land in later phases).
//! Kept separate from the `schema::analysis` resolvers so the math is unit-tested
//! in isolation and never diverges from a client-side copy.

pub mod turning;
