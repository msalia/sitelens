#![allow(clippy::too_many_arguments)]
use super::*;
use crate::mail::Mailer;

#[derive(Default)]
pub struct AuthQuery;

#[Object]
impl AuthQuery {
    /// Public runtime config the client needs (e.g. the shared Cesium Ion token).
    async fn public_config(&self, ctx: &Context<'_>) -> Result<PublicConfig> {
        let cfg = config(ctx)?;
        Ok(PublicConfig {
            cesium_ion_token: cfg.cesium_ion_token.clone(),
        })
    }

    /// The currently authenticated user, or null if not logged in.
    async fn me(&self, ctx: &Context<'_>) -> Result<Option<User>> {
        let Some(auth) = ctx.data_opt::<AuthContext>() else {
            return Ok(None);
        };
        let row: Option<UserRow> = sqlx::query_as(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE id = $1 AND org_id = $2"
        ))
        .bind(auth.user_id)
        .bind(auth.org_id)
        .fetch_optional(pool(ctx)?)
        .await?;
        Ok(row.map(User::from))
    }

    /// All users in the caller's organization. Admin only.
    async fn users(&self, ctx: &Context<'_>) -> Result<Vec<User>> {
        let auth = require_admin(ctx)?;
        let rows: Vec<UserRow> = sqlx::query_as(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE org_id = $1 ORDER BY created_at"
        ))
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows.into_iter().map(User::from).collect())
    }

    /// The caller's organization (id, name). Used by the settings page and the
    /// type-to-confirm delete flow.
    async fn organization(&self, ctx: &Context<'_>) -> Result<Org> {
        let auth = require_auth(ctx)?;
        let org: Org = sqlx::query_as::<_, (Uuid, String, chrono::DateTime<chrono::Utc>)>(
            "SELECT id, name, created_at FROM orgs WHERE id = $1",
        )
        .bind(auth.org_id)
        .fetch_one(pool(ctx)?)
        .await
        .map(|(id, name, created_at)| Org {
            id,
            name,
            created_at,
        })?;
        Ok(org)
    }

    /// Org roster for the admin user-management page, with a derived status.
    async fn org_members(&self, ctx: &Context<'_>) -> Result<Vec<OrgMember>> {
        let auth = require_admin(ctx)?;
        let rows: Vec<OrgMemberRow> = sqlx::query_as(
            "SELECT id, email, role, \
               CASE WHEN email_verified THEN 'active' \
                    WHEN invite_token IS NOT NULL THEN 'pending' \
                    ELSE 'unverified' END AS status, \
               created_at \
             FROM users WHERE org_id = $1 ORDER BY created_at",
        )
        .bind(auth.org_id)
        .fetch_all(pool(ctx)?)
        .await?;
        Ok(rows.into_iter().map(OrgMember::from).collect())
    }
}

#[derive(Default)]
pub struct AuthMutation;

#[Object]
impl AuthMutation {
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
            "INSERT INTO users \
               (org_id, email, password_hash, role, verification_token, verification_token_expires) \
             VALUES ($1, $2, $3, 'admin', $4, now() + interval '7 days') RETURNING {USER_COLUMNS}"
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

        // Email the verification link. A send failure must not fail signup — the
        // user can request a new link via `resendVerification`.
        let mailer = ctx.data::<Mailer>()?;
        let link = format!("{}/verify?token={}", mailer.app_url(), verification_token);
        if let Err(e) = mailer.send_verification(&email, &link).await {
            eprintln!("signup: failed to send verification email to {email}: {e}");
        }

