use crate::common::*;

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
