//! Surface modeling resolvers (Phase 1): build/rebuild/delete a point-built TIN
//! and stream its render mesh. All resolvers are Crew-gated and org/project
//! scoped; mutations also require an editor role + an active subscription.
//!
//! Triangulation runs synchronously (inside the mutation) via `spawn_blocking`,
//! following the codebase's existing no-background-worker convention. Vertices are
//! converted to geographic with the *same* rotation + projection pipeline
//! `scene.rs` uses for survey points, so the TIN registers on the point cloud.
use serde_json::{json, Value};

use super::*;
use crate::models::{
    BreaklineImportLayer, BreaklineImportPreview, BreaklineImportResult, BreaklineInput,
    BreaklineKind, BreaklineLayerMapping, BreaklineVertexInput, FileBlob, PointScope, Surface,
    SurfaceBreakline, SurfaceExportFormat, SurfaceInput, SurfaceKind, SurfaceStatus, Volume,
    VolumeComparison, VolumeInput, VolumeReportFormat, VolumeUnit,
};
use crate::surface::{self, contour, export, geom, geotiff, tin, volume};

/// Read columns for a `surfaces` row, in the order [`row_to_surface`] expects.
const SURFACE_COLUMNS: &str =
    "id, project_id, name, version, kind, status, failure_reason, inputs, \
     vertex_count, triangle_count, created_at";

type SurfaceRow = (
    Uuid,           // id
    Uuid,           // project_id
    String,         // name
    i32,            // version
    String,         // kind
    String,         // status
    Option<String>, // failure_reason
    Value,          // inputs (jsonb)
    i32,            // vertex_count
    i32,            // triangle_count
    DateTime<Utc>,  // created_at
);

fn row_to_surface(r: SurfaceRow) -> Surface {
    Surface {
        id: r.0,
        project_id: r.1,
        name: r.2,
        version: r.3,
        kind: SurfaceKind::from_db_str(&r.4),
        status: SurfaceStatus::from_db_str(&r.5),
        failure_reason: r.6,
        inputs: r.7.to_string(),
        vertex_count: r.8,
        triangle_count: r.9,
        created_at: r.10,
    }
}

/// The JSON snapshot persisted in `surfaces.inputs`.
fn inputs_snapshot(input: &SurfaceInput) -> Value {
    json!({
        "name": input.name,
        "scope": input.scope.as_db_str(),
        "scopeRef": input.scope_ref,
        "excludeCategoryIds": input.exclude_category_ids,
        "excludeTags": input.exclude_tags,
        "excludePointIds": input.exclude_point_ids,
        "maxEdgeLength": input.max_edge_length,
        "breaklineIds": input.breakline_ids,
        "boundaryId": input.boundary_id,
        "holeIds": input.hole_ids,
    })
}