        Ok(SignupResult {
            user,
            org,
            verification_token,
        })
    }

    /// Verifies an email address using the token issued at signup.
    async fn verify_email(&self, ctx: &Context<'_>, token: String) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE users SET email_verified = true, verification_token = NULL, \
               verification_token_expires = NULL \
             WHERE verification_token = $1 \
               AND (verification_token_expires IS NULL OR verification_token_expires > now())",
        )
        .bind(&token)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new("invalid or expired token"));
        }
        Ok(true)
    }

    /// Re-issues + re-sends a verification email for an unverified account. Always
    /// returns true (no account-existence leak). Rate-limited.
    async fn resend_verification(&self, ctx: &Context<'_>, email: String) -> Result<bool> {
        enforce_rate_limit(ctx, "resend_verification").await?;
        let email = normalize_email(&email);
        let pool = pool(ctx)?;
        let row: Option<(Uuid, String)> = sqlx::query_as(
            "SELECT id, email FROM users WHERE lower(email) = $1 AND email_verified = false",
        )
        .bind(&email)
        .fetch_optional(pool)
        .await?;
        if let Some((id, addr)) = row {
            let token = gen_token();
            sqlx::query(
                "UPDATE users SET verification_token = $1, \
                   verification_token_expires = now() + interval '7 days' WHERE id = $2",
            )
            .bind(&token)
            .bind(id)
            .execute(pool)
            .await?;
            let mailer = ctx.data::<Mailer>()?;
            let link = format!("{}/verify?token={}", mailer.app_url(), token);
            if let Err(e) = mailer.send_verification(&addr, &link).await {
                eprintln!("resend_verification: send failed for {addr}: {e}");
            }
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
            "INSERT INTO users (org_id, email, role, invite_token, invite_token_expires) \
             VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING {USER_COLUMNS}"
        ))
        .bind(auth.org_id)
        .bind(&email)
        .bind(role.as_str())
        .bind(&invite_token)
        .fetch_one(pool)
        .await
        .map(User::from)?;

        // Email the invite link (best-effort — the link is also returned).
        let (org_name,): (String,) = sqlx::query_as("SELECT name FROM orgs WHERE id = $1")
            .bind(auth.org_id)
            .fetch_one(pool)
            .await?;
        let mailer = ctx.data::<Mailer>()?;
        let link = format!("{}/accept-invite?token={}", mailer.app_url(), invite_token);
        if let Err(e) = mailer.send_invite(&email, &org_name, &link).await {
            eprintln!("invite_user: failed to email invite to {email}: {e}");
        }

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
            "UPDATE users SET password_hash = $1, email_verified = true, invite_token = NULL, \
               invite_token_expires = NULL \
             WHERE invite_token = $2 \
               AND (invite_token_expires IS NULL OR invite_token_expires > now()) \
             RETURNING {USER_COLUMNS}"
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
        let pool = pool(ctx)?;
        // Never demote the org's last admin.
        if role != Role::Admin && is_last_admin(pool, auth.org_id, user_id).await? {
            return Err(async_graphql::Error::new("cannot demote the last admin"));
        }
        let user: Option<UserRow> = sqlx::query_as(&format!(
            "UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING {USER_COLUMNS}"
        ))
        .bind(role.as_str())
        .bind(user_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        user.map(User::from)
            .ok_or_else(|| async_graphql::Error::new("user not found in your organization"))
    }

    /// Removes a user from the caller's org. Admin only; cannot remove the last
    /// admin (an admin may remove themselves only if another admin remains).
    async fn remove_user(&self, ctx: &Context<'_>, user_id: Uuid) -> Result<bool> {
        let auth = require_admin(ctx)?;
        let pool = pool(ctx)?;
        if is_last_admin(pool, auth.org_id, user_id).await? {
            return Err(async_graphql::Error::new("cannot remove the last admin"));
        }
        let result = sqlx::query("DELETE FROM users WHERE id = $1 AND org_id = $2")
            .bind(user_id)
            .bind(auth.org_id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new(
                "user not found in your organization",
            ));
        }
        Ok(true)
    }

    /// Permanently deletes the caller's entire organization — this *closes the
    /// account*. Every project (and all its uploaded files), every user, and all
    /// org data is removed; nothing is left behind. Admin only. Clears the
    /// caller's session since their account no longer exists.
    async fn delete_organization(&self, ctx: &Context<'_>) -> Result<bool> {
        let auth = require_admin(ctx)?;
        let pool = pool(ctx)?;
        let storage = ctx.data::<std::sync::Arc<dyn crate::storage::Storage>>()?;

        // Purge every project's uploaded files before dropping the rows.
        let project_ids: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM projects WHERE org_id = $1")
                .bind(auth.org_id)
                .fetch_all(pool)
                .await?;
        for pid in project_ids {
            super::projects::purge_project_files(storage.as_ref(), pid).await;
        }

        // Deleting the org cascades to projects (and their children), users, and
        // org-scoped categories — see the FK ON DELETE CASCADE chain.
        sqlx::query("DELETE FROM orgs WHERE id = $1")
            .bind(auth.org_id)
            .execute(pool)
            .await?;

        // The caller's user is gone — clear their session cookie.
        let cfg = config(ctx)?;
        ctx.append_http_header("Set-Cookie", build_clearing_cookie(cfg.cookie_secure));
        Ok(true)
    }

    /// Admin-initiated reset: emails the user a one-time reset link. Admin only.
    async fn admin_reset_password(&self, ctx: &Context<'_>, user_id: Uuid) -> Result<bool> {
        let auth = require_admin(ctx)?;
        let pool = pool(ctx)?;
        let row: Option<(String,)> =
            sqlx::query_as("SELECT email FROM users WHERE id = $1 AND org_id = $2")
                .bind(user_id)
                .bind(auth.org_id)
                .fetch_optional(pool)
                .await?;
        let (email,) =
            row.ok_or_else(|| async_graphql::Error::new("user not found in your organization"))?;
        send_reset_link(ctx, pool, user_id, &email).await?;
        Ok(true)
    }

    /// Self-service: emails a reset link if the address has a password. Always
    /// returns true (no account-existence leak). Rate-limited.
    async fn request_password_reset(&self, ctx: &Context<'_>, email: String) -> Result<bool> {
        enforce_rate_limit(ctx, "password_reset").await?;
        let email = normalize_email(&email);
        let pool = pool(ctx)?;
        let row: Option<(Uuid, String)> = sqlx::query_as(
            "SELECT id, email FROM users WHERE lower(email) = $1 AND password_hash IS NOT NULL",
        )
        .bind(&email)
        .fetch_optional(pool)
        .await?;
        if let Some((id, addr)) = row {
            send_reset_link(ctx, pool, id, &addr).await?;
        }
        Ok(true)
    }

    /// Consumes a reset token and sets a new password (also marks the email
    /// verified — possessing the token proves control of the inbox).
    async fn reset_password(
        &self,
        ctx: &Context<'_>,
        token: String,
        new_password: String,
    ) -> Result<bool> {
        if new_password.len() < MIN_PASSWORD_LEN {
            return Err(async_graphql::Error::new(format!(
                "password must be at least {MIN_PASSWORD_LEN} characters"
            )));
        }
        let hash = hash_password(&new_password).map_err(async_graphql::Error::new)?;
        let result = sqlx::query(
            "UPDATE users SET password_hash = $1, email_verified = true, reset_token = NULL, \
               reset_token_expires = NULL \
             WHERE reset_token = $2 \
               AND (reset_token_expires IS NULL OR reset_token_expires > now())",
        )
        .bind(&hash)
        .bind(&token)
        .execute(pool(ctx)?)
        .await?;
        if result.rows_affected() == 0 {
            return Err(async_graphql::Error::new("invalid or expired token"));
        }
        Ok(true)
    }
}

