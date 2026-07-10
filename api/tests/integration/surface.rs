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

// --- Phase 2: constraints ---------------------------------------------------

const CREATE_BREAKLINE: &str = r#"mutation ($pid: UUID!, $input: BreaklineInput!) {
    createBreakline(projectId: $pid, input: $input) { id kind }
}"#;

const BUILD_FULL: &str = r#"mutation ($pid: UUID!, $input: SurfaceInput!) {
    buildSurface(projectId: $pid, input: $input) { id version triangleCount }
}"#;

/// A paid org + project seeded with an n×n grid of design points.
async fn seed_grid(schema: &ApiSchema, pool: &PgPool, n: i32) -> (AuthContext, Uuid) {
    let (admin, org, _) = signup(schema, "grid@example.com", "Grid Co").await;
    set_paid(pool, org).await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(schema, auth.clone(), "Grid").await;
    for r in 0..n {
        for c in 0..n {
            add_point(
                schema,
                auth.clone(),
                pid,
                &format!("P{r}_{c}"),
                c as f64,
                r as f64,
                (r + c) as f64,
            )
            .await;
        }
    }
    (auth, pid)
}

#[sqlx::test(migrations = "./migrations")]
async fn breakline_crud(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;

    let created = exec_ok_vars(
        &schema,
        CREATE_BREAKLINE,
        serde_json::json!({
            "pid": pid,
            "input": { "kind": "HARD", "closed": false, "vertices": [
                { "n": 0.0, "e": 0.0, "z": 10.0 },
                { "n": 100.0, "e": 100.0, "z": 15.0 }
            ] }
        }),
        auth.clone(),
    )
    .await;
    assert_eq!(
        created["createBreakline"]["kind"],
        serde_json::json!("HARD")
    );
    let bid = uuid_at(&created, &["createBreakline", "id"]);

    let list = exec_ok(
        &schema,
        &format!(r#"{{ breaklines(projectId: "{pid}") {{ id }} }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(list["breaklines"].as_array().unwrap().len(), 1);

    let del = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteBreakline(id: "{bid}") }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(del["deleteBreakline"], serde_json::json!(true));

    let after = exec_ok(
        &schema,
        &format!(r#"{{ breaklines(projectId: "{pid}") {{ id }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(after["breaklines"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn boundary_clips_the_built_surface_and_snapshots_its_id(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_grid(&schema, &pool, 5).await;

    let bare = exec_ok_vars(
        &schema,
        BUILD_FULL,
        serde_json::json!({ "pid": pid, "input": { "name": "bare", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    let t0 = bare["buildSurface"]["triangleCount"].as_i64().unwrap();

    // A boundary over the central region (z omitted → z-filled from points).
    let b = exec_ok_vars(
        &schema,
        CREATE_BREAKLINE,
        serde_json::json!({
            "pid": pid,
            "input": { "kind": "BOUNDARY", "closed": true, "vertices": [
                { "n": 1.0, "e": 1.0 }, { "n": 1.0, "e": 3.0 },
                { "n": 3.0, "e": 3.0 }, { "n": 3.0, "e": 1.0 }
            ] }
        }),
        auth.clone(),
    )
    .await;
    let bid = uuid_at(&b, &["createBreakline", "id"]);

    let clipped = exec_ok_vars(
        &schema,
        BUILD_FULL,
        serde_json::json!({
            "pid": pid,
            "input": { "name": "clip", "scope": "ALL", "boundaryId": bid }
        }),
        auth.clone(),
    )
    .await;
    let t1 = clipped["buildSurface"]["triangleCount"].as_i64().unwrap();
    assert!(
        t1 < t0,
        "boundary should reduce triangle count ({t1} !< {t0})"
    );

    let sid = uuid_at(&clipped, &["buildSurface", "id"]);
    let one = exec_ok(
        &schema,
        &format!(r#"{{ surface(id: "{sid}") {{ inputs }} }}"#),
        Some(auth),
    )
    .await;
    assert!(
        one["surface"]["inputs"]
            .as_str()
            .unwrap()
            .contains(&bid.to_string()),
        "inputs snapshot should record the boundary id"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn auto_boundary_creates_a_boundary_breakline(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_grid(&schema, &pool, 5).await;

    let ab = exec_ok_vars(
        &schema,
        r#"mutation ($pid: UUID!) { autoBoundary(projectId: $pid, scope: ALL) { id kind } }"#,
        serde_json::json!({ "pid": pid }),
        auth.clone(),
    )
    .await;
    assert_eq!(ab["autoBoundary"]["kind"], serde_json::json!("BOUNDARY"));

    let list = exec_ok(
        &schema,
        &format!(r#"{{ breaklines(projectId: "{pid}") {{ kind }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(list["breaklines"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn dxf_import_creates_breaklines_tagged_by_layer(pool: PgPool) {
    use base64::Engine;
    let schema = schema(pool.clone());
    let (auth, pid) = seed_grid(&schema, &pool, 3).await;

    // Minimal DXF: one LWPOLYLINE (3 vertices) on layer "BRK".
    let dxf = "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nBRK\n90\n3\n10\n0.0\n20\n0.0\n10\n5.0\n20\n0.0\n10\n5.0\n20\n5.0\n0\nENDSEC\n0\nEOF\n";
    let b64 = base64::engine::general_purpose::STANDARD.encode(dxf);

    let prev = exec_ok_vars(
        &schema,
        r#"query ($pid: UUID!, $c: String!) {
            previewBreaklineImport(projectId: $pid, contentBase64: $c) {
                layers { layer count suggestedKind }
            }
        }"#,
        serde_json::json!({ "pid": pid, "c": b64 }),
        auth.clone(),
    )
    .await;
    let layers = prev["previewBreaklineImport"]["layers"].as_array().unwrap();
    assert!(layers
        .iter()
        .any(|l| l["layer"] == serde_json::json!("BRK")));

    let imp = exec_ok_vars(
        &schema,
        r#"mutation ($pid: UUID!, $c: String!, $m: [BreaklineLayerMapping!]!) {
            importBreaklines(projectId: $pid, contentBase64: $c, mappings: $m) { created skipped }
        }"#,
        serde_json::json!({ "pid": pid, "c": b64, "m": [{ "layer": "BRK", "kind": "HARD" }] }),
        auth.clone(),
    )
    .await;
    assert_eq!(imp["importBreaklines"]["created"], serde_json::json!(1));

    let list = exec_ok(
        &schema,
        &format!(r#"{{ breaklines(projectId: "{pid}") {{ source sourceLayer }} }}"#),
        Some(auth),
    )
    .await;
    let rows = list["breaklines"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["source"], serde_json::json!("dxf"));
    assert_eq!(rows[0]["sourceLayer"], serde_json::json!("BRK"));
}

#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_breakline_creation(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;

    let msg = exec_err_vars(
        &schema,
        CREATE_BREAKLINE,
        serde_json::json!({
            "pid": pid,
            "input": { "kind": "HARD", "closed": false, "vertices": [
                { "n": 0.0, "e": 0.0, "z": 1.0 }, { "n": 1.0, "e": 1.0, "z": 2.0 }
            ] }
        }),
        auth,
    )
    .await;
    assert!(msg.contains("Crew feature"), "breaklines not gated: {msg}");
}

// --- Phase 3: contours ------------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn surface_contours_serves_an_sctr_blob(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await; // z spans 10..15

    let built = exec_ok_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "Grade", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    let sid = uuid_at(&built, &["buildSurface", "id"]);

    // A 1 m interval over a 10..15 surface yields several iso-lines. The blob is
    // base64 and starts with the "SCTR" magic ("SCT" → base64 "U0NU").
    let res = exec_ok(
        &schema,
        &format!(
            r#"{{ surfaceContours(id: "{sid}", interval: 1.0, majorInterval: 5.0, smoothing: 1) {{ filename contentBase64 }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    let b64 = res["surfaceContours"]["contentBase64"].as_str().unwrap();
    assert!(
        b64.starts_with("U0NU"),
        "contour blob should start with SCTR magic; got {b64:.8}"
    );
    assert_eq!(
        res["surfaceContours"]["filename"],
        serde_json::json!("Grade.sctr")
    );

    // A non-positive interval is a user error surfaced from the compute stage.
    let msg = exec_err(
        &schema,
        &format!(r#"{{ surfaceContours(id: "{sid}", interval: 0.0) {{ filename }} }}"#),
        Some(auth),
    )
    .await;
    assert!(msg.contains("positive"), "expected interval error: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn surface_contours_are_tenant_isolated(pool: PgPool) {
    let schema = schema(pool.clone());
    let (owner, pid) = seed_square(&schema, &pool).await;
    let built = exec_ok_vars(
        &schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "Grade", "scope": "ALL" } }),
        owner.clone(),
    )
    .await;
    let sid = uuid_at(&built, &["buildSurface", "id"]);

    // A different paid org cannot read another org's surface contours.
    let (intruder, org2, _) = signup(&schema, "intruder@example.com", "Other Co").await;
    set_paid(&pool, org2).await;
    let other = admin_ctx(intruder, org2);
    let msg = exec_err(
        &schema,
        &format!(r#"{{ surfaceContours(id: "{sid}", interval: 1.0) {{ filename }} }}"#),
        Some(other),
    )
    .await;
    assert!(
        msg.contains("surface"),
        "expected not-found for other org: {msg}"
    );
}

// --- Phase 4: volumes -------------------------------------------------------

const COMPUTE_VOLUME: &str = r#"mutation ($pid: UUID!, $input: VolumeInput!) {
    computeVolume(projectId: $pid, input: $input) {
        id comparison baseVersion compareVersion cutVolume fillVolume netVolume area hasHeatmap
    }
}"#;

/// Builds a TIN from all design points and returns its id.
async fn build_surface(schema: &ApiSchema, pid: Uuid, auth: AuthContext, name: &str) -> Uuid {
    let built = exec_ok_vars(
        schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": name, "scope": "ALL" } }),
        auth,
    )
    .await;
    uuid_at(&built, &["buildSurface", "id"])
}

#[sqlx::test(migrations = "./migrations")]
async fn surface_to_elevation_volume_is_all_cut_above_datum(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await; // z spans 10..15, all > 0
    let sid = build_surface(&schema, pid, auth.clone(), "Grade").await;

    let res = exec_ok_vars(
        &schema,
        COMPUTE_VOLUME,
        serde_json::json!({ "pid": pid, "input": {
            "name": "To datum", "comparison": "SURFACE_TO_ELEVATION",
            "baseSurfaceId": sid, "referenceElev": 0.0, "cellSize": 2.0,
        } }),
        auth.clone(),
    )
    .await;
    let v = &res["computeVolume"];
    assert_eq!(v["comparison"], serde_json::json!("SURFACE_TO_ELEVATION"));
    assert_eq!(v["baseVersion"], serde_json::json!(1));
    assert!(
        v["cutVolume"].as_f64().unwrap() > 1000.0,
        "cut = {}",
        v["cutVolume"]
    );
    assert!(
        v["fillVolume"].as_f64().unwrap().abs() < 1e-6,
        "fill = {}",
        v["fillVolume"]
    );
    assert!(v["area"].as_f64().unwrap() > 1000.0, "area = {}", v["area"]);
    assert_eq!(v["hasHeatmap"], serde_json::json!(true));
    let vid = uuid_at(&res, &["computeVolume", "id"]);

    // The heatmap grid is served, base64, starting with the "SVOL" magic
    // ("SVO" → base64 "U1ZP").
    let heat = exec_ok(
        &schema,
        &format!(r#"{{ volumeHeatmap(id: "{vid}") {{ filename contentBase64 }} }}"#),
        Some(auth.clone()),
    )
    .await;
    let b64 = heat["volumeHeatmap"]["contentBase64"].as_str().unwrap();
    assert!(
        b64.starts_with("U1ZP"),
        "heatmap should start with SVOL magic; got {b64:.8}"
    );

    // It appears in the project's volume list.
    let list = exec_ok(
        &schema,
        &format!(r#"{{ volumes(projectId: "{pid}") {{ id name }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(list["volumes"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn volume_snapshots_surface_version_across_rebuild(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;
    let base = build_surface(&schema, pid, auth.clone(), "Base").await;
    let compare = build_surface(&schema, pid, auth.clone(), "Compare").await;

    let res = exec_ok_vars(
        &schema,
        COMPUTE_VOLUME,
        serde_json::json!({ "pid": pid, "input": {
            "name": "S2S", "comparison": "SURFACE_TO_SURFACE",
            "baseSurfaceId": base, "compareSurfaceId": compare, "cellSize": 2.0,
        } }),
        auth.clone(),
    )
    .await;
    let v = &res["computeVolume"];
    assert_eq!(v["baseVersion"], serde_json::json!(1));
    assert_eq!(v["compareVersion"], serde_json::json!(1));
    assert!(v["area"].as_f64().unwrap() > 1000.0);
    let net_before = v["netVolume"].as_f64().unwrap();
    let vid = uuid_at(&res, &["computeVolume", "id"]);

    // Rebuild the base surface → its version bumps to 2.
    let rebuilt = exec_ok_vars(
        &schema,
        r#"mutation ($id: UUID!, $input: SurfaceInput!) {
            rebuildSurface(id: $id, input: $input) { version } }"#,
        serde_json::json!({ "id": base, "input": { "name": "Base", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    assert_eq!(rebuilt["rebuildSurface"]["version"], serde_json::json!(2));

    // The volume still reports the snapshotted version 1 + unchanged result.
    let after = exec_ok(
        &schema,
        &format!(r#"{{ volume(id: "{vid}") {{ baseVersion netVolume }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(after["volume"]["baseVersion"], serde_json::json!(1));
    assert!((after["volume"]["netVolume"].as_f64().unwrap() - net_before).abs() < 1e-6);
}

#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_volumes(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;
    let msg = exec_err_vars(
        &schema,
        COMPUTE_VOLUME,
        serde_json::json!({ "pid": pid, "input": {
            "name": "V", "comparison": "SURFACE_TO_ELEVATION",
            "baseSurfaceId": "00000000-0000-0000-0000-000000000000",
            "referenceElev": 0.0, "cellSize": 1.0,
        } }),
        auth,
    )
    .await;
    assert!(msg.contains("Crew feature"), "volumes not gated: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn volume_requires_matching_comparison_target(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;
    let sid = build_surface(&schema, pid, auth.clone(), "Grade").await;

    // surface-to-surface without a compare surface is rejected.
    let msg = exec_err_vars(
        &schema,
        COMPUTE_VOLUME,
        serde_json::json!({ "pid": pid, "input": {
            "name": "Bad", "comparison": "SURFACE_TO_SURFACE",
            "baseSurfaceId": sid, "cellSize": 2.0,
        } }),
        auth,
    )
    .await;
    assert!(
        msg.contains("compare surface"),
        "expected compare-surface error: {msg}"
    );
}

// --- Phase 5: exports -------------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn export_surface_formats(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;
    let sid = build_surface(&schema, pid, auth.clone(), "Existing & Grade").await;

    // LandXML — base64 of "<?x" is "PD94"; filename is slugified.
    let xml = exec_ok(
        &schema,
        &format!(
            r#"{{ exportSurface(id: "{sid}", format: LANDXML) {{ filename contentBase64 }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(
        xml["exportSurface"]["filename"],
        serde_json::json!("existing-grade.xml")
    );
    assert!(xml["exportSurface"]["contentBase64"]
        .as_str()
        .unwrap()
        .starts_with("PD94"));

    // DXF with a contour overlay — non-empty, .dxf.
    let dxf = exec_ok(
        &schema,
        &format!(
            r#"{{ exportSurface(id: "{sid}", format: DXF, contourInterval: 1.0) {{ filename contentBase64 }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(
        dxf["exportSurface"]["filename"],
        serde_json::json!("existing-grade.dxf")
    );
    assert!(!dxf["exportSurface"]["contentBase64"]
        .as_str()
        .unwrap()
        .is_empty());

    // GeoTIFF — base64 of the little-endian TIFF magic "II*" is "SUkq".
    let tif = exec_ok(
        &schema,
        &format!(
            r#"{{ exportSurface(id: "{sid}", format: GEOTIFF, cellSize: 5.0) {{ filename contentBase64 }} }}"#
        ),
        Some(auth),
    )
    .await;
    assert_eq!(
        tif["exportSurface"]["filename"],
        serde_json::json!("existing-grade.tif")
    );
    assert!(tif["exportSurface"]["contentBase64"]
        .as_str()
        .unwrap()
        .starts_with("SUkq"));
}

#[sqlx::test(migrations = "./migrations")]
async fn export_volume_report_csv(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;
    let sid = build_surface(&schema, pid, auth.clone(), "Grade").await;
    let vol = exec_ok_vars(
        &schema,
        COMPUTE_VOLUME,
        serde_json::json!({ "pid": pid, "input": {
            "name": "Cut", "comparison": "SURFACE_TO_ELEVATION",
            "baseSurfaceId": sid, "referenceElev": 0.0, "cellSize": 2.0,
        } }),
        auth.clone(),
    )
    .await;
    let vid = uuid_at(&vol, &["computeVolume", "id"]);

    // CSV — base64 of "fie" (field,value…) is "Zmll".
    let csv = exec_ok(
        &schema,
        &format!(
            r#"{{ exportVolumeReport(id: "{vid}", format: CSV, unit: CUBIC_YARD) {{ filename contentBase64 }} }}"#
        ),
        Some(auth),
    )
    .await;
    assert_eq!(
        csv["exportVolumeReport"]["filename"],
        serde_json::json!("cut.csv")
    );
    assert!(csv["exportVolumeReport"]["contentBase64"]
        .as_str()
        .unwrap()
        .starts_with("Zmll"));
}

#[sqlx::test(migrations = "./migrations")]
async fn export_surface_is_crew_gated(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let _pid = create_project(&schema, auth.clone(), "Site").await;
    let msg = exec_err(
        &schema,
        r#"{ exportSurface(id: "00000000-0000-0000-0000-000000000000", format: LANDXML) { filename } }"#,
        Some(auth),
    )
    .await;
    assert!(msg.contains("Crew feature"), "export not gated: {msg}");
}

// --- Phase 5b: DEM source ---------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn build_dem_surface_from_a_grid(pool: PgPool) {
    use base64::Engine;
    let schema = schema(pool.clone());
    let (auth, pid) = seed_square(&schema, &pool).await;

    // A 4×4 projected (EPSG:32111) grid near the seed square, as LE f32 bytes.
    let (w, h) = (4usize, 4usize);
    let mut vals: Vec<u8> = Vec::new();
    for r in 0..h {
        for c in 0..w {
            let z = 10.0 + c as f32 + r as f32 * 0.5;
            vals.extend_from_slice(&z.to_le_bytes());
        }
    }
    let values_b64 = base64::engine::general_purpose::STANDARD.encode(&vals);
    // A tiny fake "GeoTIFF" payload (only stored, never parsed server-side).
    let content_b64 = base64::engine::general_purpose::STANDARD.encode(b"II*\0fake");

    let res = exec_ok_vars(
        &schema,
        r#"mutation ($pid: UUID!, $name: String!, $file: String!, $c: String!, $g: DemGridInput!) {
            buildDemSurface(projectId: $pid, name: $name, filename: $file, contentBase64: $c, grid: $g) {
                id kind vertexCount triangleCount
            }
        }"#,
        serde_json::json!({
            "pid": pid, "name": "Drone DEM", "file": "site.tif", "c": content_b64,
            "g": {
                "epsg": 32111,
                "originE": 188500.0, "originN": 215050.0,
                "pixelX": 5.0, "pixelY": 5.0,
                "width": w, "height": h, "nodata": null, "valuesBase64": values_b64,
            }
        }),
        auth.clone(),
    )
    .await;
    let s = &res["buildDemSurface"];
    assert_eq!(s["kind"], serde_json::json!("DEM"));
    assert_eq!(s["vertexCount"], serde_json::json!(16));
    // 3×3 cells × 2 triangles.
    assert_eq!(s["triangleCount"], serde_json::json!(18));

    // The DEM surface serves a mesh like any other (STIN magic "STI" → "U1RJ").
    let sid = uuid_at(&res, &["buildDemSurface", "id"]);
    let mesh = exec_ok(
        &schema,
        &format!(r#"{{ surfaceMesh(id: "{sid}") {{ contentBase64 }} }}"#),
        Some(auth),
    )
    .await;
    assert!(mesh["surfaceMesh"]["contentBase64"]
        .as_str()
        .unwrap()
        .starts_with("U1RJ"));
}

#[sqlx::test(migrations = "./migrations")]
async fn build_surface_from_digitized_points(pool: PgPool) {
    // A flat design pad from four digitized corners (constant z) → a TIN with
    // 4 vertices / 2 triangles, usable in volume analysis.
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "pad@example.com", "Pad Co").await;
    set_paid(&pool, org).await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Pad").await;

    let q = r#"mutation ($pid: UUID!, $pts: [SurfacePointInput!]!) {
        buildSurfaceFromPoints(projectId: $pid, name: "Design pad", points: $pts) {
            id kind status vertexCount triangleCount
        }
    }"#;
    let r = exec_ok_vars(
        &schema,
        q,
        serde_json::json!({ "pid": pid, "pts": [
            { "e": 0.0, "n": 0.0, "z": 20.0 },
            { "e": 100.0, "n": 0.0, "z": 20.0 },
            { "e": 100.0, "n": 100.0, "z": 20.0 },
            { "e": 0.0, "n": 100.0, "z": 20.0 },
        ] }),
        auth.clone(),
    )
    .await;
    let s = &r["buildSurfaceFromPoints"];
    assert_eq!(s["kind"], serde_json::json!("TIN"));
    assert_eq!(s["status"], serde_json::json!("READY"));
    assert_eq!(s["vertexCount"].as_i64().unwrap(), 4);
    assert_eq!(s["triangleCount"].as_i64().unwrap(), 2);

    // Fewer than three points is rejected.
    let msg = exec_err_vars(
        &schema,
        q,
        serde_json::json!({ "pid": pid, "pts": [
            { "e": 0.0, "n": 0.0, "z": 20.0 }, { "e": 1.0, "n": 0.0, "z": 20.0 },
        ] }),
        auth,
    )
    .await;
    assert!(
        msg.contains("at least three"),
        "expected min-points error: {msg}"
    );
}
