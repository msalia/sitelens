use crate::models::{
    BreaklineImportLayer, BreaklineImportPreview, FileBlob, Surface, SurfaceBreakline,
    SurfaceExportFormat, Volume, VolumeReportFormat, VolumeUnit,
};
use crate::schema::*;
use crate::surface::terrain_composite::{self, DesignGrade, GradedVolume};
use crate::surface::{self, contour, export, geotiff};

use super::shared::*;

/// Loads the base + design (compare) mesh bytes for a surface-to-surface volume,
/// org-scoped. Returns None for a surface-to-elevation volume (no design mesh).
async fn volume_surface_bytes(
    ctx: &Context<'_>,
    org_id: Uuid,
    id: Uuid,
) -> Result<Option<(Vec<u8>, Vec<u8>)>> {
    let pool = pool(ctx)?;
    let row: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "SELECT v.base_surface_id, v.compare_surface_id FROM volumes v \
         JOIN projects p ON p.id = v.project_id WHERE v.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let (base_id, compare_id) = found_in_org(row, "volume")?;
    let Some(compare_id) = compare_id else {
        return Ok(None);
    };
    let key_of = |sid: Uuid| async move {
        let r: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT s.storage_key FROM surfaces s JOIN projects p ON p.id = s.project_id \
             WHERE s.id = $1 AND p.org_id = $2",
        )
        .bind(sid)
        .bind(org_id)
        .fetch_optional(pool)
        .await?;
        found_in_org(r, "surface")?
            .0
            .ok_or_else(|| async_graphql::Error::new("surface has no mesh"))
    };
    let base_key = key_of(base_id).await?;
    let compare_key = key_of(compare_id).await?;
    let storage = storage(ctx)?;
    let base_bytes = storage
        .get(&base_key)
        .await
        .map_err(async_graphql::Error::new)?;
    let cmp_bytes = storage
        .get(&compare_key)
        .await
        .map_err(async_graphql::Error::new)?;
    Ok(Some((base_bytes, cmp_bytes)))
}

/// Traces a geographic mesh's outer boundary into a `[lon, lat]` ring (mesh verts
/// are `[lat, lon, h]`).
fn boundary_ring_lonlat(verts: &[[f64; 3]], tris: &[[u32; 3]]) -> Result<Vec<[f64; 2]>> {
    let ring = order_boundary_ring(tris)
        .ok_or_else(|| async_graphql::Error::new("could not trace the volume footprint"))?;
    Ok(ring.iter().map(|&i| [verts[i][1], verts[i][0]]).collect())
}

/// Loads a surface's decoded geographic mesh (STIN → `[lat,lon,h]` + tris), org-scoped.
async fn surface_mesh_geo(
    ctx: &Context<'_>,
    org_id: Uuid,
    sid: Uuid,
) -> Result<crate::surface::MeshData> {
    let pool = pool(ctx)?;
    let r: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT s.storage_key FROM surfaces s JOIN projects p ON p.id = s.project_id \
         WHERE s.id = $1 AND p.org_id = $2",
    )
    .bind(sid)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let key = found_in_org(r, "surface")?
        .0
        .ok_or_else(|| async_graphql::Error::new("surface has no mesh"))?;
    let bytes = storage(ctx)?
        .get(&key)
        .await
        .map_err(async_graphql::Error::new)?;
    surface::deserialize_mesh(&bytes)
        .ok_or_else(|| async_graphql::Error::new("surface mesh is unreadable"))
}

