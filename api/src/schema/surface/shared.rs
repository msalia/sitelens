//! Shared helpers for the surface-modeling resolvers ([`super::query`] +
//! [`super::mutation`]): row mappers, point/constraint selection, the
//! mesh/volume/DEM builders, the CAD/GIS export helpers, and small utilities.
//! Kept `pub(super)` so both resolver modules can use them.
use serde_json::{json, Value};

use crate::models::{
    BreaklineKind, BreaklineVertexInput, DemGridInput, FileBlob, PointScope, Surface,
    SurfaceBreakline, SurfaceInput, SurfaceKind, SurfaceStatus, Volume, VolumeComparison,
};
use crate::schema::*;
use crate::surface::{self, dem, geom, geotiff, tin, volume};

/// Read columns for a `surfaces` row, in the order [`row_to_surface`] expects.
pub(super) const SURFACE_COLUMNS: &str =
    "id, project_id, name, version, kind, status, failure_reason, inputs, \
     vertex_count, triangle_count, created_at";

pub(super) type SurfaceRow = (
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

pub(super) fn row_to_surface(r: SurfaceRow) -> Surface {
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
pub(super) fn inputs_snapshot(input: &SurfaceInput) -> Value {
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
pub(super) async fn select_points(
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
pub(super) struct LoadedConstraint {
    kind: BreaklineKind,
    closed: bool,
    /// `(easting, northing, z?)` in projected meters.
    verts: Vec<(f64, f64, Option<f64>)>,
}

/// Parses a stored `vertices` JSON array (`[{n,e,z?}]`) into `(e, n, z?)` tuples.
pub(super) fn parse_vertices(v: &Value) -> Vec<(f64, f64, Option<f64>)> {
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
pub(super) async fn select_constraints(
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
pub(super) async fn build_mesh_blob(
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

pub(super) const BREAKLINE_COLUMNS: &str =
    "id, project_id, kind, closed, vertices, source, source_layer, created_at, updated_at";

pub(super) type BreaklineRow = (
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

pub(super) fn row_to_breakline(r: BreaklineRow) -> SurfaceBreakline {
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
pub(super) fn vertices_json(verts: &[BreaklineVertexInput]) -> Value {
    Value::Array(
        verts
            .iter()
            .map(|v| json!({ "n": v.n, "e": v.e, "z": v.z }))
            .collect(),
    )
}

/// Resolves a breakline's project (org-scoped); errors if not in the org.
pub(super) async fn breakline_project_in_org(
    pool: &PgPool,
    id: Uuid,
    org_id: Uuid,
) -> Result<Uuid> {
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
pub(super) fn guess_breakline_kind(layer: &str) -> &'static str {
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
pub(super) fn decode_dxf(content_base64: &str) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.trim())
        .map_err(|e| async_graphql::Error::new(format!("invalid base64: {e}")))?;
    String::from_utf8(bytes).map_err(|e| async_graphql::Error::new(format!("invalid UTF-8: {e}")))
}

// --- Volumes ----------------------------------------------------------------

pub(super) const VOLUME_COLUMNS: &str =
    "id, project_id, name, comparison, base_surface_id, base_version, \
     compare_surface_id, compare_version, reference_elev, cell_size, cut_volume, fill_volume, \
     net_volume, area, heatmap_key, computed_at";

pub(super) type VolumeRow = (
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

pub(super) fn row_to_volume(r: VolumeRow) -> Volume {
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
pub(super) async fn load_surface_for_volume(
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
pub(super) struct MetricFrame {
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
    /// A single geographic `(lat, lon)` → planar `(x, y)` meters.
    fn to_metric(&self, lat: f64, lon: f64) -> (f64, f64) {
        (
            (lon - self.lon0) * self.m_lon,
            (lat - self.lat0) * self.m_lat,
        )
    }
    /// Inverse of [`to_metric`]: planar `(x, y)` meters → geographic `(lat, lon)`.
    fn to_geo(&self, x: f64, y: f64) -> (f64, f64) {
        (self.lat0 + y / self.m_lat, self.lon0 + x / self.m_lon)
    }
}

/// The stored numeric result of a volume compute, plus its heatmap blob.
pub(super) struct VolumeOut {
    pub(super) blob: Vec<u8>,
    pub(super) cut: f64,
    pub(super) fill: f64,
    pub(super) net: f64,
    pub(super) area: f64,
}

/// Deserializes the base (and optional compare) mesh, computes the earthwork on a
/// shared metric frame, and serializes the SVOL heatmap blob. CPU-bound — run via
/// `spawn_blocking`.
pub(super) fn compute_volume_blob(
    base_bytes: &[u8],
    compare_bytes: Option<&[u8]>,
    reference_elev: Option<f64>,
    cell_size: f64,
) -> std::result::Result<VolumeOut, String> {
    let (base_geo, base_tris) =
        surface::deserialize_mesh(base_bytes).ok_or("base surface mesh is unreadable")?;
    // One shared frame (from the base centroid) so both surfaces sample aligned.
    let frame = MetricFrame::from_centroid(&base_geo);
    let base = volume::SurfaceSampler::new(frame.mesh_to_metric(&base_geo), base_tris.clone())
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

    // Totals come from the grid integration (accurate quadrature).
    let res = volume::compute_volume(&base, compare.as_ref(), reference_elev, cell_size)?;

    // The heatmap is the base surface itself, colored by a per-vertex Δz — so it
    // follows the surface outline exactly (no grid rasterization). A vertex the
    // compare surface doesn't cover gets Δz 0 (neutral).
    let mut dz = Vec::with_capacity(base_geo.len());
    let (mut min_dz, mut max_dz) = (f64::INFINITY, f64::NEG_INFINITY);
    for v in &base_geo {
        let (x, y) = frame.to_metric(v[0], v[1]);
        let other = match &compare {
            Some(c) => c.sample(x, y),
            None => reference_elev,
        };
        let d = other.map_or(0.0, |o| o - v[2]);
        if other.is_some() {
            min_dz = min_dz.min(d);
            max_dz = max_dz.max(d);
        }
        dz.push(d);
    }
    if !min_dz.is_finite() {
        (min_dz, max_dz) = (0.0, 0.0);
    }
    let blob = surface::serialize_volume_heatmap(&base_geo, &dz, &base_tris, min_dz, max_dz);
    Ok(VolumeOut {
        blob,
        cut: res.cut,
        fill: res.fill,
        net: res.net,
        area: res.area,
    })
}

/// Builds a **clean earthwork solid** for a surface-to-surface volume: the cut/fill
/// mass between the existing (`base`) surface and the proposed (`compare`) design,
/// clipped exactly to the design footprint so the edges are straight (not the
/// staircase you'd get from the base mesh). The design triangulation is subdivided
/// to pick up existing-ground relief for the top cap; the bottom cap is the design;
/// vertical walls follow the design boundary. Red = cut (design below existing),
/// blue = fill. Display only — the volume totals come from the grid integration.
pub(super) fn build_earthwork_solid_blob(
    base_bytes: &[u8],
    compare_bytes: &[u8],
) -> std::result::Result<Vec<u8>, String> {
    const CUT: [f64; 3] = [0.86, 0.15, 0.15];
    const FILL: [f64; 3] = [0.2, 0.45, 0.9];
    const NEUTRAL: [f64; 3] = [0.72, 0.72, 0.72];
    const TARGET_M: f64 = 3.0; // sub-edge length target (meters)
    const KMAX: usize = 12;

    let (base_geo, base_tris) =
        surface::deserialize_mesh(base_bytes).ok_or("base surface mesh is unreadable")?;
    let (cmp_geo, cmp_tris) =
        surface::deserialize_mesh(compare_bytes).ok_or("design surface mesh is unreadable")?;
    let frame = MetricFrame::from_centroid(&base_geo);
    let base = volume::SurfaceSampler::new(frame.mesh_to_metric(&base_geo), base_tris)
        .ok_or("base surface mesh is unusable")?;
    // Design vertices in metric (xy) with their design elevation.
    let cmp: Vec<[f64; 3]> = frame.mesh_to_metric(&cmp_geo);

    // Colour scale: the largest |design − existing| across design vertices.
    let mut scale = 0.0_f64;
    for v in &cmp {
        if let Some(e) = base.sample(v[0], v[1]) {
            scale = scale.max((v[2] - e).abs());
        }
    }
    if scale <= 0.0 {
        scale = 1.0;
    }
    let colour = |dz: f64| -> [f64; 3] {
        let end = if dz < 0.0 { CUT } else { FILL };
        let k = (dz.abs() / scale).clamp(0.0, 1.0);
        let t = 0.35 + 0.65 * k;
        [
            NEUTRAL[0] + (end[0] - NEUTRAL[0]) * t,
            NEUTRAL[1] + (end[1] - NEUTRAL[1]) * t,
            NEUTRAL[2] + (end[2] - NEUTRAL[2]) * t,
        ]
    };

    let mut verts: Vec<[f64; 3]> = Vec::new();
    let mut cols: Vec<[f64; 3]> = Vec::new();
    let mut tris: Vec<[u32; 3]> = Vec::new();
    // Push a triangle of metric points at the given elevations, in geographic space.
    let mut push_tri = |p: [(f64, f64, f64); 3], c: [f64; 3]| {
        let n = verts.len() as u32;
        for (x, y, z) in p {
            let (lat, lon) = frame.to_geo(x, y);
            verts.push([lat, lon, z]);
            cols.push(c);
        }
        tris.push([n, n + 1, n + 2]);
    };
    // Existing ground at a metric point (falls back to the design elev off-terrain).
    let existing = |x: f64, y: f64, design_z: f64| base.sample(x, y).unwrap_or(design_z);

    // Caps: subdivide each design triangle to capture existing-ground relief.
    for t in &cmp_tris {
        let a = cmp[t[0] as usize];
        let b = cmp[t[1] as usize];
        let c = cmp[t[2] as usize];
        let edge =
            |p: [f64; 3], q: [f64; 3]| ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
        let max_edge = edge(a, b).max(edge(b, c)).max(edge(c, a));
        let k = ((max_edge / TARGET_M).round() as usize).clamp(1, KMAX);
        // Barycentric point (ii, jj) of the k-subdivided triangle → (x, y, design_z).
        let pt = |ii: usize, jj: usize| -> (f64, f64, f64) {
            let wb = ii as f64 / k as f64;
            let wc = jj as f64 / k as f64;
            let wa = 1.0 - wb - wc;
            (
                wa * a[0] + wb * b[0] + wc * c[0],
                wa * a[1] + wb * b[1] + wc * c[1],
                wa * a[2] + wb * b[2] + wc * c[2],
            )
        };
        for ii in 0..k {
            for jj in 0..(k - ii) {
                let lower = [(ii, jj), (ii + 1, jj), (ii, jj + 1)];
                let mut emit = |grid: [(usize, usize); 3]| {
                    let d: Vec<(f64, f64, f64)> = grid.iter().map(|&(i, j)| pt(i, j)).collect();
                    let top: Vec<(f64, f64, f64)> = d
                        .iter()
                        .map(|&(x, y, z)| (x, y, existing(x, y, z)))
                        .collect();
                    let mdz = (d[0].2 - top[0].2 + d[1].2 - top[1].2 + d[2].2 - top[2].2) / 3.0;
                    let col = colour(mdz);
                    // Top cap (existing ground).
                    push_tri([top[0], top[1], top[2]], col);
                    // Bottom cap (design), reversed winding.
                    push_tri([d[0], d[2], d[1]], col);
                };
                emit(lower);
                if ii + jj + 1 < k {
                    emit([(ii + 1, jj), (ii + 1, jj + 1), (ii, jj + 1)]);
                }
            }
        }
    }

    // Vertical walls along the design boundary (edges used by a single triangle).
    let mut edge_count: std::collections::HashMap<(u32, u32), i32> =
        std::collections::HashMap::new();
    for t in &cmp_tris {
        for (i, j) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let key = if i < j { (i, j) } else { (j, i) };
            *edge_count.entry(key).or_insert(0) += 1;
        }
    }
    for (&(i, j), &count) in &edge_count {
        if count != 1 {
            continue;
        }
        let (vi, vj) = (cmp[i as usize], cmp[j as usize]);
        let len = ((vi[0] - vj[0]).powi(2) + (vi[1] - vj[1]).powi(2)).sqrt();
        let k = ((len / TARGET_M).round() as usize).clamp(1, KMAX);
        for s in 0..k {
            let t0 = s as f64 / k as f64;
            let t1 = (s + 1) as f64 / k as f64;
            let seg = |tt: f64| -> (f64, f64, f64) {
                (
                    vi[0] + (vj[0] - vi[0]) * tt,
                    vi[1] + (vj[1] - vi[1]) * tt,
                    vi[2] + (vj[2] - vi[2]) * tt,
                )
            };
            let (x0, y0, dz0) = seg(t0);
            let (x1, y1, dz1) = seg(t1);
            let e0 = existing(x0, y0, dz0);
            let e1 = existing(x1, y1, dz1);
            let col = colour(((dz0 - e0) + (dz1 - e1)) / 2.0);
            // Vertical quad: existing → design at each segment end.
            push_tri([(x0, y0, e0), (x1, y1, e1), (x1, y1, dz1)], col);
            push_tri([(x0, y0, e0), (x1, y1, dz1), (x0, y0, dz0)], col);
        }
    }

    if tris.is_empty() {
        return Err("no earthwork geometry to display".into());
    }
    Ok(surface::serialize_earthwork_solid(&verts, &cols, &tris))
}

// --- DEM source -------------------------------------------------------------

/// Reprojects a DEM grid node to geographic. Geographic sources (4326/4269) carry
/// nodes as `(lon, lat)` already; projected sources go through `crs`.
pub(super) fn dem_node_to_geographic(epsg: i32, e: f64, n: f64) -> Option<(f64, f64)> {
    if epsg == 4326 || epsg == 4269 {
        Some((n, e))
    } else {
        crs::projected_to_geographic(epsg, e, n)
    }
}

/// Decodes a client-parsed DEM grid, triangulates it, reprojects to geographic,
/// and serializes the STIN blob. CPU-bound → runs off the async runtime.
pub(super) async fn build_dem_mesh_blob(grid: DemGridInput) -> Result<(Vec<u8>, i32, i32)> {
    tokio::task::spawn_blocking(
        move || -> std::result::Result<(Vec<u8>, i32, i32), String> {
            use base64::Engine;
            let raw = base64::engine::general_purpose::STANDARD
                .decode(grid.values_base64.trim())
                .map_err(|e| format!("invalid DEM values base64: {e}"))?;
            if raw.len() % 4 != 0 {
                return Err("DEM values are not a little-endian f32 array".into());
            }
            let values: Vec<f64> = raw
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f64)
                .collect();
            if grid.width < 0 || grid.height < 0 {
                return Err("DEM dimensions must be non-negative".into());
            }
            let mesh = dem::grid_to_mesh(&dem::DemInput {
                width: grid.width as usize,
                height: grid.height as usize,
                origin_e: grid.origin_e,
                origin_n: grid.origin_n,
                pixel_x: grid.pixel_x,
                pixel_y: grid.pixel_y,
                nodata: grid.nodata,
                values,
            })?;
            let mut geo = Vec::with_capacity(mesh.vertices.len());
            for [e, n, z] in &mesh.vertices {
                let (lat, lon) = dem_node_to_geographic(grid.epsg, *e, *n)
                    .ok_or("could not reproject a DEM node to geographic")?;
                geo.push([lat, lon, *z]);
            }
            let blob = surface::serialize_mesh(&geo, &mesh.indices);
            Ok((blob, geo.len() as i32, mesh.indices.len() as i32))
        },
    )
    .await
    .map_err(|e| async_graphql::Error::new(format!("DEM build task failed: {e}")))?
    .map_err(async_graphql::Error::new)
}

// --- Exports ----------------------------------------------------------------

/// A surface ready to export: `(name, epsg, projected vertices [e,n,z], triangles)`.
pub(super) type ProjectedSurface = (String, i32, Vec<[f64; 3]>, Vec<[u32; 3]>);

/// Loads a surface's mesh in the project's **projected** frame `[e, n, z]`
/// (inverting the stored geographic vertices), plus its name + EPSG — the basis
/// for every CAD/GIS deliverable. Org-scoped; errors if not computed.
pub(super) async fn load_surface_projected(
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
pub(super) fn surface_to_dem_grid(
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
pub(super) async fn render_pdf(html: &str) -> Result<Vec<u8>> {
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
pub(super) async fn file_blob(
    filename: String,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<FileBlob> {
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
pub(super) const CUBIC_YARD_M3: f64 = 0.764_554_857_984;
pub(super) const SQUARE_FOOT_M2: f64 = 0.092_903_04;

/// Filename-safe slug from a name (collapses non-alphanumerics to `-`).
pub(super) fn slug(s: &str) -> String {
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
