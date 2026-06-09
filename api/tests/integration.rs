//! Integration tests for auth + multi-tenancy. Each test runs against an
//! ephemeral database provisioned by `#[sqlx::test]` (requires DATABASE_URL to
//! point at a Postgres/PostGIS server with create-db privileges).

use std::sync::Arc;

use async_graphql::{Request, Value};
use serde_json::Value as Json;
use sqlx::PgPool;
use uuid::Uuid;

use sitelens_api::auth::{session_token_from_cookie_header, AuthConfig, AuthContext, Role};
use sitelens_api::storage::{LocalStorage, Storage};
use sitelens_api::{build_schema, ApiSchema};

fn schema(pool: PgPool) -> ApiSchema {
    let config = AuthConfig {
        jwt_secret: "test-secret".to_string(),
        cookie_secure: false,
    };
    let storage: Arc<dyn Storage> = Arc::new(LocalStorage::new(
        std::env::temp_dir().join("sitelens-test-uploads"),
    ));
    build_schema(pool, config, storage)
}

/// Executes a query, asserts there were no GraphQL errors, returns `data` as JSON.
async fn exec_ok(schema: &ApiSchema, query: &str, auth: Option<AuthContext>) -> Json {
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
async fn exec_err(schema: &ApiSchema, query: &str, auth: Option<AuthContext>) -> String {
    let mut req = Request::new(query);
    if let Some(a) = auth {
        req = req.data(a);
    }
    let resp = schema.execute(req).await;
    assert!(!resp.errors.is_empty(), "expected an error, got none");
    resp.errors[0].message.clone()
}

fn uuid_at(v: &Json, path: &[&str]) -> Uuid {
    let mut cur = v;
    for p in path {
        cur = &cur[p];
    }
    Uuid::parse_str(cur.as_str().unwrap()).unwrap()
}

async fn signup(schema: &ApiSchema, email: &str, org: &str) -> (Uuid, Uuid, String) {
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

fn admin_ctx(user_id: Uuid, org_id: Uuid) -> AuthContext {
    AuthContext {
        user_id,
        org_id,
        role: Role::Admin,
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_verify_login_me(pool: PgPool) {
    let schema = schema(pool);
    let (user_id, org_id, token) = signup(&schema, "a@example.com", "Acme Survey").await;

    // me is null before login.
    let data = exec_ok(&schema, "{ me { id } }", None).await;
    assert!(data["me"].is_null());

    // login fails before verification.
    let login_q = r#"mutation { login(email: "a@example.com", password: "password123") { id } }"#;
    let msg = exec_err(&schema, login_q, None).await;
    assert!(msg.contains("not verified"), "got: {msg}");

    // verify, then login succeeds and sets a session cookie.
    let verify_q = format!(r#"mutation {{ verifyEmail(token: "{token}") }}"#);
    let data = exec_ok(&schema, &verify_q, None).await;
    assert_eq!(data["verifyEmail"], Json::Bool(true));

    let resp = schema.execute(Request::new(login_q)).await;
    assert!(resp.errors.is_empty(), "login errors: {:?}", resp.errors);
    let set_cookie = resp
        .http_headers
        .get("set-cookie")
        .expect("login should set a cookie")
        .to_str()
        .unwrap()
        .to_string();
    let session = session_token_from_cookie_header(&set_cookie).expect("cookie has session token");
    let auth = sitelens_api::auth::auth_context_from_token(&session, "test-secret").unwrap();
    assert_eq!(auth.user_id, user_id);
    assert_eq!(auth.org_id, org_id);

    // me works with the derived auth context.
    let data = exec_ok(&schema, "{ me { id email } }", Some(auth)).await;
    assert_eq!(uuid_at(&data, &["me", "id"]), user_id);
    assert_eq!(data["me"]["email"], Json::String("a@example.com".into()));
    // login data is also sane.
    assert!(matches!(resp.data, Value::Object(_)));
}

#[sqlx::test(migrations = "./migrations")]
async fn tenancy_isolation_between_orgs(pool: PgPool) {
    let schema = schema(pool);
    let (a_admin, a_org, _) = signup(&schema, "admin-a@example.com", "Org A").await;
    let (_b_admin, _b_org, _) = signup(&schema, "admin-b@example.com", "Org B").await;

    // Org A admin invites a second user into Org A.
    let invite_q = r#"mutation { inviteUser(email: "tech-a@example.com", role: SURVEYOR) { user { id } inviteToken } }"#;
    exec_ok(&schema, invite_q, Some(admin_ctx(a_admin, a_org))).await;

    // Org A admin sees only Org A users (the admin + invitee), never Org B's.
    let data = exec_ok(
        &schema,
        "{ users { email orgId } }",
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    let users = data["users"].as_array().unwrap();
    assert_eq!(users.len(), 2, "Org A should see exactly its 2 users");
    for u in users {
        assert_eq!(uuid_at(u, &["orgId"]), a_org, "leaked a cross-org user");
        assert!(u["email"].as_str().unwrap().ends_with("-a@example.com"));
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn role_enforcement_blocks_non_admin(pool: PgPool) {
    let schema = schema(pool);
    let (admin_id, org_id, _) = signup(&schema, "admin@example.com", "Org").await;

    // Invite a viewer and accept the invite (sets password + verifies).
    let invite_q = r#"mutation { inviteUser(email: "viewer@example.com", role: VIEWER) { user { id } inviteToken } }"#;
    let data = exec_ok(&schema, invite_q, Some(admin_ctx(admin_id, org_id))).await;
    let viewer_id = uuid_at(&data, &["inviteUser", "user", "id"]);
    let invite_token = data["inviteUser"]["inviteToken"]
        .as_str()
        .unwrap()
        .to_string();

    let accept_q = format!(
        r#"mutation {{ acceptInvite(token: "{invite_token}", password: "password123") {{ id role }} }}"#
    );
    let data = exec_ok(&schema, &accept_q, None).await;
    assert_eq!(data["acceptInvite"]["role"], Json::String("VIEWER".into()));

    // A viewer cannot list users or change roles.
    let viewer_ctx = AuthContext {
        user_id: viewer_id,
        org_id,
        role: Role::Viewer,
    };
    let msg = exec_err(&schema, "{ users { id } }", Some(viewer_ctx.clone())).await;
    assert!(msg.contains("forbidden"), "got: {msg}");

    let update_q =
        format!(r#"mutation {{ updateUserRole(userId: "{admin_id}", role: VIEWER) {{ id }} }}"#);
    let msg = exec_err(&schema, &update_q, Some(viewer_ctx)).await;
    assert!(msg.contains("forbidden"), "got: {msg}");
}
