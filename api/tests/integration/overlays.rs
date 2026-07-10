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

#[sqlx::test(migrations = "./migrations")]
async fn align_cad_overlay_solves_offset_rotation_scale(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "align@example.com", "Org").await;
    set_paid(&pool, org).await; // DXF overlays are a Crew feature
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Upload a DXF — it starts at the identity transform (offset 0, scale 1, rot 0).
    let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0\n20\n0\n11\n1\n21\n0\n0\nENDSEC\n0\nEOF\n";
    let up = r#"mutation ($id: UUID!, $c: String!) {
        uploadDxf(projectId: $id, filename: "plan.dxf", content: $c) { id }
    }"#;
    let data = exec_ok_vars(
        &schema,
        up,
        serde_json::json!({ "id": pid, "c": dxf }),
        admin_ctx(admin, org),
    )
    .await;
    let oid = uuid_at(&data, &["uploadDxf", "id"]);

    // Two drawing vertices (current world = drawing coords under identity) mapped
    // onto two grid intersections that imply a 90° rotation + 2× scale:
    //   (1,0)->(5,5), (0,1)->(3,3)  ⇒  offset (5,3), scale 2, rotation 90°.
    let align = r#"mutation ($id: UUID!, $src: [AlignPoint!]!, $dst: [AlignPoint!]!) {
        alignCadOverlay(id: $id, src: $src, dst: $dst) { offsetE offsetN rotationDeg scale }
    }"#;
    let r = exec_ok_vars(
        &schema,
        align,
        serde_json::json!({
            "id": oid,
            "src": [{ "e": 1.0, "n": 0.0 }, { "e": 0.0, "n": 1.0 }],
            "dst": [{ "e": 5.0, "n": 5.0 }, { "e": 3.0, "n": 3.0 }],
        }),
        admin_ctx(admin, org),
    )
    .await;
    let a = &r["alignCadOverlay"];
    assert!(
        (a["offsetE"].as_f64().unwrap() - 5.0).abs() < 1e-6,
        "offsetE {a}"
    );
    assert!(
        (a["offsetN"].as_f64().unwrap() - 3.0).abs() < 1e-6,
        "offsetN {a}"
    );
    assert!(
        (a["scale"].as_f64().unwrap() - 2.0).abs() < 1e-6,
        "scale {a}"
    );
    assert!(
        (a["rotationDeg"].as_f64().unwrap() - 90.0).abs() < 1e-6,
        "rot {a}"
    );

    // Degenerate (coincident source points) is rejected.
    let msg = exec_err_vars(
        &schema,
        align,
        serde_json::json!({
            "id": oid,
            "src": [{ "e": 1.0, "n": 1.0 }, { "e": 1.0, "n": 1.0 }],
            "dst": [{ "e": 5.0, "n": 5.0 }, { "e": 3.0, "n": 3.0 }],
        }),
        admin_ctx(admin, org),
    )
    .await;
    assert!(msg.contains("coincide"), "expected degenerate error: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn align_handles_large_projected_coordinates(pool: PgPool) {
    // Regression: DXF picks are large projected-world coords (~1e6). Two points a
    // few meters apart at that magnitude used to trip the Helmert rank check as a
    // false "degenerate"; centering the source keeps the solve well-conditioned.
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "big@example.com", "Org").await;
    set_paid(&pool, org).await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0\n20\n0\n11\n1\n21\n0\n0\nENDSEC\n0\nEOF\n";
    let up = r#"mutation ($id: UUID!, $c: String!) { uploadDxf(projectId: $id, filename: "p.dxf", content: $c) { id } }"#;
    let data = exec_ok_vars(
        &schema,
        up,
        serde_json::json!({ "id": pid, "c": dxf }),
        admin_ctx(admin, org),
    )
    .await;
    let oid = uuid_at(&data, &["uploadDxf", "id"]);

    // Two points 10 m apart near a UTM origin, mapped onto themselves ⇒ identity.
    let align = r#"mutation ($id: UUID!, $src: [AlignPoint!]!, $dst: [AlignPoint!]!) {
        alignCadOverlay(id: $id, src: $src, dst: $dst) { offsetE offsetN rotationDeg scale }
    }"#;
    let r = exec_ok_vars(
        &schema,
        align,
        serde_json::json!({
            "id": oid,
            "src": [{ "e": 500000.0, "n": 4000000.0 }, { "e": 500010.0, "n": 4000000.0 }],
            "dst": [{ "e": 500000.0, "n": 4000000.0 }, { "e": 500010.0, "n": 4000000.0 }],
        }),
        admin_ctx(admin, org),
    )
    .await;
    let a = &r["alignCadOverlay"];
    assert!(
        (a["scale"].as_f64().unwrap() - 1.0).abs() < 1e-6,
        "scale {a}"
    );
    assert!(a["rotationDeg"].as_f64().unwrap().abs() < 1e-6, "rot {a}");
    assert!(a["offsetE"].as_f64().unwrap().abs() < 1e-3, "offsetE {a}");
    assert!(a["offsetN"].as_f64().unwrap().abs() < 1e-3, "offsetN {a}");
}
