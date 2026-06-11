//! Project export/import: a single self-contained `.slx` archive (JSON text)
//! holding everything authored for a project — settings, grid axes, control
//! points, the solved transform, categories, survey points, point groups, and
//! DXF overlays (drawing files embedded inline; DXF is UTF-8 text). Cached
//! terrain/buildings are intentionally excluded — they're re-fetchable from the
//! site after import.
//!
//! Stable references: survey points and categories carry their original UUIDs as
//! `ref` keys so point-group membership and per-point categories survive the
//! remap to fresh IDs (and, for categories, to the importing org's own set).

mod export;
mod import;
mod types;

pub use export::export_project;
pub use import::import_project;
pub use types::{ARCHIVE_FORMAT, ARCHIVE_VERSION};
