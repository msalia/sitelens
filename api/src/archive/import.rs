use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use crate::import::MAX_ROWS;
use crate::storage::Storage;

use super::types::*;

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

    // Utility runs (+ snapshotted vertices) and structures. `source_point_id`
    // soft links are dropped — geometry is snapshotted, so the record stands alone.
    for r in &archive.utility_runs {
        let (run_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO utility_runs \
               (project_id, type_key, label, level, diameter, material, invert_up, invert_down, \
                slope, owner, install_date, condition, attrs_extra, tags, source, as_built_date, \
                locate_method) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id",
        )
        .bind(project_id)
        .bind(&r.type_key)
        .bind(&r.label)
        .bind(&r.level)
        .bind(r.diameter)
        .bind(&r.material)
        .bind(r.invert_up)
        .bind(r.invert_down)
        .bind(r.slope)
        .bind(&r.owner)
        .bind(r.install_date)
        .bind(&r.condition)
        .bind(sqlx::types::Json(&r.attrs_extra))
        .bind(&r.tags)
        .bind(&r.source)
        .bind(r.as_built_date)
        .bind(&r.locate_method)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        for (seq, v) in r.vertices.iter().enumerate() {
            sqlx::query(
                "INSERT INTO utility_vertices (run_id, seq, northing, easting, elevation) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(run_id)
            .bind(seq as i32)
            .bind(v.northing)
            .bind(v.easting)
            .bind(v.elevation)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    for s in &archive.utility_structures {
        sqlx::query(
            "INSERT INTO utility_structures \
               (project_id, type_key, label, level, northing, easting, rim_elev, inverts, material, \
                owner, condition, attrs_extra, tags, source, as_built_date, locate_method) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        )
        .bind(project_id)
        .bind(&s.type_key)
        .bind(&s.label)
        .bind(&s.level)
        .bind(s.northing)
        .bind(s.easting)
        .bind(s.rim_elev)
        .bind(sqlx::types::Json(&s.inverts))
        .bind(&s.material)
        .bind(&s.owner)
        .bind(&s.condition)
        .bind(sqlx::types::Json(&s.attrs_extra))
        .bind(&s.tags)
        .bind(&s.source)
        .bind(s.as_built_date)
        .bind(&s.locate_method)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Field-exchange as-built comparison batches (+ snapshotted rows).
    for b in &archive.as_built_batches {
        let (batch_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO as_built_batches \
               (project_id, source_filename, format, baseline_scope, delta_space, \
                tol_h_warn, tol_h_fail, tol_v_warn, tol_v_fail, report_unit) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        )
        .bind(project_id)
        .bind(&b.source_filename)
        .bind(&b.format)
        .bind(&b.baseline_scope)
        .bind(&b.delta_space)
        .bind(b.tol_h_warn)
        .bind(b.tol_h_fail)
        .bind(b.tol_v_warn)
        .bind(b.tol_v_fail)
        .bind(&b.report_unit)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        for c in &b.comparisons {
            sqlx::query(
                "INSERT INTO as_built_comparisons \
                   (batch_id, as_built_label, as_built_n, as_built_e, as_built_z, \
                    design_n, design_e, design_z, match_method, delta_n, delta_e, delta_z, \
                    delta_h_radial, delta_grid_n, delta_grid_e, status) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            )
            .bind(batch_id)
            .bind(&c.as_built_label)
            .bind(c.as_built_n)
            .bind(c.as_built_e)
            .bind(c.as_built_z)
            .bind(c.design_n)
            .bind(c.design_e)
            .bind(c.design_z)
            .bind(&c.match_method)
            .bind(c.delta_n)
            .bind(c.delta_e)
            .bind(c.delta_z)
            .bind(c.delta_h_radial)
            .bind(c.delta_grid_n)
            .bind(c.delta_grid_e)
            .bind(&c.status)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(project_id)
}
