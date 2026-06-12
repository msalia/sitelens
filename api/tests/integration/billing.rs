use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_crew_features(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);

    // First project is allowed on the Solo plan.
    let pid = create_project(&schema, auth.clone(), "Site 1").await;

    // A second project is blocked (Solo cap = 1 project).
    let second = r#"mutation { createProject(name: "Site 2", epsgCode: 2229, displayUnit: US_SURVEY_FOOT) { id } }"#;
    let msg = exec_err(&schema, second, Some(auth.clone())).await;
    assert!(
        msg.contains("Solo plan is limited to 1 project"),
        "got: {msg}"
    );

    // Exporting is blocked.
    let export = format!(
        r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
    );
    let msg = exec_err(&schema, &export, Some(auth.clone())).await;
    assert!(msg.contains("Crew feature"), "export not gated: {msg}");

    // DXF upload is blocked.
    let dxf = "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
    let up = r#"mutation ($id: UUID!, $c: String!) {
        uploadDxf(projectId: $id, filename: "p.dxf", content: $c) { id } }"#;
    let msg = exec_err_vars(
        &schema,
        up,
        serde_json::json!({ "id": pid, "c": dxf }),
        auth.clone(),
    )
    .await;
    assert!(msg.contains("Crew feature"), "dxf upload not gated: {msg}");

    // Overlays are hidden on the free tier (empty list, so the bundled scene
    // query still loads) — the upload path above is what carries the upgrade prompt.
    let view = format!(r#"{{ cadOverlays(projectId: "{pid}") {{ id }} }}"#);
    let data = exec_ok(&schema, &view, Some(auth)).await;
    assert_eq!(
        data["cadOverlays"].as_array().unwrap().len(),
        0,
        "free tier should see no overlays"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn free_tier_member_caps_enforced(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);

    // Five non-admin members are allowed.
    for i in 0..5 {
        let q = format!(
            r#"mutation {{ inviteUser(email: "m{i}@example.com", role: SURVEYOR) {{ user {{ id }} }} }}"#
        );
        exec_ok(&schema, &q, Some(auth.clone())).await;
    }
    // The sixth member is blocked.
    let sixth =
        r#"mutation { inviteUser(email: "m6@example.com", role: SURVEYOR) { user { id } } }"#;
    let msg = exec_err(&schema, sixth, Some(auth.clone())).await;
    assert!(msg.contains("up to 5 members"), "got: {msg}");

    // A second admin is blocked (Solo allows 1).
    let admin2 =
        r#"mutation { inviteUser(email: "admin2@example.com", role: ADMIN) { user { id } } }"#;
    let msg = exec_err(&schema, admin2, Some(auth)).await;
    assert!(msg.contains("allows 1 admin"), "got: {msg}");
}

#[sqlx::test(migrations = "./migrations")]
async fn paid_org_unlocks_crew_features(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Crew Co").await;
    set_paid(&pool, org).await;
    let auth = admin_ctx(admin, org);

    // Multiple projects + export are allowed once paid.
    create_project(&schema, auth.clone(), "Site 1").await;
    let pid = create_project(&schema, auth.clone(), "Site 2").await;
    let export = format!(
        r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
    );
    exec_ok(&schema, &export, Some(auth)).await;
}

#[sqlx::test(migrations = "./migrations")]
async fn billing_query_reflects_plan(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Co").await;
    let auth = admin_ctx(admin, org);

    let q = r#"{ billing { plan canExport restricted maxProjects maxNonAdmin projects admins adminEmails } }"#;
    let data = exec_ok(&schema, q, Some(auth.clone())).await;
    assert_eq!(data["billing"]["plan"], Json::String("solo".into()));
    assert_eq!(
        data["billing"]["adminEmails"],
        serde_json::json!(["a@example.com"]),
        "non-admins should be able to reach the org admin"
    );
    assert_eq!(data["billing"]["canExport"], Json::Bool(false));
    assert_eq!(data["billing"]["restricted"], Json::Bool(false));
    assert_eq!(data["billing"]["maxProjects"].as_i64().unwrap(), 1);
    assert_eq!(data["billing"]["maxNonAdmin"].as_i64().unwrap(), 5);
    assert_eq!(data["billing"]["admins"].as_i64().unwrap(), 1);

    set_paid(&pool, org).await;
    let data = exec_ok(&schema, q, Some(auth)).await;
    assert_eq!(data["billing"]["plan"], Json::String("crew".into()));
    assert_eq!(data["billing"]["canExport"], Json::Bool(true));
    assert_eq!(data["billing"]["maxProjects"].as_i64().unwrap(), -1);
    assert_eq!(data["billing"]["maxNonAdmin"].as_i64().unwrap(), -1);
}

#[sqlx::test(migrations = "./migrations")]
async fn lapsed_subscription_is_read_only(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Co").await;
    let auth = admin_ctx(admin, org);

    // While paid, build two projects (over the Solo cap).
    set_paid(&pool, org).await;
    create_project(&schema, auth.clone(), "Site 1").await;
    let pid = create_project(&schema, auth.clone(), "Site 2").await;

    // Subscription lapses: now over the caps AND unpaid => read-only.
    sqlx::query("UPDATE orgs SET subscription_status = 'canceled' WHERE id = $1")
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();

    // The billing query reports the restricted state.
    let data = exec_ok(
        &schema,
        r#"{ billing { plan restricted } }"#,
        Some(auth.clone()),
    )
    .await;
    assert_eq!(data["billing"]["plan"], Json::String("solo".into()));
    assert_eq!(data["billing"]["restricted"], Json::Bool(true));

    // Reads still work...
    exec_ok(
        &schema,
        &format!(r#"{{ project(id: "{pid}") {{ id }} }}"#),
        Some(auth.clone()),
    )
    .await;

    // ...but edits are blocked.
    let edit = format!(r#"mutation {{ updateProject(id: "{pid}", name: "x") {{ id }} }}"#);
    let msg = exec_err(&schema, &edit, Some(auth)).await;
    assert!(msg.contains("read-only"), "got: {msg}");
}

// Guard against *over*-gating: a free Solo org must still be able to fully use
// its one project — every editor action below goes through `require_editor_active`,
// which must NOT block a non-restricted free org.
#[sqlx::test(migrations = "./migrations")]
async fn free_tier_can_fully_use_its_one_project(pool: PgPool) {
    let schema = schema(pool);
    let (_admin, org, _) = signup(&schema, "a@example.com", "Solo Co").await;
    let auth = admin_ctx(_admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;

    // Control points, grid, and survey points all succeed on the free tier.
    add_cp(&schema, auth.clone(), pid, "CP1", 2000.0, 1000.0, 0.0, 0.0).await;
    let grid = format!(
        r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [{{ family: LETTERED, label: "A", position: 0.0 }}]) {{ id }} }}"#
    );
    exec_ok(&schema, &grid, Some(auth.clone())).await;
    let pt = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "P1", space: PROJECTED, x: 200.0, y: 100.0, unit: METER) {{ id }} }}"#
    );
    exec_ok(&schema, &pt, Some(auth)).await;
}

