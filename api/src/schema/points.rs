#![allow(clippy::too_many_arguments)]
use super::*;

const CATEGORY_COLUMNS: &str = "id, org_id, name, color, icon, is_default";
const SURVEY_POINT_COLUMNS: &str = "id, project_id, label, northing, easting, elevation, \
    description, category_id, tags, import_batch_id";

/// Converts a GraphQL CSV mapping into the parser's mapping (validating indices).
fn to_csv_mapping(m: &CsvMappingInput) -> Result<CsvMapping> {
    let idx = |v: i32, what: &str| -> Result<usize> {
        usize::try_from(v).map_err(|_| async_graphql::Error::new(format!("invalid {what} column")))
    };
    let opt = |v: Option<i32>, what: &str| -> Result<Option<usize>> {
        v.map(|x| idx(x, what)).transpose()
    };
    Ok(CsvMapping {
        has_header: m.has_header,
        label_col: opt(m.label_col, "label")?,
        northing_col: idx(m.northing_col, "northing")?,
        easting_col: idx(m.easting_col, "easting")?,
        elevation_col: opt(m.elevation_col, "elevation")?,
        description_col: opt(m.description_col, "description")?,
    })
}

/// Like [`publish_scene`] for a bulk op spanning possibly several projects;
/// publishes each distinct project once.
fn publish_scenes(ctx: &Context<'_>, project_ids: impl IntoIterator<Item = Uuid>) {
    let Ok(hub) = ctx.data::<ScenePubSub>() else {
        return;
    };
    let mut seen = std::collections::HashSet::new();
    for pid in project_ids {
        if seen.insert(pid) {
            hub.publish(pid);
        }
    }
}

#[derive(Default)]
pub struct PointsQuery;

