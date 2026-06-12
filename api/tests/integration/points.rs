use crate::common::*;

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
async fn add_survey_point_inserts_a_single_point(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Projected input: x = easting, y = northing (meters).
    let q = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "P1", space: PROJECTED, x: 200.0, y: 100.0, unit: METER) {{ label northing easting }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    assert_eq!(data["addSurveyPoint"]["label"], serde_json::json!("P1"));
    // METER projected input is stored as-is (meters).
    assert_eq!(data["addSurveyPoint"]["northing"], serde_json::json!(100.0));
    assert_eq!(data["addSurveyPoint"]["easting"], serde_json::json!(200.0));

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM survey_points WHERE project_id = $1")
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn add_survey_point_geographic_is_converted_and_stored(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Geographic input (LA, in the project's California zone): x = lon, y = lat.
    let q = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "G1", space: GEOGRAPHIC, x: -118.2, y: 34.0, unit: METER) {{ easting northing }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    let e = data["addSurveyPoint"]["easting"].as_f64().unwrap();
    let n = data["addSurveyPoint"]["northing"].as_f64().unwrap();
    assert!(e.is_finite() && n.is_finite() && (e != 0.0 || n != 0.0));

    // Round-trip the stored projected value back to geographic — it returns the
    // input lat/lon, confirming the geographic input was converted correctly.
    let conv = format!(
        r#"{{ convertCoordinate(projectId: "{pid}", space: PROJECTED, x: {e}, y: {n}, unit: METER) {{ latitude longitude }} }}"#
    );
    let cdata = exec_ok(&schema, &conv, Some(admin_ctx(admin, org))).await;
    assert!((cdata["convertCoordinate"]["latitude"].as_f64().unwrap() - 34.0).abs() < 1e-6);
    assert!((cdata["convertCoordinate"]["longitude"].as_f64().unwrap() + 118.2).abs() < 1e-6);
}

#[sqlx::test(migrations = "./migrations")]
async fn add_survey_point_grid_requires_a_transform(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // No transform solved yet → a building-grid point can't be placed.
    let q = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "GR", space: GRID, x: 10.0, y: 20.0, unit: METER) {{ easting }} }}"#
    );
    let err = exec_err(&schema, &q, Some(admin_ctx(admin, org))).await;
    assert!(err.to_lowercase().contains("transform"), "got: {err}");
}

#[sqlx::test(migrations = "./migrations")]
async fn add_survey_point_grid_uses_the_solved_transform(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Identity scale/rotation, translation E=100, N=200: grid (gx,gy) → (gx+100, gy+200).
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
    exec_ok(
        &schema,
        &format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;

    // Grid (10, 20) → projected easting 110, northing 220.
    let q = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "GR", space: GRID, x: 10.0, y: 20.0, unit: METER) {{ easting northing }} }}"#
    );
    let data = exec_ok(&schema, &q, Some(admin_ctx(admin, org))).await;
    assert!((data["addSurveyPoint"]["easting"].as_f64().unwrap() - 110.0).abs() < 1e-6);
    assert!((data["addSurveyPoint"]["northing"].as_f64().unwrap() - 220.0).abs() < 1e-6);
}