/// True when `user_id` is an admin and the only admin left in the org — used to
/// block removing/demoting the last admin.
async fn is_last_admin(pool: &PgPool, org_id: Uuid, user_id: Uuid) -> Result<bool> {
    let (is_admin,): (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role = 'admin')",
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_one(pool)
    .await?;
    if !is_admin {
        return Ok(false);
    }
    let (admins,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM users WHERE org_id = $1 AND role = 'admin'")
            .bind(org_id)
            .fetch_one(pool)
            .await?;
    Ok(admins <= 1)
}

/// Mints a one-hour reset token for a user and emails the reset link (best-effort).
async fn send_reset_link(
    ctx: &Context<'_>,
    pool: &PgPool,
    user_id: Uuid,
    email: &str,
) -> Result<()> {
    let token = gen_token();
    sqlx::query(
        "UPDATE users SET reset_token = $1, reset_token_expires = now() + interval '1 hour' \
         WHERE id = $2",
    )
    .bind(&token)
    .bind(user_id)
    .execute(pool)
    .await?;
    let mailer = ctx.data::<Mailer>()?;
    let link = format!("{}/reset-password?token={}", mailer.app_url(), token);
    if let Err(e) = mailer.send_password_reset(email, &link).await {
        eprintln!("send_reset_link: failed for {email}: {e}");
    }
    Ok(())
}
