//! Field Exchange — Phase 3: design/as-built separation + project tolerances.

use crate::common::*;

/// Inserts a survey point of the given `point_type` directly (bypasses the
/// design-only mutations so we can plant an as-built row before Phase 4 exists).
async fn insert_point(pool: &PgPool, project_id: Uuid, label: &str, point_type: &str) {
    sqlx::query(
        "INSERT INTO survey_points (project_id, label, northing, easting, elevation, point_type) \
         VALUES ($1, $2, 100.0, 200.0, 5.0, $3)",
    )
    .bind(project_id)
    .bind(label)
    .bind(point_type)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn as_built_points_are_hidden_from_design_surfaces(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await; // unlock export
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    insert_point(&pool, pid, "D1", "design").await;
    insert_point(&pool, pid, "AB1", "as_built").await;

    // Survey-points list + count show only the design point.
    let list = exec_ok(
        &schema,
        &format!(
            r#"{{ surveyPoints(projectId: "{pid}") {{ label }} surveyPointCount(projectId: "{pid}") }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let labels: Vec<&str> = list["surveyPoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, vec!["D1"], "list must exclude as-builts");
    assert_eq!(list["surveyPointCount"].as_i64().unwrap(), 1);

    // Scene data shows only the design point.
    let scene = exec_ok(
        &schema,
        &format!(r#"{{ sceneData(projectId: "{pid}") {{ surveyPoints {{ label }} }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let scene_labels: Vec<&str> = scene["sceneData"]["surveyPoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["label"].as_str().unwrap())
        .collect();
    assert_eq!(scene_labels, vec!["D1"], "scene must exclude as-builts");

    // Export contains the design point, not the as-built.
    let export = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let csv = export["exportPoints"].as_str().unwrap();
    assert!(csv.contains("D1"), "export must include design point");
    assert!(!csv.contains("AB1"), "export must exclude as-built point");

    // Field export (the new preset export) also excludes the as-built.
    let fx = exec_ok(
        &schema,
        &format!(
            r#"{{ exportField(projectId: "{pid}", presetId: "generic_csv") {{ contentBase64 }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let b64 = fx["exportField"]["contentBase64"].as_str().unwrap();
    let decoded = String::from_utf8(base64_decode(b64)).unwrap();
    assert!(decoded.contains("D1"));
    assert!(!decoded.contains("AB1"));
}

#[sqlx::test(migrations = "./migrations")]
async fn projects_get_default_tolerances(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let data = exec_ok(
        &schema,
        &format!(r#"{{ project(id: "{pid}") {{ tolHWarn tolHFail tolVWarn tolVFail }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let p = &data["project"];
    // Construction defaults (~0.05 ft warn / ~0.10 ft fail, in meters).
    assert!((p["tolHWarn"].as_f64().unwrap() - 0.01524).abs() < 1e-9);
    assert!((p["tolHFail"].as_f64().unwrap() - 0.03048).abs() < 1e-9);
    assert!((p["tolVWarn"].as_f64().unwrap() - 0.01524).abs() < 1e-9);
    assert!((p["tolVFail"].as_f64().unwrap() - 0.03048).abs() < 1e-9);
}

#[sqlx::test(migrations = "./migrations")]
async fn set_project_tolerances_updates_values(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await; // FieldExchange is Crew-gated
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let data = exec_ok(
        &schema,
        &format!(
            r#"mutation {{ setProjectTolerances(projectId: "{pid}", tolHWarn: 0.02, tolHFail: 0.04, tolVWarn: 0.03, tolVFail: 0.05) {{ tolHWarn tolHFail tolVWarn tolVFail }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let p = &data["setProjectTolerances"];
    assert_eq!(p["tolHWarn"].as_f64().unwrap(), 0.02);
    assert_eq!(p["tolHFail"].as_f64().unwrap(), 0.04);
    assert_eq!(p["tolVWarn"].as_f64().unwrap(), 0.03);
    assert_eq!(p["tolVFail"].as_f64().unwrap(), 0.05);
}

#[sqlx::test(migrations = "./migrations")]
async fn set_project_tolerances_gated_to_crew(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await; // Solo (unpaid)
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let err = exec_err(
        &schema,
        &format!(
            r#"mutation {{ setProjectTolerances(projectId: "{pid}", tolHWarn: 0.02, tolHFail: 0.04, tolVWarn: 0.03, tolVFail: 0.05) {{ tolHWarn }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert!(
        err.contains("Crew"),
        "expected a Crew-gate error, got: {err}"
    );
}

/// Minimal standard-base64 decode for asserting field-export contents.
fn base64_decode(s: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}
