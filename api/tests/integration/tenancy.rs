use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn cross_org_isolation_comprehensive(pool: PgPool) {
    let schema = schema(pool.clone());
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;
    // Both paid so the cross-org checks (not entitlement gates) are what fire.
    set_paid(&pool, a_org).await;
    set_paid(&pool, b_org).await;
    let a = admin_ctx(a_admin, a_org);
    let b = admin_ctx(b_admin, b_org);

    // Org A builds a project with a control point and an imported survey point.
    let pid = create_project(&schema, a.clone(), "A Site").await;
    let cp_q = format!(
        r#"mutation {{ addControlPoint(projectId: "{pid}", label: "CP1", northing: 1000.0, easting: 2000.0, gridX: 0.0, gridY: 0.0, unit: METER) {{ id }} }}"#
    );
    exec_ok(&schema, &cp_q, Some(a.clone())).await;
    let imp = r#"mutation ($id: UUID!, $c: String!, $m: CsvMappingInput!) {
        importPoints(projectId: $id, format: CSV, content: $c, unit: METER, mapping: $m) { rowCount } }"#;
    let imp_vars = serde_json::json!({
        "id": pid, "c": "P,N,E\nPT1,1,1\n",
        "m": { "hasHeader": true, "labelCol": 0, "northingCol": 1, "eastingCol": 2 }
    });
    exec_ok_vars(&schema, imp, imp_vars, a.clone()).await;
    let pts = exec_ok(
        &schema,
        &format!(r#"{{ surveyPoints(projectId: "{pid}") {{ id }} }}"#),
        Some(a.clone()),
    )
    .await;
    let a_point_id = uuid_at(&pts["surveyPoints"][0], &["id"]);

    // Every project-scoped read is denied for Org B.
    let reads = [
        format!(r#"{{ gridAxes(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ controlPoints(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ surveyPoints(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ surveyPointCount(projectId: "{pid}") }}"#),
        format!(r#"{{ transform(projectId: "{pid}") {{ scale }} }}"#),
        format!(r#"{{ cadOverlays(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ importBatches(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ importProfiles(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ pointGroups(projectId: "{pid}") {{ id }} }}"#),
        format!(r#"{{ sceneData(projectId: "{pid}") {{ origin {{ latitude }} }} }}"#),
        format!(
            r#"{{ convertCoordinate(projectId: "{pid}", space: PROJECTED, x: 1.0, y: 2.0, unit: METER) {{ latitude }} }}"#
        ),
        format!(
            r#"{{ exportPoints(projectId: "{pid}", format: CSV, space: PROJECTED_GRID, unit: METER) }}"#
        ),
    ];
    for q in &reads {
        let msg = exec_err(&schema, q, Some(b.clone())).await;
        assert!(
            msg.contains("not found"),
            "read leaked across orgs: {q}\n=> {msg}"
        );
    }

    // Every project-scoped mutation is denied for Org B.
    let mutations = [
        format!(r#"mutation {{ updateProject(id: "{pid}", name: "hijacked") {{ id }} }}"#),
        format!(
            r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [{{ family: LETTERED, label: "A", position: 0.0 }}]) {{ id }} }}"#
        ),
        format!(
            r#"mutation {{ addControlPoint(projectId: "{pid}", label: "X", northing: 1.0, easting: 1.0, unit: METER) {{ id }} }}"#
        ),
        format!(r#"mutation {{ solveTransform(projectId: "{pid}") {{ scale }} }}"#),
        format!(
            r#"mutation {{ createPointGroup(projectId: "{pid}", name: "g", memberIds: []) {{ id }} }}"#
        ),
        format!(r#"mutation {{ deleteSurveyPoint(id: "{a_point_id}") }}"#),
    ];
    for q in &mutations {
        let msg = exec_err(&schema, q, Some(b.clone())).await;
        assert!(
            msg.contains("not found"),
            "mutation crossed orgs: {q}\n=> {msg}"
        );
    }

    // The project itself is invisible to Org B (null, not an error).
    let proj = exec_ok(
        &schema,
        &format!(r#"{{ project(id: "{pid}") {{ id }} }}"#),
        Some(b.clone()),
    )
    .await;
    assert!(proj["project"].is_null(), "Org B can see Org A's project");

    // Org A's own data is still intact and accessible.
    let still = exec_ok(
        &schema,
        &format!(r#"{{ surveyPointCount(projectId: "{pid}") }}"#),
        Some(a),
    )
    .await;
    assert_eq!(still["surveyPointCount"].as_i64().unwrap(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn tenancy_isolation_between_orgs(pool: PgPool) {
    let schema = schema(pool);
    let (a_admin, a_org, _) = signup(&schema, "admin-a@example.com", "Org A").await;
    let (_b_admin, _b_org, _) = signup(&schema, "admin-b@example.com", "Org B").await;

    // Org A admin invites a second user into Org A.
    let invite_q = r#"mutation { inviteUser(email: "tech-a@example.com", role: SURVEYOR) { user { id } inviteToken } }"#;
    exec_ok(&schema, invite_q, Some(admin_ctx(a_admin, a_org))).await;

    // Org A admin sees only Org A users (the admin + invitee), never Org B's.
    let data = exec_ok(
        &schema,
        "{ users { email orgId } }",
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    let users = data["users"].as_array().unwrap();
    assert_eq!(users.len(), 2, "Org A should see exactly its 2 users");
    for u in users {
        assert_eq!(uuid_at(u, &["orgId"]), a_org, "leaked a cross-org user");
        assert!(u["email"].as_str().unwrap().ends_with("-a@example.com"));
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_organization_removes_everything_and_isolates_other_orgs(pool: PgPool) {
    let schema = schema(pool.clone());
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;

    // Org A: a project + an invited user. Org B: a project (to prove isolation).
    let a_pid = create_project(&schema, admin_ctx(a_admin, a_org), "A Site").await;
    exec_ok(
        &schema,
        r#"mutation { inviteUser(email: "tech@a.com", role: SURVEYOR) { user { id } } }"#,
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    let b_pid = create_project(&schema, admin_ctx(b_admin, b_org), "B Site").await;

    // Non-admins cannot delete the organization.
    let viewer = AuthContext {
        user_id: a_admin,
        org_id: a_org,
        role: Role::Viewer,
    };
    let err = exec_err(&schema, "mutation { deleteOrganization }", Some(viewer)).await;
    assert!(
        err.to_lowercase().contains("admin"),
        "expected admin guard: {err}"
    );

    // Admin deletes Org A.
    let data = exec_ok(
        &schema,
        "mutation { deleteOrganization }",
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    assert_eq!(data["deleteOrganization"].as_bool(), Some(true));

    // Org A: org row, users, and projects are all gone.
    for (q, id) in [
        ("SELECT count(*) FROM orgs WHERE id = $1", a_org),
        ("SELECT count(*) FROM users WHERE org_id = $1", a_org),
        ("SELECT count(*) FROM projects WHERE id = $1", a_pid),
    ] {
        let count: i64 = sqlx::query_scalar(q)
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    // Org B is completely untouched.
    let b_proj: i64 = sqlx::query_scalar("SELECT count(*) FROM projects WHERE id = $1")
        .bind(b_pid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(b_proj, 1);
    let b_users: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE org_id = $1")
        .bind(b_org)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(b_users, 1);
}
