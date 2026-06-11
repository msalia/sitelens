#![allow(clippy::too_many_arguments)]
use super::*;

#[Object]
impl MutationRoot {
    /// Self-service signup: creates a new organization and its first Admin user
    /// (unverified). Returns the verification token (delivered by email later).
    async fn signup(
        &self,
        ctx: &Context<'_>,
        email: String,
        password: String,
        org_name: String,
    ) -> Result<SignupResult> {
        enforce_rate_limit(ctx, "signup").await?;
        let email = normalize_email(&email);
        if email.is_empty() || !email.contains('@') {
            return Err(async_graphql::Error::new("a valid email is required"));
        }
        if password.len() < MIN_PASSWORD_LEN {
            return Err(async_graphql::Error::new(format!(
                "password must be at least {MIN_PASSWORD_LEN} characters"
            )));
        }
        if org_name.trim().is_empty() {
            return Err(async_graphql::Error::new("organization name is required"));
        }
        let pool = pool(ctx)?;
        if email_taken(pool, &email).await? {
            return Err(async_graphql::Error::new("email is already registered"));
        }

        let password_hash = hash_password(&password).map_err(async_graphql::Error::new)?;
        let verification_token = gen_token();

        let mut tx = pool.begin().await?;
        let org: Org = sqlx::query_as::<_, (Uuid, String, chrono::DateTime<chrono::Utc>)>(
            "INSERT INTO orgs (name) VALUES ($1) RETURNING id, name, created_at",
        )
        .bind(org_name.trim())
        .fetch_one(&mut *tx)
        .await
        .map(|(id, name, created_at)| Org {
            id,
            name,
            created_at,
        })?;

        let user: User = sqlx::query_as::<_, UserRow>(&format!(
            "INSERT INTO users (org_id, email, password_hash, role, verification_token) \
             VALUES ($1, $2, $3, 'admin', $4) RETURNING {USER_COLUMNS}"
        ))
        .bind(org.id)
        .bind(&email)
        .bind(&password_hash)
        .bind(&verification_token)
        .fetch_one(&mut *tx)
        .await
        .map(User::from)?;

        // Seed the default point categories for the new org.
        for (name, color, icon) in DEFAULT_CATEGORIES {
            sqlx::query(
                "INSERT INTO point_categories (org_id, name, color, icon, is_default) \
                 VALUES ($1, $2, $3, $4, true)",
            )
            .bind(org.id)
            .bind(name)
            .bind(color)
            .bind(icon)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(SignupResult {
            user,
            org,
            verification_token,
        })
    }

    /// Verifies an email address using the token issued at signup.
    async fn verify_email(&self, ctx: &Context<'_>, token: String) -> Result<bool> {
        let result =
            sqlx::query("UPDATE users SET email_verified = true, verification_token = NULL WHERE verification_token = $1")
                .bind(&token)
                .execute(pool(ctx)?)
                .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new("invalid or expired token"));
        }
        Ok(true)
    }

    /// Logs in with email + password. Sets an HTTP-only session cookie.
    async fn login(&self, ctx: &Context<'_>, email: String, password: String) -> Result<User> {
        enforce_rate_limit(ctx, "login").await?;
        let email = normalize_email(&email);
        let pool = pool(ctx)?;
        let row: Option<LoginRow> = sqlx::query_as(
            "SELECT id, org_id, role, email_verified, password_hash FROM users WHERE lower(email) = $1",
        )
        .bind(&email)
        .fetch_optional(pool)
        .await?;

        let row = row.ok_or_else(|| async_graphql::Error::new("invalid credentials"))?;
        let hash = row
            .password_hash
            .as_deref()
            .ok_or_else(|| async_graphql::Error::new("invalid credentials"))?;
        if !verify_password(&password, hash) {
            return Err(async_graphql::Error::new("invalid credentials"));
        }
        if !row.email_verified {
            return Err(async_graphql::Error::new("email not verified"));
        }
        let role = Role::parse(&row.role)
            .ok_or_else(|| async_graphql::Error::new("user has an invalid role"))?;

        let cfg = config(ctx)?;
        let token = issue_jwt(row.id, row.org_id, role, &cfg.jwt_secret)
            .map_err(async_graphql::Error::new)?;
        ctx.append_http_header(
            "Set-Cookie",
            build_session_cookie(&token, cfg.cookie_secure),
        );

        let user: UserRow =
            sqlx::query_as(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1"))
                .bind(row.id)
                .fetch_one(pool)
                .await?;
        Ok(user.into())
    }

    /// Clears the session cookie.
    async fn logout(&self, ctx: &Context<'_>) -> Result<bool> {
        let cfg = config(ctx)?;
        ctx.append_http_header("Set-Cookie", build_clearing_cookie(cfg.cookie_secure));
        Ok(true)
    }

    /// Invites a user into the caller's organization. Admin only. Returns the
    /// invite token (delivered by email later).
    async fn invite_user(
        &self,
        ctx: &Context<'_>,
        email: String,
        role: Role,
    ) -> Result<InviteResult> {
        let auth = require_admin(ctx)?;
        let email = normalize_email(&email);
        if email.is_empty() || !email.contains('@') {
            return Err(async_graphql::Error::new("a valid email is required"));
        }
        let pool = pool(ctx)?;
        if email_taken(pool, &email).await? {
            return Err(async_graphql::Error::new("email is already registered"));
        }
        let invite_token = gen_token();
        let user: User = sqlx::query_as::<_, UserRow>(&format!(
            "INSERT INTO users (org_id, email, role, invite_token) VALUES ($1, $2, $3, $4) \
             RETURNING {USER_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(&email)
        .bind(role.as_str())
        .bind(&invite_token)
        .fetch_one(pool)
        .await
        .map(User::from)?;

        Ok(InviteResult { user, invite_token })
    }

    /// Accepts an invite: sets the password, verifies the email, and logs in.
    async fn accept_invite(
        &self,
        ctx: &Context<'_>,
        token: String,
        password: String,
    ) -> Result<User> {
        if password.len() < MIN_PASSWORD_LEN {
            return Err(async_graphql::Error::new(format!(
                "password must be at least {MIN_PASSWORD_LEN} characters"
            )));
        }
        let pool = pool(ctx)?;
        let password_hash = hash_password(&password).map_err(async_graphql::Error::new)?;
        let user: Option<UserRow> = sqlx::query_as(&format!(
            "UPDATE users SET password_hash = $1, email_verified = true, invite_token = NULL \
             WHERE invite_token = $2 RETURNING {USER_COLUMNS}"
        ))
        .bind(&password_hash)
        .bind(&token)
        .fetch_optional(pool)
        .await?;
        let user = user.ok_or_else(|| async_graphql::Error::new("invalid or expired invite"))?;
        let user = User::from(user);

        let cfg = config(ctx)?;
        let jwt = issue_jwt(user.id, user.org_id, user.role, &cfg.jwt_secret)
            .map_err(async_graphql::Error::new)?;
        ctx.append_http_header("Set-Cookie", build_session_cookie(&jwt, cfg.cookie_secure));
        Ok(user)
    }

    /// Changes a user's role within the caller's organization. Admin only.
    async fn update_user_role(&self, ctx: &Context<'_>, user_id: Uuid, role: Role) -> Result<User> {
        let auth = require_admin(ctx)?;
        let user: Option<UserRow> = sqlx::query_as(&format!(
            "UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING {USER_COLUMNS}"
        ))
        .bind(role.as_str())
        .bind(user_id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        user.map(User::from)
            .ok_or_else(|| async_graphql::Error::new("user not found in your organization"))
    }

    // ----- Projects -----

    /// Creates a project in the caller's organization. Editor role required.
    async fn create_project(
        &self,
        ctx: &Context<'_>,
        name: String,
        description: Option<String>,
        epsg_code: i32,
        display_unit: LengthUnit,
        combined_scale_factor: Option<f64>,
        site_origin_lat: Option<f64>,
        site_origin_lon: Option<f64>,
        site_origin_rotation_deg: Option<f64>,
    ) -> Result<Project> {
        let auth = require_editor(ctx)?;
        if name.trim().is_empty() {
            return Err(async_graphql::Error::new("project name is required"));
        }
        let row: ProjectRow = sqlx::query_as(&format!(
            "INSERT INTO projects \
             (org_id, name, description, epsg_code, display_unit, combined_scale_factor, \
              site_origin_lat, site_origin_lon, site_origin_rotation_deg) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(name.trim())
        .bind(description.unwrap_or_default())
        .bind(epsg_code)
        .bind(display_unit.as_db_str())
        .bind(combined_scale_factor.unwrap_or(1.0))
        .bind(site_origin_lat)
        .bind(site_origin_lon)
        .bind(site_origin_rotation_deg.unwrap_or(0.0))
        .fetch_one(pool(ctx)?)
        .await?;
        Ok(row.into())
    }

    /// Imports a `.slx` archive as a new project in the caller's org. Editor role
    /// required.
    async fn import_project(&self, ctx: &Context<'_>, content: String) -> Result<Project> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let id = archive::import_project(pool, storage.as_ref(), auth.org_id, &content)
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectRow = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLUMNS} FROM projects WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(pool)
        .await?;
        Ok(row.into())
    }

    /// Updates mutable project fields. Editor role required.
    async fn update_project(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        name: Option<String>,
        description: Option<String>,
        epsg_code: Option<i32>,
        display_unit: Option<LengthUnit>,
        combined_scale_factor: Option<f64>,
        site_origin_lat: Option<f64>,
        site_origin_lon: Option<f64>,
        site_origin_rotation_deg: Option<f64>,
    ) -> Result<Project> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, id, auth.org_id).await?;
        // COALESCE keeps existing values when an argument is omitted.
        let row: ProjectRow = sqlx::query_as(&format!(
            "UPDATE projects SET \
               name = COALESCE($2, name), \
               description = COALESCE($3, description), \
               epsg_code = COALESCE($4, epsg_code), \
               display_unit = COALESCE($5, display_unit), \
               combined_scale_factor = COALESCE($6, combined_scale_factor), \
               site_origin_lat = COALESCE($7, site_origin_lat), \
               site_origin_lon = COALESCE($8, site_origin_lon), \
               site_origin_rotation_deg = COALESCE($10, site_origin_rotation_deg), \
               updated_at = now() \
             WHERE id = $1 AND org_id = $9 RETURNING {PROJECT_COLUMNS}"
        ))
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(epsg_code)
        .bind(display_unit.map(|u| u.as_db_str()))
        .bind(combined_scale_factor)
        .bind(site_origin_lat)
        .bind(site_origin_lon)
        .bind(auth.org_id)
        .bind(site_origin_rotation_deg)
        .fetch_one(pool)
        .await?;
        Ok(row.into())
    }

    /// Deletes a project (cascades to its grid and control points). Editor role required.
    async fn delete_project(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query("DELETE FROM projects WHERE id = $1 AND org_id = $2")
            .bind(id)
            .bind(auth.org_id)
            .execute(pool(ctx)?)
            .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "project not found in your organization",
            ));
        }
        Ok(true)
    }

    // ----- Grid -----

    /// Replaces a project's entire grid. Axis positions are given in `unit`.
    async fn set_grid_axes(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        unit: LengthUnit,
        axes: Vec<GridAxisInput>,
    ) -> Result<Vec<GridAxis>> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let mut tx = pool.begin().await?;
        sqlx::query("DELETE FROM grid_axes WHERE project_id = $1")
            .bind(project_id)
            .execute(&mut *tx)
            .await?;
        for axis in &axes {
            if axis.label.trim().is_empty() {
                return Err(async_graphql::Error::new("axis label is required"));
            }
            sqlx::query(
                "INSERT INTO grid_axes (project_id, family, label, position) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(project_id)
            .bind(axis.family.as_str())
            .bind(axis.label.trim())
            .bind(unit.to_meters(axis.position))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;

        let rows: Vec<GridAxisRow> = sqlx::query_as(
            "SELECT id, project_id, family, label, position FROM grid_axes \
             WHERE project_id = $1 ORDER BY family, position",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(GridAxis::from).collect())
    }

    // ----- Control points -----

    /// Adds a control point. Coordinates are given in `unit` and stored as meters.
    async fn add_control_point(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        label: String,
        northing: f64,
        easting: f64,
        elevation: Option<f64>,
        grid_x: Option<f64>,
        grid_y: Option<f64>,
        unit: LengthUnit,
        source: Option<String>,
    ) -> Result<ControlPoint> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if label.trim().is_empty() {
            return Err(async_graphql::Error::new("control point label is required"));
        }
        let cp: ControlPoint = sqlx::query_as(&format!(
            "INSERT INTO control_points \
               (project_id, label, northing, easting, elevation, grid_x, grid_y, source) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {CONTROL_POINT_COLUMNS}"
        ))
        .bind(project_id)
        .bind(label.trim())
        .bind(unit.to_meters(northing))
        .bind(unit.to_meters(easting))
        .bind(elevation.map(|e| unit.to_meters(e)))
        .bind(grid_x.map(|v| unit.to_meters(v)))
        .bind(grid_y.map(|v| unit.to_meters(v)))
        .bind(source.unwrap_or_default())
        .fetch_one(pool)
        .await?;
        Ok(cp)
    }

    /// Updates a control point. Coordinate fields, when provided, are in `unit`.
    async fn update_control_point(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        label: Option<String>,
        northing: Option<f64>,
        easting: Option<f64>,
        elevation: Option<f64>,
        grid_x: Option<f64>,
        grid_y: Option<f64>,
        unit: LengthUnit,
        source: Option<String>,
    ) -> Result<ControlPoint> {
        let auth = require_editor(ctx)?;
        let cp: Option<ControlPoint> = sqlx::query_as(&format!(
            "UPDATE control_points cp SET \
               label = COALESCE($2, cp.label), \
               northing = COALESCE($3, cp.northing), \
               easting = COALESCE($4, cp.easting), \
               elevation = COALESCE($5, cp.elevation), \
               grid_x = COALESCE($6, cp.grid_x), \
               grid_y = COALESCE($7, cp.grid_y), \
               source = COALESCE($8, cp.source) \
             FROM projects p \
             WHERE cp.id = $1 AND cp.project_id = p.id AND p.org_id = $9 \
             RETURNING {}",
            CONTROL_POINT_COLUMNS
                .split(", ")
                .map(|c| format!("cp.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .bind(id)
        .bind(label)
        .bind(northing.map(|v| unit.to_meters(v)))
        .bind(easting.map(|v| unit.to_meters(v)))
        .bind(elevation.map(|v| unit.to_meters(v)))
        .bind(grid_x.map(|v| unit.to_meters(v)))
        .bind(grid_y.map(|v| unit.to_meters(v)))
        .bind(source)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        cp.ok_or_else(|| async_graphql::Error::new("control point not found in your organization"))
    }

    /// Deletes a control point in the caller's organization. Editor role required.
    async fn delete_control_point(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM control_points cp USING projects p \
             WHERE cp.id = $1 AND cp.project_id = p.id AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "control point not found in your organization",
            ));
        }
        Ok(true)
    }

    // ----- Transform -----

    /// Solves the Helmert transform from the project's control points (those with
    /// grid coordinates) and persists it. Editor role required.
    async fn solve_transform(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Transform> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let rows: Vec<SolvePointRow> = sqlx::query_as(
            "SELECT label, grid_x, grid_y, northing, easting FROM control_points \
             WHERE project_id = $1 AND grid_x IS NOT NULL AND grid_y IS NOT NULL \
             ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let correspondences: Vec<Correspondence> = rows
            .iter()
            .map(|r| Correspondence {
                grid_x: r.grid_x,
                grid_y: r.grid_y,
                proj_e: r.easting,
                proj_n: r.northing,
            })
            .collect();

        let solution = solve_helmert(&correspondences)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let residuals: Vec<TransformResidual> = solution
            .residuals
            .iter()
            .map(|res| TransformResidual {
                label: rows[res.index].label.clone(),
                delta_easting: res.de,
                delta_northing: res.dn,
                magnitude: res.magnitude,
            })
            .collect();

        // Upsert the single transform per project.
        sqlx::query(
            "INSERT INTO transforms \
               (project_id, translation_e, translation_n, rotation_rad, scale, rms_error, point_count, residuals) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             ON CONFLICT (project_id) DO UPDATE SET \
               translation_e = EXCLUDED.translation_e, translation_n = EXCLUDED.translation_n, \
               rotation_rad = EXCLUDED.rotation_rad, scale = EXCLUDED.scale, \
               rms_error = EXCLUDED.rms_error, point_count = EXCLUDED.point_count, \
               residuals = EXCLUDED.residuals, created_at = now()",
        )
        .bind(project_id)
        .bind(solution.params.tx)
        .bind(solution.params.ty)
        .bind(solution.params.rotation_rad())
        .bind(solution.params.scale())
        .bind(solution.rms)
        .bind(rows.len() as i32)
        .bind(sqlx::types::Json(&residuals))
        .execute(pool)
        .await?;

        Ok(Transform {
            translation_e: solution.params.tx,
            translation_n: solution.params.ty,
            rotation_degrees: solution.params.rotation_rad().to_degrees(),
            scale: solution.params.scale(),
            rms_error: solution.rms,
            point_count: rows.len() as i32,
            residuals,
        })
    }

    // ----- Categories -----

    /// Creates a custom point category for the caller's organization.
    async fn create_category(
        &self,
        ctx: &Context<'_>,
        name: String,
        color: String,
        icon: String,
    ) -> Result<PointCategory> {
        let auth = require_editor(ctx)?;
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
        let auth = require_editor(ctx)?;
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
        let auth = require_editor(ctx)?;
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

        for p in &parsed {
            sqlx::query(
                "INSERT INTO survey_points \
                   (project_id, label, northing, easting, elevation, description, category_id, import_batch_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(project_id)
            .bind(&p.label)
            .bind(unit.to_meters(p.northing))
            .bind(unit.to_meters(p.easting))
            .bind(p.elevation.map(|e| unit.to_meters(e)))
            .bind(&p.description)
            .bind(category_id)
            .bind(batch.id)
            .execute(&mut *tx)
            .await?;
        }

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
        Ok(batch)
    }

    // ----- Survey points -----

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
        let auth = require_editor(ctx)?;
        let point: Option<SurveyPoint> = sqlx::query_as(&format!(
            "UPDATE survey_points sp SET \
               label = COALESCE($2, sp.label), \
               description = COALESCE($3, sp.description), \
               category_id = COALESCE($4, sp.category_id), \
               tags = COALESCE($5, sp.tags) \
             FROM projects p \
             WHERE sp.id = $1 AND sp.project_id = p.id AND p.org_id = $6 \
             RETURNING {}",
            SURVEY_POINT_COLUMNS
                .split(", ")
                .map(|c| format!("sp.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .bind(id)
        .bind(label)
        .bind(description)
        .bind(category_id)
        .bind(tags)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        point.ok_or_else(|| async_graphql::Error::new("point not found in your organization"))
    }

    /// Deletes a surveyed point. Editor role required.
    async fn delete_survey_point(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM survey_points sp USING projects p \
             WHERE sp.id = $1 AND sp.project_id = p.id AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "point not found in your organization",
            ));
        }
        Ok(true)
    }

    /// Bulk-deletes surveyed points (org-scoped). Returns how many were deleted.
    /// Editor role required.
    async fn delete_survey_points(&self, ctx: &Context<'_>, ids: Vec<Uuid>) -> Result<i64> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM survey_points sp USING projects p \
             WHERE sp.id = ANY($1) AND sp.project_id = p.id AND p.org_id = $2",
        )
        .bind(&ids)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        Ok(result.rows_affected() as i64)
    }

    /// Bulk-assigns (or clears, when `categoryId` is null) the category of
    /// surveyed points (org-scoped). Returns how many were updated. Editor role.
    async fn assign_category(
        &self,
        ctx: &Context<'_>,
        ids: Vec<Uuid>,
        category_id: Option<Uuid>,
    ) -> Result<i64> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "UPDATE survey_points sp SET category_id = $3 FROM projects p \
             WHERE sp.id = ANY($1) AND sp.project_id = p.id AND p.org_id = $2",
        )
        .bind(&ids)
        .bind(auth.org_id)
        .bind(category_id)
        .execute(pool(ctx)?)
        .await?;
        Ok(result.rows_affected() as i64)
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
        let auth = require_editor(ctx)?;
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
        Ok(group)
    }

    /// Deletes a point group. Editor role required.
    async fn delete_point_group(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let result = sqlx::query(
            "DELETE FROM point_groups pg USING projects p \
             WHERE pg.id = $1 AND pg.project_id = p.id AND p.org_id = $2",
        )
        .bind(id)
        .bind(auth.org_id)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "group not found in your organization",
            ));
        }
        Ok(true)
    }

    /// Adds points to an existing group (union, de-duplicated). Editor role.
    async fn add_points_to_group(
        &self,
        ctx: &Context<'_>,
        group_id: Uuid,
        member_ids: Vec<Uuid>,
    ) -> Result<PointGroup> {
        let auth = require_editor(ctx)?;
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
        group.ok_or_else(|| async_graphql::Error::new("group not found in your organization"))
    }

    // ----- DXF overlays -----

    /// Uploads a DXF file: stores the raw text and creates an overlay record
    /// (defaulting to real-world georeferencing). Editor role required.
    async fn upload_dxf(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        filename: String,
        content: String,
    ) -> Result<CadOverlay> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        if content.len() > import::MAX_DXF_BYTES {
            return Err(async_graphql::Error::new(
                "DXF exceeds the maximum allowed size (10 MB)",
            ));
        }
        if content.trim().is_empty() {
            return Err(async_graphql::Error::new("DXF content is empty"));
        }

        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let id = Uuid::new_v4();
        let key = format!("dxf/{project_id}/{id}.dxf");
        storage
            .put(&key, content.as_bytes())
            .await
            .map_err(async_graphql::Error::new)?;

        let row: CadOverlay = sqlx::query_as(&format!(
            "INSERT INTO cad_overlays (id, project_id, original_filename, storage_key) \
             VALUES ($1, $2, $3, $4) RETURNING {CAD_OVERLAY_COLUMNS}"
        ))
        .bind(id)
        .bind(project_id)
        .bind(filename.trim())
        .bind(&key)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Fetches (if needed) and caches the OpenTopography DEM for a project's
    /// bbox. Lazy: a cached terrain is reused unless `force`. A forced refresh is
    /// blocked for 7 days after the last fetch (OpenTopography is rate-limited).
    /// The DEM is fetched server-side here; the API key never reaches the client.
    async fn refresh_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        south: f64,
        north: f64,
        west: f64,
        east: f64,
        demtype: Option<String>,
        force: Option<bool>,
    ) -> Result<ProjectTerrain> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        // `demtype` is optional: when omitted we auto-select the best available
        // (USGS 3DEP 10 m for the US, falling back to global SRTM 30 m).
        let explicit_demtype = demtype.filter(|d| !d.trim().is_empty());
        let force = force.unwrap_or(false);

        let existing: Option<(DateTime<Utc>,)> =
            sqlx::query_as("SELECT fetched_at FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        if let Some((fetched_at,)) = existing {
            if !force {
                // Already cached and no forced refresh requested — reuse it.
                let row = sqlx::query_as(&format!(
                    "SELECT {TERRAIN_COLUMNS} FROM project_terrain WHERE project_id = $1"
                ))
                .bind(project_id)
                .fetch_one(pool)
                .await?;
                return Ok(row);
            }
            let age = Utc::now() - fetched_at;
            if age < chrono::Duration::days(7) {
                let days = (7 - age.num_days()).max(1);
                return Err(async_graphql::Error::new(format!(
                    "Terrain was refreshed recently — try again in {days} day(s)."
                )));
            }
        }

        let api_key = std::env::var("OPENTOPO_API_KEY")
            .map_err(|_| async_graphql::Error::new("OPENTOPO_API_KEY is not configured"))?;
        let client = reqwest::Client::new();

        // Fetch a GeoTIFF DEM from a URL; None on any non-success/empty response.
        async fn fetch_dem(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
            let resp = client.get(url).send().await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let b = resp.bytes().await.ok()?;
            if b.is_empty() {
                None
            } else {
                Some(b.to_vec())
            }
        }
        let bbox = format!("south={south}&north={north}&west={west}&east={east}");

        let (bytes, used_demtype): (Vec<u8>, String) = if let Some(dt) = explicit_demtype {
            // Caller asked for a specific global DEM type.
            let url = format!(
                "https://portal.opentopography.org/API/globaldem?demtype={dt}&{bbox}\
                 &outputFormat=GTiff&API_Key={api_key}"
            );
            match fetch_dem(&client, &url).await {
                Some(b) => (b, dt),
                None => return Err(async_graphql::Error::new("OpenTopography returned no data")),
            }
        } else {
            // Auto: USGS 3DEP 10 m (US), else global SRTM 30 m.
            let usgs = format!(
                "https://portal.opentopography.org/API/usgsdem?datasetName=USGS10m&{bbox}\
                 &outputFormat=GTiff&API_Key={api_key}"
            );
            let srtm = format!(
                "https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1&{bbox}\
                 &outputFormat=GTiff&API_Key={api_key}"
            );
            if let Some(b) = fetch_dem(&client, &usgs).await {
                (b, "USGS10m".to_string())
            } else if let Some(b) = fetch_dem(&client, &srtm).await {
                (b, "SRTMGL1".to_string())
            } else {
                return Err(async_graphql::Error::new(
                    "OpenTopography returned no terrain for this area",
                ));
            }
        };

        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let key = format!("terrain/{project_id}.tif");
        storage
            .put(&key, &bytes)
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectTerrain = sqlx::query_as(&format!(
            "INSERT INTO project_terrain \
             (project_id, demtype, south, north, west, east, storage_key, fetched_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, now()) \
             ON CONFLICT (project_id) DO UPDATE SET \
               demtype = EXCLUDED.demtype, south = EXCLUDED.south, north = EXCLUDED.north, \
               west = EXCLUDED.west, east = EXCLUDED.east, storage_key = EXCLUDED.storage_key, \
               fetched_at = now() \
             RETURNING {TERRAIN_COLUMNS}"
        ))
        .bind(project_id)
        .bind(used_demtype.trim())
        .bind(south)
        .bind(north)
        .bind(west)
        .bind(east)
        .bind(&key)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Fetches (if needed) and caches OSM building footprints for the bbox from
    /// the free Overpass API. Same 7-day cooldown as terrain. Visual context only.
    async fn refresh_buildings(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        south: f64,
        north: f64,
        west: f64,
        east: f64,
        force: Option<bool>,
    ) -> Result<ProjectBuildings> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let force = force.unwrap_or(false);

        let existing: Option<(DateTime<Utc>,)> =
            sqlx::query_as("SELECT fetched_at FROM project_buildings WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        if let Some((fetched_at,)) = existing {
            if !force {
                let row = sqlx::query_as(&format!(
                    "SELECT {BUILDINGS_COLUMNS} FROM project_buildings WHERE project_id = $1"
                ))
                .bind(project_id)
                .fetch_one(pool)
                .await?;
                return Ok(row);
            }
            let age = Utc::now() - fetched_at;
            if age < chrono::Duration::days(7) {
                let days = (7 - age.num_days()).max(1);
                return Err(async_graphql::Error::new(format!(
                    "Buildings were refreshed recently — try again in {days} day(s)."
                )));
            }
        }

        // Overpass QL: building ways within the bbox, with node geometry + tags.
        let query = format!(
            "[out:json][timeout:25];(way[\"building\"]({south},{west},{north},{east}););out geom tags;"
        );
        // The public Overpass instances are frequently overloaded (transient 504s)
        // and reject a missing/default User-Agent with HTTP 406. We try the primary
        // endpoint then community mirrors in turn, retrying past transient failures
        // (network errors, timeouts, 429, 5xx) but bailing on a definitive 4xx. The
        // query is sent as the canonical form-encoded `data=` parameter.
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(40))
            .build()
            .map_err(|e| async_graphql::Error::new(format!("HTTP client error: {e}")))?;
        const OVERPASS_ENDPOINTS: [&str; 3] = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        ];
        let mut json: Option<serde_json::Value> = None;
        let mut last_err = String::from("Overpass request failed");
        for endpoint in OVERPASS_ENDPOINTS {
            match client
                .post(endpoint)
                .header("User-Agent", "SiteLens/1.0 (+https://sitelens.msalia.org)")
                .form(&[("data", query.as_str())])
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.bytes().await {
                            Ok(body) => match serde_json::from_slice(&body) {
                                Ok(parsed) => {
                                    json = Some(parsed);
                                    break;
                                }
                                Err(e) => last_err = format!("Overpass parse failed: {e}"),
                            },
                            Err(e) => last_err = format!("Overpass read failed: {e}"),
                        }
                    } else {
                        let code = status.as_u16();
                        last_err = format!("Overpass error ({code})");
                        // 4xx (other than rate-limit) is a definitive client error —
                        // retrying another mirror won't help, so stop now.
                        if (400..500).contains(&code) && code != 429 {
                            return Err(async_graphql::Error::new(last_err));
                        }
                    }
                }
                Err(e) => last_err = format!("Overpass request failed: {e}"),
            }
        }
        let json = json.ok_or_else(|| {
            async_graphql::Error::new(format!(
                "{last_err}. OpenStreetMap's building service is busy — please try again shortly."
            ))
        })?;

        let mut buildings: Vec<serde_json::Value> = Vec::new();
        if let Some(elements) = json["elements"].as_array() {
            for el in elements {
                let Some(geom) = el["geometry"].as_array() else {
                    continue;
                };
                let poly: Vec<[f64; 2]> = geom
                    .iter()
                    .filter_map(|g| Some([g["lat"].as_f64()?, g["lon"].as_f64()?]))
                    .collect();
                if poly.len() < 3 {
                    continue;
                }
                buildings.push(serde_json::json!({
                    "poly": poly,
                    "height": building_height(&el["tags"]),
                }));
                if buildings.len() >= 4000 {
                    break;
                }
            }
        }

        let count = buildings.len() as i32;
        let payload = serde_json::Value::Array(buildings).to_string();
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let key = format!("buildings/{project_id}.json");
        storage
            .put(&key, payload.as_bytes())
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectBuildings = sqlx::query_as(&format!(
            "INSERT INTO project_buildings (project_id, storage_key, count, fetched_at) \
             VALUES ($1, $2, $3, now()) \
             ON CONFLICT (project_id) DO UPDATE SET \
               storage_key = EXCLUDED.storage_key, count = EXCLUDED.count, fetched_at = now() \
             RETURNING {BUILDINGS_COLUMNS}"
        ))
        .bind(project_id)
        .bind(&key)
        .bind(count)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Updates an overlay's georeference / visibility. Editor role required.
    async fn set_cad_georeference(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        offset_e: Option<f64>,
        offset_n: Option<f64>,
        rotation_deg: Option<f64>,
        scale: Option<f64>,
        elevation: Option<f64>,
        assume_real_world: Option<bool>,
        visible: Option<bool>,
    ) -> Result<CadOverlay> {
        let auth = require_editor(ctx)?;
        let row: Option<CadOverlay> = sqlx::query_as(&format!(
            "UPDATE cad_overlays co SET \
               offset_e = COALESCE($2, co.offset_e), \
               offset_n = COALESCE($3, co.offset_n), \
               rotation_deg = COALESCE($4, co.rotation_deg), \
               scale = COALESCE($5, co.scale), \
               assume_real_world = COALESCE($6, co.assume_real_world), \
               visible = COALESCE($7, co.visible), \
               elevation = COALESCE($9, co.elevation) \
             FROM projects p \
             WHERE co.id = $1 AND co.project_id = p.id AND p.org_id = $8 \
             RETURNING {}",
            CAD_OVERLAY_COLUMNS
                .split(", ")
                .map(|c| format!("co.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .bind(id)
        .bind(offset_e)
        .bind(offset_n)
        .bind(rotation_deg)
        .bind(scale)
        .bind(assume_real_world)
        .bind(visible)
        .bind(auth.org_id)
        .bind(elevation)
        .fetch_optional(pool(ctx)?)
        .await?;
        row.ok_or_else(|| async_graphql::Error::new("overlay not found in your organization"))
    }

    /// Deletes an overlay and its stored file. Editor role required.
    async fn delete_cad_overlay(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        let key = overlay_key_in_org(pool, id, auth.org_id).await?;
        sqlx::query("DELETE FROM cad_overlays WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        // Best-effort file cleanup.
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let _ = storage.delete(&key).await;
        Ok(true)
    }
}