/// Selects the design points that seed the TIN: a scope (all / one category /
/// one group) minus the explicit exclusions. Returns `(easting, northing,
/// elevation)` in projected meters.
async fn select_points(
    pool: &PgPool,
    project_id: Uuid,
    scope: PointScope,
    scope_ref: Option<Uuid>,
    exclude_category_ids: &[Uuid],
    exclude_tags: &[String],
    exclude_point_ids: &[Uuid],
) -> Result<Vec<(f64, f64, Option<f64>)>> {
    if !matches!(scope, PointScope::All) && scope_ref.is_none() {
        return Err(async_graphql::Error::new(
            "a category or group scope needs a reference id",
        ));
    }
    // Every parameter is referenced unconditionally so the bind count is fixed
    // regardless of scope; empty exclusion arrays exclude nothing.
    let rows: Vec<(f64, f64, Option<f64>)> = sqlx::query_as(
        "SELECT sp.easting, sp.northing, sp.elevation FROM survey_points sp \
         WHERE sp.project_id = $1 AND sp.point_type = 'design' \
           AND ( \
             $2 = 'all' \
             OR ($2 = 'category' AND sp.category_id = $3) \
             OR ($2 = 'group' AND sp.id = ANY(COALESCE( \
                 (SELECT member_ids FROM point_groups WHERE id = $3 AND project_id = $1), \
                 ARRAY[]::uuid[]))) \
           ) \
           AND (sp.category_id IS NULL OR NOT (sp.category_id = ANY($4))) \
           AND NOT (sp.tags && $5) \
           AND NOT (sp.id = ANY($6))",
    )
    .bind(project_id)
    .bind(scope.as_db_str())
    .bind(scope_ref)
    .bind(exclude_category_ids)
    .bind(exclude_tags)
    .bind(exclude_point_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A constraint loaded from `surface_breaklines`, ready for triangulation.
struct LoadedConstraint {
    kind: BreaklineKind,
    closed: bool,
    /// `(easting, northing, z?)` in projected meters.
    verts: Vec<(f64, f64, Option<f64>)>,
}

/// Parses a stored `vertices` JSON array (`[{n,e,z?}]`) into `(e, n, z?)` tuples.
fn parse_vertices(v: &Value) -> Vec<(f64, f64, Option<f64>)> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|o| {
                    let e = o.get("e")?.as_f64()?;
                    let n = o.get("n")?.as_f64()?;
                    let z = o.get("z").and_then(|z| z.as_f64());
                    Some((e, n, z))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Loads the breakline/boundary/hole rows referenced by a surface's inputs,
/// classified by their stored `kind`.
async fn select_constraints(
    pool: &PgPool,
    project_id: Uuid,
    input: &SurfaceInput,
) -> Result<Vec<LoadedConstraint>> {
    let mut ids: Vec<Uuid> = input.breakline_ids.clone();
    if let Some(b) = input.boundary_id {
        ids.push(b);
    }
    ids.extend(input.hole_ids.iter().copied());
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String, bool, Value)> = sqlx::query_as(
        "SELECT kind, closed, vertices FROM surface_breaklines \
         WHERE project_id = $1 AND id = ANY($2)",
    )
    .bind(project_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(kind, closed, verts)| LoadedConstraint {
            kind: BreaklineKind::from_db_str(&kind),
            closed,
            verts: parse_vertices(&verts),
        })
        .collect())
}

/// Triangulates the selected points and returns the STIN render blob plus the
/// vertex/triangle counts. Runs the CPU-bound triangulation off the async runtime.
async fn build_mesh_blob(
    crs: &ProjectCrs,
    points: Vec<(f64, f64, Option<f64>)>,
    constraints: Vec<LoadedConstraint>,
    max_edge_length: Option<f64>,
) -> Result<(Vec<u8>, i32, i32)> {
    // Known-elevation points, for z-filling constraint vertices that lack z.
    let known: Vec<(f64, f64, f64)> = points
        .iter()
        .filter_map(|&(e, n, z)| z.map(|z| (e, n, z)))
        .collect();
    let z_at = |e: f64, n: f64, z: Option<f64>| -> f64 {
        z.or_else(|| geom::nearest_point_z(&known, e, n))
            .unwrap_or(0.0)
    };

    let inputs: Vec<tin::InputPoint> = points
        .iter()
        .map(|&(e, n, z)| tin::InputPoint {
            e,
            n,
            z: z.unwrap_or(0.0),
        })
        .collect();

    // Split the loaded constraints into breaklines / boundary / holes, z-filling.
    let to_constraint = |c: &LoadedConstraint, force_closed: bool| tin::Constraint {
        closed: force_closed || c.closed,
        verts: c
            .verts
            .iter()
            .map(|&(e, n, z)| tin::InputPoint {
                e,
                n,
                z: z_at(e, n, z),
            })
            .collect(),
    };
    let breaklines: Vec<tin::Constraint> = constraints
        .iter()
        .filter(|c| matches!(c.kind, BreaklineKind::Hard))
        .map(|c| to_constraint(c, false))
        .collect();
    let boundary: Option<tin::Constraint> = constraints
        .iter()
        .find(|c| matches!(c.kind, BreaklineKind::Boundary))
        .map(|c| to_constraint(c, true));
    let holes: Vec<tin::Constraint> = constraints
        .iter()
        .filter(|c| matches!(c.kind, BreaklineKind::Hole))
        .map(|c| to_constraint(c, true))
        .collect();

    let mesh = tokio::task::spawn_blocking(move || {
        tin::triangulate_constrained(
            &inputs,
            &breaklines,
            boundary.as_ref(),
            &holes,
            max_edge_length,
        )
    })
    .await
    .map_err(|e| async_graphql::Error::new(format!("triangulation task failed: {e}")))?
    .map_err(async_graphql::Error::new)?;

    // Project each TIN vertex to geographic using the same rotation the scene
    // applies to points, so the surface overlays them exactly. Any vertex that
    // fails to project would break index alignment, so that aborts the build.
    let epsg = crs.epsg;
    let rotation = crs.rotation;
    let mut geo = Vec::with_capacity(mesh.vertices.len());
    for [e, n, z] in &mesh.vertices {
        let (te, tn) = rotation.map_or((*e, *n), |r| r.to_true(*e, *n));
        let (lat, lon) = crs::projected_to_geographic(epsg, te, tn).ok_or_else(|| {
            async_graphql::Error::new("could not project a surface vertex to geographic")
        })?;
        geo.push([lat, lon, *z]);
    }

    let blob = surface::serialize_mesh(&geo, &mesh.indices);
    Ok((blob, geo.len() as i32, mesh.indices.len() as i32))
}

// --- Breaklines / boundary / holes -----------------------------------------

const BREAKLINE_COLUMNS: &str =
    "id, project_id, kind, closed, vertices, source, source_layer, created_at, updated_at";

type BreaklineRow = (
    Uuid,
    Uuid,
    String,
    bool,
    Value,
    String,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

fn row_to_breakline(r: BreaklineRow) -> SurfaceBreakline {
    SurfaceBreakline {
        id: r.0,
        project_id: r.1,
        kind: BreaklineKind::from_db_str(&r.2),
        closed: r.3,
        vertices: r.4.to_string(),
        source: r.5,
        source_layer: r.6,
        created_at: r.7,
        updated_at: r.8,
    }
}

/// Serializes vertex inputs into the stored `[{n,e,z?}]` JSON.
fn vertices_json(verts: &[BreaklineVertexInput]) -> Value {
    Value::Array(
        verts
            .iter()
            .map(|v| json!({ "n": v.n, "e": v.e, "z": v.z }))
            .collect(),
    )
}

/// Resolves a breakline's project (org-scoped); errors if not in the org.
async fn breakline_project_in_org(pool: &PgPool, id: Uuid, org_id: Uuid) -> Result<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT b.project_id FROM surface_breaklines b JOIN projects p ON p.id = b.project_id \
         WHERE b.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(found_in_org(row, "breakline")?.0)
}

/// Suggests a breakline kind from a DXF layer name.
fn guess_breakline_kind(layer: &str) -> &'static str {
    let n = layer.to_ascii_uppercase();
    if n.contains("BOUND") || n.contains("LIMIT") || n.contains("PERIMETER") {
        "boundary"
    } else if n.contains("HOLE") || n.contains("VOID") || n.contains("EXCLU") {
        "hole"
    } else {
        "hard"
    }
}

/// Decodes a base64 DXF payload to UTF-8 text.
fn decode_dxf(content_base64: &str) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.trim())
        .map_err(|e| async_graphql::Error::new(format!("invalid base64: {e}")))?;
    String::from_utf8(bytes).map_err(|e| async_graphql::Error::new(format!("invalid UTF-8: {e}")))
}

// --- Volumes ----------------------------------------------------------------

