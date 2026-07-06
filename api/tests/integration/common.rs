#![allow(dead_code)]

pub use std::sync::Arc;

pub use async_graphql::{Request, Value};
pub use serde_json::Value as Json;
pub use sqlx::PgPool;
pub use uuid::Uuid;

pub use hmac::{Hmac, Mac};
pub use sha2::Sha256;

pub use sitelens_api::auth::{session_token_from_cookie_header, AuthConfig, AuthContext, Role};
pub use sitelens_api::billing::{apply_event, org_billing, verify_signature};
pub use sitelens_api::ratelimit::RateLimiter;
pub use sitelens_api::storage::{LocalStorage, Storage};
pub use sitelens_api::{build_schema, build_schema_with, ApiSchema};

fn test_config() -> AuthConfig {
    AuthConfig {
        jwt_secret: "test-secret".to_string(),
        cookie_secure: false,
        cesium_ion_token: String::new(),
    }
}

fn test_storage() -> Arc<dyn Storage> {
    Arc::new(LocalStorage::new(
        std::env::temp_dir().join("sitelens-test-uploads"),
    ))
}

/// The default test schema. Uses a deliberately huge in-memory rate limit so the
/// ambient `AUTH_RATE_LIMIT_MAX` (dev `.env` sets it very high) can't make tests
/// non-deterministic. Rate-limiting behavior is exercised via
/// [`schema_with_rate_limit`].
pub(crate) fn schema(pool: PgPool) -> ApiSchema {
    build_schema_with(
        pool,
        test_config(),
        test_storage(),
        RateLimiter::memory(1_000_000, std::time::Duration::from_secs(60)),
    )
}

/// A test schema with an explicit auth rate limit, so the limit is independent of
/// the ambient environment.
pub(crate) fn schema_with_rate_limit(pool: PgPool, max: usize) -> ApiSchema {
    build_schema_with(
        pool,
        test_config(),
        test_storage(),
        RateLimiter::memory(max, std::time::Duration::from_secs(60)),
    )
}

/// Executes a query, asserts there were no GraphQL errors, returns `data` as JSON.
pub(crate) async fn exec_ok(schema: &ApiSchema, query: &str, auth: Option<AuthContext>) -> Json {
    let mut req = Request::new(query);
    if let Some(a) = auth {
        req = req.data(a);
    }
    let resp = schema.execute(req).await;
    assert!(
        resp.errors.is_empty(),
        "unexpected errors: {:?}",
        resp.errors
    );
    serde_json::to_value(resp.data).unwrap()
}

/// Executes a query expecting a GraphQL error; returns the first error message.
pub(crate) async fn exec_err(schema: &ApiSchema, query: &str, auth: Option<AuthContext>) -> String {
    let mut req = Request::new(query);
    if let Some(a) = auth {
        req = req.data(a);
    }
    let resp = schema.execute(req).await;
    assert!(!resp.errors.is_empty(), "expected an error, got none");
    resp.errors[0].message.clone()
}

pub(crate) fn uuid_at(v: &Json, path: &[&str]) -> Uuid {
    let mut cur = v;
    for p in path {
        cur = &cur[p];
    }
    Uuid::parse_str(cur.as_str().unwrap()).unwrap()
}

pub(crate) async fn signup(schema: &ApiSchema, email: &str, org: &str) -> (Uuid, Uuid, String) {
    let q = format!(
        r#"mutation {{ signup(email: "{email}", password: "password123", orgName: "{org}") {{
            user {{ id orgId role }} verificationToken }} }}"#
    );
    let data = exec_ok(schema, &q, None).await;
    let user_id = uuid_at(&data, &["signup", "user", "id"]);
    let org_id = uuid_at(&data, &["signup", "user", "orgId"]);
    let token = data["signup"]["verificationToken"]
        .as_str()
        .unwrap()
        .to_string();
    (user_id, org_id, token)
}

/// Marks an org as a paying Crew subscriber so entitlement-gated features
/// (exports, DXF overlays, extra projects/members) are unlocked in tests.
pub(crate) async fn set_paid(pool: &PgPool, org_id: Uuid) {
    sqlx::query("UPDATE orgs SET subscription_status = 'active' WHERE id = $1")
        .bind(org_id)
        .execute(pool)
        .await
        .unwrap();
}

pub(crate) fn admin_ctx(user_id: Uuid, org_id: Uuid) -> AuthContext {
    AuthContext {
        user_id,
        org_id,
        role: Role::Admin,
    }
}

pub(crate) async fn create_project(schema: &ApiSchema, auth: AuthContext, name: &str) -> Uuid {
    let q = format!(
        r#"mutation {{ createProject(name: "{name}", epsgCode: 2229, displayUnit: US_SURVEY_FOOT) {{ id orgId }} }}"#
    );
    let data = exec_ok(schema, &q, Some(auth)).await;
    uuid_at(&data, &["createProject", "id"])
}

/// Adds a control point with grid coordinates (all values in meters).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn add_cp(
    schema: &ApiSchema,
    auth: AuthContext,
    pid: Uuid,
    label: &str,
    e: f64,
    n: f64,
    gx: f64,
    gy: f64,
) {
    let q = format!(
        r#"mutation {{ addControlPoint(projectId: "{pid}", label: "{label}", northing: {n}, easting: {e}, gridX: {gx}, gridY: {gy}, unit: METER) {{ id }} }}"#
    );
    exec_ok(schema, &q, Some(auth)).await;
}

pub(crate) async fn exec_ok_vars(
    schema: &ApiSchema,
    query: &str,
    vars: serde_json::Value,
    auth: AuthContext,
) -> Json {
    let req = async_graphql::Request::new(query)
        .variables(async_graphql::Variables::from_json(vars))
        .data(auth);
    let resp = schema.execute(req).await;
    assert!(
        resp.errors.is_empty(),
        "unexpected errors: {:?}",
        resp.errors
    );
    serde_json::to_value(resp.data).unwrap()
}

/// Like `exec_ok_vars`, but expects a GraphQL error and returns its message.
pub(crate) async fn exec_err_vars(
    schema: &ApiSchema,
    query: &str,
    vars: serde_json::Value,
    auth: AuthContext,
) -> String {
    let req = async_graphql::Request::new(query)
        .variables(async_graphql::Variables::from_json(vars))
        .data(auth);
    let resp = schema.execute(req).await;
    assert!(!resp.errors.is_empty(), "expected an error, got none");
    resp.errors[0].message.clone()
}

pub(crate) fn role_ctx(user_id: Uuid, org_id: Uuid, role: Role) -> AuthContext {
    AuthContext {
        user_id,
        org_id,
        role,
    }
}

/// Invites a user with the given role (enum literal e.g. "SURVEYOR") and returns
/// their new user id.
pub(crate) async fn invite(
    schema: &ApiSchema,
    admin: AuthContext,
    email: &str,
    role: &str,
) -> Uuid {
    let q =
        format!(r#"mutation {{ inviteUser(email: "{email}", role: {role}) {{ user {{ id }} }} }}"#);
    let d = exec_ok(schema, &q, Some(admin)).await;
    uuid_at(&d, &["inviteUser", "user", "id"])
}

/// Builds a `Stripe-Signature` header (`t=…,v1=…`) for `payload` at `timestamp`,
/// matching Stripe's HMAC-SHA256 over `"{t}.{payload}"`.
pub(crate) fn stripe_signature(secret: &str, timestamp: i64, payload: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(payload);
    format!(
        "t={timestamp},v1={}",
        hex::encode(mac.finalize().into_bytes())
    )
}
