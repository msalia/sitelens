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
        cesium_ion_token: String::new(),
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
async fn verify_email_rejects_reused_and_invalid_tokens(pool: PgPool) {
    let schema = schema(pool);
    let (_id, _org, token) = signup(&schema, "v@example.com", "Org").await;

    // First verification works.
    let q = format!(r#"mutation {{ verifyEmail(token: "{token}") }}"#);
    assert_eq!(
        exec_ok(&schema, &q, None).await["verifyEmail"],
        Json::Bool(true)
    );

    // The same token can't be reused (cleared on use).
    let msg = exec_err(&schema, &q, None).await;
    assert!(msg.contains("invalid or expired"), "reuse: {msg}");

    // A bogus token is rejected too.
    let bad = r#"mutation { verifyEmail(token: "nope-not-real") }"#;
    let msg = exec_err(&schema, bad, None).await;
    assert!(msg.contains("invalid or expired"), "bogus: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn resend_verification_reissues_token_and_is_always_truthy(pool: PgPool) {
    let schema = schema(pool.clone());
    let (user_id, _org, token1) = signup(&schema, "r@example.com", "Org").await;

    // Always returns true — even for an address that doesn't exist (no enumeration).
    let resend = |email: &str| format!(r#"mutation {{ resendVerification(email: "{email}") }}"#);
    assert_eq!(
        exec_ok(&schema, &resend("r@example.com"), None).await["resendVerification"],
        Json::Bool(true)
    );
    assert_eq!(
        exec_ok(&schema, &resend("nobody@example.com"), None).await["resendVerification"],
        Json::Bool(true)
    );

    // The original token was replaced by the resend.
    let stale = format!(r#"mutation {{ verifyEmail(token: "{token1}") }}"#);
    assert!(exec_err(&schema, &stale, None)
        .await
        .contains("invalid or expired"));

    // The freshly-issued token (read from the DB) verifies and enables login.
    let token2: String = sqlx::query_scalar("SELECT verification_token FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let verify2 = format!(r#"mutation {{ verifyEmail(token: "{token2}") }}"#);
    assert_eq!(
        exec_ok(&schema, &verify2, None).await["verifyEmail"],
        Json::Bool(true)
    );
    let login = r#"mutation { login(email: "r@example.com", password: "password123") { id } }"#;
    assert!(schema.execute(Request::new(login)).await.errors.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn login_is_rate_limited(pool: PgPool) {
    let schema = schema(pool);
    // A real account so attempts reach the credential check, not a missing user.
    let (_id, _org, token) = signup(&schema, "a@example.com", "Org").await;
    let verify_q = format!(r#"mutation {{ verifyEmail(token: "{token}") }}"#);
    exec_ok(&schema, &verify_q, None).await;

    // The limiter is 10 attempts/min/IP. Tests carry no ClientIp, so all share
    // the "unknown" bucket. Ten wrong-password attempts are allowed (each an
    // "invalid credentials" error)...
    let wrong = r#"mutation { login(email: "a@example.com", password: "wrong-password") { id } }"#;
    for _ in 0..10 {
        let msg = exec_err(&schema, wrong, None).await;
        assert!(msg.contains("invalid credentials"), "got: {msg}");
    }
    // ...the 11th is refused by the rate limiter regardless of credentials.
    let msg = exec_err(&schema, wrong, None).await;
    assert!(msg.contains("too many attempts"), "got: {msg}");

    // Even a correct password is blocked once the limit is hit.
    let right = r#"mutation { login(email: "a@example.com", password: "password123") { id } }"#;
    let msg = exec_err(&schema, right, None).await;
    assert!(msg.contains("too many attempts"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn cross_org_isolation_comprehensive(pool: PgPool) {
    let schema = schema(pool);
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;
    let a = admin_ctx(a_admin, a_org);
    let b = admin_ctx(b_admin, b_org);

    // Org A builds a project with a control point and an imported survey point.
    let pid = create_project(&schema, a.clone(), "A Site").await;
    let cp_q = format!(
        r#"mutation {{ addControlPoint(projectId: "{pid}", label: "CP1", northing: 1000.0, easting: 2000.0, gridX: 0.0, gridY: 0.0, unit: METER) {{ id }} }}"#
    );
    exec_ok(&schema, &cp_q, Some(a.clone())).await;
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount } }"#;
    let imp_vars = serde_json::json!({
        "id": pid, "c": "P,N,E\nPT1,1,1\n",
        "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
    });
    exec_ok_vars(&schema, imp, imp_vars, a.clone()).await;
    let pts = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}") {{ id }} }}"#),
        Some(a.clone()),
    )
    .await;
    let a_point_id = uuid_at(&pts["surveyPoints"][0], &["id"]);

    // Every project-scoped read is denied for Org B.
    let reads = [
        format!(r#"{{ gridAxes(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ controlPoints(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ surveyPoints(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ surveyPointCount(projectId: "{pid}") }}"#),
        format!(r#"{{ transform(projectId: "{pid}") {{ scale }} }}"#),
        format!(r#"{{ cadOverlays(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ importBatches(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ importProfiles(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ pointGroups(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ sceneData(projectId: "{pid}") {{ origin {{ latitude }} }} }}"#),
        format!(
            r#"{{ convertCoordinate(projectId: "{pid}", space: PROJECTED, x: 1.0, y: 2.0, unit: METER) {{ latitude }} }}"#
        ),
        format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
        ),
    ];
    for q in &reads {
        let msg = exec_err(&schema, q, Some(b.clone())).await;
        assert!(
            msg.contains("not found"),
            "read leaked across orgs: {q}\n=> {msg}"
        );
    }

    // Every project-scoped mutation is denied for Org B.
    let mutations = [
        format!(r#"mutation {{ updateProject(id: "{pid}", name: "hijacked") {{ id }} }}"#),
        format!(
            r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [{{ family: LETTERED, label: "A", position: 0.0 }}]) {{ id }} }}"#
        ),
        format!(
            r#"mutation {{ addControlPoint(projectId: "{pid}", label: "X", northing: 1.0, easting: 1.0, unit: METER) {{ id }} }}"#
        ),
        format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#),
        format!(
            r#"mutation {{ createPointGroup(projectId: "{pid}", name: "g", memberIds: []) {{ id }} }}"#
        ),
        format!(r#"mutation {{ deleteSurveyPoint(id: "{a_point_id}") }}"#),
    ];
    for q in &mutations {
        let msg = exec_err(&schema, q, Some(b.clone())).await;
        assert!(
            msg.contains("not found"),
            "mutation crossed orgs: {q}\n=> {msg}"
        );
    }

    // The project itself is invisible to Org B (null, not an error).
    let proj = exec_ok(
        &schema,
        &format!(r#"{{ project(id: "{pid}") {{ id }} }}"#),
        Some(b.clone()),
    )
    .await;
    assert!(proj["project"].is_null(), "Org B can see Org A's project");

    // Org A's own data is still intact and accessible.
    let still = exec_ok(
        &schema,
        &format!(r#"{{ surveyPointCount(projectId: "{pid}") }}"#),
        Some(a),
    )
    .await;
    assert_eq!(still["surveyPointCount"].as_i64().unwrap(), 1);
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

// ---------------------------------------------------------------------------
// Phase 2: projects, grid, control points
// ---------------------------------------------------------------------------

async fn create_project(schema: &ApiSchema, auth: AuthContext, name: &str) -> Uuid {
    let q = format!(
        r#"mutation {{ createProject(name: "{name}", epsgCode: 2229, displayUnit: US_SURVEY_FOOT) {{ id orgId }} }}"#
    );
    let data = exec_ok(schema, &q, Some(auth)).await;
    uuid_at(&data, &["createProject", "id"])
}

#[sqlx::test(migrations = "./migrations")]
async fn project_crud_is_org_scoped(pool: PgPool) {
    let schema = schema(pool);
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;

    let pid = create_project(&schema, admin_ctx(a_admin, a_org), "Tower A").await;

    // Org A sees its project; Org B sees none and cannot read it by id.
    let data = exec_ok(
        &schema,
        "{ projects { id } }",
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    assert_eq!(data["projects"].as_array().unwrap().len(), 1);
    let data = exec_ok(
        &schema,
        "{ projects { id } }",
        Some(admin_ctx(b_admin, b_org)),
    )
    .await;
    assert_eq!(data["projects"].as_array().unwrap().len(), 0);
    let q = format!(r#"{{ project(id: "{pid}") {{ id }} }}"#);
    let data = exec_ok(&schema, &q, Some(admin_ctx(b_admin, b_org))).await;
    assert!(
        data["project"].is_null(),
        "Org B must not read Org A's project"
    );

    // Org B cannot update or delete Org A's project.
    let upd = format!(r#"mutation {{ updateProject(id: "{pid}", name: "Hijacked") {{ id }} }}"#);
    assert!(exec_err(&schema, &upd, Some(admin_ctx(b_admin, b_org)))
        .await
        .contains("not found"));
    let del = format!(r#"mutation {{ deleteProject(id: "{pid}") }}"#);
    assert!(exec_err(&schema, &del, Some(admin_ctx(b_admin, b_org)))
        .await
        .contains("not found"));

    // Org A can delete its own project.
    let data = exec_ok(&schema, &del, Some(admin_ctx(a_admin, a_org))).await;
    assert_eq!(data["deleteProject"], Json::Bool(true));
}

#[sqlx::test(migrations = "./migrations")]
async fn control_point_feet_convert_to_meters(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Add a control point in US survey feet; it must be stored/returned in meters.
    let add = format!(
        r#"mutation {{ addControlPoint(projectId: "{pid}", label: "CP1", northing: 1000.0, easting: 2000.0, elevation: 100.0, unit: US_SURVEY_FOOT) {{ id northing easting elevation }} }}"#
    );
    exec_ok(&schema, &add, Some(admin_ctx(admin, org))).await;

    let data = exec_ok(
        &schema,
        &format!(r#"{{ controlPoints(projectId: "{pid}") {{ northing easting elevation }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let cp = &data["controlPoints"][0];
    let us_ft_m = 1200.0_f64 / 3937.0;
    assert!((cp["northing"].as_f64().unwrap() - 1000.0 * us_ft_m).abs() < 1e-6);
    assert!((cp["easting"].as_f64().unwrap() - 2000.0 * us_ft_m).abs() < 1e-6);
    assert!((cp["elevation"].as_f64().unwrap() - 100.0 * us_ft_m).abs() < 1e-6);
}

#[sqlx::test(migrations = "./migrations")]
async fn set_grid_axes_replaces_and_converts(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let q = format!(
        r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [
            {{ family: LETTERED, label: "A", position: 0.0 }},
            {{ family: LETTERED, label: "B", position: 10.0 }},
            {{ family: NUMBERED, label: "1", position: 0.0 }}
        ]) {{ label position family }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    assert_eq!(data["setGridAxes"].as_array().unwrap().len(), 3);

    // Replacing yields only the new set.
    let q2 = format!(
        r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [
            {{ family: LETTERED, label: "A", position: 0.0 }}
        ]) {{ label }} }}"#
    );
    let data = exec_ok(&schema, &q2, Some(admin_ctx(admin, org))).await;
    assert_eq!(data["setGridAxes"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn viewer_cannot_create_project(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;

    let invite = r#"mutation { inviteUser(email: "v@example.com", role: VIEWER) { user { id } inviteToken } }"#;
    let data = exec_ok(&schema, invite, Some(admin_ctx(admin, org))).await;
    let viewer_id = uuid_at(&data, &["inviteUser", "user", "id"]);
    let token = data["inviteUser"]["inviteToken"]
        .as_str()
        .unwrap()
        .to_string();
    let accept = format!(
        r#"mutation {{ acceptInvite(token: "{token}", password: "password123") {{ id }} }}"#
    );
    exec_ok(&schema, &accept, None).await;

    let viewer_ctx = AuthContext {
        user_id: viewer_id,
        org_id: org,
        role: Role::Viewer,
    };
    let q = r#"mutation { createProject(name: "X", epsgCode: 2229, displayUnit: METER) { id } }"#;
    assert!(exec_err(&schema, q, Some(viewer_ctx))
        .await
        .contains("forbidden"));
}

// ---------------------------------------------------------------------------
// Phase 3: Helmert transform
// ---------------------------------------------------------------------------

/// Adds a control point with grid coordinates (all values in meters).
#[allow(clippy::too_many_arguments)]
async fn add_cp(
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

#[sqlx::test(migrations = "./migrations")]
async fn solve_transform_recovers_translation(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Identity rotation/scale, translation E=100, N=200.
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "A",
        100.0,
        200.0,
        0.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "B",
        110.0,
        200.0,
        10.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "C",
        100.0,
        210.0,
        0.0,
        10.0,
    )
    .await;

    let q = format!(
        r#"mutation {{ solveTransform(projectId: "{pid}") {{ translationE translationN scale rotationDegrees rmsError pointCount residuals {{ label magnitude }} }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    let t = &data["solveTransform"];
    assert!((t["translationE"].as_f64().unwrap() - 100.0).abs() < 1e-6);
    assert!((t["translationN"].as_f64().unwrap() - 200.0).abs() < 1e-6);
    assert!((t["scale"].as_f64().unwrap() - 1.0).abs() < 1e-6);
    assert!(t["rotationDegrees"].as_f64().unwrap().abs() < 1e-6);
    assert!(t["rmsError"].as_f64().unwrap() < 1e-6);
    assert_eq!(t["pointCount"].as_i64().unwrap(), 3);
    assert_eq!(t["residuals"].as_array().unwrap().len(), 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn solve_transform_reports_residuals_at_high_rms(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Identity-ish, but the 4th point is 1 m off → non-zero RMS, full residuals.
    add_cp(&schema, admin_ctx(admin, org), pid, "A", 0.0, 0.0, 0.0, 0.0).await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "B",
        10.0,
        0.0,
        10.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "C",
        0.0,
        10.0,
        0.0,
        10.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "D",
        11.0,
        10.0,
        10.0,
        10.0,
    )
    .await;

    let q = format!(
        r#"mutation {{ solveTransform(projectId: "{pid}") {{ rmsError residuals {{ label magnitude }} }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    assert!(data["solveTransform"]["rmsError"].as_f64().unwrap() > 0.0);
    assert_eq!(
        data["solveTransform"]["residuals"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn solve_transform_too_few_points_errors(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    add_cp(&schema, admin_ctx(admin, org), pid, "A", 0.0, 0.0, 0.0, 0.0).await;

    let q = format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#);
    let msg = exec_err(&schema, &q, Some(admin_ctx(admin, org))).await;
    assert!(msg.contains("two control points"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn transform_query_returns_persisted(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "A",
        100.0,
        200.0,
        0.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "B",
        110.0,
        200.0,
        10.0,
        0.0,
    )
    .await;

    // Before solving: null.
    let q0 = format!(r#"{{ transform(projectId: "{pid}") {{ scale }} }}"#);
    let before = exec_ok(&schema, &q0, Some(admin_ctx(admin, org))).await;
    assert!(before["transform"].is_null());

    let solve = format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#);
    exec_ok(&schema, &solve, Some(admin_ctx(admin, org))).await;

    let after = exec_ok(&schema, &q0, Some(admin_ctx(admin, org))).await;
    assert!((after["transform"]["scale"].as_f64().unwrap() - 1.0).abs() < 1e-6);
}

// ---------------------------------------------------------------------------
// Phase 4: coordinate conversion
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn convert_coordinate_returns_all_representations(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Identity transform, translation E=100 N=200, so grid (x,y) → projected (x+100, y+200).
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "A",
        100.0,
        200.0,
        0.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "B",
        110.0,
        200.0,
        10.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "C",
        100.0,
        210.0,
        0.0,
        10.0,
    )
    .await;
    let solve = format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#);
    exec_ok(&schema, &solve, Some(admin_ctx(admin, org))).await;

    // Convert a projected coordinate → grid is recovered, geographic is present.
    let q = format!(
        r#"{{ convertCoordinate(projectId: "{pid}", space: PROJECTED, x: 110.0, y: 220.0, unit: METER) {{
            gridX gridY projectedGroundE latitude longitude }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    let c = &data["convertCoordinate"];
    assert!((c["gridX"].as_f64().unwrap() - 10.0).abs() < 1e-6);
    assert!((c["gridY"].as_f64().unwrap() - 20.0).abs() < 1e-6);
    assert!((c["projectedGroundE"].as_f64().unwrap() - 110.0).abs() < 1e-6); // CSF defaults to 1
    assert!(c["latitude"].as_f64().is_some());
    assert!(c["longitude"].as_f64().is_some());

    // Convert a grid coordinate → projected is computed via the transform.
    let q2 = format!(
        r#"{{ convertCoordinate(projectId: "{pid}", space: GRID, x: 10.0, y: 20.0, unit: METER) {{
            projectedGridE projectedGridN }} }}"#
    );
    let data2 = exec_ok(&schema, &q2, Some(admin_ctx(admin, org))).await;
    let c2 = &data2["convertCoordinate"];
    assert!((c2["projectedGridE"].as_f64().unwrap() - 110.0).abs() < 1e-6);
    assert!((c2["projectedGridN"].as_f64().unwrap() - 220.0).abs() < 1e-6);
}

// ---------------------------------------------------------------------------
// Phase 5: points, categories, import
// ---------------------------------------------------------------------------

async fn exec_ok_vars(
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

#[sqlx::test(migrations = "./migrations")]
async fn default_categories_seeded_on_signup(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let data = exec_ok(
        &schema,
        "{ categories { name isDefault } }",
        Some(admin_ctx(admin, org)),
    )
    .await;
    let cats = data["categories"].as_array().unwrap();
    assert_eq!(cats.len(), 7, "expected 7 default categories");
    assert!(cats.iter().all(|c| c["isDefault"].as_bool().unwrap()));
}

#[sqlx::test(migrations = "./migrations")]
async fn import_csv_converts_feet_to_meters(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let content = "P,N,E,Z,D\n1,1000,2000,5,MON\n2,1001,2001,,IP\n";
    let q = r#"mutation ($id: UUID!, $content: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $content, unit: US_SURVEY_FOOT, mapping: $m) { rowCount }
    }"#;
    let vars = serde_json::json!({
        "id": pid,
        "content": content,
        "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2, "elevationCol": 3, "descriptionCol": 4 }
    });
    let data = exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await;
    assert_eq!(data["importPoints"]["rowCount"].as_i64().unwrap(), 2);

    let pts = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}") {{ label northing description }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let arr = pts["surveyPoints"].as_array().unwrap();
    assert_eq!(arr.len(), 2);
    let us_ft_m = 1200.0_f64 / 3937.0;
    assert!((arr[0]["northing"].as_f64().unwrap() - 1000.0 * us_ft_m).abs() < 1e-6);
    assert_eq!(arr[0]["description"], Json::String("MON".into()));
}

#[sqlx::test(migrations = "./migrations")]
async fn survey_points_search_filter(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let content = "P,N,E,D\nCB1,1,1,catch basin\nMH1,2,2,manhole\n";
    let q = r#"mutation ($id: UUID!, $content: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $content, unit: METER, mapping: $m) { rowCount }
    }"#;
    let vars = serde_json::json!({
        "id": pid, "content": content,
        "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2, "descriptionCol": 3 }
    });
    exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await;

    let filtered = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}", search: "manhole") {{ label }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let arr = filtered["surveyPoints"].as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["label"], Json::String("MH1".into()));
}

#[sqlx::test(migrations = "./migrations")]
async fn survey_points_pagination_and_count(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Import 5 points in a known order.
    let mut content = String::from("P,N,E\n");
    for i in 0..5 {
        content.push_str(&format!("PT{i},{i},{i}\n"));
    }
    let q = r#"mutation ($id: UUID!, $content: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $content, unit: METER, mapping: $m) { rowCount }
    }"#;
    let vars = serde_json::json!({
        "id": pid, "content": content,
        "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
    });
    exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await;

    // Count reflects all matching rows regardless of paging.
    let counted = exec_ok(
        &schema,
        &format!(r#"{{ surveyPointCount(projectId: "{pid}") }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(counted["surveyPointCount"].as_i64().unwrap(), 5);

    // First page of 2.
    let page1 = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}", limit: 2, offset: 0) {{ label }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let p1 = page1["surveyPoints"].as_array().unwrap();
    assert_eq!(p1.len(), 2);
    assert_eq!(p1[0]["label"], Json::String("PT0".into()));

    // Second page continues where the first left off.
    let page2 = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}", limit: 2, offset: 2) {{ label }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let p2 = page2["surveyPoints"].as_array().unwrap();
    assert_eq!(p2.len(), 2);
    assert_eq!(p2[0]["label"], Json::String("PT2".into()));
}

#[sqlx::test(migrations = "./migrations")]
async fn import_landxml_points(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let content = r#"<LandXML><CgPoints><CgPoint name="1" code="MON">100 200 5</CgPoint><CgPoint name="2">101 201</CgPoint></CgPoints></LandXML>"#;
    let q = r#"mutation ($id: UUID!, $content: String!) {
        importPoints(projectId: $id, format: LANDXML, content: $content, unit: METER) { rowCount }
    }"#;
    let data = exec_ok_vars(
        &schema,
        q,
        serde_json::json!({ "id": pid, "content": content }),
        admin_ctx(admin, org),
    )
    .await;
    assert_eq!(data["importPoints"]["rowCount"].as_i64().unwrap(), 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn point_group_create_and_list(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let q = format!(
        r#"mutation {{ createPointGroup(projectId: "{pid}", name: "North wing", memberIds: []) {{ id name }} }}"#
    );
    exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    let data = exec_ok(
        &schema,
        &format!(r#"{{ pointGroups(projectId: "{pid}") {{ name }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(data["pointGroups"].as_array().unwrap().len(), 1);
}

// ---------------------------------------------------------------------------
// Phase 6: 3D scene data
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn scene_data_projects_to_geographic(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Control points near a real LA projected location (EPSG 2229, meters).
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "A",
        1_950_000.0,
        560_000.0,
        0.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "B",
        1_950_010.0,
        560_000.0,
        10.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "C",
        1_950_000.0,
        560_010.0,
        0.0,
        10.0,
    )
    .await;
    exec_ok(
        &schema,
        &format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    // Two axes per family so grid lines are non-degenerate.
    let axes = format!(
        r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [
            {{ family: LETTERED, label: "A", position: 0 }},
            {{ family: LETTERED, label: "B", position: 10 }},
            {{ family: NUMBERED, label: "1", position: 0 }},
            {{ family: NUMBERED, label: "2", position: 10 }}
        ]) {{ id }} }}"#
    );
    exec_ok(&schema, &axes, Some(admin_ctx(admin, org))).await;

    let data = exec_ok(
        &schema,
        &format!(
            r#"{{ sceneData(projectId: "{pid}") {{
                origin {{ latitude longitude }}
                controlPoints {{ label latitude longitude height }}
                gridLines {{ label coordinates {{ latitude }} }}
            }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let s = &data["sceneData"];
    let cps = s["controlPoints"].as_array().unwrap();
    assert_eq!(cps.len(), 3);
    // LA-area latitude.
    let lat = cps[0]["latitude"].as_f64().unwrap();
    assert!((33.0..35.0).contains(&lat), "lat {lat}");
    assert!(s["origin"]["latitude"].as_f64().is_some());
    assert_eq!(s["gridLines"].as_array().unwrap().len(), 4);
}

// ---------------------------------------------------------------------------
// Phase 7: DXF overlays
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn dxf_overlay_upload_georef_delete(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n";
    let up = r#"mutation ($id: UUID!, $c: String!) {
        uploadDxf(projectId: $id, filename: "plan.dxf", content: $c) { id originalFilename assumeRealWorld visible }
    }"#;
    let data = exec_ok_vars(
        &schema,
        up,
        serde_json::json!({ "id": pid, "c": dxf }),
        admin_ctx(admin, org),
    )
    .await;
    let oid = uuid_at(&data, &["uploadDxf", "id"]);
    assert_eq!(
        data["uploadDxf"]["originalFilename"],
        Json::String("plan.dxf".into())
    );
    assert_eq!(data["uploadDxf"]["assumeRealWorld"], Json::Bool(true));

    // Content round-trips through storage.
    let content = exec_ok(
        &schema,
        &format!(r#"{{ cadOverlayContent(id: "{oid}") }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert!(content["cadOverlayContent"]
        .as_str()
        .unwrap()
        .contains("ENTITIES"));

    // Georeference update.
    let geo = format!(
        r#"mutation {{ setCadGeoreference(id: "{oid}", offsetE: 5, rotationDeg: 90, scale: 2, visible: false) {{ offsetE rotationDeg scale visible }} }}"#
    );
    let g = exec_ok(&schema, &geo, Some(admin_ctx(admin, org))).await;
    assert_eq!(g["setCadGeoreference"]["offsetE"].as_f64().unwrap(), 5.0);
    assert_eq!(
        g["setCadGeoreference"]["rotationDeg"].as_f64().unwrap(),
        90.0
    );
    assert_eq!(g["setCadGeoreference"]["visible"], Json::Bool(false));

    // List then delete.
    let list = exec_ok(
        &schema,
        &format!(r#"{{ cadOverlays(projectId: "{pid}") {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(list["cadOverlays"].as_array().unwrap().len(), 1);

    let del = format!(r#"mutation {{ deleteCadOverlay(id: "{oid}") }}"#);
    assert_eq!(
        exec_ok(&schema, &del, Some(admin_ctx(admin, org))).await["deleteCadOverlay"],
        Json::Bool(true)
    );
}

// ---------------------------------------------------------------------------
// Phase 8: export
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn export_points_csv_and_landxml(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Import two points in meters.
    let content = "P,N,E,Z,D\n1,1000,2000,5,MON\n2,1001,2001,,IP\n";
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount }
    }"#;
    exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({ "id": pid, "c": content,
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2, "elevationCol": 3, "descriptionCol": 4 } }),
        admin_ctx(admin, org),
    )
    .await;

    // CSV export (projected grid, meters, default PNEZD).
    let csv_q = format!(
        r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
    );
    let csv = exec_ok(&schema, &csv_q, Some(admin_ctx(admin, org))).await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(csv.contains("Point,Northing,Easting,Elevation,Description"));
    assert!(csv.contains("1,1000.0000,2000.0000,5.0000,MON"));

    // LandXML export.
    let xml_q = format!(
        r#"{{ exportPoints(projectId: "{pid}", format: LANDXML, space: PROJECTED_GRID, unit: METER) }}"#
    );
    let xml = exec_ok(&schema, &xml_q, Some(admin_ctx(admin, org))).await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(xml.contains("<CgPoint"));
    assert!(xml.contains("1000 2000 5"));
}

// ---------------------------------------------------------------------------
// Phase 10: RBAC, auth validation, and CRUD gap coverage
// ---------------------------------------------------------------------------

fn role_ctx(user_id: Uuid, org_id: Uuid, role: Role) -> AuthContext {
    AuthContext {
        user_id,
        org_id,
        role,
    }
}

/// Invites a user with the given role (enum literal e.g. "SURVEYOR") and returns
/// their new user id.
async fn invite(schema: &ApiSchema, admin: AuthContext, email: &str, role: &str) -> Uuid {
    let q =
        format!(r#"mutation {{ inviteUser(email: "{email}", role: {role}) {{ user {{ id }} }} }}"#);
    let d = exec_ok(schema, &q, Some(admin)).await;
    uuid_at(&d, &["inviteUser", "user", "id"])
}

#[sqlx::test(migrations = "./migrations")]
async fn surveyor_can_edit_but_not_administer(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;
    let surveyor_id = invite(&schema, admin_ctx(admin, org), "s@example.com", "SURVEYOR").await;
    let surveyor = role_ctx(surveyor_id, org, Role::Surveyor);

    // A surveyor is an editor: project + control point + category all succeed.
    let pid = create_project(&schema, surveyor.clone(), "S Site").await;
    add_cp(&schema, surveyor.clone(), pid, "CP1", 1.0, 1.0, 0.0, 0.0).await;
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Utilities", color: "#fff", icon: "u") { id isDefault } }"##,
        Some(surveyor.clone()),
    )
    .await;
    assert_eq!(cat["createCategory"]["isDefault"], Json::Bool(false));

    // But not admin actions.
    let msg = exec_err(&schema, "{ users { id } }", Some(surveyor.clone())).await;
    assert!(msg.contains("forbidden"), "got: {msg}");
    let inv = r#"mutation { inviteUser(email: "x@example.com", role: VIEWER) { inviteToken } }"#;
    let msg = exec_err(&schema, inv, Some(surveyor)).await;
    assert!(msg.contains("forbidden"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn viewer_cannot_mutate_data(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let viewer_id = invite(&schema, admin_ctx(admin, org), "v@example.com", "VIEWER").await;
    let viewer = role_ctx(viewer_id, org, Role::Viewer);

    // A viewer can read...
    let read = exec_ok(
        &schema,
        &format!(r#"{{ controlPoints(projectId: "{pid}") {{ id }} }}"#),
        Some(viewer.clone()),
    )
    .await;
    assert_eq!(read["controlPoints"].as_array().unwrap().len(), 0);

    // ...but every write is rejected with an editor-role error.
    let writes = [
        format!(
            r#"mutation {{ addControlPoint(projectId: "{pid}", label: "X", northing: 1.0, easting: 1.0, unit: METER) {{ id }} }}"#
        ),
        format!(
            r#"mutation {{ importPoints(projectId: "{pid}", format: CSV, content: "N,E\n1,1\n", unit: METER, mapping: {{ hasHeader: true, northingCol: 0, eastingCol: 1 }}) {{ rowCount }} }}"#
        ),
        r##"mutation { createCategory(name: "C", color: "#fff", icon: "c") { id } }"##.to_string(),
        format!(
            r#"mutation {{ uploadDxf(projectId: "{pid}", filename: "a.dxf", content: "x") {{ id }} }}"#
        ),
    ];
    for q in &writes {
        let msg = exec_err(&schema, q, Some(viewer.clone())).await;
        assert!(
            msg.contains("editor role required"),
            "viewer wrote: {q}\n=> {msg}"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn unauthenticated_requests_are_denied(pool: PgPool) {
    let schema = schema(pool);
    let msg = exec_err(&schema, "{ projects { id } }", None).await;
    assert!(msg.contains("not authenticated"), "got: {msg}");
    let m = r#"mutation { createProject(name: "X", epsgCode: 2229, displayUnit: METER) { id } }"#;
    let msg = exec_err(&schema, m, None).await;
    assert!(msg.contains("not authenticated"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_validation_errors(pool: PgPool) {
    let schema = schema(pool);

    let short = r#"mutation { signup(email: "a@example.com", password: "short12", orgName: "O") { user { id } } }"#;
    assert!(exec_err(&schema, short, None).await.contains("at least 8"));

    let bad_email = r#"mutation { signup(email: "nope", password: "password123", orgName: "O") { user { id } } }"#;
    assert!(exec_err(&schema, bad_email, None)
        .await
        .contains("valid email"));

    let empty_org = r#"mutation { signup(email: "b@example.com", password: "password123", orgName: "  ") { user { id } } }"#;
    assert!(exec_err(&schema, empty_org, None)
        .await
        .contains("organization name"));

    // Duplicate email is rejected.
    signup(&schema, "dup@example.com", "Org").await;
    let dup = r#"mutation { signup(email: "dup@example.com", password: "password123", orgName: "Org2") { user { id } } }"#;
    assert!(exec_err(&schema, dup, None)
        .await
        .contains("already registered"));
}

#[sqlx::test(migrations = "./migrations")]
async fn token_and_invite_errors(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;

    let bad_verify = r#"mutation { verifyEmail(token: "nope") }"#;
    assert!(exec_err(&schema, bad_verify, None)
        .await
        .contains("invalid or expired"));

    let bad_accept = r#"mutation { acceptInvite(token: "nope", password: "password123") { id } }"#;
    assert!(exec_err(&schema, bad_accept, None)
        .await
        .contains("invalid or expired invite"));

    let short_pw = r#"mutation { acceptInvite(token: "whatever", password: "short12") { id } }"#;
    assert!(exec_err(&schema, short_pw, None)
        .await
        .contains("at least 8"));

    // Inviting an already-registered email fails.
    let dup =
        r#"mutation { inviteUser(email: "admin@example.com", role: VIEWER) { inviteToken } }"#;
    assert!(exec_err(&schema, dup, Some(admin_ctx(admin, org)))
        .await
        .contains("already registered"));
}

#[sqlx::test(migrations = "./migrations")]
async fn admin_updates_user_role(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Org").await;
    let viewer_id = invite(&schema, admin_ctx(admin, org), "v@example.com", "VIEWER").await;

    let promote = format!(
        r#"mutation {{ updateUserRole(userId: "{viewer_id}", role: SURVEYOR) {{ role }} }}"#
    );
    let d = exec_ok(&schema, &promote, Some(admin_ctx(admin, org))).await;
    assert_eq!(d["updateUserRole"]["role"], Json::String("SURVEYOR".into()));

    // Reflected in the org user list.
    let users = exec_ok(
        &schema,
        "{ users { id role } }",
        Some(admin_ctx(admin, org)),
    )
    .await;
    let found = users["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| uuid_at(u, &["id"]) == viewer_id)
        .unwrap();
    assert_eq!(found["role"], Json::String("SURVEYOR".into()));
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_clears_session_cookie(pool: PgPool) {
    let schema = schema(pool);
    let resp = schema.execute(Request::new("mutation { logout }")).await;
    assert!(resp.errors.is_empty());
    let cookie = resp
        .http_headers
        .get("set-cookie")
        .expect("logout sets a clearing cookie")
        .to_str()
        .unwrap();
    // Clears the session: empty value + immediate expiry.
    assert!(cookie.contains("session="), "got: {cookie}");
    assert!(cookie.contains("Max-Age=0"), "got: {cookie}");
}

#[sqlx::test(migrations = "./migrations")]
async fn update_and_delete_control_point(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let add = format!(
        r#"mutation {{ addControlPoint(projectId: "{pid}", label: "CP1", northing: 1.0, easting: 2.0, unit: METER) {{ id }} }}"#
    );
    let cpid = uuid_at(
        &exec_ok(&schema, &add, Some(admin_ctx(admin, org))).await,
        &["addControlPoint", "id"],
    );

    // Update relabels and re-coordinates (feet → meters).
    let upd = format!(
        r#"mutation {{ updateControlPoint(id: "{cpid}", label: "CP1b", northing: 1000.0, unit: US_SURVEY_FOOT) {{ label northing }} }}"#
    );
    let d = exec_ok(&schema, &upd, Some(admin_ctx(admin, org))).await;
    assert_eq!(
        d["updateControlPoint"]["label"],
        Json::String("CP1b".into())
    );
    let us_ft_m = 1200.0_f64 / 3937.0;
    assert!(
        (d["updateControlPoint"]["northing"].as_f64().unwrap() - 1000.0 * us_ft_m).abs() < 1e-6
    );

    // Cross-org cannot touch it.
    let cross = format!(r#"mutation {{ deleteControlPoint(id: "{cpid}") }}"#);
    assert!(exec_err(&schema, &cross, Some(admin_ctx(b_admin, b_org)))
        .await
        .contains("not found"));

    // Owner deletes it.
    let del = format!(r#"mutation {{ deleteControlPoint(id: "{cpid}") }}"#);
    assert_eq!(
        exec_ok(&schema, &del, Some(admin_ctx(admin, org))).await["deleteControlPoint"],
        Json::Bool(true)
    );
    let left = exec_ok(
        &schema,
        &format!(r#"{{ controlPoints(projectId: "{pid}") {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(left["controlPoints"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn update_survey_point_and_assign_category(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // A custom category and one imported point.
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Manholes", color: "#0af", icon: "m") { id } }"##,
        Some(admin_ctx(admin, org)),
    )
    .await;
    let cat_id = uuid_at(&cat, &["createCategory", "id"]);

    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount } }"#;
    exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({
            "id": pid, "c": "P,N,E\nMH1,1,1\n",
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
        }),
        admin_ctx(admin, org),
    )
    .await;
    let pts = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}") {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let sp_id = uuid_at(&pts["surveyPoints"][0], &["id"]);

    let upd = format!(
        r#"mutation {{ updateSurveyPoint(id: "{sp_id}", label: "MH-renamed", description: "north basin", categoryId: "{cat_id}", tags: ["storm","verified"]) {{ label description categoryId tags }} }}"#
    );
    let d = exec_ok(&schema, &upd, Some(admin_ctx(admin, org))).await;
    let p = &d["updateSurveyPoint"];
    assert_eq!(p["label"], Json::String("MH-renamed".into()));
    assert_eq!(p["description"], Json::String("north basin".into()));
    assert_eq!(uuid_at(p, &["categoryId"]), cat_id);
    assert_eq!(
        p["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["storm", "verified"]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn import_with_category_and_saved_profile(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Trees", color: "#0a0", icon: "t") { id } }"##,
        Some(admin_ctx(admin, org)),
    )
    .await;
    let cat_id = uuid_at(&cat, &["createCategory", "id"]);

    // Import tags every row with the category AND saves the mapping as a profile.
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!, $cat: UUID!, $name: String!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m, categoryId: $cat, saveProfileName: $name) { rowCount } }"#;
    let d = exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({
            "id": pid, "c": "P,N,E\nT1,1,1\nT2,2,2\n", "cat": cat_id, "name": "PNE meters",
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
        }),
        admin_ctx(admin, org),
    )
    .await;
    assert_eq!(d["importPoints"]["rowCount"].as_i64().unwrap(), 2);

    // Both points carry the category.
    let by_cat = exec_ok(
        &schema,
        &format!(r#"{{ surveyPointCount(projectId: "{pid}", categoryId: "{cat_id}") }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(by_cat["surveyPointCount"].as_i64().unwrap(), 2);

    // The profile was saved and is listed.
    let profiles = exec_ok(
        &schema,
        &format!(r#"{{ importProfiles(projectId: "{pid}") {{ name unit }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let arr = profiles["importProfiles"].as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], Json::String("PNE meters".into()));
    assert_eq!(arr[0]["unit"], Json::String("METER".into()));
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_point_group(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let g = exec_ok(
        &schema,
        &format!(r#"mutation {{ createPointGroup(projectId: "{pid}", name: "Set A", memberIds: []) {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let gid = uuid_at(&g, &["createPointGroup", "id"]);
    assert_eq!(
        exec_ok(
            &schema,
            &format!(r#"mutation {{ deletePointGroup(id: "{gid}") }}"#),
            Some(admin_ctx(admin, org)),
        )
        .await["deletePointGroup"],
        Json::Bool(true)
    );
    let left = exec_ok(
        &schema,
        &format!(r#"{{ pointGroups(projectId: "{pid}") {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(left["pointGroups"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn search_epsg_finds_known_code(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    // Searching by code returns that CRS.
    let d = exec_ok(
        &schema,
        r#"{ searchEpsg(query: "2229", limit: 5) { code name } }"#,
        Some(admin_ctx(admin, org)),
    )
    .await;
    let arr = d["searchEpsg"].as_array().unwrap();
    assert!(arr.iter().any(|e| e["code"].as_i64() == Some(2229)));
    assert!(arr.iter().all(|e| !e["name"].as_str().unwrap().is_empty()));
}

#[sqlx::test(migrations = "./migrations")]
async fn public_config_returns_configured_token(pool: PgPool) {
    let schema = schema(pool);
    // The test AuthConfig uses an empty Ion token.
    let d = exec_ok(&schema, "{ publicConfig { cesiumIonToken } }", None).await;
    assert_eq!(
        d["publicConfig"]["cesiumIonToken"],
        Json::String(String::new())
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn convert_ground_uses_combined_scale_factor(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    // CSF = 2 → ground = projected-grid / 2.
    let create = r#"mutation { createProject(name: "S", epsgCode: 2229, displayUnit: METER, combinedScaleFactor: 2.0) { id } }"#;
    let pid = uuid_at(
        &exec_ok(&schema, create, Some(admin_ctx(admin, org))).await,
        &["createProject", "id"],
    );
    let q = format!(
        r#"{{ convertCoordinate(projectId: "{pid}", space: PROJECTED, x: 100.0, y: 200.0, unit: METER) {{ projectedGridE projectedGroundE projectedGroundN }} }}"#
    );
    let c = &exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await["convertCoordinate"];
    assert!((c["projectedGridE"].as_f64().unwrap() - 100.0).abs() < 1e-9);
    assert!((c["projectedGroundE"].as_f64().unwrap() - 50.0).abs() < 1e-9);
    assert!((c["projectedGroundN"].as_f64().unwrap() - 100.0).abs() < 1e-9);
}

#[sqlx::test(migrations = "./migrations")]
async fn export_respects_columns_space_and_category_filter(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount } }"#;
    exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({
            "id": pid, "c": "P,N,E\nA,1000,2000\nB,1001,2001\n",
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
        }),
        admin_ctx(admin, org),
    )
    .await;

    // A chosen column subset/order — no Elevation/Description columns.
    let subset = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER, columns: [POINT, EASTING, NORTHING]) }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    let header = subset.lines().next().unwrap();
    assert_eq!(header, "Point,Easting,Northing");
    assert!(!subset.contains("Elevation"));

    // Geographic space emits lat/long columns with real values.
    let geo = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: GEOGRAPHIC, unit: METER, columns: [POINT, LATITUDE, LONGITUDE]) }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(geo.lines().next().unwrap(), "Point,Latitude,Longitude");
    assert_eq!(geo.lines().filter(|l| !l.trim().is_empty()).count(), 3); // header + 2

    // Filtering by an empty category yields only the header.
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Empty", color: "#000", icon: "e") { id } }"##,
        Some(admin_ctx(admin, org)),
    )
    .await;
    let cat_id = uuid_at(&cat, &["createCategory", "id"]);
    let filtered = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER, categoryId: "{cat_id}") }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(filtered.lines().filter(|l| !l.trim().is_empty()).count(), 1);
    assert!(!filtered.contains(",1000,") && !filtered.contains('A'));
}

#[sqlx::test(migrations = "./migrations")]
async fn survey_points_sort_and_bulk_actions(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;
    let a = admin_ctx(admin, org);
    let pid = create_project(&schema, a.clone(), "Site").await;

    // Import three points with out-of-order northings.
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount } }"#;
    exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({
            "id": pid, "c": "P,N,E\nA,300,1\nB,100,2\nC,200,3\n",
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
        }),
        a.clone(),
    )
    .await;

    // Sort by northing ascending → B(100), C(200), A(300).
    let asc = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}", sort: "northing") {{ label }} }}"#),
        Some(a.clone()),
    )
    .await;
    let labels: Vec<&str> = asc["surveyPoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, vec!["B", "C", "A"]);

    // Descending flips it.
    let desc = exec_ok(
        &schema,
        &format!(
            r#"{{ surveyPoints(projectId: "{pid}", sort: "northing", descending: true) {{ label }} }}"#
        ),
        Some(a.clone()),
    )
    .await;
    let dlabels: Vec<&str> = desc["surveyPoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["label"].as_str().unwrap())
        .collect();
    assert_eq!(dlabels, vec!["A", "C", "B"]);

    // Collect ids by label.
    let all = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}") {{ id label }} }}"#),
        Some(a.clone()),
    )
    .await;
    let id_of = |label: &str| -> Uuid {
        let p = all["surveyPoints"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["label"].as_str() == Some(label))
            .unwrap();
        uuid_at(p, &["id"])
    };
    let (ia, ib, ic) = (id_of("A"), id_of("B"), id_of("C"));

    // Bulk-assign a category to A and B.
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Set", color: "#abc", icon: "s") { id } }"##,
        Some(a.clone()),
    )
    .await;
    let cat_id = uuid_at(&cat, &["createCategory", "id"]);
    let assigned = exec_ok(
        &schema,
        &format!(r#"mutation {{ assignCategory(ids: ["{ia}", "{ib}"], categoryId: "{cat_id}") }}"#),
        Some(a.clone()),
    )
    .await;
    assert_eq!(assigned["assignCategory"].as_i64().unwrap(), 2);
    let in_cat = exec_ok(
        &schema,
        &format!(r#"{{ surveyPointCount(projectId: "{pid}", categoryId: "{cat_id}") }}"#),
        Some(a.clone()),
    )
    .await;
    assert_eq!(in_cat["surveyPointCount"].as_i64().unwrap(), 2);

    // Another org cannot bulk-delete this org's points (returns 0, leaves them).
    let cross = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteSurveyPoints(ids: ["{ia}", "{ib}", "{ic}"]) }}"#),
        Some(admin_ctx(b_admin, b_org)),
    )
    .await;
    assert_eq!(cross["deleteSurveyPoints"].as_i64().unwrap(), 0);

    // Owner bulk-deletes A and B; only C remains.
    let del = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteSurveyPoints(ids: ["{ia}", "{ib}"]) }}"#),
        Some(a.clone()),
    )
    .await;
    assert_eq!(del["deleteSurveyPoints"].as_i64().unwrap(), 2);
    let left = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}") {{ label }} }}"#),
        Some(a),
    )
    .await;
    let remaining: Vec<&str> = left["surveyPoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["label"].as_str().unwrap())
        .collect();
    assert_eq!(remaining, vec!["C"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_project_purges_db_rows_and_uploaded_files(pool: PgPool) {
    // Use a dedicated storage root so we can assert files are physically removed.
    let storage_root = std::env::temp_dir().join(format!("sitelens-del-{}", Uuid::new_v4()));
    let storage: Arc<dyn Storage> = Arc::new(LocalStorage::new(&storage_root));
    let config = AuthConfig {
        jwt_secret: "test-secret".to_string(),
        cookie_secure: false,
        cesium_ion_token: String::new(),
    };
    let schema = build_schema(pool.clone(), config, storage.clone());

    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;

    // Child data + an uploaded DXF (writes a real file on disk).
    exec_ok(
        &schema,
        &format!(
            r#"mutation {{ addControlPoint(projectId: "{pid}", label: "CP", northing: 1.0, easting: 2.0, unit: METER) {{ id }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    let ov = exec_ok(
        &schema,
        &format!(
            r#"mutation {{ uploadDxf(projectId: "{pid}", filename: "d.dxf", content: "0\nSECTION\n") {{ id }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    let overlay_id = uuid_at(&ov, &["uploadDxf", "id"]);
    let key = format!("dxf/{pid}/{overlay_id}.dxf");
    assert!(
        storage.exists(&key).await,
        "overlay file should exist pre-delete"
    );

    // Delete the project.
    let data = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteProject(id: "{pid}") }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(data["deleteProject"].as_bool(), Some(true));

    // DB: the project and its children are gone (FK cascade).
    for (table, col) in [
        ("projects", "id"),
        ("control_points", "project_id"),
        ("cad_overlays", "project_id"),
    ] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT count(*) FROM {table} WHERE {col} = $1"))
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "{table} should have no rows for the project");
    }

    // Storage: the uploaded file is physically gone — no traces left behind.
    assert!(!storage.exists(&key).await, "overlay file must be deleted");

    let _ = tokio::fs::remove_dir_all(&storage_root).await;
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_organization_removes_everything_and_isolates_other_orgs(pool: PgPool) {
    let schema = schema(pool.clone());
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;

    // Org A: a project + an invited user. Org B: a project (to prove isolation).
    let a_pid = create_project(&schema, admin_ctx(a_admin, a_org), "A Site").await;
    exec_ok(
        &schema,
        r#"mutation { inviteUser(email: "tech@a.com", role: SURVEYOR) { user { id } } }"#,
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    let b_pid = create_project(&schema, admin_ctx(b_admin, b_org), "B Site").await;

    // Non-admins cannot delete the organization.
    let viewer = AuthContext {
        user_id: a_admin,
        org_id: a_org,
        role: Role::Viewer,
    };
    let err = exec_err(&schema, "mutation { deleteOrganization }", Some(viewer)).await;
    assert!(
        err.to_lowercase().contains("admin"),
        "expected admin guard: {err}"
    );

    // Admin deletes Org A.
    let data = exec_ok(
        &schema,
        "mutation { deleteOrganization }",
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    assert_eq!(data["deleteOrganization"].as_bool(), Some(true));

    // Org A: org row, users, and projects are all gone.
    for (q, id) in [
        ("SELECT count(*) FROM orgs WHERE id = $1", a_org),
        ("SELECT count(*) FROM users WHERE org_id = $1", a_org),
        ("SELECT count(*) FROM projects WHERE id = $1", a_pid),
    ] {
        let count: i64 = sqlx::query_scalar(q)
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    // Org B is completely untouched.
    let b_proj: i64 = sqlx::query_scalar("SELECT count(*) FROM projects WHERE id = $1")
        .bind(b_pid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(b_proj, 1);
    let b_users: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE org_id = $1")
        .bind(b_org)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(b_users, 1);
}