const VOLUME_COLUMNS: &str = "id, project_id, name, comparison, base_surface_id, base_version, \
     compare_surface_id, compare_version, reference_elev, cell_size, cut_volume, fill_volume, \
     net_volume, area, heatmap_key, computed_at";

type VolumeRow = (
    Uuid,           // id
    Uuid,           // project_id
    String,         // name
    String,         // comparison
    Uuid,           // base_surface_id
    i32,            // base_version
    Option<Uuid>,   // compare_surface_id
    Option<i32>,    // compare_version
    Option<f64>,    // reference_elev
    f64,            // cell_size
    f64,            // cut_volume
    f64,            // fill_volume
    f64,            // net_volume
    f64,            // area
    Option<String>, // heatmap_key
    DateTime<Utc>,  // computed_at
);

fn row_to_volume(r: VolumeRow) -> Volume {
    Volume {
        id: r.0,
        project_id: r.1,
        name: r.2,
        comparison: VolumeComparison::from_db_str(&r.3),
        base_surface_id: r.4,
        base_version: r.5,
        compare_surface_id: r.6,
        compare_version: r.7,
        reference_elev: r.8,
        cell_size: r.9,
        cut_volume: r.10,
        fill_volume: r.11,
        net_volume: r.12,
        area: r.13,
        has_heatmap: r.14.is_some(),
        computed_at: r.15,
    }
}

/// Resolves a surface (org-scoped) to its `(project_id, version, storage_key)`,
/// erroring if it isn't in the org or hasn't been computed yet.
async fn load_surface_for_volume(
    pool: &PgPool,
    id: Uuid,
    org_id: Uuid,
) -> Result<(Uuid, i32, String)> {
    let row: Option<(Uuid, i32, Option<String>)> = sqlx::query_as(
        "SELECT s.project_id, s.version, s.storage_key FROM surfaces s \
         JOIN projects p ON p.id = s.project_id \
         WHERE s.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let (project_id, version, key) = found_in_org(row, "surface")?;
    let key = key.ok_or_else(|| async_graphql::Error::new("surface has no computed mesh yet"))?;
    Ok((project_id, version, key))
}

/// A local equirectangular metric frame anchored at a mesh centroid — turns the
/// stored geographic mesh into planar meters for volume math (rigid, so areas /
/// volumes are unaffected), and back to geographic for the heatmap blob.
struct MetricFrame {
    lat0: f64,
    lon0: f64,
    m_lat: f64,
    m_lon: f64,
}

impl MetricFrame {
    fn from_centroid(verts: &[[f64; 3]]) -> MetricFrame {
        let n = verts.len().max(1) as f64;
        let lat0 = verts.iter().map(|v| v[0]).sum::<f64>() / n;
        let lon0 = verts.iter().map(|v| v[1]).sum::<f64>() / n;
        MetricFrame {
            lat0,
            lon0,
            m_lat: 111_320.0,
            m_lon: 111_320.0 * lat0.to_radians().cos(),
        }
    }
    /// Geographic `[lat, lon, z]` mesh → planar `[x, y, z]` meters.
    fn mesh_to_metric(&self, geo: &[[f64; 3]]) -> Vec<[f64; 3]> {
        geo.iter()
            .map(|v| {
                [
                    (v[1] - self.lon0) * self.m_lon,
                    (v[0] - self.lat0) * self.m_lat,
                    v[2],
                ]
            })
            .collect()
    }
    /// Planar `(x, y)` meters → geographic `(lat, lon)`.
    fn to_geo(&self, x: f64, y: f64) -> (f64, f64) {
        (self.lat0 + y / self.m_lat, self.lon0 + x / self.m_lon)
    }
}

/// The stored numeric result of a volume compute, plus its heatmap blob.
struct VolumeOut {
    blob: Vec<u8>,
    cut: f64,
    fill: f64,
    net: f64,
    area: f64,
}

/// Deserializes the base (and optional compare) mesh, computes the earthwork on a
/// shared metric frame, and serializes the SVOL heatmap blob. CPU-bound — run via
/// `spawn_blocking`.
fn compute_volume_blob(
    base_bytes: &[u8],
    compare_bytes: Option<&[u8]>,
    reference_elev: Option<f64>,
    cell_size: f64,
) -> std::result::Result<VolumeOut, String> {
    let (base_geo, base_tris) =
        surface::deserialize_mesh(base_bytes).ok_or("base surface mesh is unreadable")?;
    // One shared frame (from the base centroid) so both surfaces sample aligned.
    let frame = MetricFrame::from_centroid(&base_geo);
    let base = volume::SurfaceSampler::new(frame.mesh_to_metric(&base_geo), base_tris)
        .ok_or("base surface mesh is unusable")?;

    let compare = match compare_bytes {
        Some(bytes) => {
            let (geo, tris) =
                surface::deserialize_mesh(bytes).ok_or("compare surface mesh is unreadable")?;
            Some(
                volume::SurfaceSampler::new(frame.mesh_to_metric(&geo), tris)
                    .ok_or("compare surface mesh is unusable")?,
            )
        }
        None => None,
    };

    let res = volume::compute_volume(&base, compare.as_ref(), reference_elev, cell_size)?;
    let cells: Vec<[f64; 4]> = res
        .cells
        .iter()
        .map(|c| {
            let (lat, lon) = frame.to_geo(c.x, c.y);
            [lat, lon, c.base_z, c.dz]
        })
        .collect();
    let blob = surface::serialize_volume_grid(cell_size, res.min_dz, res.max_dz, &cells);
    Ok(VolumeOut {
        blob,
        cut: res.cut,
        fill: res.fill,
        net: res.net,
        area: res.area,
    })
}

// --- Exports ----------------------------------------------------------------

/// A surface ready to export: `(name, epsg, projected vertices [e,n,z], triangles)`.
type ProjectedSurface = (String, i32, Vec<[f64; 3]>, Vec<[u32; 3]>);

/// Loads a surface's mesh in the project's **projected** frame `[e, n, z]`
/// (inverting the stored geographic vertices), plus its name + EPSG — the basis
/// for every CAD/GIS deliverable. Org-scoped; errors if not computed.
async fn load_surface_projected(
    ctx: &Context<'_>,
    id: Uuid,
    org_id: Uuid,
) -> Result<ProjectedSurface> {
    let pool = pool(ctx)?;
    let row: Option<(String, Uuid, Option<String>)> = sqlx::query_as(
        "SELECT s.name, s.project_id, s.storage_key FROM surfaces s \
         JOIN projects p ON p.id = s.project_id \
         WHERE s.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let (name, project_id, key) = found_in_org(row, "surface")?;
    let key = key.ok_or_else(|| async_graphql::Error::new("surface has no computed mesh yet"))?;
    let crs = load_project_crs(pool, project_id, org_id).await?;
    let bytes = storage(ctx)?
        .get(&key)
        .await
        .map_err(async_graphql::Error::new)?;
    let (geo, tris) = surface::deserialize_mesh(&bytes)
        .ok_or_else(|| async_graphql::Error::new("stored surface mesh is unreadable"))?;
    let mut verts = Vec::with_capacity(geo.len());
    for v in &geo {
        let (e, n) = crs::geographic_to_projected(crs.epsg, v[0], v[1]).ok_or_else(|| {
            async_graphql::Error::new("could not project a surface vertex for export")
        })?;
        verts.push([e, n, v[2]]);
    }
    Ok((name, crs.epsg, verts, tris))
}

/// Samples a projected TIN to a DEM raster grid for GeoTIFF export.
fn surface_to_dem_grid(
    verts: &[[f64; 3]],
    tris: &[[u32; 3]],
    epsg: i32,
    cell_size: f64,
) -> Result<geotiff::DemGrid> {
    let sampler = volume::SurfaceSampler::new(verts.to_vec(), tris.to_vec())
        .ok_or_else(|| async_graphql::Error::new("surface mesh is unusable"))?;
    let [min_e, min_n, max_e, max_n] = sampler.bounds();
    let width = (((max_e - min_e) / cell_size).ceil() as usize).max(1);
    let height = (((max_n - min_n) / cell_size).ceil() as usize).max(1);
    if width.saturating_mul(height) > volume::MAX_CELLS {
        return Err(async_graphql::Error::new(
            "cell size is too fine for this surface's extent — increase it",
        ));
    }
    let nodata = -9999.0_f32;
    let mut data = vec![nodata; width * height];
    for row in 0..height {
        // Row 0 is the north edge → sample from max_n downward.
        let n = max_n - (row as f64 + 0.5) * cell_size;
        for col in 0..width {
            let e = min_e + (col as f64 + 0.5) * cell_size;
            if let Some(z) = sampler.sample(e, n) {
                data[row * width + col] = z as f32;
            }
        }
    }
    Ok(geotiff::DemGrid {
        width,
        height,
        origin_e: min_e,
        origin_n: max_n,
        pixel: cell_size,
        epsg,
        nodata,
        data,
    })
}

/// Renders HTML to PDF via the shared WeasyPrint report service.
async fn render_pdf(html: &str) -> Result<Vec<u8>> {
    let base =
        std::env::var("REPORT_SERVICE_URL").unwrap_or_else(|_| "http://localhost:8000".to_string());
    let url = format!("{}/render", base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(json!({ "html": html }).to_string())
        .send()
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(async_graphql::Error::new(format!(
            "report service error: {}",
            resp.status()
        )));
    }
    Ok(resp
        .bytes()
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?
        .to_vec())
}

/// Base64-encodes bytes off the async runtime, wrapping them in a `FileBlob`.
async fn file_blob(filename: String, mime_type: &str, bytes: Vec<u8>) -> Result<FileBlob> {
    let content_base64 = tokio::task::spawn_blocking(move || {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    })
    .await
    .map_err(|e| async_graphql::Error::new(e.to_string()))?;
    Ok(FileBlob {
        filename,
        mime_type: mime_type.to_string(),
        content_base64,
    })
}

/// m³ per cubic yard (exact: (0.9144 m)³) and m² per international foot².
const CUBIC_YARD_M3: f64 = 0.764_554_857_984;
const SQUARE_FOOT_M2: f64 = 0.092_903_04;

/// Filename-safe slug from a name (collapses non-alphanumerics to `-`).
fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "surface".to_string()
    } else {
        trimmed
    }
}

