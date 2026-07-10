use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn project_crud_is_org_scoped(pool: PgPool) {
    let schema = schema(pool);
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;

    let pid = create_project(&schema, admin_ctx(a_admin, a_org), "Tower A").await;

    // Org A sees its project; Org B sees none and cannot read it by id.
    let data = exec_ok(
        &schema,
        "{ projects { id } }",
        Some(admin_ctx(a_admin, a_org)),
    )
    .await;
    assert_eq!(data["projects"].as_array().unwrap().len(), 1);
    let data = exec_ok(
        &schema,
        "{ projects { id } }",
        Some(admin_ctx(b_admin, b_org)),
    )
    .await;
    assert_eq!(data["projects"].as_array().unwrap().len(), 0);
    let q = format!(r#"{{ project(id: "{pid}") {{ id }} }}"#);
    let data = exec_ok(&schema, &q, Some(admin_ctx(b_admin, b_org))).await;
    assert!(
        data["project"].is_null(),
        "Org B must not read Org A's project"
    );

    // Org B cannot update or delete Org A's project.
    let upd = format!(r#"mutation {{ updateProject(id: "{pid}", name: "Hijacked") {{ id }} }}"#);
    assert!(exec_err(&schema, &upd, Some(admin_ctx(b_admin, b_org)))
        .await
        .contains("not found"));
    let del = format!(r#"mutation {{ deleteProject(id: "{pid}") }}"#);
    assert!(exec_err(&schema, &del, Some(admin_ctx(b_admin, b_org)))
        .await
        .contains("not found"));

    // Org A can delete its own project.
    let data = exec_ok(&schema, &del, Some(admin_ctx(a_admin, a_org))).await;
    assert_eq!(data["deleteProject"], Json::Bool(true));
}

#[sqlx::test(migrations = "./migrations")]
async fn viewer_cannot_create_project(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;

    let invite = r#"mutation { inviteUser(email: "v@example.com", role: VIEWER) { user { id } inviteToken } }"#;
    let data = exec_ok(&schema, invite, Some(admin_ctx(admin, org))).await;
    let viewer_id = uuid_at(&data, &["inviteUser", "user", "id"]);
    let token = data["inviteUser"]["inviteToken"]
        .as_str()
        .unwrap()
        .to_string();
    let accept = format!(
        r#"mutation {{ acceptInvite(token: "{token}", password: "password123") {{ id }} }}"#
    );
    exec_ok(&schema, &accept, None).await;

    let viewer_ctx = AuthContext {
        user_id: viewer_id,
        org_id: org,
        role: Role::Viewer,
    };
    let q = r#"mutation { createProject(name: "X", epsgCode: 2229, displayUnit: METER) { id } }"#;
    assert!(exec_err(&schema, q, Some(viewer_ctx))
        .await
        .contains("forbidden"));
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_project_purges_db_rows_and_uploaded_files(pool: PgPool) {
    // Use a dedicated storage root so we can assert files are physically removed.
    let storage_root = std::env::temp_dir().join(format!("sitelens-del-{}", Uuid::new_v4()));
    let storage: Arc<dyn Storage> = Arc::new(LocalStorage::new(&storage_root));
    let config = AuthConfig {
        jwt_secret: "test-secret".to_string(),
        cookie_secure: false,
        cesium_ion_token: String::new(),
    };
    let schema = build_schema(pool.clone(), config, storage.clone());

    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    set_paid(&pool, org).await; // uploads a DXF (a Crew feature) below
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;

    // Child data + an uploaded DXF (writes a real file on disk).
    exec_ok(
        &schema,
        &format!(
            r#"mutation {{ addControlPoint(projectId: "{pid}", label: "CP", northing: 1.0, easting: 2.0, unit: METER) {{ id }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    let ov = exec_ok(
        &schema,
        &format!(
            r#"mutation {{ uploadDxf(projectId: "{pid}", filename: "d.dxf", content: "0\nSECTION\n") {{ id }} }}"#
        ),
        Some(auth.clone()),
    )
    .await;
    let overlay_id = uuid_at(&ov, &["uploadDxf", "id"]);
    let key = format!("dxf/{pid}/{overlay_id}.dxf");
    assert!(
        storage.exists(&key).await,
        "overlay file should exist pre-delete"
    );

    // Delete the project.
    let data = exec_ok(
        &schema,
        &format!(r#"mutation {{ deleteProject(id: "{pid}") }}"#),
        Some(auth.clone()),
    )
    .await;
    assert_eq!(data["deleteProject"].as_bool(), Some(true));

    // DB: the project and its children are gone (FK cascade).
    for (table, col) in [
        ("projects", "id"),
        ("control_points", "project_id"),
        ("cad_overlays", "project_id"),
    ] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT count(*) FROM {table} WHERE {col} = $1"))
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "{table} should have no rows for the project");
    }

    // Storage: the uploaded file is physically gone — no traces left behind.
    assert!(!storage.exists(&key).await, "overlay file must be deleted");

    let _ = tokio::fs::remove_dir_all(&storage_root).await;
}

#[sqlx::test(migrations = "./migrations")]
async fn project_changed_subscription_requires_org_ownership(pool: PgPool) {
    use async_graphql::futures_util::StreamExt;
    let schema = schema(pool);
    let (a_admin, a_org, _) = signup(&schema, "a@example.com", "Org A").await;
    let (b_admin, b_org, _) = signup(&schema, "b@example.com", "Org B").await;
    let a_pid = create_project(&schema, admin_ctx(a_admin, a_org), "A Site").await;

    // Org B may not subscribe to Org A's project — the stream's first item errors.
    let q = format!(r#"subscription {{ projectChanged(projectId: "{a_pid}") }}"#);
    let req = Request::new(q).data(admin_ctx(b_admin, b_org));
    let first = schema
        .execute_stream(req)
        .next()
        .await
        .expect("a stream response");
    assert!(
        !first.errors.is_empty(),
        "expected an org-ownership error, got: {:?}",
        first.data
    );

    // The owner can subscribe and receives a ping when the project is published.
    let q2 = format!(r#"subscription {{ projectChanged(projectId: "{a_pid}") }}"#);
    let req2 = Request::new(q2).data(admin_ctx(a_admin, a_org));
    let mut owner_stream = schema.execute_stream(req2);
    // Poll once so the resolver runs and registers the subscriber (no ping yet,
    // so this times out by design); only then does a publish reach it.
    let _ = tokio::time::timeout(std::time::Duration::from_millis(500), owner_stream.next()).await;
    schema
        .data::<sitelens_api::pubsub::ScenePubSub>()
        .unwrap()
        .publish(a_pid);
    let item = tokio::time::timeout(std::time::Duration::from_secs(2), owner_stream.next())
        .await
        .expect("subscription should yield within 2s")
        .expect("a stream item");
    assert!(
        item.errors.is_empty(),
        "unexpected errors: {:?}",
        item.errors
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn set_and_clear_project_boundary(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "b@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Set a triangular boundary (projected meters).
    let set = r#"mutation ($id: UUID!, $b: String) {
        setProjectBoundary(projectId: $id, boundary: $b) { id boundary }
    }"#;
    let r = exec_ok_vars(
        &schema,
        set,
        serde_json::json!({ "id": pid, "b": "[[0,0],[10,0],[10,10]]" }),
        admin_ctx(admin, org),
    )
    .await;
    let b = r["setProjectBoundary"]["boundary"].as_str().unwrap();
    assert!(b.contains("10"), "boundary stored: {b}");

    // It round-trips on the project query.
    let got = exec_ok(
        &schema,
        &format!(r#"{{ project(id: "{pid}") {{ boundary }} }}"#),
        Some(admin_ctx(admin, org)),
    )
    .await;
    assert!(got["project"]["boundary"].as_str().unwrap().contains("10"));

    // Passing null clears it.
    let cleared = exec_ok_vars(
        &schema,
        set,
        serde_json::json!({ "id": pid, "b": serde_json::Value::Null }),
        admin_ctx(admin, org),
    )
    .await;
    assert!(cleared["setProjectBoundary"]["boundary"].is_null());

    // Fewer than three points is rejected.
    let msg = exec_err_vars(
        &schema,
        set,
        serde_json::json!({ "id": pid, "b": "[[0,0],[1,1]]" }),
        admin_ctx(admin, org),
    )
    .await;
    assert!(
        msg.contains("at least three"),
        "expected min-points error: {msg}"
    );
}
