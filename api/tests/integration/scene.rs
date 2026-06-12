use crate::common::*;

#[sqlx::test(migrations = "./migrations")]
async fn scene_data_projects_to_geographic(pool: PgPool) {
    let schema = schema(pool);
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    // Control points near a real LA projected location (EPSG 2229, meters).
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "A",
        1_950_000.0,
        560_000.0,
        0.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "B",
        1_950_010.0,
        560_000.0,
        10.0,
        0.0,
    )
    .await;
    add_cp(
        &schema,
        admin_ctx(admin, org),
        pid,
        "C",
        1_950_000.0,
        560_010.0,
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
    // Two axes per family so grid lines are non-degenerate.
    let axes = format!(
        r#"mutation {{ setGridAxes(projectId: "{pid}", unit: METER, axes: [
            {{ family: LETTERED, label: "A", position: 0 }},
            {{ family: LETTERED, label: "B", position: 10 }},
            {{ family: NUMBERED, label: "1", position: 0 }},
            {{ family: NUMBERED, label: "2", position: 10 }}
        ]) {{ id }} }}"#
    );
    exec_ok(&schema, &axes, Some(admin_ctx(admin, org))).await;

    let data = exec_ok(
        &schema,
        &format!(
            r#"{{ sceneData(projectId: "{pid}") {{
                origin {{ latitude longitude }}
                controlPoints {{ label latitude longitude height }}
                gridLines {{ label coordinates {{ latitude }} }}
            }} }}"#
        ),
        Some(admin_ctx(admin, org)),
    )
    .await;
    let s = &data["sceneData"];
    let cps = s["controlPoints"].as_array().unwrap();
    assert_eq!(cps.len(), 3);
    // LA-area latitude.
    let lat = cps[0]["latitude"].as_f64().unwrap();
    assert!((33.0..35.0).contains(&lat), "lat {lat}");
    assert!(s["origin"]["latitude"].as_f64().is_some());
    assert_eq!(s["gridLines"].as_array().unwrap().len(), 4);
}