#[derive(Default)]
pub struct SurfaceQuery;

#[Object]
impl SurfaceQuery {
    /// Every surface in a project (newest first).
    async fn surfaces(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<Surface>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<SurfaceRow> = sqlx::query_as(&format!(
            "SELECT {SURFACE_COLUMNS} FROM surfaces WHERE project_id = $1 \
             ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_surface).collect())
    }

    /// A single surface by id (org-scoped).
    async fn surface(&self, ctx: &Context<'_>, id: Uuid) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<SurfaceRow> = sqlx::query_as(&format!(
            "SELECT {} FROM surfaces s JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
            qualify_columns(SURFACE_COLUMNS, "s")
        ))
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(row_to_surface(found_in_org(row, "surface")?))
    }

    /// The computed render mesh (STIN binary blob, base64-encoded).
    async fn surface_mesh(&self, ctx: &Context<'_>, id: Uuid) -> Result<FileBlob> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT s.name, s.storage_key FROM surfaces s \
             JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (name, storage_key) = found_in_org(row, "surface")?;
        let key = storage_key
            .ok_or_else(|| async_graphql::Error::new("surface has no computed mesh yet"))?;
        let bytes = storage(ctx)?
            .get(&key)
            .await
            .map_err(async_graphql::Error::new)?;
        let content_base64 = tokio::task::spawn_blocking(move || {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(bytes)
        })
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(FileBlob {
            filename: format!("{name}.stin"),
            mime_type: "application/octet-stream".to_string(),
            content_base64,
        })
    }

