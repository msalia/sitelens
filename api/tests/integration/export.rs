use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn export_points_csv_and_landxml(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await; // exporting is a Crew feature
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Import two points in meters.
    let content = "P,N,E,Z,D\n1,1000,2000,5,MON\n2,1001,2001,,IP\n";
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount }
    }"#;
    exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({ "id": pid, "c": content,
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2, "elevationCol": 3, "descriptionCol": 4 } }),
        admin_ctx(admin, org),
    )
    .await;

    // CSV export (projected grid, meters, default PNEZD).
    let csv_q = format!(
        r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
    );
    let csv = exec_ok(&schema, &csv_q, Some(admin_ctx(admin, org))).await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(csv.contains("Point,Northing,Easting,Elevation,Description"));
    assert!(csv.contains("1,1000.0000,2000.0000,5.0000,MON"));

    // LandXML export.
    let xml_q = format!(
        r#"{{ exportPoints(projectId: "{pid}", format: LANDXML, space: PROJECTED_GRID, unit: METER) }}"#
    );
    let xml = exec_ok(&schema, &xml_q, Some(admin_ctx(admin, org))).await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(xml.contains("<CgPoint"));
    assert!(xml.contains("1000 2000 5"));
}

#[sqlx::test(migrations = "./migrations")]
async fn export_respects_columns_space_and_category_filter(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await; // exporting is a Crew feature
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount } }"#;
    exec_ok_vars(
        &schema,
        imp,
        serde_json::json!({
            "id": pid, "c": "P,N,E\nA,1000,2000\nB,1001,2001\n",
            "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
        }),
        admin_ctx(admin, org),
    )
    .await;

    // A chosen column subset/order — no Elevation/Description columns.
    let subset = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER, columns: [POINT, EASTING, NORTHING]) }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    let header = subset.lines().next().unwrap();
    assert_eq!(header, "Point,Easting,Northing");
    assert!(!subset.contains("Elevation"));

    // Geographic space emits lat/long columns with real values.
    let geo = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: GEOGRAPHIC, unit: METER, columns: [POINT, LATITUDE, LONGITUDE]) }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(geo.lines().next().unwrap(), "Point,Latitude,Longitude");
    assert_eq!(geo.lines().filter(|l| !l.trim().is_empty()).count(), 3); // header + 2

    // Filtering by an empty category yields only the header.
    let cat = exec_ok(
        &schema,
        r##"mutation { createCategory(name: "Empty", color: "#000", icon: "e") { id } }"##,
        Some(admin_ctx(admin, org)),
    )
    .await;
    let cat_id = uuid_at(&cat, &["createCategory", "id"]);
    let filtered = exec_ok(
        &schema,
        &format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER, categoryId: "{cat_id}") }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await["exportPoints"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(filtered.lines().filter(|l| !l.trim().is_empty()).count(), 1);
    assert!(!filtered.contains(",1000,") && !filtered.contains('A'));
}
