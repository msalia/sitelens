use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::storage::Storage;

use super::types::*;

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
         FROM survey_points WHERE project_id = $1 AND point_type = 'design' ORDER BY seq",
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