    /// Iso-line contours computed from a surface's stored mesh at the given
    /// `interval` (meters). `major_interval` (meters) flags heavier, labeled
    /// contours (defaults to 5× the minor interval); `smoothing` applies Chaikin
    /// corner-cutting (0–3 passes). Returned as an SCTR binary blob (base64).
    async fn surface_contours(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        interval: f64,
        major_interval: Option<f64>,
        #[graphql(default)] smoothing: i32,
    ) -> Result<FileBlob> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT s.name, s.storage_key FROM surfaces s \
             JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (name, storage_key) = found_in_org(row, "surface")?;
        let key = storage_key
            .ok_or_else(|| async_graphql::Error::new("surface has no computed mesh yet"))?;
        let bytes = storage(ctx)?
            .get(&key)
            .await
            .map_err(async_graphql::Error::new)?;

        // Deserialize → contour → serialize → base64, all off the async runtime.
        let smoothing = smoothing.max(0) as u32;
        let content_base64 =
            tokio::task::spawn_blocking(move || -> std::result::Result<String, String> {
                let (vertices, indices) = surface::deserialize_mesh(&bytes)
                    .ok_or_else(|| "stored surface mesh is unreadable".to_string())?;
                let levels = surface::contour::contours(
                    &vertices,
                    &indices,
                    &surface::contour::ContourOptions {
                        interval,
                        major_interval,
                        smoothing,
                    },
                )?;
                let blob = surface::serialize_contours(&levels);
                use base64::Engine;
                Ok(base64::engine::general_purpose::STANDARD.encode(blob))
            })
            .await
            .map_err(|e| async_graphql::Error::new(format!("contour task failed: {e}")))?
            .map_err(async_graphql::Error::new)?;

        Ok(FileBlob {
            filename: format!("{name}.sctr"),
            mime_type: "application/octet-stream".to_string(),
            content_base64,
        })
    }

    /// Every constraint (breakline / boundary / hole) in a project.
    async fn breaklines(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<SurfaceBreakline>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<BreaklineRow> = sqlx::query_as(&format!(
            "SELECT {BREAKLINE_COLUMNS} FROM surface_breaklines WHERE project_id = $1 \
             ORDER BY created_at"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_breakline).collect())
    }

    /// Previews a DXF file's polyline layers for breakline import (mapping UI).
    async fn preview_breakline_import(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        content_base64: String,
    ) -> Result<BreaklineImportPreview> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        ensure_project_in_org(pool(ctx)?, project_id, auth.org_id).await?;
        let text = decode_dxf(&content_base64)?;
        let features =
            crate::utilities::import::parse_dxf(&text).map_err(async_graphql::Error::new)?;
        use std::collections::BTreeMap;
        let mut counts: BTreeMap<String, i32> = BTreeMap::new();
        for f in &features {
            if matches!(f.kind, crate::utilities::import::FeatureKind::Line) {
                *counts.entry(f.layer.clone()).or_default() += 1;
            }
        }
        let layers = counts
            .into_iter()
            .map(|(layer, count)| BreaklineImportLayer {
                suggested_kind: guess_breakline_kind(&layer).to_string(),
                layer,
                count,
            })
            .collect();
        Ok(BreaklineImportPreview { layers })
    }

    /// Every volume computation in a project (newest first).
    async fn volumes(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<Volume>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<VolumeRow> = sqlx::query_as(&format!(
            "SELECT {VOLUME_COLUMNS} FROM volumes WHERE project_id = $1 ORDER BY computed_at DESC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(row_to_volume).collect())
    }

    /// A single volume by id (org-scoped).
    async fn volume(&self, ctx: &Context<'_>, id: Uuid) -> Result<Volume> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<VolumeRow> = sqlx::query_as(&format!(
            "SELECT {} FROM volumes v JOIN projects p ON p.id = v.project_id \
             WHERE v.id = $1 AND p.org_id = $2",
            qualify_columns(VOLUME_COLUMNS, "v")
        ))
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        Ok(row_to_volume(found_in_org(row, "volume")?))
    }

    /// The cut/fill heatmap grid (SVOL binary blob, base64-encoded).
    async fn volume_heatmap(&self, ctx: &Context<'_>, id: Uuid) -> Result<FileBlob> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT v.name, v.heatmap_key FROM volumes v \
             JOIN projects p ON p.id = v.project_id \
             WHERE v.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (name, heatmap_key) = found_in_org(row, "volume")?;
        let key =
            heatmap_key.ok_or_else(|| async_graphql::Error::new("volume has no heatmap grid"))?;
        let bytes = storage(ctx)?
            .get(&key)
            .await
            .map_err(async_graphql::Error::new)?;
        let content_base64 = tokio::task::spawn_blocking(move || {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(bytes)
        })
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(FileBlob {
            filename: format!("{name}.svol"),
            mime_type: "application/octet-stream".to_string(),
            content_base64,
        })
    }

    /// Exports a surface as LandXML, DXF (3DFACE + optional contour layers), or a
    /// GeoTIFF DEM. `contour_interval` (meters) adds contour layers to DXF;
    /// `cell_size` (meters) sets the GeoTIFF raster resolution (default 1 m).
    async fn export_surface(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        format: SurfaceExportFormat,
        contour_interval: Option<f64>,
        cell_size: Option<f64>,
    ) -> Result<FileBlob> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let (name, epsg, verts, tris) = load_surface_projected(ctx, id, auth.org_id).await?;
        let slug = slug(&name);

        match format {
            SurfaceExportFormat::Landxml => {
                let xml = export::surface_landxml(&name, &verts, &tris);
                file_blob(format!("{slug}.xml"), "application/xml", xml.into_bytes()).await
            }
            SurfaceExportFormat::Dxf => {
                // Optional contour overlay, computed on the projected mesh.
                let contours = match contour_interval.filter(|i| *i > 0.0) {
                    Some(interval) => contour::contours(
                        &verts,
                        &tris,
                        &contour::ContourOptions {
                            interval,
                            major_interval: None,
                            smoothing: 0,
                        },
                    )
                    .map_err(async_graphql::Error::new)?,
                    None => Vec::new(),
                };
                let dxf = export::surface_dxf(&verts, &tris, &contours)
                    .map_err(async_graphql::Error::new)?;
                file_blob(format!("{slug}.dxf"), "application/dxf", dxf.into_bytes()).await
            }
            SurfaceExportFormat::Geotiff => {
                let cell = cell_size.filter(|c| *c > 0.0).unwrap_or(1.0);
                let grid = surface_to_dem_grid(&verts, &tris, epsg, cell)?;
                let bytes = tokio::task::spawn_blocking(move || geotiff::write_geotiff(&grid))
                    .await
                    .map_err(|e| async_graphql::Error::new(e.to_string()))?;
                file_blob(format!("{slug}.tif"), "image/tiff", bytes).await
            }
        }
    }

    /// Exports a volume result as a PDF (WeasyPrint) or CSV, in cubic yards
    /// (default) or cubic meters. Both carry the reproducibility metadata.
    async fn export_volume_report(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        format: VolumeReportFormat,
        #[graphql(default_with = "VolumeUnit::CubicYard")] unit: VolumeUnit,
    ) -> Result<FileBlob> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        // Volume + the base/compare surface names, org-scoped.
        // (name, comparison, base_ver, compare_ver, ref_elev, cell, cut, fill,
        //  net, area, base_surface_name, compare_surface_name)
        type VolumeReportRow = (
            String,
            String,
            i32,
            Option<i32>,
            Option<f64>,
            f64,
            f64,
            f64,
            f64,
            f64,
            String,
            Option<String>,
        );
        let row: Option<VolumeReportRow> = sqlx::query_as(
            "SELECT v.name, v.comparison, v.base_version, v.compare_version, v.reference_elev, \
                    v.cell_size, v.cut_volume, v.fill_volume, v.net_volume, v.area, \
                    b.name, c.name \
             FROM volumes v JOIN projects p ON p.id = v.project_id \
             JOIN surfaces b ON b.id = v.base_surface_id \
             LEFT JOIN surfaces c ON c.id = v.compare_surface_id \
             WHERE v.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (
            vname,
            comparison,
            base_ver,
            cmp_ver,
            ref_elev,
            cell,
            cut,
            fill,
            net,
            area,
            base_name,
            cmp_name,
        ) = found_in_org(row, "volume")?;

        // Convert the canonical m³ / m² results into the requested unit.
        let (vf, vu, af, au) = match unit {
            VolumeUnit::CubicYard => (CUBIC_YARD_M3, "yd³", SQUARE_FOOT_M2, "ft²"),
            VolumeUnit::CubicMeter => (1.0, "m³", 1.0, "m²"),
        };
        let compare = cmp_name.as_deref().zip(cmp_ver);
        let report = export::VolumeReport {
            name: &vname,
            comparison: &comparison,
            base_surface: &base_name,
            base_version: base_ver,
            compare,
            reference_elev: ref_elev,
            cell_size: cell,
            cut: cut / vf,
            fill: fill / vf,
            net: net / vf,
            area: area / af,
            vol_unit: vu,
            area_unit: au,
        };
        let slug = slug(&vname);
        match format {
            VolumeReportFormat::Csv => {
                let csv = export::volume_csv(&report);
                file_blob(format!("{slug}.csv"), "text/csv", csv.into_bytes()).await
            }
            VolumeReportFormat::Pdf => {
                let html = export::volume_html(&report, &crate::report::org_name());
                let pdf = render_pdf(&html).await?;
                file_blob(format!("{slug}.pdf"), "application/pdf", pdf).await
            }
        }
    }
}

