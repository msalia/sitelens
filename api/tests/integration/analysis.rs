//! Site-analysis integration tests (Phase 1): analysis CRUD + duplicate, Crew
//! gating, and tenancy. Each test runs every migration (exercises 0017 up).

use crate::common::*;

/// A paid org + project, ready for analysis CRUD.
async fn seed(schema: &ApiSchema, pool: &PgPool, email: &str) -> (AuthContext, Uuid) {
    let (admin, org, _) = signup(schema, email, "Analysis Co").await;
    set_paid(pool, org).await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(schema, auth.clone(), "Site").await;
    (auth, pid)
}

const CREATE: &str = r#"mutation ($pid: UUID!, $in: AnalysisInput!) {
    createAnalysis(projectId: $pid, input: $in) {
        id type name status params inputGeometry result
    }
}"#;

fn turning_input() -> serde_json::Value {
    serde_json::json!({
        "type": "TURNING",
        "name": "Driveway swept path",
        "params": "{\"stepResolution\":1.0}",
        "inputGeometry": "[[0.0,0.0],[10.0,0.0],[10.0,10.0]]",
    })
}

#[sqlx::test(migrations = "./migrations")]
async fn create_list_and_get_analysis(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed(&schema, &pool, "a@example.com").await;

    let created = exec_ok_vars(
        &schema,
        CREATE,
        serde_json::json!({ "pid": pid, "in": turning_input() }),
        auth.clone(),
    )
    .await;
    let a = &created["createAnalysis"];
    assert_eq!(a["type"], serde_json::json!("TURNING"));
    assert_eq!(a["status"], serde_json::json!("DRAFT"));
    assert!(a["params"].as_str().unwrap().contains("stepResolution"));
    assert!(a["inputGeometry"].as_str().unwrap().contains("10"));
    let id = uuid_at(&created, &["createAnalysis", "id"]);

    // Appears in the project list.
    let list = exec_ok(
        &schema,
        &format!(r#"{{ analyses(projectId: "{pid}") {{ id name }} }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(list["analyses"].as_array().unwrap().len(), 1);

    // Fetch one by id.
    let one = exec_ok(
        &schema,
        &format!(r#"{{ analysis(id: "{id}") {{ name type }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(
        one["analysis"]["name"],
        serde_json::json!("Driveway swept path")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_and_delete_analysis(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed(&schema, &pool, "dup@example.com").await;
    let created = exec_ok_vars(
        &schema,
        CREATE,
        serde_json::json!({ "pid": pid, "in": turning_input() }),
        auth.clone(),
    )
    .await;
    let id = uuid_at(&created, &["createAnalysis", "id"]);

    // Duplicate → a fresh draft named "… (copy)" carrying the same input.
    let dup = exec_ok(
        &schema,
        &format!(
            r#"mutation {{ duplicateAnalysis(id: "{id}") {{ id name status inputGeometry }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(
        dup["duplicateAnalysis"]["name"],
        serde_json::json!("Driveway swept path (copy)")
    );
    assert_eq!(
        dup["duplicateAnalysis"]["status"],
        serde_json::json!("DRAFT")
    );
    assert!(dup["duplicateAnalysis"]["inputGeometry"]
        .as_str()
        .unwrap()
        .contains("10"));

    // Two analyses now; delete the original leaves one.
    let del = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteAnalysis(id: "{id}") }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(del["deleteAnalysis"], serde_json::json!(true));
    let list = exec_ok(
        &schema,
        &format!(r#"{{ analyses(projectId: "{pid}") {{ id }} }}"#),
        Some(auth),
    )
    .await;
    assert_eq!(list["analyses"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_analysis(pool: PgPool) {
    let schema = schema(pool.clone());
    // Solo org (not set_paid).
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;
    let msg = exec_err_vars(
        &schema,
        CREATE,
        serde_json::json!({ "pid": pid, "in": turning_input() }),
        auth,
    )
    .await;
    assert!(msg.contains("Crew feature"), "analysis not gated: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn analyses_are_tenant_isolated(pool: PgPool) {
    let schema = schema(pool.clone());
    let (owner, pid) = seed(&schema, &pool, "owner@example.com").await;
    let created = exec_ok_vars(
        &schema,
        CREATE,
        serde_json::json!({ "pid": pid, "in": turning_input() }),
        owner,
    )
    .await;
    let id = uuid_at(&created, &["createAnalysis", "id"]);

    let (intruder, org2, _) = signup(&schema, "intruder@example.com", "Other Co").await;
    set_paid(&pool, org2).await;
    let other = admin_ctx(intruder, org2);
    let msg = exec_err(
        &schema,
        &format!(r#"{{ analysis(id: "{id}") {{ id }} }}"#),
        Some(other),
    )
    .await;
    assert!(
        msg.contains("not found in your organization"),
        "tenancy leak: {msg}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_geometry_json_is_rejected(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed(&schema, &pool, "bad@example.com").await;
    let mut input = turning_input();
    input["inputGeometry"] = serde_json::json!("{not valid json");
    let msg = exec_err_vars(
        &schema,
        CREATE,
        serde_json::json!({ "pid": pid, "in": input }),
        auth,
    )
    .await;
    assert!(
        msg.contains("invalid geometry JSON"),
        "expected JSON error: {msg}"
    );
}

// --- Phase 2: turning radius ------------------------------------------------

#[sqlx::test(migrations = "./migrations")]
async fn vehicle_presets_are_global_and_custom_are_org_scoped(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, _pid) = seed(&schema, &pool, "veh@example.com").await;

    // Seeded global presets are visible to any Crew org, read-only.
    let list = exec_ok(
        &schema,
        "{ vehicleTemplates { id name isPreset } }",
        Some(auth.clone()),
    )
    .await;
    let rows = list["vehicleTemplates"].as_array().unwrap();
    assert!(
        rows.len() >= 8,
        "expected the seeded presets, got {}",
        rows.len()
    );
    assert!(rows
        .iter()
        .all(|v| v["isPreset"] == serde_json::json!(true)));

    // A custom vehicle appears for its org…
    let created = exec_ok_vars(
        &schema,
        r#"mutation ($in: VehicleTemplateInput!) {
            createVehicleTemplate(input: $in) { id name isPreset wheelbase }
        }"#,
        serde_json::json!({ "in": { "name": "Yard truck", "wheelbase": 4.5, "width": 2.5 } }),
        auth.clone(),
    )
    .await;
    assert_eq!(
        created["createVehicleTemplate"]["isPreset"],
        serde_json::json!(false)
    );
    let after = exec_ok(&schema, "{ vehicleTemplates { id isPreset } }", Some(auth)).await;
    let custom = after["vehicleTemplates"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["isPreset"] == serde_json::json!(false))
        .count();
    assert_eq!(custom, 1);

    // …but not for a different org (only its presets).
    let (admin2, org2, _) = signup(&schema, "veh2@example.com", "Veh Two").await;
    set_paid(&pool, org2).await;
    let other = admin_ctx(admin2, org2);
    let other_list = exec_ok(&schema, "{ vehicleTemplates { isPreset } }", Some(other)).await;
    assert!(other_list["vehicleTemplates"]
        .as_array()
        .unwrap()
        .iter()
        .all(|v| v["isPreset"] == serde_json::json!(true)));
}

const RUN_TURNING: &str = r#"mutation ($pid: UUID!, $in: TurningInput!) {
    runTurningAnalysis(projectId: $pid, input: $in) { id type status result resultGeometry }
}"#;

#[sqlx::test(migrations = "./migrations")]
async fn turning_analysis_passes_clear_and_fails_clipped(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed(&schema, &pool, "turn@example.com").await;
    // Grab a preset vehicle id.
    let veh = exec_ok(
        &schema,
        "{ vehicleTemplates { id name } }",
        Some(auth.clone()),
    )
    .await;
    let vid = veh["vehicleTemplates"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // A straight run with no obstacles → complete + pass.
    let ok = exec_ok_vars(
        &schema,
        RUN_TURNING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "Driveway", "vehicleTemplateId": vid, "path": "[[0,0],[30,0]]", "stepResolution": 0.5,
        } }),
        auth.clone(),
    )
    .await;
    let a = &ok["runTurningAnalysis"];
    assert_eq!(a["type"], serde_json::json!("TURNING"));
    assert_eq!(a["status"], serde_json::json!("COMPLETE"));
    assert!(a["result"].as_str().unwrap().contains("\"pass\":true"));
    assert!(a["resultGeometry"].as_str().unwrap().contains("rearTrack"));

    // A curb point sitting on the centerline → fail (clipped).
    let bad = exec_ok_vars(
        &schema,
        RUN_TURNING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "Tight", "vehicleTemplateId": vid, "path": "[[0,0],[30,0]]",
            "obstacles": "[[[15,0]]]", "stepResolution": 0.5,
        } }),
        auth.clone(),
    )
    .await;
    assert!(bad["runTurningAnalysis"]["result"]
        .as_str()
        .unwrap()
        .contains("\"pass\":false"));
}

#[sqlx::test(migrations = "./migrations")]
async fn turning_run_is_crew_gated(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;
    let msg = exec_err_vars(
        &schema,
        RUN_TURNING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "x", "vehicleTemplateId": "00000000-0000-0000-0000-000000000000", "path": "[[0,0],[1,0]]",
        } }),
        auth,
    )
    .await;
    assert!(msg.contains("Crew feature"), "turning not gated: {msg}");
}

// --- Phase 3: parking -------------------------------------------------------

const RUN_PARKING: &str = r#"mutation ($pid: UUID!, $in: ParkingInput!) {
    runParkingAnalysis(projectId: $pid, input: $in) { id type status result resultGeometry }
}"#;