#[Object]
impl PointsQuery {
    /// The caller organization's point categories (defaults + custom).
    async fn categories(&self, ctx: &Context<'_>) -> Result<Vec<PointCategory>> {
        let auth = require_auth(ctx)?;
        let rows: Vec<PointCategory> = sqlx::query_as(&format!(
            "SELECT {CATEGORY_COLUMNS} FROM point_categories WHERE org_id = $1 \
             ORDER BY is_default DESC, name"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows)
    }

    /// Surveyed points for a project, optionally filtered by free-text search
    /// (label/description/tags) and/or category. Paginated: `limit` is clamped to
    /// [1, 1000] (default 200) so the list query is always bounded.
    async fn survey_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        search: Option<String>,
        category_id: Option<Uuid>,
        group_id: Option<Uuid>,
        limit: Option<i64>,
        offset: Option<i64>,
        sort: Option<String>,
        descending: Option<bool>,
    ) -> Result<Vec<SurveyPoint>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        let offset = offset.unwrap_or(0).max(0);
        // Whitelist the sort column (never interpolate user input directly).
        let sort_col = match sort.as_deref() {
            Some("label") => "label",
            Some("northing") => "northing",
            Some("easting") => "easting",
            Some("elevation") => "elevation",
            _ => "seq",
        };
        let dir = if descending.unwrap_or(false) {
            "DESC"
        } else {
            "ASC"
        };
        let rows: Vec<SurveyPoint> = sqlx::query_as(&format!(
            "SELECT {SURVEY_POINT_COLUMNS} FROM survey_points WHERE project_id = $1 \
             AND point_type = 'design' \
             AND ($2::text IS NULL OR label ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' \
                  OR array_to_string(tags, ' ') ILIKE '%'||$2||'%') \
             AND ($3::uuid IS NULL OR category_id = $3) \
             AND ($6::uuid IS NULL OR id = ANY(COALESCE( \
                  (SELECT member_ids FROM point_groups WHERE id = $6 AND project_id = $1), \
                  ARRAY[]::uuid[]))) \
             ORDER BY {sort_col} {dir} NULLS LAST, seq ASC LIMIT $4 OFFSET $5"
        ))
        .bind(project_id)
        .bind(search)
        .bind(category_id)
        .bind(limit)
        .bind(offset)
        .bind(group_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Total count of surveyed points matching the same filters as `surveyPoints`.
    /// Lets the UI paginate without fetching every row.
    async fn survey_point_count(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        search: Option<String>,
        category_id: Option<Uuid>,
        group_id: Option<Uuid>,
    ) -> Result<i64> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let search = search.filter(|s| !s.trim().is_empty());
        let (count,): (i64,) = sqlx::query_as(
            "SELECT count(*) FROM survey_points WHERE project_id = $1 \
             AND point_type = 'design' \
             AND ($2::text IS NULL OR label ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' \
                  OR array_to_string(tags, ' ') ILIKE '%'||$2||'%') \
             AND ($3::uuid IS NULL OR category_id = $3) \
             AND ($4::uuid IS NULL OR id = ANY(COALESCE( \
                  (SELECT member_ids FROM point_groups WHERE id = $4 AND project_id = $1), \
                  ARRAY[]::uuid[])))",
        )
        .bind(project_id)
        .bind(search)
        .bind(category_id)
        .bind(group_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    /// Import batches for a project.
    async fn import_batches(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ImportBatch>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ImportBatch> = sqlx::query_as(
            "SELECT id, project_id, source_filename, format, row_count FROM import_batches \
             WHERE project_id = $1 ORDER BY created_at DESC",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Saved CSV import profiles for a project.
    async fn import_profiles(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Vec<ImportProfile>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<ImportProfileRow> = sqlx::query_as(
            "SELECT id, project_id, name, unit, mapping FROM import_profiles \
             WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(ImportProfile::from).collect())
    }

    /// Saved point groups (named selections) for a project.
    async fn point_groups(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Vec<PointGroup>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let rows: Vec<PointGroup> = sqlx::query_as(
            "SELECT id, project_id, name, member_ids FROM point_groups \
             WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}

#[derive(Default)]
pub struct PointsMutation;

#[Object]
impl PointsMutation {
    // ----- Categories -----

    /// Creates a custom point category for the caller's organization.
    async fn create_category(
        &self,
        ctx: &Context<'_>,
        name: String,
        color: String,
        icon: String,
    ) -> Result<PointCategory> {
        let auth = require_editor_active(ctx).await?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("category name is required"));
        }
        let cat: PointCategory = sqlx::query_as(&format!(
            "INSERT INTO point_categories (org_id, name, color, icon, is_default) \
             VALUES ($1, $2, $3, $4, false) RETURNING {CATEGORY_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(name.trim())
        .bind(color)
        .bind(icon)
        .fetch_one(pool(ctx)?)
        .await?;
        Ok(cat)
    }

    /// Deletes a custom (non-default) category. Points in it are uncategorized.
    async fn delete_category(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        let row: Option<(bool,)> =
            sqlx::query_as("SELECT is_default FROM point_categories WHERE id = $1 AND org_id = $2")
                .bind(id)
                .bind(auth.org_id)
                .fetch_optional(pool)
                .await?;
        let Some((is_default,)) = row else {
            return Err(async_graphql::Error::new("category not found"));
        };
        if is_default {
            return Err(async_graphql::Error::new(
                "default categories cannot be deleted",
            ));
        }
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE survey_points SET category_id = NULL WHERE category_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM point_categories WHERE id = $1 AND org_id = $2")
            .bind(id)
            .bind(auth.org_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(true)
    }

    // ----- Import -----

    /// Imports points from CSV or LandXML content. Coordinates in `unit` are
    /// stored as meters. Optionally tags all points with a category and saves
    /// the CSV mapping as a reusable profile.
    async fn import_points(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        format: ImportFormat,
        content: String,
        unit: LengthUnit,
        mapping: Option<CsvMappingInput>,
        source_filename: Option<String>,
        category_id: Option<Uuid>,
        save_profile_name: Option<String>,
    ) -> Result<ImportBatch> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let (parsed, format_str) = match format {
            ImportFormat::Csv => {
                let m = mapping.as_ref().ok_or_else(|| {
                    async_graphql::Error::new("a column mapping is required for CSV")
                })?;
                let csv_mapping = to_csv_mapping(m)?;
                (
                    import::parse_csv(&content, &csv_mapping)
                        .map_err(|e| async_graphql::Error::new(e.to_string()))?,
                    "csv",
                )
            }
            ImportFormat::Landxml => (
                import::parse_landxml(&content)
                    .map_err(|e| async_graphql::Error::new(e.to_string()))?,
                "landxml",
            ),
        };
        if parsed.is_empty() {
            return Err(async_graphql::Error::new("no points found in the file"));
        }

        let mut tx = pool.begin().await?;
        let batch: ImportBatch = sqlx::query_as(
            "INSERT INTO import_batches (project_id, source_filename, format, row_count) \
             VALUES ($1, $2, $3, $4) RETURNING id, project_id, source_filename, format, row_count",
        )
        .bind(project_id)
        .bind(source_filename.unwrap_or_default())
        .bind(format_str)
        .bind(parsed.len() as i32)
        .fetch_one(&mut *tx)
        .await?;

        // One batched multi-row INSERT (via UNNEST) instead of a query per point —
        // an import of N points is a single round-trip, not N. The constant
        // columns (project_id, category_id, import_batch_id) are inlined.
        let n = parsed.len();
        let mut labels = Vec::with_capacity(n);
        let mut northings = Vec::with_capacity(n);
        let mut eastings = Vec::with_capacity(n);
        let mut elevations: Vec<Option<f64>> = Vec::with_capacity(n);
        let mut descriptions = Vec::with_capacity(n);
        for p in &parsed {
            labels.push(p.label.clone());
            northings.push(unit.to_meters(p.northing));
            eastings.push(unit.to_meters(p.easting));
            elevations.push(p.elevation.map(|e| unit.to_meters(e)));
            descriptions.push(p.description.clone());
        }
        sqlx::query(
            "INSERT INTO survey_points \
               (project_id, label, northing, easting, elevation, description, category_id, import_batch_id) \
             SELECT $1, t.label, t.northing, t.easting, t.elevation, t.description, $7, $8 \
             FROM UNNEST($2::text[], $3::float8[], $4::float8[], $5::float8[], $6::text[]) \
               AS t(label, northing, easting, elevation, description)",
        )
        .bind(project_id)
        .bind(&labels)
        .bind(&northings)
        .bind(&eastings)
        .bind(&elevations)
        .bind(&descriptions)
        .bind(category_id)
        .bind(batch.id)
        .execute(&mut *tx)
        .await?;

        // Optionally persist the CSV mapping as a reusable profile.
        if let (Some(name), Some(m)) = (save_profile_name.as_ref(), mapping.as_ref()) {
            if !name.trim().is_empty() {
                let mapping_json = serde_json::json!({
                    "hasHeader": m.has_header,
                    "labelCol": m.label_col,
                    "northingCol": m.northing_col,
                    "eastingCol": m.easting_col,
                    "elevationCol": m.elevation_col,
                    "descriptionCol": m.description_col,
                });
                sqlx::query(
                    "INSERT INTO import_profiles (project_id, name, unit, mapping) \
                     VALUES ($1, $2, $3, $4)",
                )
                .bind(project_id)
                .bind(name.trim())
                .bind(unit.as_db_str())
                .bind(sqlx::types::Json(mapping_json))
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        publish_scene(ctx, project_id);
        Ok(batch)
    }

    // ----- Survey points -----

    /// Adds a single surveyed point manually (outside of an import). The input
    /// coordinate may be given in any `space` — projected easting/northing,
    /// geographic longitude/latitude, or building-grid X/Y — and is converted to
    /// the canonical projected (grid) value for storage. `x`/`y` are in `unit`
    /// except for geographic input, where they are degrees (x = lon, y = lat).
    /// Editor role required.
    async fn add_survey_point(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        label: String,
        space: CoordinateSpace,
        x: f64,
        y: f64,
        elevation: Option<f64>,
        description: Option<String>,
        category_id: Option<Uuid>,
        tags: Option<Vec<String>>,
        unit: LengthUnit,
    ) -> Result<SurveyPoint> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        if label.trim().is_empty() {
            return Err(async_graphql::Error::new("point label is required"));
        }

        // Convert the input (in whatever space) to the stored projected value,
        // reusing the same path as the standalone coordinate converter.
        let crs = load_project_crs(pool, project_id, auth.org_id).await?;
        let cspace: Space = space.into();
        let (cx, cy) = normalize_input(cspace, x, y, unit);
        let set = convert::convert_with_rotation(
            cspace,
            cx,
            cy,
            crs.params,
            crs.epsg,
            crs.csf,
            crs.rotation,
        );
        let (easting, northing) = match (set.projected_grid_e, set.projected_grid_n) {
            (Some(e), Some(n)) => (e, n),
            // Building-grid input needs a solved transform to place the point.
            _ => return Err(async_graphql::Error::new(
                "can't place this point — solve the transform first to add a building-grid point",
            )),
        };

        let sp: SurveyPoint = sqlx::query_as(&format!(
            "INSERT INTO survey_points \
               (project_id, label, northing, easting, elevation, description, category_id, tags) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {SURVEY_POINT_COLUMNS}"
        ))
        .bind(project_id)
        .bind(label.trim())
        .bind(northing)
        .bind(easting)
        .bind(elevation.map(|e| unit.to_meters(e)))
        .bind(description.unwrap_or_default())
        .bind(category_id)
        .bind(tags.unwrap_or_default())
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(sp)
    }

    /// Updates a surveyed point's organizational fields (label, description,
    /// category, tags). Editor role required.
    async fn update_survey_point(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        label: Option<String>,
        description: Option<String>,
        category_id: Option<Uuid>,
        tags: Option<Vec<String>>,
    ) -> Result<SurveyPoint> {
        let auth = require_editor_active(ctx).await?;
        let point: Option<SurveyPoint> = sqlx::query_as(&format!(
            "UPDATE survey_points sp SET \
               label = COALESCE($2, sp.label), \
               description = COALESCE($3, sp.description), \
               category_id = COALESCE($4, sp.category_id), \
               tags = COALESCE($5, sp.tags) \
             FROM projects p \
             WHERE sp.id = $1 AND sp.project_id = p.id AND p.org_id = $6 \
             RETURNING {}",
            qualify_columns(SURVEY_POINT_COLUMNS, "sp")
        ))
        .bind(id)
        .bind(label)
        .bind(description)
        .bind(category_id)
        .bind(tags)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        let point = found_in_org(point, "point")?;
        publish_scene(ctx, point.project_id);
        Ok(point)
    }

    /// Deletes a surveyed point. Editor role required.
    async fn delete_survey_point(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        let row: Option<(Uuid,)> = sqlx::query_as(
            "DELETE FROM survey_points sp USING projects p \
             WHERE sp.id = $1 AND sp.project_id = p.id AND p.org_id = $2 \
             RETURNING sp.project_id",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        let (project_id,) = found_in_org(row, "point")?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    /// Bulk-deletes surveyed points (org-scoped). Returns how many were deleted.
    /// Editor role required.
    async fn delete_survey_points(&self, ctx: &Context<'_>, ids: Vec<Uuid>) -> Result<i64> {
        let auth = require_editor_active(ctx).await?;
        let rows: Vec<(Uuid,)> = sqlx::query_as(
            "DELETE FROM survey_points sp USING projects p \
             WHERE sp.id = ANY($1) AND sp.project_id = p.id AND p.org_id = $2 \
             RETURNING sp.project_id",
        )
        .bind(&ids)
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        publish_scenes(ctx, rows.iter().map(|(pid,)| *pid));
        Ok(rows.len() as i64)
    }

    /// Bulk-assigns (or clears, when `categoryId` is null) the category of
    /// surveyed points (org-scoped). Returns how many were updated. Editor role.
    async fn assign_category(
        &self,
        ctx: &Context<'_>,
        ids: Vec<Uuid>,
        category_id: Option<Uuid>,
    ) -> Result<i64> {
        let auth = require_editor_active(ctx).await?;
        let rows: Vec<(Uuid,)> = sqlx::query_as(
            "UPDATE survey_points sp SET category_id = $3 FROM projects p \
             WHERE sp.id = ANY($1) AND sp.project_id = p.id AND p.org_id = $2 \
             RETURNING sp.project_id",
        )
        .bind(&ids)
        .bind(auth.org_id)
        .bind(category_id)
        .fetch_all(pool(ctx)?)
        .await?;
        publish_scenes(ctx, rows.iter().map(|(pid,)| *pid));
        Ok(rows.len() as i64)
    }

    // ----- Point groups -----

    /// Saves a named selection of points. Editor role required.
    async fn create_point_group(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        name: String,
        member_ids: Vec<Uuid>,
    ) -> Result<PointGroup> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("group name is required"));
        }
        let group: PointGroup = sqlx::query_as(
            "INSERT INTO point_groups (project_id, name, member_ids) VALUES ($1, $2, $3) \
             RETURNING id, project_id, name, member_ids",
        )
        .bind(project_id)
        .bind(name.trim())
        .bind(&member_ids)
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(group)
    }

    /// Deletes a point group. Editor role required.
    async fn delete_point_group(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor_active(ctx).await?;
        let row: Option<(Uuid,)> = sqlx::query_as(
            "DELETE FROM point_groups pg USING projects p \
             WHERE pg.id = $1 AND pg.project_id = p.id AND p.org_id = $2 \
             RETURNING pg.project_id",
        )
        .bind(id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        let (project_id,) = found_in_org(row, "group")?;
        publish_scene(ctx, project_id);
        Ok(true)
    }

    /// Adds points to an existing group (union, de-duplicated). Editor role.
    async fn add_points_to_group(
        &self,
        ctx: &Context<'_>,
        group_id: Uuid,
        member_ids: Vec<Uuid>,
    ) -> Result<PointGroup> {
        let auth = require_editor_active(ctx).await?;
        if member_ids.is_empty() {
            return Err(async_graphql::Error::new("no points to add"));
        }
        let group: Option<PointGroup> = sqlx::query_as(
            "UPDATE point_groups pg \
             SET member_ids = ( \
               SELECT array_agg(DISTINCT m) FROM unnest(pg.member_ids || $2::uuid[]) AS m \
             ) \
             FROM projects p \
             WHERE pg.id = $1 AND pg.project_id = p.id AND p.org_id = $3 \
             RETURNING pg.id, pg.project_id, pg.name, pg.member_ids",
        )
        .bind(group_id)
        .bind(&member_ids)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        let group = found_in_org(group, "group")?;
        publish_scene(ctx, group.project_id);
        Ok(group)
    }
}
