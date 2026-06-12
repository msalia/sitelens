use crate::common::*;

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