// The .slx project export is a Crew feature too (no exports on Solo).
#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_project_export(pool: PgPool) {
    let schema = schema(pool.clone());
    let (_admin, org, _) = signup(&schema, "a@example.com", "Co").await;
    let auth = admin_ctx(_admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;

    let q = format!(r#"{{ projectExport(projectId: "{pid}") }}"#);
    let msg = exec_err(&schema, &q, Some(auth.clone())).await;
    assert!(
        msg.contains("Crew feature"),
        "project export not gated: {msg}"
    );

    // Once paid, the same export succeeds.
    set_paid(&pool, org).await;
    exec_ok(&schema, &q, Some(auth)).await;
}

// Promoting a member to admin is an admin-cap action: blocked on Solo (1 admin).
#[sqlx::test(migrations = "./migrations")]
async fn free_tier_blocks_promoting_member_to_admin(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "admin@example.com", "Co").await;
    let auth = admin_ctx(admin, org);
    let member = invite(&schema, auth.clone(), "m@example.com", "SURVEYOR").await;

    let promote =
        format!(r#"mutation {{ updateUserRole(userId: "{member}", role: ADMIN) {{ id }} }}"#);
    let msg = exec_err(&schema, &promote, Some(auth)).await;
    assert!(msg.contains("allows 1 admin"), "got: {msg}");
}

// A restricted (lapsed, over-cap) org must still be able to reach the upgrade
// path — billing mutations are intentionally NOT blocked by the read-only gate.
// With Stripe unconfigured in tests, the error is the config error, never the
// read-only lock (which would mean upgrade is impossible).
#[sqlx::test(migrations = "./migrations")]
async fn restricted_org_can_still_reach_upgrade(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Co").await;
    let auth = admin_ctx(admin, org);

    // Become paid, exceed the Solo project cap, then lapse → restricted.
    set_paid(&pool, org).await;
    create_project(&schema, auth.clone(), "Site 1").await;
    create_project(&schema, auth.clone(), "Site 2").await;
    sqlx::query("UPDATE orgs SET subscription_status = 'canceled' WHERE id = $1")
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();
    assert!(org_billing(&pool, org).await.unwrap().restricted());

    // The checkout mutation is reachable (fails only because Stripe isn't
    // configured in tests) — it is NOT blocked by the read-only lock.
    let msg = exec_err(
        &schema,
        r#"mutation { createCheckoutSession(interval: MONTHLY) }"#,
        Some(auth),
    )
    .await;
    assert!(
        msg.contains("not configured") && !msg.contains("read-only"),
        "upgrade path should stay open for restricted orgs: {msg}"
    );
}