#[derive(Default)]
pub struct SurfaceMutation;

#[Object]
impl SurfaceMutation {
    /// Builds a new TIN surface from selected survey points.
    async fn build_surface(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: SurfaceInput,
    ) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        // Also serves as the org-ownership check for the project.
        let crs = load_project_crs(pool, project_id, auth.org_id).await?;

        let points = select_points(
            pool,
            project_id,
            input.scope,
            input.scope_ref,
            &input.exclude_category_ids,
            &input.exclude_tags,
            &input.exclude_point_ids,
        )
        .await?;
        let constraints = select_constraints(pool, project_id, &input).await?;
        let (blob, vertex_count, triangle_count) =
            build_mesh_blob(&crs, points, constraints, input.max_edge_length).await?;

        let id = Uuid::new_v4();
        let storage_key = format!("surface/{project_id}/{id}.bin");
        storage(ctx)?
            .put(&storage_key, &blob)
            .await
            .map_err(async_graphql::Error::new)?;

        let row: SurfaceRow = sqlx::query_as(&format!(
            "INSERT INTO surfaces \
               (id, project_id, name, version, kind, status, inputs, storage_key, \
                vertex_count, triangle_count, created_by) \
             VALUES ($1, $2, $3, 1, 'tin', 'ready', $4, $5, $6, $7, $8) \
             RETURNING {SURFACE_COLUMNS}"
        ))
        .bind(id)
        .bind(project_id)
        .bind(&input.name)
        .bind(sqlx::types::Json(inputs_snapshot(&input)))
        .bind(&storage_key)
        .bind(vertex_count)
        .bind(triangle_count)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_surface(row))
    }

    /// Rebuilds an existing surface from (possibly new) inputs → next version.
    async fn rebuild_surface(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: SurfaceInput,
    ) -> Result<Surface> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;

        // Resolve the surface's project (org-scoped) before recomputing.
        let existing: Option<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT s.project_id, s.storage_key FROM surfaces s \
             JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (project_id, old_key) = found_in_org(existing, "surface")?;
        let crs = load_project_crs(pool, project_id, auth.org_id).await?;

        let points = select_points(
            pool,
            project_id,
            input.scope,
            input.scope_ref,
            &input.exclude_category_ids,
            &input.exclude_tags,
            &input.exclude_point_ids,
        )
        .await?;
        let constraints = select_constraints(pool, project_id, &input).await?;
        let (blob, vertex_count, triangle_count) =
            build_mesh_blob(&crs, points, constraints, input.max_edge_length).await?;

        let storage_key = format!("surface/{project_id}/{id}.bin");
        let store = storage(ctx)?;
        store
            .put(&storage_key, &blob)
            .await
            .map_err(async_graphql::Error::new)?;
        // Clean up a superseded blob under a different key (belt-and-suspenders;
        // the key is deterministic so it's usually the same path, overwritten).
        if let Some(k) = old_key {
            if k != storage_key {
                let _ = store.delete(&k).await;
            }
        }

        let row: SurfaceRow = sqlx::query_as(&format!(
            "UPDATE surfaces SET \
               name = $2, version = version + 1, status = 'ready', failure_reason = NULL, \
               inputs = $3, storage_key = $4, vertex_count = $5, triangle_count = $6 \
             WHERE id = $1 \
             RETURNING {SURFACE_COLUMNS}"
        ))
        .bind(id)
        .bind(&input.name)
        .bind(sqlx::types::Json(inputs_snapshot(&input)))
        .bind(&storage_key)
        .bind(vertex_count)
        .bind(triangle_count)
        .fetch_one(pool)
        .await?;
        Ok(row_to_surface(row))
    }

    /// Deletes a surface and its mesh blob.
    async fn delete_surface(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "DELETE FROM surfaces s USING projects p \
             WHERE s.id = $1 AND p.id = s.project_id AND p.org_id = $2 \
             RETURNING s.storage_key",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (storage_key,) = found_in_org(row, "surface")?;
        if let Some(key) = storage_key {
            let _ = storage(ctx)?.delete(&key).await;
        }
        Ok(true)
    }

    /// Creates a digitized breakline / boundary / hole.
    async fn create_breakline(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: BreaklineInput,
    ) -> Result<SurfaceBreakline> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row: BreaklineRow = sqlx::query_as(&format!(
            "INSERT INTO surface_breaklines (project_id, kind, closed, vertices, source) \
             VALUES ($1, $2, $3, $4, 'digitized') RETURNING {BREAKLINE_COLUMNS}"
        ))
        .bind(project_id)
        .bind(input.kind.as_db_str())
        .bind(input.closed)
        .bind(sqlx::types::Json(vertices_json(&input.vertices)))
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row_to_breakline(row))
    }

    /// Replaces a breakline's kind + geometry.
    async fn update_breakline(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        input: BreaklineInput,
    ) -> Result<SurfaceBreakline> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let project_id = breakline_project_in_org(pool, id, auth.org_id).await?;
        let row: BreaklineRow = sqlx::query_as(&format!(
            "UPDATE surface_breaklines SET kind = $2, closed = $3, vertices = $4, updated_at = now() \
             WHERE id = $1 RETURNING {BREAKLINE_COLUMNS}"
        ))
        .bind(id)
        .bind(input.kind.as_db_str())
        .bind(input.closed)
        .bind(sqlx::types::Json(vertices_json(&input.vertices)))
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row_to_breakline(row))
    }

    /// Deletes a breakline.
    async fn delete_breakline(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let project_id = breakline_project_in_org(pool, id, auth.org_id).await?;
        sqlx::query("DELETE FROM surface_breaklines WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    /// Generates an auto concave-hull boundary from a point scope, stored as an
    /// editable `boundary` breakline.
    async fn auto_boundary(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        #[graphql(default_with = "PointScope::All")] scope: PointScope,
        scope_ref: Option<Uuid>,
    ) -> Result<SurfaceBreakline> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let pts = select_points(pool, project_id, scope, scope_ref, &[], &[], &[]).await?;
        if pts.len() < 3 {
            return Err(async_graphql::Error::new(
                "need at least 3 points to derive a boundary",
            ));
        }
        let pts2d: Vec<[f64; 2]> = pts.iter().map(|&(e, n, _)| [e, n]).collect();
        let known: Vec<(f64, f64, f64)> = pts
            .iter()
            .filter_map(|&(e, n, z)| z.map(|z| (e, n, z)))
            .collect();
        let hull = geom::concave_hull(&pts2d, 2.0);
        if hull.len() < 3 {
            return Err(async_graphql::Error::new("could not derive a boundary"));
        }
        let verts = Value::Array(
            hull.iter()
                .map(|&[e, n]| json!({ "n": n, "e": e, "z": geom::nearest_point_z(&known, e, n) }))
                .collect(),
        );
        let row: BreaklineRow = sqlx::query_as(&format!(
            "INSERT INTO surface_breaklines (project_id, kind, closed, vertices, source) \
             VALUES ($1, 'boundary', true, $2, 'digitized') RETURNING {BREAKLINE_COLUMNS}"
        ))
        .bind(project_id)
        .bind(sqlx::types::Json(verts))
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row_to_breakline(row))
    }

    /// Imports breaklines from DXF polylines, one per feature, tagged by layer.
    async fn import_breaklines(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        content_base64: String,
        mappings: Vec<BreaklineLayerMapping>,
        unit: Option<LengthUnit>,
    ) -> Result<BreaklineImportResult> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let unit = unit.unwrap_or(LengthUnit::Meter);
        let text = decode_dxf(&content_base64)?;
        let features =
            crate::utilities::import::parse_dxf(&text).map_err(async_graphql::Error::new)?;
        use std::collections::HashMap;
        let map: HashMap<String, String> = mappings
            .into_iter()
            .filter_map(|m| m.kind.filter(|k| !k.is_empty()).map(|k| (m.layer, k)))
            .collect();

        let mut created = 0;
        let mut skipped = 0;
        let mut tx = pool.begin().await?;
        for f in &features {
            if !matches!(f.kind, crate::utilities::import::FeatureKind::Line) {
                continue;
            }
            // Canonicalize the mapped kind to the db's lowercase form (the client
            // sends the enum-style "HARD"/"BOUNDARY"/"HOLE").
            let kind = match map.get(&f.layer) {
                Some(k) => BreaklineKind::from_db_str(&k.to_lowercase()).as_db_str(),
                None => {
                    skipped += 1;
                    continue;
                }
            };
            let closed = kind != "hard";
            let verts = Value::Array(
                f.points
                    .iter()
                    .map(|&(x, y)| {
                        json!({ "n": unit.to_meters(y), "e": unit.to_meters(x), "z": Value::Null })
                    })
                    .collect(),
            );
            sqlx::query(
                "INSERT INTO surface_breaklines (project_id, kind, closed, vertices, source, source_layer) \
                 VALUES ($1, $2, $3, $4, 'dxf', $5)",
            )
            .bind(project_id)
            .bind(kind)
            .bind(closed)
            .bind(sqlx::types::Json(&verts))
            .bind(&f.layer)
            .execute(&mut *tx)
            .await?;
            created += 1;
        }
        tx.commit().await?;
        publish_scene(ctx, project_id);
        Ok(BreaklineImportResult { created, skipped })
    }

    /// Computes a reproducible cut/fill volume between a base surface and either a
    /// compare surface (surface↔surface) or a reference elevation (surface↔elevation),
    /// snapshotting the surface versions + params so the result never changes.
    async fn compute_volume(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        input: VolumeInput,
    ) -> Result<Volume> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        // The comparison target must match the requested comparison kind.
        match input.comparison {
            VolumeComparison::SurfaceToSurface if input.compare_surface_id.is_none() => {
                return Err(async_graphql::Error::new(
                    "a surface-to-surface volume needs a compare surface",
                ));
            }
            VolumeComparison::SurfaceToElevation if input.reference_elev.is_none() => {
                return Err(async_graphql::Error::new(
                    "a surface-to-elevation volume needs a reference elevation",
                ));
            }
            _ => {}
        }

        let (base_proj, base_version, base_key) =
            load_surface_for_volume(pool, input.base_surface_id, auth.org_id).await?;
        if base_proj != project_id {
            return Err(async_graphql::Error::new(
                "base surface is not in this project",
            ));
        }
        let store = storage(ctx)?;
        let base_bytes = store
            .get(&base_key)
            .await
            .map_err(async_graphql::Error::new)?;

        // Only load a compare surface for a surface-to-surface volume.
        let (compare_version, compare_bytes) = match input.comparison {
            VolumeComparison::SurfaceToSurface => {
                let cid = input.compare_surface_id.unwrap();
                let (c_proj, c_ver, c_key) =
                    load_surface_for_volume(pool, cid, auth.org_id).await?;
                if c_proj != project_id {
                    return Err(async_graphql::Error::new(
                        "compare surface is not in this project",
                    ));
                }
                let bytes = store.get(&c_key).await.map_err(async_graphql::Error::new)?;
                (Some(c_ver), Some(bytes))
            }
            VolumeComparison::SurfaceToElevation => (None, None),
        };
        // For a surface-to-elevation volume the reference is the target; for
        // surface-to-surface there's no reference elevation.
        let reference_elev = match input.comparison {
            VolumeComparison::SurfaceToElevation => input.reference_elev,
            VolumeComparison::SurfaceToSurface => None,
        };

        let cell_size = input.cell_size;
        let out = tokio::task::spawn_blocking(move || {
            compute_volume_blob(
                &base_bytes,
                compare_bytes.as_deref(),
                reference_elev,
                cell_size,
            )
        })
        .await
        .map_err(|e| async_graphql::Error::new(format!("volume task failed: {e}")))?
        .map_err(async_graphql::Error::new)?;

        let id = Uuid::new_v4();
        let heatmap_key = format!("volume/{project_id}/{id}.bin");
        store
            .put(&heatmap_key, &out.blob)
            .await
            .map_err(async_graphql::Error::new)?;

        let row: VolumeRow = sqlx::query_as(&format!(
            "INSERT INTO volumes \
               (id, project_id, name, method, comparison, base_surface_id, base_version, \
                compare_surface_id, compare_version, reference_elev, cell_size, \
                cut_volume, fill_volume, net_volume, area, heatmap_key, computed_by) \
             VALUES ($1, $2, $3, 'grid', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) \
             RETURNING {VOLUME_COLUMNS}"
        ))
        .bind(id)
        .bind(project_id)
        .bind(&input.name)
        .bind(input.comparison.as_db_str())
        .bind(input.base_surface_id)
        .bind(base_version)
        .bind(input.compare_surface_id)
        .bind(compare_version)
        .bind(reference_elev)
        .bind(cell_size)
        .bind(out.cut)
        .bind(out.fill)
        .bind(out.net)
        .bind(out.area)
        .bind(&heatmap_key)
        .bind(auth.user_id)
        .fetch_one(pool)
        .await?;
        Ok(row_to_volume(row))
    }

    /// Deletes a volume computation and its heatmap grid blob.
    async fn delete_volume(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "DELETE FROM volumes v USING projects p \
             WHERE v.id = $1 AND p.id = v.project_id AND p.org_id = $2 \
             RETURNING v.heatmap_key",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (heatmap_key,) = found_in_org(row, "volume")?;
        if let Some(key) = heatmap_key {
            let _ = storage(ctx)?.delete(&key).await;
        }
        Ok(true)
    }
}
