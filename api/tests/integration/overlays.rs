use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn dxf_overlay_upload_georef_delete(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await; // DXF overlays are a Crew feature
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n";
    let up = r#"mutation ($id: UUID!, $c: String!) {
        uploadDxf(projectId: $id, filename: "plan.dxf", content: $c) { id originalFilename assumeRealWorld visible }
    }"#;
    let data = exec_ok_vars(
        &schema,
        up,
        serde_json::json!({ "id": pid, "c": dxf }),
        admin_ctx(admin, org),
    )
    .await;
    let oid = uuid_at(&data, &["uploadDxf", "id"]);
    assert_eq!(
        data["uploadDxf"]["originalFilename"],
        Json::String("plan.dxf".into())
    );
    assert_eq!(data["uploadDxf"]["assumeRealWorld"], Json::Bool(true));

    // Content round-trips through storage.
    let content = exec_ok(
        &schema,
        &format!(r#"{{ cadOverlayContent(id: "{oid}") }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert!(content["cadOverlayContent"]
        .as_str()
        .unwrap()
        .contains("ENTITIES"));

    // Georeference update.
    let geo = format!(
        r#"mutation {{ setCadGeoreference(id: "{oid}", offsetE: 5, rotationDeg: 90, scale: 2, visible: false) {{ offsetE rotationDeg scale visible }} }}"#
    );
    let g = exec_ok(&schema, &geo, Some(admin_ctx(admin, org))).await;
    assert_eq!(g["setCadGeoreference"]["offsetE"].as_f64().unwrap(), 5.0);
    assert_eq!(
        g["setCadGeoreference"]["rotationDeg"].as_f64().unwrap(),
        90.0
    );
    assert_eq!(g["setCadGeoreference"]["visible"], Json::Bool(false));

    // List then delete.
    let list = exec_ok(
        &schema,
        &format!(r#"{{ cadOverlays(projectId: "{pid}") {{ id }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert_eq!(list["cadOverlays"].as_array().unwrap().len(), 1);

    let del = format!(r#"mutation {{ deleteCadOverlay(id: "{oid}") }}"#);
    assert_eq!(
        exec_ok(&schema, &del, Some(admin_ctx(admin, org))).await["deleteCadOverlay"],
        Json::Bool(true)
    );
}
