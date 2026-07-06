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

fn b64(s: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(s)
}

/// Inserts a design point directly, returning its id (canonical meters).
async fn insert_design(
    pool: &PgPool,
    pid: Uuid,
    label: &str,
    n: f64,
    e: f64,
    z: Option<f64>,
    category_id: Option<Uuid>,
) -> Uuid {
    let (id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO survey_points (project_id, label, northing, easting, elevation, point_type, category_id) \
         VALUES ($1, $2, $3, $4, $5, 'design', $6) RETURNING id",
    )
    .bind(pid)
    .bind(label)
    .bind(n)
    .bind(e)
    .bind(z)
    .bind(category_id)
    .fetch_one(pool)
    .await
    .unwrap();
    id
}

/// A project with combined_scale_factor pinned to 1.0 so grid == ground and
/// deltas are exact. Returns (pid,).
async fn project_csf1(schema: &ApiSchema, pool: &PgPool, admin: Uuid, org: Uuid) -> Uuid {
    let pid = create_project(schema, admin_ctx(admin, org), "Site").await;
    sqlx::query("UPDATE projects SET combined_scale_factor = 1.0 WHERE id = $1")
        .bind(pid)
        .execute(pool)
        .await
        .unwrap();
    pid
}

const FRIENDLY_TOL: &str = r#"{"hWarn":0.05,"hFail":0.10,"vWarn":0.05,"vFail":0.10}"#;

/// Imports an as-built CSV (generic_csv preset, projected-grid meters) and returns
/// the new batch id.
async fn import_csv(schema: &ApiSchema, ctx: AuthContext, pid: Uuid, csv: &str) -> Uuid {
    let q = r#"mutation ($id: UUID!, $c: String!, $tol: ToleranceInput) {
        importAsBuilt(projectId: $id, contentBase64: $c, format: CSV, presetId: "generic_csv",
                      space: PROJECTED_GRID, unit: METER, tolOverride: $tol) { id }
    }"#;
    let vars = serde_json::json!({
        "id": pid,
        "c": b64(csv),
        "tol": serde_json::from_str::<serde_json::Value>(FRIENDLY_TOL).unwrap(),
    });
    let data = exec_ok_vars(schema, q, vars, ctx).await;
    uuid_at(&data, &["importAsBuilt", "id"])
}

