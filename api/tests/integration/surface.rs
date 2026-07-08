//! Surface-modeling integration tests (Phase 1): TIN build/rebuild/delete +
//! mesh serving, Crew gating, tenancy, and degenerate-input handling. Each test
//! runs every migration (so this also exercises 0016 up).

use crate::common::*;

/// Adds a design survey point in projected meters (x = easting, y = northing).
async fn add_point(
    schema: &ApiSchema,
    auth: AuthContext,
    pid: Uuid,
    label: &str,
    e: f64,
    n: f64,
    z: f64,
) {
    let q = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "{label}", space: PROJECTED, x: {e}, y: {n}, elevation: {z}, unit: METER) {{ id }} }}"#
    );
    exec_ok(schema, &q, Some(auth)).await;
}

/// A paid org + project seeded with a non-degenerate set of 4 design points
/// (a square, so Delaunay yields 2 triangles / 4 vertices).
async fn seed_square(schema: &ApiSchema, pool: &PgPool) -> (AuthContext, Uuid) {
    let (admin, org, _) = signup(schema, "surf@example.com", "Surf Co").await;
    set_paid(pool, org).await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(schema, auth.clone(), "Grade").await;
    add_point(schema, auth.clone(), pid, "P1", 0.0, 0.0, 10.0).await;
    add_point(schema, auth.clone(), pid, "P2", 100.0, 0.0, 12.0).await;
    add_point(schema, auth.clone(), pid, "P3", 100.0, 100.0, 15.0).await;
    add_point(schema, auth.clone(), pid, "P4", 0.0, 100.0, 11.0).await;
    (auth, pid)
}

const BUILD: &str = r#"mutation ($pid: UUID!, $input: SurfaceInput!) {
    buildSurface(projectId: $pid, input: $input) {
        id version status kind vertexCount triangleCount
    } }"#;

#[sqlx::test(migrations = "./migrations")]
async fn build_surface_triangulates_and_serves_mesh(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;

    let data = exec_ok_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "Existing grade", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    let s = &data["buildSurface"];
    assert_eq!(s["status"], serde_json::json!("READY"));
    assert_eq!(s["kind"], serde_json::json!("TIN"));
    assert_eq!(s["version"], serde_json::json!(1));
    assert_eq!(s["vertexCount"], serde_json::json!(4));
    assert_eq!(s["triangleCount"], serde_json::json!(2));
    let sid = uuid_at(&data, &["buildSurface", "id"]);

    // It appears in the project's surface list.
    let list = exec_ok(
        &schema,
        &format!(r#"{{ surfaces(projectId: "{pid}") {{ id name }} }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(list["surfaces"].as_array().unwrap().len(), 1);

    // The mesh blob is served, base64-encoded, and starts with the "STIN" magic
    // ("STI" → base64 "U1RJ").
    let mesh = exec_ok(
        &schema,
        &format!(r#"{{ surfaceMesh(id: "{sid}") {{ filename contentBase64 }} }}"#),
        Some(auth),
    )
    .await;
    let b64 = mesh["surfaceMesh"]["contentBase64"].as_str().unwrap();
    assert!(
        b64.starts_with("U1RJ"),
        "mesh blob should start with STIN magic; got {b64:.8}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn rebuild_increments_version_and_snapshots_inputs(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;

    let built = exec_ok_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "v1", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    let sid = uuid_at(&built, &["buildSurface", "id"]);

    let rebuilt = exec_ok_vars(
        &schema,
        r#"mutation ($id: UUID!, $input: SurfaceInput!) {
            rebuildSurface(id: $id, input: $input) { id version } }"#,
        serde_json::json!({ "id": sid, "input": { "name": "v2", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    assert_eq!(rebuilt["rebuildSurface"]["version"], serde_json::json!(2));

    // The inputs snapshot is persisted (its JSON records the scope).
    let one = exec_ok(
        &schema,
        &format!(r#"{{ surface(id: "{sid}") {{ version inputs }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(one["surface"]["version"], serde_json::json!(2));
    let inputs = one["surface"]["inputs"].as_str().unwrap();
    assert!(
        inputs.contains("\"scope\":\"all\""),
        "inputs snapshot missing scope: {inputs}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_building_surfaces(pool: PgPool) {
    let schema = schema(pool.clone());
    // Solo org (not set_paid).
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;
    add_point(&schema, auth.clone(), pid, "P1", 0.0, 0.0, 1.0).await;
    add_point(&schema, auth.clone(), pid, "P2", 10.0, 0.0, 2.0).await;
    add_point(&schema, auth.clone(), pid, "P3", 0.0, 10.0, 3.0).await;

    let msg = exec_err_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "S", "scope": "ALL" } }),
        auth,
    )
    .await;
    assert!(msg.contains("Crew feature"), "surfaces not gated: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn surfaces_are_tenant_isolated(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth_a, _pid) = seed_square(&schema, &pool).await;
    let built = exec_ok_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": _pid, "input": { "name": "A", "scope": "ALL" } }),
        auth_a,
    )
    .await;
    let sid = uuid_at(&built, &["buildSurface", "id"]);

    // A different (paid) org must not be able to read that surface.
    let (admin_b, org_b, _) = signup(&schema, "b@example.com", "Org B").await;
    set_paid(&pool, org_b).await;
    let auth_b = admin_ctx(admin_b, org_b);
    let msg = exec_err(
        &schema,
        &format!(r#"{{ surface(id: "{sid}") {{ id }} }}"#),
        Some(auth_b),
    )
    .await;
    assert!(
        msg.contains("not found in your organization"),
        "tenancy leak: {msg}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn insufficient_points_is_an_error(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "few@example.com", "Few Co").await;
    set_paid(&pool, org).await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Sparse").await;
    add_point(&schema, auth.clone(), pid, "P1", 0.0, 0.0, 1.0).await;
    add_point(&schema, auth.clone(), pid, "P2", 10.0, 10.0, 2.0).await;

    let msg = exec_err_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "S", "scope": "ALL" } }),
        auth,
    )
    .await;
    assert!(
        msg.contains("at least 3 points"),
        "expected degenerate-input error: {msg}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_surface_removes_it(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;
    let built = exec_ok_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "S", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    let sid = uuid_at(&built, &["buildSurface", "id"]);

    let del = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteSurface(id: "{sid}") }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(del["deleteSurface"], serde_json::json!(true));

    let list = exec_ok(
        &schema,
        &format!(r#"{{ surfaces(projectId: "{pid}") {{ id }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(list["surfaces"].as_array().unwrap().len(), 0);
}
