//! Surface-modeling GraphQL types: named, versioned surfaces (Phase 1 = point-
//! built TIN) plus the build inputs. Enums are stored as text columns with a
//! `CHECK` constraint (the `as_db_str`/`from_db_str` convention, no sqlx `Type`
//! derive), matching the rest of the schema. JSONB `inputs` is exposed as a JSON
//! string, like `UtilityStructure::attrs_extra`.

use async_graphql::{Enum, InputObject, SimpleObject};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// A surface source: a point-built triangulated network, or an uploaded DEM grid.
/// Phase 1 only builds `Tin`.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum SurfaceKind {
    Tin,
    Dem,
}

impl SurfaceKind {
    pub fn as_db_str(self) -> &'static str {
        match self {
            SurfaceKind::Tin => "tin",
            SurfaceKind::Dem => "dem",
        }
    }
    pub fn from_db_str(s: &str) -> SurfaceKind {
        match s {
            "dem" => SurfaceKind::Dem,
            _ => SurfaceKind::Tin,
        }
    }
}

/// Build lifecycle. Triangulation runs synchronously (inside the mutation), so a
/// returned surface is already `Ready` or `Failed`; `Building` exists for
/// forward-compat with the larger DEM surfaces in a later phase.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum SurfaceStatus {
    Building,
    Ready,
    Failed,
}

impl SurfaceStatus {
    pub fn as_db_str(self) -> &'static str {
        match self {
            SurfaceStatus::Building => "building",
            SurfaceStatus::Ready => "ready",
            SurfaceStatus::Failed => "failed",
        }
    }
    pub fn from_db_str(s: &str) -> SurfaceStatus {
        match s {
            "ready" => SurfaceStatus::Ready,
            "failed" => SurfaceStatus::Failed,
            _ => SurfaceStatus::Building,
        }
    }
}

/// Which survey points seed the TIN. Mirrors [`crate::models::BaselineScope`].
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum PointScope {
    All,
    Category,
    Group,
}

impl PointScope {
    pub fn as_db_str(self) -> &'static str {
        match self {
            PointScope::All => "all",
            PointScope::Category => "category",
            PointScope::Group => "group",
        }
    }
}

/// A named, versioned surface. The computed mesh blob (positions + indices) lives
/// in Storage under `storage_key` (deliberately unexposed); the client fetches it
/// via `surfaceMesh`.
#[derive(SimpleObject)]
pub struct Surface {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub version: i32,
    pub kind: SurfaceKind,
    pub status: SurfaceStatus,
    pub failure_reason: Option<String>,
    /// The build-input snapshot, as a JSON object string.
    pub inputs: String,
    pub vertex_count: i32,
    pub triangle_count: i32,
    pub created_at: DateTime<Utc>,
}

/// Parameters for building/rebuilding a TIN surface. Point selection is a scope
/// (all / one category / one group) minus explicit exclusions. `max_edge_length`
/// is accepted now but only applied once constrained triangulation lands.
#[derive(InputObject, Clone)]
pub struct SurfaceInput {
    pub name: String,
    #[graphql(default_with = "PointScope::All")]
    pub scope: PointScope,
    /// Category id (scope = Category) or group id (scope = Group).
    pub scope_ref: Option<Uuid>,
    /// Exclude points in any of these categories.
    #[graphql(default)]
    pub exclude_category_ids: Vec<Uuid>,
    /// Exclude points bearing any of these tags.
    #[graphql(default)]
    pub exclude_tags: Vec<String>,
    /// Exclude these specific points.
    #[graphql(default)]
    pub exclude_point_ids: Vec<Uuid>,
    /// Optional max triangle edge length (meters) — drops long sliver triangles.
    pub max_edge_length: Option<f64>,
    /// Hard breaklines to enforce as constraint edges.
    #[graphql(default)]
    pub breakline_ids: Vec<Uuid>,
    /// Outer boundary to clip the surface to (a breakline of kind `boundary`).
    pub boundary_id: Option<Uuid>,
    /// Interior holes to cut out (breaklines of kind `hole`).
    #[graphql(default)]
    pub hole_ids: Vec<Uuid>,
}

/// A surface constraint: a hard breakline, the outer boundary, or an interior hole.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum BreaklineKind {
    Hard,
    Boundary,
    Hole,
}

impl BreaklineKind {
    pub fn as_db_str(self) -> &'static str {
        match self {
            BreaklineKind::Hard => "hard",
            BreaklineKind::Boundary => "boundary",
            BreaklineKind::Hole => "hole",
        }
    }
    pub fn from_db_str(s: &str) -> BreaklineKind {
        match s {
            "boundary" => BreaklineKind::Boundary,
            "hole" => BreaklineKind::Hole,
            _ => BreaklineKind::Hard,
        }
    }
}

/// A stored surface constraint (breakline / boundary / hole). Vertices are a JSON
/// array string `[{n,e,z?}]` in projected meters (immutable against point edits).
#[derive(SimpleObject)]
pub struct SurfaceBreakline {
    pub id: Uuid,
    pub project_id: Uuid,
    pub kind: BreaklineKind,
    pub closed: bool,
    pub vertices: String,
    pub source: String,
    pub source_layer: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One breakline vertex on capture (projected meters; z optional — z-filled from
/// the nearest survey point at build time when absent).
#[derive(InputObject, Clone)]
pub struct BreaklineVertexInput {
    pub n: f64,
    pub e: f64,
    pub z: Option<f64>,
}

/// Create/replace a breakline's geometry + kind.
#[derive(InputObject, Clone)]
pub struct BreaklineInput {
    pub kind: BreaklineKind,
    #[graphql(default)]
    pub closed: bool,
    pub vertices: Vec<BreaklineVertexInput>,
}

/// A DXF layer available to import as breaklines (for the mapping UI).
#[derive(SimpleObject)]
pub struct BreaklineImportLayer {
    pub layer: String,
    pub count: i32,
    /// Suggested kind from the layer name ("hard" | "boundary" | "hole").
    pub suggested_kind: String,
}

/// Preview of a DXF breakline import: its polyline layers.
#[derive(SimpleObject)]
pub struct BreaklineImportPreview {
    pub layers: Vec<BreaklineImportLayer>,
}

/// A user-confirmed layer→kind mapping. `kind` null/empty = skip the layer.
#[derive(InputObject)]
pub struct BreaklineLayerMapping {
    pub layer: String,
    pub kind: Option<String>,
}

/// Result of committing a breakline import.
#[derive(SimpleObject)]
pub struct BreaklineImportResult {
    pub created: i32,
    pub skipped: i32,
}
