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

use std::collections::HashMap;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::import::MAX_ROWS;
use crate::storage::Storage;

pub const ARCHIVE_FORMAT: &str = "sitelens-project";
pub const ARCHIVE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveProject {
    name: String,
    description: String,
    epsg_code: i32,
    display_unit: String,
    combined_scale_factor: f64,
    site_origin_lat: Option<f64>,
    site_origin_lon: Option<f64>,
    #[serde(default)]
    site_origin_rotation_deg: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveGridAxis {
    family: String,
    label: String,
    position: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveControlPoint {
    label: String,
    northing: f64,
    easting: f64,
    elevation: Option<f64>,
    grid_x: Option<f64>,
    grid_y: Option<f64>,
    source: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveTransform {
    translation_e: f64,
    translation_n: f64,
    rotation_rad: f64,
    scale: f64,
    rms_error: f64,
    point_count: i32,
    residuals: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveCategory {
    /// Original category id — survey points reference it via `category_ref`.
    r#ref: Uuid,
    name: String,
    color: String,
    icon: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSurveyPoint {
    /// Original point id — point groups reference it via `member_refs`.
    r#ref: Uuid,
    label: String,
    northing: f64,
    easting: f64,
    elevation: Option<f64>,
    description: String,
    category_ref: Option<Uuid>,
    tags: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchivePointGroup {
    name: String,
    member_refs: Vec<Uuid>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveCadOverlay {
    original_filename: String,
    offset_e: f64,
    offset_n: f64,
    rotation_deg: f64,
    scale: f64,
    #[serde(default)]
    elevation: f64,
    assume_real_world: bool,
    visible: bool,
    /// The DXF drawing, inline (DXF is UTF-8 text).
    content: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Archive {
    format: String,
    version: u32,
    #[serde(default)]
    exported_at: String,
    project: ArchiveProject,
    grid_axes: Vec<ArchiveGridAxis>,
    control_points: Vec<ArchiveControlPoint>,
    transform: Option<ArchiveTransform>,
    categories: Vec<ArchiveCategory>,
    survey_points: Vec<ArchiveSurveyPoint>,
    point_groups: Vec<ArchivePointGroup>,
    cad_overlays: Vec<ArchiveCadOverlay>,
}

/// Serializes a project (already checked to belong to the caller's org) into a
/// `.slx` archive string.
pub async fn export_project(
    pool: &PgPool,
    storage: &dyn Storage,
    project_id: Uuid,
) -> Result<String, String> {
    let p: (
        String,
        String,
        i32,
        String,
        f64,
        Option<f64>,
        Option<f64>,
        f64,
    ) = sqlx::query_as(
        "SELECT name, description, epsg_code, display_unit, combined_scale_factor, \
         site_origin_lat, site_origin_lon, site_origin_rotation_deg \
         FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let project = ArchiveProject {
        name: p.0,
        description: p.1,
        epsg_code: p.2,
        display_unit: p.3,
        combined_scale_factor: p.4,
        site_origin_lat: p.5,
        site_origin_lon: p.6,
        site_origin_rotation_deg: p.7,
    };

    let grid_axes: Vec<ArchiveGridAxis> = sqlx::query_as(
        "SELECT family, label, position FROM grid_axes WHERE project_id = $1 ORDER BY family, position",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|(family, label, position)| ArchiveGridAxis { family, label, position })
    .collect();

    let control_points: Vec<ArchiveControlPoint> = sqlx::query_as(
        "SELECT label, northing, easting, elevation, grid_x, grid_y, source \
         FROM control_points WHERE project_id = $1 ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(
        |(label, northing, easting, elevation, grid_x, grid_y, source)| ArchiveControlPoint {
            label,
            northing,
            easting,
            elevation,
            grid_x,
            grid_y,
            source,
        },
    )
    .collect();

    let transform: Option<ArchiveTransform> = sqlx::query_as::<
        _,
        (f64, f64, f64, f64, f64, i32, sqlx::types::Json<serde_json::Value>),
    >(
        "SELECT translation_e, translation_n, rotation_rad, scale, rms_error, point_count, residuals \
         FROM transforms WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .map(|t| ArchiveTransform {
        translation_e: t.0,
        translation_n: t.1,
        rotation_rad: t.2,
        scale: t.3,
        rms_error: t.4,
        point_count: t.5,
        residuals: t.6 .0,
    });

    type SpRow = (
        Uuid,
        String,
        f64,
        f64,
        Option<f64>,
        String,
        Option<Uuid>,
        Vec<String>,
    );
    let sp_rows: Vec<SpRow> = sqlx::query_as(
        "SELECT id, label, northing, easting, elevation, description, category_id, tags \
         FROM survey_points WHERE project_id = $1 ORDER BY seq",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let survey_points: Vec<ArchiveSurveyPoint> = sp_rows
        .into_iter()
        .map(
            |(id, label, northing, easting, elevation, description, category_id, tags)| {
                ArchiveSurveyPoint {
                    r#ref: id,
                    label,
                    northing,
                    easting,
                    elevation,
                    description,
                    category_ref: category_id,
                    tags,
                }
            },
        )
        .collect();

    // Only the categories actually used by this project's points.
    let used: Vec<Uuid> = survey_points
        .iter()
        .filter_map(|p| p.category_ref)
        .collect();
    let categories: Vec<ArchiveCategory> = sqlx::query_as::<_, (Uuid, String, String, String)>(
        "SELECT id, name, color, icon FROM point_categories WHERE id = ANY($1)",
    )
    .bind(&used)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|(id, name, color, icon)| ArchiveCategory {
        r#ref: id,
        name,
        color,
        icon,
    })
    .collect();

    let point_groups: Vec<ArchivePointGroup> = sqlx::query_as::<_, (String, Vec<Uuid>)>(
        "SELECT name, member_ids FROM point_groups WHERE project_id = $1 ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|(name, member_ids)| ArchivePointGroup {
        name,
        member_refs: member_ids,
    })
    .collect();

    type OverlayRow = (String, f64, f64, f64, f64, f64, bool, bool, String);
    let overlay_rows: Vec<OverlayRow> = sqlx::query_as(
        "SELECT original_filename, offset_e, offset_n, rotation_deg, scale, elevation, \
         assume_real_world, visible, storage_key FROM cad_overlays WHERE project_id = $1 ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut cad_overlays = Vec::with_capacity(overlay_rows.len());
    for (
        original_filename,
        offset_e,
        offset_n,
        rotation_deg,
        scale,
        elevation,
        assume_real_world,
        visible,
        storage_key,
    ) in overlay_rows
    {
        let bytes = storage.get(&storage_key).await?;
        let content =
            String::from_utf8(bytes).map_err(|_| "overlay is not valid UTF-8".to_string())?;
        cad_overlays.push(ArchiveCadOverlay {
            original_filename,
            offset_e,
            offset_n,
            rotation_deg,
            scale,
            elevation,
            assume_real_world,
            visible,
            content,
        });
    }

    let archive = Archive {
        format: ARCHIVE_FORMAT.to_string(),
        version: ARCHIVE_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        project,
        grid_axes,
        control_points,
        transform,
        categories,
        survey_points,
        point_groups,
        cad_overlays,
    };
    serde_json::to_string_pretty(&archive).map_err(|e| e.to_string())
}

/// Creates a new project in `org_id` from a `.slx` archive string, recreating
/// all of its data. Returns the new project id.
pub async fn import_project(
    pool: &PgPool,
    storage: &dyn Storage,
    org_id: Uuid,
    content: &str,
) -> Result<Uuid, String> {
    let archive: Archive =
        serde_json::from_str(content).map_err(|_| "not a valid SiteLens archive".to_string())?;
    if archive.format != ARCHIVE_FORMAT {
        return Err("not a SiteLens project archive".to_string());
    }
    if archive.version > ARCHIVE_VERSION {
        return Err(format!(
            "archive version {} is newer than this server supports ({ARCHIVE_VERSION})",
            archive.version
        ));
    }
    if archive.project.name.trim().is_empty() {
        return Err("archive is missing a project name".to_string());
    }
    if archive.survey_points.len() > MAX_ROWS || archive.control_points.len() > MAX_ROWS {
        return Err("archive exceeds the maximum allowed number of points".to_string());
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let (project_id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO projects \
           (org_id, name, description, epsg_code, display_unit, combined_scale_factor, \
            site_origin_lat, site_origin_lon, site_origin_rotation_deg) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    )
    .bind(org_id)
    .bind(archive.project.name.trim())
    .bind(&archive.project.description)
    .bind(archive.project.epsg_code)
    .bind(&archive.project.display_unit)
    .bind(archive.project.combined_scale_factor)
    .bind(archive.project.site_origin_lat)
    .bind(archive.project.site_origin_lon)
    .bind(archive.project.site_origin_rotation_deg)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    for a in &archive.grid_axes {
        sqlx::query(
            "INSERT INTO grid_axes (project_id, family, label, position) VALUES ($1, $2, $3, $4)",
        )
        .bind(project_id)
        .bind(&a.family)
        .bind(&a.label)
        .bind(a.position)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    for c in &archive.control_points {
        sqlx::query(
            "INSERT INTO control_points \
               (project_id, label, northing, easting, elevation, grid_x, grid_y, source) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(project_id)
        .bind(&c.label)
        .bind(c.northing)
        .bind(c.easting)
        .bind(c.elevation)
        .bind(c.grid_x)
        .bind(c.grid_y)
        .bind(&c.source)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    if let Some(t) = &archive.transform {
        sqlx::query(
            "INSERT INTO transforms \
               (project_id, translation_e, translation_n, rotation_rad, scale, rms_error, point_count, residuals) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(project_id)
        .bind(t.translation_e)
        .bind(t.translation_n)
        .bind(t.rotation_rad)
        .bind(t.scale)
        .bind(t.rms_error)
        .bind(t.point_count)
        .bind(sqlx::types::Json(&t.residuals))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Map archived category ids → the importing org's categories (reuse by name,
    // create when missing).
    let mut category_map: HashMap<Uuid, Uuid> = HashMap::new();
    for cat in &archive.categories {
        let existing: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM point_categories WHERE org_id = $1 AND lower(name) = lower($2) LIMIT 1",
        )
        .bind(org_id)
        .bind(&cat.name)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let resolved = match existing {
            Some((id,)) => id,
            None => {
                let (id,): (Uuid,) = sqlx::query_as(
                    "INSERT INTO point_categories (org_id, name, color, icon, is_default) \
                     VALUES ($1, $2, $3, $4, false) RETURNING id",
                )
                .bind(org_id)
                .bind(&cat.name)
                .bind(&cat.color)
                .bind(&cat.icon)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                id
            }
        };
        category_map.insert(cat.r#ref, resolved);
    }

    // Insert survey points, mapping category refs and recording new ids so point
    // groups can be rebuilt.
    let mut point_map: HashMap<Uuid, Uuid> = HashMap::new();
    for sp in &archive.survey_points {
        let category_id = sp.category_ref.and_then(|r| category_map.get(&r).copied());
        let (id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO survey_points \
               (project_id, label, northing, easting, elevation, description, category_id, tags) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        )
        .bind(project_id)
        .bind(&sp.label)
        .bind(sp.northing)
        .bind(sp.easting)
        .bind(sp.elevation)
        .bind(&sp.description)
        .bind(category_id)
        .bind(&sp.tags)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        point_map.insert(sp.r#ref, id);
    }

    for g in &archive.point_groups {
        let members: Vec<Uuid> = g
            .member_refs
            .iter()
            .filter_map(|r| point_map.get(r).copied())
            .collect();
        sqlx::query("INSERT INTO point_groups (project_id, name, member_ids) VALUES ($1, $2, $3)")
            .bind(project_id)
            .bind(&g.name)
            .bind(&members)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // DXF overlays: write the drawing to storage under a fresh key, then record
    // the row. Storage writes aren't transactional, but a rolled-back DB tx just
    // leaves an unreferenced file behind (harmless).
    for ov in &archive.cad_overlays {
        let overlay_id = Uuid::new_v4();
        let key = format!("dxf/{project_id}/{overlay_id}.dxf");
        storage.put(&key, ov.content.as_bytes()).await?;
        sqlx::query(
            "INSERT INTO cad_overlays \
               (id, project_id, original_filename, storage_key, offset_e, offset_n, rotation_deg, \
                scale, elevation, assume_real_world, visible) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(overlay_id)
        .bind(project_id)
        .bind(&ov.original_filename)
        .bind(&key)
        .bind(ov.offset_e)
        .bind(ov.offset_n)
        .bind(ov.rotation_deg)
        .bind(ov.scale)
        .bind(ov.elevation)
        .bind(ov.assume_real_world)
        .bind(ov.visible)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(project_id)
}
