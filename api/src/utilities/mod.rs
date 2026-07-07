//! As-built utility records: linear runs + node structures captured as an
//! immutable, audited geometry-and-attributes record (not a GIS network).
//!
//! `geom` holds the pure derivations (length, slope, cover, unit normalization);
//! `audit` is the shared append-only change-logging helper used by every
//! mutation. Grid/ground/geographic derivation reuses [`crate::convert`].

pub mod audit;
pub mod geom;
pub mod import;