#[sqlx::test(migrations = "./migrations")]
async fn import_as_built_matches_and_computes_deltas(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = project_csf1(&schema, &pool, admin, org).await;
    insert_design(&pool, pid, "1", 100.0, 200.0, Some(5.0), None).await;
    insert_design(&pool, pid, "2", 0.0, 0.0, Some(0.0), None).await;

    // "1" exact → pass; "2" 0.08m north → warn; "9" no match → unmatched.
    let csv = "Point,Northing,Easting,Elevation,Code\n1,100.0,200.0,5.0,\n2,0.08,0.0,0.0,\n9,50.0,50.0,,\n";
    let bid = import_csv(&schema, admin_ctx(admin, org), pid, csv).await;

    let data = exec_ok(
        &schema,
        &format!(
            r#"{{ comparison(batchId: "{bid}") {{
                summary {{ pass warn fail unmatched noVertical maxMiss }}
                rows {{ asBuiltLabel status designPointId deltaN deltaHRadial }}
            }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let sum = &data["comparison"]["summary"];
    assert_eq!(sum["pass"].as_i64().unwrap(), 1);
    assert_eq!(sum["warn"].as_i64().unwrap(), 1);
    assert_eq!(sum["unmatched"].as_i64().unwrap(), 1);

    let rows = data["comparison"]["rows"].as_array().unwrap();
    let row = |label: &str| rows.iter().find(|r| r["asBuiltLabel"] == label).unwrap();
    assert_eq!(row("1")["status"], "PASS");
    assert!(row("1")["designPointId"].is_string());
    assert!((row("1")["deltaHRadial"].as_f64().unwrap()).abs() < 1e-9);
    assert_eq!(row("2")["status"], "WARN");
    assert!((row("2")["deltaN"].as_f64().unwrap() - 0.08).abs() < 1e-9);
    assert_eq!(row("9")["status"], "UNMATCHED");
    assert!(row("9")["designPointId"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn comparison_snapshot_is_immutable(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = project_csf1(&schema, &pool, admin, org).await;
    let design_id = insert_design(&pool, pid, "1", 100.0, 200.0, Some(5.0), None).await;

    let csv = "Point,Northing,Easting,Elevation,Code\n1,100.0,200.0,5.0,\n";
    let bid = import_csv(&schema, admin_ctx(admin, org), pid, csv).await;

    // Move the design point AFTER the comparison was snapshotted.
    sqlx::query("UPDATE survey_points SET northing = 999.0 WHERE id = $1")
        .bind(design_id)
        .execute(&pool)
        .await
        .unwrap();

    let data = exec_ok(
        &schema,
        &format!(r#"{{ comparison(batchId: "{bid}") {{ rows {{ designN deltaN status }} }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let r = &data["comparison"]["rows"][0];
    // Snapshot still reflects the original design coords, not the moved value.
    assert!((r["designN"].as_f64().unwrap() - 100.0).abs() < 1e-9);
    assert_eq!(r["status"], "PASS");
}

#[sqlx::test(migrations = "./migrations")]
async fn manual_repair_repairs_an_unmatched_row(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = project_csf1(&schema, &pool, admin, org).await;
    let design_id = insert_design(&pool, pid, "1", 100.0, 200.0, Some(5.0), None).await;

    // As-built "99" doesn't match any design number → unmatched.
    let csv = "Point,Northing,Easting,Elevation,Code\n99,100.0,200.0,5.0,\n";
    let bid = import_csv(&schema, admin_ctx(admin, org), pid, csv).await;

    let before = exec_ok(
        &schema,
        &format!(r#"{{ comparison(batchId: "{bid}") {{ rows {{ id status }} }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(before["comparison"]["rows"][0]["status"], "UNMATCHED");
    let comp_id = Uuid::parse_str(before["comparison"]["rows"][0]["id"].as_str().unwrap()).unwrap();

    // Manually pair "99" to design "1" (exact coords → pass).
    let q = format!(
        r#"mutation {{ repairComparison(batchId: "{bid}", asBuiltCompId: "{comp_id}", designPointId: "{design_id}") {{ status matchMethod designPointId }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    let r = &data["repairComparison"];
    assert_eq!(r["status"], "PASS");
    assert_eq!(r["matchMethod"], "MANUAL");
    assert_eq!(
        uuid_at(&data, &["repairComparison", "designPointId"]),
        design_id
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn baseline_category_scope_limits_matches(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = project_csf1(&schema, &pool, admin, org).await;

    // A seeded category to scope by.
    let (cat,): (Uuid,) =
        sqlx::query_as("SELECT id FROM point_categories WHERE org_id = $1 LIMIT 1")
            .bind(org)
            .fetch_one(&pool)
            .await
            .unwrap();
    insert_design(&pool, pid, "1", 0.0, 0.0, Some(0.0), Some(cat)).await; // in scope
    insert_design(&pool, pid, "2", 0.0, 0.0, Some(0.0), None).await; // out of scope

    let csv = "Point,Northing,Easting,Elevation,Code\n1,0.0,0.0,0.0,\n2,0.0,0.0,0.0,\n";
    let q = r#"mutation ($id: UUID!, $c: String!, $ref: UUID!) {
        importAsBuilt(projectId: $id, contentBase64: $c, format: CSV, presetId: "generic_csv",
                      space: PROJECTED_GRID, unit: METER,
                      baselineScope: CATEGORY, baselineRefId: $ref) { id }
    }"#;
    let vars = serde_json::json!({ "id": pid, "c": b64(csv), "ref": cat });
    let bid = uuid_at(
        &exec_ok_vars(&schema, q, vars, admin_ctx(admin, org)).await,
        &["importAsBuilt", "id"],
    );

    let data = exec_ok(
        &schema,
        &format!(r#"{{ comparison(batchId: "{bid}") {{ rows {{ asBuiltLabel status }} }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let rows = data["comparison"]["rows"].as_array().unwrap();
    let row = |label: &str| rows.iter().find(|r| r["asBuiltLabel"] == label).unwrap();
    // "1" is in the scoped category → matched; "2" is outside → unmatched.
    assert_ne!(row("1")["status"], "UNMATCHED");
    assert_eq!(row("2")["status"], "UNMATCHED");
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_as_built_batch_removes_it(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = project_csf1(&schema, &pool, admin, org).await;
    insert_design(&pool, pid, "1", 0.0, 0.0, Some(0.0), None).await;
    let csv = "Point,Northing,Easting,Elevation,Code\n1,0.0,0.0,0.0,\n";
    let bid = import_csv(&schema, admin_ctx(admin, org), pid, csv).await;

    let del = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteAsBuiltBatch(batchId: "{bid}") }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(del["deleteAsBuiltBatch"], true);

    let list = exec_ok(
        &schema,
        &format!(r#"{{ asBuiltBatches(projectId: "{pid}") {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(list["asBuiltBatches"].as_array().unwrap().len(), 0);
}
