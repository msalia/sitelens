//! Surface-modeling resolvers, split by concern:
//! - [`shared`] — row mappers + the mesh / volume / DEM / export helpers.
//! - [`query`] — [`SurfaceQuery`]: list/read surfaces, mesh, contours, breaklines,
//!   volumes, and CAD/GIS exports.
//! - [`mutation`] — [`SurfaceMutation`]: build/rebuild/delete surfaces, breaklines
//!   + boundary, volumes, and DEM upload.
//!
//! All resolvers are Crew-gated and org/project scoped; mutations also require an
//! editor role + an active subscription. Triangulation/volume/DEM builds run off
//! the async runtime via `spawn_blocking` (the codebase's no-worker convention).
mod mutation;
mod query;
mod shared;

pub use mutation::SurfaceMutation;
pub use query::SurfaceQuery;
