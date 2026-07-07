//! Utility Records — Phase 1 (migration + audit) and Phase 2 (CRUD + snapshot).

use crate::common::*;
use sitelens_api::utilities::audit;

/// Creates a water run with two vertices and returns its id + the GraphQL payload.
async fn create_run(schema: &ApiSchema, ctx: AuthContext, pid: Uuid) -> Json {
    let q = r#"mutation ($id: UUID!, $in: UtilityRunInput!, $v: [UtilityVertexInput!]!) {
        createUtilityRun(projectId: $id, input: $in, vertices: $v) {
            id typeKey material diameter length invertUp invertDown slope
            vertices { seq northing easting sourcePointId }
        }
    }"#;
    let vars = serde_json::json!({
        "id": pid,
        "in": { "typeKey": "water", "material": "PVC", "diameterInches": 8.0,
                "invertUp": 105.0, "invertDown": 100.0, "tags": ["main"] },
        "v": [
            { "northing": 0.0, "easting": 0.0, "elevation": 0.0 },
            { "northing": 4.0, "easting": 3.0, "elevation": 12.0 },
        ],
    });
    exec_ok_vars(schema, q, vars, ctx).await
}

#[sqlx::test(migrations = "./migrations")]
async fn create_run_computes_derived_and_audits(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let data = create_run(&schema, admin_ctx(admin, org), pid).await;
    let run = &data["createUtilityRun"];
    assert_eq!(run["typeKey"], "water");
    assert_eq!(run["material"], "PVC");
    // 8 in → 0.2032 m; 3-4-12 triangle → 13 m; slope (105-100)/5 = 1.0.
    assert!((run["diameter"].as_f64().unwrap() - 0.2032).abs() < 1e-9);
    assert!((run["length"].as_f64().unwrap() - 13.0).abs() < 1e-9);
    assert!((run["slope"].as_f64().unwrap() - 1.0).abs() < 1e-9);

    let audit = exec_ok(
        &schema,
        &format!(r#"{{ utilityAudit(projectId: "{pid}") {{ action entityType }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let entries = audit["utilityAudit"].as_array().unwrap();
    assert!(entries
        .iter()
        .any(|e| e["action"] == "create" && e["entityType"] == "run"));
}

#[sqlx::test(migrations = "./migrations")]
async fn update_run_records_field_diff(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let rid = uuid_at(
        &create_run(&schema, admin_ctx(admin, org), pid).await,
        &["createUtilityRun", "id"],
    );

    let q = r#"mutation ($id: UUID!, $in: UtilityRunInput!) {
        updateUtilityRun(id: $id, input: $in) { material }
    }"#;
    let vars = serde_json::json!({ "id": rid, "in": { "material": "HDPE" } });
    let data = exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await;
    assert_eq!(data["updateUtilityRun"]["material"], "HDPE");

    let audit = exec_ok(
        &schema,
        &format!(r#"{{ utilityAudit(projectId: "{pid}", entityId: "{rid}") {{ action diff }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let update = audit["utilityAudit"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["action"] == "update")
        .expect("an update audit entry");
    let diff: serde_json::Value = serde_json::from_str(update["diff"].as_str().unwrap()).unwrap();
    assert_eq!(diff["material"]["before"], "PVC");
    assert_eq!(diff["material"]["after"], "HDPE");
}

#[sqlx::test(migrations = "./migrations")]
async fn soft_delete_hides_run_from_inventory(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let rid = uuid_at(
        &create_run(&schema, admin_ctx(admin, org), pid).await,
        &["createUtilityRun", "id"],
    );

    exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteUtilityRun(id: "{rid}") }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let inv = exec_ok(
        &schema,
        &format!(r#"{{ utilities(projectId: "{pid}") {{ runs {{ id }} }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(inv["utilities"]["runs"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn geometry_snapshot_survives_source_point_delete(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // A survey point we snap a vertex to.
    let (sp,): (Uuid,) = sqlx::query_as(
        "INSERT INTO survey_points (project_id, label, northing, easting, elevation, point_type) \
         VALUES ($1, 'P1', 10.0, 20.0, 1.0, 'design') RETURNING id",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let q = r#"mutation ($id: UUID!, $in: UtilityRunInput!, $v: [UtilityVertexInput!]!) {
        createUtilityRun(projectId: $id, input: $in, vertices: $v) { id }
    }"#;
    let vars = serde_json::json!({
        "id": pid,
        "in": { "typeKey": "sanitary_sewer" },
        "v": [
            { "northing": 10.0, "easting": 20.0, "elevation": 1.0, "sourcePointId": sp },
            { "northing": 11.0, "easting": 21.0, "elevation": 0.5 },
        ],
    });
    let rid = uuid_at(
        &exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await,
        &["createUtilityRun", "id"],
    );

    // Delete the source survey point.
    sqlx::query("DELETE FROM survey_points WHERE id = $1")
        .bind(sp)
        .execute(&pool)
        .await
        .unwrap();

    // The run's snapshotted geometry is intact; the soft link is cleared.
    let data = exec_ok(
        &schema,
        &format!(
            r#"{{ utility(id: "{rid}") {{ vertices {{ northing easting sourcePointId }} }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let v0 = &data["utility"]["vertices"][0];
    assert_eq!(v0["northing"].as_f64().unwrap(), 10.0);
    assert_eq!(v0["easting"].as_f64().unwrap(), 20.0);
    assert!(
        v0["sourcePointId"].is_null(),
        "soft link cleared on source delete"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn utilities_gated_to_crew(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await; // Solo
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let q = r#"mutation ($id: UUID!, $in: UtilityRunInput!, $v: [UtilityVertexInput!]!) {
        createUtilityRun(projectId: $id, input: $in, vertices: $v) { id }
    }"#;
    let vars = serde_json::json!({
        "id": pid,
        "in": { "typeKey": "water" },
        "v": [{ "northing": 0.0, "easting": 0.0 }, { "northing": 1.0, "easting": 1.0 }],
    });
    let err = exec_err_vars(&schema, q, vars, admin_ctx(admin, org)).await;
    assert!(err.contains("Crew"), "expected a Crew gate, got: {err}");
}

#[sqlx::test(migrations = "./migrations")]
async fn migration_seeds_apwa_type_catalog(pool: PgPool) {
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM utility_types")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        count >= 15,
        "expected the APWA type catalog seeded, got {count}"
    );

    // A known linear type and a known structure type exist with the right kind.
    let (line,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM utility_types WHERE key = 'water' AND default_geometry = 'line'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(line, 1);
    let (structure,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM utility_types WHERE key = 'manhole' AND default_geometry = 'structure'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(structure, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn audit_log_appends_field_level_diff(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let entity = Uuid::new_v4();
    let d = audit::diff(
        &serde_json::json!({}),
        &serde_json::json!({ "material": "PVC", "diameter": 8 }),
    );
    audit::log(&pool, pid, "run", entity, "create", Some(admin), &d)
        .await
        .unwrap();

    let (cnt,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM utility_audit \
         WHERE project_id = $1 AND entity_id = $2 AND action = 'create'",
    )
    .bind(pid)
    .bind(entity)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cnt, 1);

    // The field-level diff persisted as jsonb.
    let (diff,): (serde_json::Value,) =
        sqlx::query_as("SELECT diff FROM utility_audit WHERE entity_id = $1")
            .bind(entity)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(diff["material"]["after"], "PVC");
    assert_eq!(diff["diameter"]["after"], 8);
}

#[sqlx::test(migrations = "./migrations")]
async fn import_geojson_creates_runs_and_structures(pool: PgPool) {
    use base64::Engine as _;
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Projected-meter GeoJSON: a WATER line + a MANHOLE point.
    let geojson = r#"{"type":"FeatureCollection","features":[
        {"type":"Feature","properties":{"layer":"WATER","name":"W-1"},
         "geometry":{"type":"LineString","coordinates":[[0,0],[3,4]]}},
        {"type":"Feature","properties":{"layer":"MANHOLE"},
         "geometry":{"type":"Point","coordinates":[5,5]}}
    ]}"#;
    let b64 = base64::engine::general_purpose::STANDARD.encode(geojson);

    let q = r#"mutation ($id: UUID!, $c: String!, $m: [UtilityLayerMapping!]!) {
        importUtilities(projectId: $id, format: "geojson", contentBase64: $c, mappings: $m,
                        space: "projected", unit: METER) {
            runsCreated structuresCreated skipped
        }
    }"#;
    let vars = serde_json::json!({
        "id": pid, "c": b64,
        "m": [
            { "layer": "WATER", "kind": "line", "typeKey": "water" },
            { "layer": "MANHOLE", "kind": "point", "typeKey": "manhole" },
        ],
    });
    let data = exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await;
    let r = &data["importUtilities"];
    assert_eq!(r["runsCreated"], 1);
    assert_eq!(r["structuresCreated"], 1);
    assert_eq!(r["skipped"], 0);

    // Both land in the inventory with their mapped types (projected coords kept).
    let inv = exec_ok_vars(
        &schema,
        r#"query ($id: UUID!){ utilities(projectId:$id){
            runs{ typeKey label vertices{ seq easting northing } }
            structures{ typeKey easting northing } } }"#,
        serde_json::json!({ "id": pid }),
        admin_ctx(admin, org),
    )
    .await;
    let run = &inv["utilities"]["runs"][0];
    assert_eq!(run["typeKey"], "water");
    assert_eq!(run["label"], "W-1");
    assert_eq!(run["vertices"].as_array().unwrap().len(), 2);
    assert_eq!(run["vertices"][1]["easting"], 3.0);
    assert_eq!(inv["utilities"]["structures"][0]["typeKey"], "manhole");
    assert_eq!(inv["utilities"]["structures"][0]["easting"], 5.0);
}

#[sqlx::test(migrations = "./migrations")]
async fn preview_suggests_apwa_types(pool: PgPool) {
    use base64::Engine as _;
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let geojson = r#"{"type":"FeatureCollection","features":[
        {"type":"Feature","properties":{"layer":"SAN-SEWER"},
         "geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}}]}"#;
    let b64 = base64::engine::general_purpose::STANDARD.encode(geojson);
    let data = exec_ok_vars(
        &schema,
        r#"query ($id: UUID!, $c: String!){
            previewUtilityImport(projectId:$id, format:"geojson", contentBase64:$c){
                layers{ layer kind count suggestedType } } }"#,
        serde_json::json!({ "id": pid, "c": b64 }),
        admin_ctx(admin, org),
    )
    .await;
    let layer = &data["previewUtilityImport"]["layers"][0];
    assert_eq!(layer["layer"], "SAN-SEWER");
    assert_eq!(layer["kind"], "line");
    assert_eq!(layer["suggestedType"], "sanitary_sewer");
}