/// Resolves one volume into a [`GradedVolume`] (footprint + design grade),
/// org-scoped. surface-to-elevation → base footprint + flat reference elevation;
/// surface-to-surface → the compare surface's footprint + the compare mesh.
async fn graded_volume(ctx: &Context<'_>, org_id: Uuid, id: Uuid) -> Result<GradedVolume> {
    let pool = pool(ctx)?;
    let row: Option<(String, Uuid, Option<Uuid>, Option<f64>)> = sqlx::query_as(
        "SELECT v.comparison, v.base_surface_id, v.compare_surface_id, v.reference_elev \
         FROM volumes v JOIN projects p ON p.id = v.project_id \
         WHERE v.id = $1 AND p.org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let (comparison, base_id, compare_id, ref_elev) = found_in_org(row, "volume")?;
    if comparison == "surface_to_elevation" {
        let e = ref_elev
            .ok_or_else(|| async_graphql::Error::new("volume missing reference elevation"))?;
        let (verts, tris) = surface_mesh_geo(ctx, org_id, base_id).await?;
        Ok(GradedVolume {
            footprint_lonlat: boundary_ring_lonlat(&verts, &tris)?,
            grade: DesignGrade::Elevation(e),
        })
    } else {
        let cid = compare_id
            .ok_or_else(|| async_graphql::Error::new("volume missing a design surface"))?;
        let (verts, tris) = surface_mesh_geo(ctx, org_id, cid).await?;
        let ring = boundary_ring_lonlat(&verts, &tris)?;
        Ok(GradedVolume {
            footprint_lonlat: ring,
            grade: DesignGrade::Surface((verts, tris)),
        })
    }
}

/// Base64-encodes bytes off the async runtime.
async fn encode_base64(bytes: Vec<u8>) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    })
    .await
    .map_err(|e| async_graphql::Error::new(e.to_string()))
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

    /// A clean earthwork solid (the cut/fill mass clipped to the design footprint,
    /// with straight edges + vertical walls) for display, as a base64 ESOL blob.
    /// Null for surface-to-elevation volumes (no design mesh to clip to).
    async fn volume_earthwork_solid(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<String>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let Some((base_bytes, cmp_bytes)) = volume_surface_bytes(ctx, auth.org_id, id).await?
        else {
            return Ok(None);
        };
        let blob = tokio::task::spawn_blocking(move || {
            build_earthwork_solid_blob(&base_bytes, &cmp_bytes)
        })
        .await
        .map_err(|e| async_graphql::Error::new(format!("earthwork task failed: {e}")))?
        .map_err(async_graphql::Error::new)?;
        Ok(Some(encode_base64(blob).await?))
    }

    /// The clean **graded-terrain surface** (existing terrain with the design
    /// footprint cut out + filled to the proposed grade, straight edges + vertical
    /// walls) for display, as a base64 ESOL blob. Null for surface-to-elevation.
    async fn volume_graded_terrain(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<String>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let Some((base_bytes, cmp_bytes)) = volume_surface_bytes(ctx, auth.org_id, id).await?
        else {
            return Ok(None);
        };
        let blob =
            tokio::task::spawn_blocking(move || build_graded_terrain_blob(&base_bytes, &cmp_bytes))
                .await
                .map_err(|e| async_graphql::Error::new(format!("graded task failed: {e}")))?
                .map_err(async_graphql::Error::new)?;
        Ok(Some(encode_base64(blob).await?))
    }

    /// The **combined graded terrain** (base64 CTER): the boundary-split composite
    /// with the inside-boundary detail lifted to each selected volume's design grade
    /// (overlaps resolve by list order). Rendered by the client's `CompositeTerrain`
    /// exactly like the plain composite. `null` when the project has no boundary or
    /// is missing a DEM. Crew-gated.
    async fn graded_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        volume_ids: Vec<Uuid>,
    ) -> Result<Option<String>> {
        require_feature(ctx, Feature::Surfaces).await?;
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        // Boundary → geographic [lon, lat] (matches the composite path).
        let row: Option<(Option<serde_json::Value>, i32)> = sqlx::query_as(
            "SELECT boundary, epsg_code FROM projects WHERE id = $1 AND org_id = $2",
        )
        .bind(project_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (boundary, epsg) = found_in_org(row, "project")?;
        let Some(boundary) = boundary else {
            return Ok(None);
        };
        let pts: Vec<[f64; 2]> = serde_json::from_value(boundary)
            .map_err(|e| async_graphql::Error::new(format!("invalid boundary geometry: {e}")))?;
        let boundary_lonlat: Vec<[f64; 2]> = pts
            .iter()
            .filter_map(|[e, n]| crate::crs::projected_to_geographic(epsg, *e, *n))
            .map(|(lat, lon)| [lon, lat])
            .collect();
        if boundary_lonlat.len() < 3 {
            return Ok(None);
        }

        // Both DEMs must be cached.
        let ckey: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let dkey: Option<(String,)> = sqlx::query_as(
            "SELECT storage_key FROM project_detailed_terrain WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        let (Some((ckey,)), Some((dkey,))) = (ckey, dkey) else {
            return Ok(None);
        };

        // Resolve each volume's footprint + grade (org-scoped).
        let mut grades: Vec<GradedVolume> = Vec::with_capacity(volume_ids.len());
        for id in &volume_ids {
            grades.push(graded_volume(ctx, auth.org_id, *id).await?);
        }

        let storage = storage(ctx)?;
        let coarse_bytes = storage
            .get(&ckey)
            .await
            .map_err(async_graphql::Error::new)?;
        let detail_bytes = storage
            .get(&dkey)
            .await
            .map_err(async_graphql::Error::new)?;

        let blob = tokio::task::spawn_blocking(move || -> std::result::Result<Vec<u8>, String> {
            let coarse = geotiff::read_geotiff(&coarse_bytes)?;
            let detail = geotiff::read_geotiff(&detail_bytes)?;
            let mesh = terrain_composite::build_graded_composite(
                &coarse,
                &detail,
                &boundary_lonlat,
                &grades,
            )?;
            Ok(surface::serialize_composite(
                &mesh.vertices,
                &mesh.alpha,
                &mesh.coarse_tris,
                &mesh.detail_tris,
            ))
        })
        .await
        .map_err(|e| async_graphql::Error::new(format!("graded task failed: {e}")))?
        .map_err(async_graphql::Error::new)?;
        Ok(Some(encode_base64(blob).await?))
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
