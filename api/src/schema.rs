//! GraphQL schema: health, auth, and tenancy-scoped user management.

use async_graphql::{Context, Object, Result};
use rand::{distributions::Alphanumeric, Rng};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{
    build_clearing_cookie, build_session_cookie, hash_password, issue_jwt, verify_password,
    AuthConfig, AuthContext, Role,
};
use crate::models::{InviteResult, LoginRow, Org, SignupResult, User, UserRow};

const USER_COLUMNS: &str = "id, org_id, email, role, email_verified, created_at";
const MIN_PASSWORD_LEN: usize = 8;

fn gen_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn pool<'a>(ctx: &'a Context) -> Result<&'a PgPool> {
    ctx.data::<PgPool>()
}

fn config<'a>(ctx: &'a Context) -> Result<&'a AuthConfig> {
    ctx.data::<AuthConfig>()
}

/// The authenticated principal, or an error if the request is unauthenticated.
fn require_auth<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    ctx.data_opt::<AuthContext>()
        .ok_or_else(|| async_graphql::Error::new("not authenticated"))
}

fn require_admin<'a>(ctx: &'a Context) -> Result<&'a AuthContext> {
    let auth = require_auth(ctx)?;
    if auth.role != Role::Admin {
        return Err(async_graphql::Error::new("forbidden: admin role required"));
    }
    Ok(auth)
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

async fn email_taken(pool: &PgPool, email: &str) -> Result<bool> {
    let existing: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE lower(email) = lower($1)")
            .bind(email)
            .fetch_optional(pool)
            .await?;
    Ok(existing.is_some())
}

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Liveness check.
    async fn health(&self) -> &str {
        "ok"
    }

    /// Database connectivity check.
    async fn db_status(&self, ctx: &Context<'_>) -> String {
        match sqlx::query("SELECT 1").execute(pool(ctx).unwrap()).await {
            Ok(_) => "connected".to_string(),
            Err(_) => "disconnected".to_string(),
        }
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
}

pub struct MutationRoot;

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
}
