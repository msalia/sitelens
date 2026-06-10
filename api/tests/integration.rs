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
