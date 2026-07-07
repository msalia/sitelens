use chrono::{NaiveDate, Utc};
use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::storage::Storage;

use super::types::*;

#[derive(sqlx::FromRow)]
struct RunRow {
    id: Uuid,
    type_key: String,
    label: String,
    level: Option<String>,
    diameter: Option<f64>,
    material: Option<String>,
    invert_up: Option<f64>,
    invert_down: Option<f64>,
    slope: Option<f64>,
    owner: Option<String>,
    install_date: Option<NaiveDate>,
    condition: Option<String>,
    attrs_extra: Json<serde_json::Value>,
    tags: Vec<String>,
    source: String,
    as_built_date: Option<NaiveDate>,
    locate_method: Option<String>,
}

#[derive(sqlx::FromRow)]
struct StructRow {
    type_key: String,
    label: String,
    level: Option<String>,
    northing: f64,
    easting: f64,
    rim_elev: Option<f64>,
    inverts: Json<serde_json::Value>,
    material: Option<String>,
    owner: Option<String>,
    condition: Option<String>,
    attrs_extra: Json<serde_json::Value>,
    tags: Vec<String>,
    source: String,
    as_built_date: Option<NaiveDate>,
    locate_method: Option<String>,
}

#[derive(sqlx::FromRow)]
struct BatchRow {
    id: Uuid,
    source_filename: String,
    format: String,
    baseline_scope: String,
    delta_space: String,
    tol_h_warn: f64,
    tol_h_fail: f64,
    tol_v_warn: f64,
    tol_v_fail: f64,
    report_unit: String,
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

    // Utility runs (+ snapshotted vertices).
    let run_rows: Vec<RunRow> = sqlx::query_as(
        "SELECT id, type_key, label, level, diameter, material, invert_up, invert_down, slope, \
         owner, install_date, condition, attrs_extra, tags, source, as_built_date, locate_method \
         FROM utility_runs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut utility_runs = Vec::with_capacity(run_rows.len());
    for r in run_rows {
        let vertices: Vec<ArchiveUtilityVertex> = sqlx::query_as::<_, (f64, f64, Option<f64>)>(
            "SELECT northing, easting, elevation FROM utility_vertices WHERE run_id = $1 ORDER BY seq",
        )
        .bind(r.id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(northing, easting, elevation)| ArchiveUtilityVertex {
            northing,
            easting,
            elevation,
        })
        .collect();
        utility_runs.push(ArchiveUtilityRun {
            type_key: r.type_key,
            label: r.label,
            level: r.level,
            diameter: r.diameter,
            material: r.material,
            invert_up: r.invert_up,
            invert_down: r.invert_down,
            slope: r.slope,
            owner: r.owner,
            install_date: r.install_date,
            condition: r.condition,
            attrs_extra: r.attrs_extra.0,
            tags: r.tags,
            source: r.source,
            as_built_date: r.as_built_date,
            locate_method: r.locate_method,
            vertices,
        });
    }

    let utility_structures: Vec<ArchiveUtilityStructure> = sqlx::query_as::<_, StructRow>(
        "SELECT type_key, label, level, northing, easting, rim_elev, inverts, material, owner, \
         condition, attrs_extra, tags, source, as_built_date, locate_method \
         FROM utility_structures WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|s| ArchiveUtilityStructure {
        type_key: s.type_key,
        label: s.label,
        level: s.level,
        northing: s.northing,
        easting: s.easting,
        rim_elev: s.rim_elev,
        inverts: s.inverts.0,
        material: s.material,
        owner: s.owner,
        condition: s.condition,
        attrs_extra: s.attrs_extra.0,
        tags: s.tags,
        source: s.source,
        as_built_date: s.as_built_date,
        locate_method: s.locate_method,
    })
    .collect();

    // Field-exchange as-built comparison batches (+ snapshotted rows).
    let batch_rows: Vec<BatchRow> = sqlx::query_as(
        "SELECT id, source_filename, format, baseline_scope, delta_space, tol_h_warn, tol_h_fail, \
         tol_v_warn, tol_v_fail, report_unit FROM as_built_batches WHERE project_id = $1 \
         ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut as_built_batches = Vec::with_capacity(batch_rows.len());
    for b in batch_rows {
        type CmpRow = (
            String,
            f64,
            f64,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            String,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            String,
        );
        let comparisons: Vec<ArchiveComparison> = sqlx::query_as::<_, CmpRow>(
            "SELECT as_built_label, as_built_n, as_built_e, as_built_z, design_n, design_e, \
             design_z, match_method, delta_n, delta_e, delta_z, delta_h_radial, delta_grid_n, \
             delta_grid_e, status FROM as_built_comparisons WHERE batch_id = $1 ORDER BY created_at",
        )
        .bind(b.id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| ArchiveComparison {
            as_built_label: c.0,
            as_built_n: c.1,
            as_built_e: c.2,
            as_built_z: c.3,
            design_n: c.4,
            design_e: c.5,
            design_z: c.6,
            match_method: c.7,
            delta_n: c.8,
            delta_e: c.9,
            delta_z: c.10,
            delta_h_radial: c.11,
            delta_grid_n: c.12,
            delta_grid_e: c.13,
            status: c.14,
        })
        .collect();
        as_built_batches.push(ArchiveAsBuiltBatch {
            source_filename: b.source_filename,
            format: b.format,
            baseline_scope: b.baseline_scope,
            delta_space: b.delta_space,
            tol_h_warn: b.tol_h_warn,
            tol_h_fail: b.tol_h_fail,
            tol_v_warn: b.tol_v_warn,
            tol_v_fail: b.tol_v_fail,
            report_unit: b.report_unit,
            comparisons,
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
        utility_runs,
        utility_structures,
        as_built_batches,
    };
    serde_json::to_string_pretty(&archive).map_err(|e| e.to_string())
}