#[sqlx::test(migrations = "./migrations")]
async fn parking_run_tiles_stalls_and_checks_codes(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed(&schema, &pool, "park@example.com").await;

    // A 30 m perpendicular bay at 2.5 m stalls tiles 12 stalls; required 10 → pass.
    let ok = exec_ok_vars(
        &schema,
        RUN_PARKING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "Lot A", "bays": "[[[0,0],[30,0]]]",
            "stallWidth": 2.5, "stallLength": 5.5, "angle": 90.0, "requiredCount": 10,
        } }),
        auth.clone(),
    )
    .await;
    let a = &ok["runParkingAnalysis"];
    assert_eq!(a["type"], serde_json::json!("PARKING"));
    assert_eq!(a["status"], serde_json::json!("COMPLETE"));
    let result = a["result"].as_str().unwrap();
    assert!(result.contains("\"stallCount\":12"), "count: {result}");
    assert!(result.contains("\"adaRequired\":1"), "ada: {result}");
    assert!(result.contains("\"pass\":true"), "verdict: {result}");
    assert!(a["resultGeometry"].as_str().unwrap().contains("stalls"));

    // The same bay but requiring 20 stalls → the required-count check fails.
    let short = exec_ok_vars(
        &schema,
        RUN_PARKING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "Lot B", "bays": "[[[0,0],[30,0]]]",
            "stallWidth": 2.5, "angle": 90.0, "requiredCount": 20,
        } }),
        auth.clone(),
    )
    .await;
    assert!(short["runParkingAnalysis"]["result"]
        .as_str()
        .unwrap()
        .contains("\"pass\":false"));
}

#[sqlx::test(migrations = "./migrations")]
async fn parking_ada_provided_check_fails_when_short(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, pid) = seed(&schema, &pool, "ada@example.com").await;
    // 12 stalls need 1 accessible; providing 0 fails ADA.
    let short = exec_ok_vars(
        &schema,
        RUN_PARKING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "No accessible", "bays": "[[[0,0],[30,0]]]",
            "stallWidth": 2.5, "angle": 90.0, "accessibleProvided": 0,
        } }),
        auth,
    )
    .await;
    let result = short["runParkingAnalysis"]["result"].as_str().unwrap();
    assert!(result.contains("\"adaPass\":false"), "adaPass: {result}");
    assert!(result.contains("\"pass\":false"), "verdict: {result}");
}

#[sqlx::test(migrations = "./migrations")]
async fn parking_run_is_crew_gated(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;
    let msg = exec_err_vars(
        &schema,
        RUN_PARKING,
        serde_json::json!({ "pid": pid, "in": {
            "name": "x", "bays": "[[[0,0],[10,0]]]",
        } }),
        auth,
    )
    .await;
    assert!(msg.contains("Crew feature"), "parking not gated: {msg}");
}
