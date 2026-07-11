//! Integration tests for the composite-terrain resolver (terrain-rendering P2b):
//! guard/tenancy behaviour. The compositing geometry itself is unit-tested in
//! `surface::terrain_composite`; here we cover the resolver's null fallbacks.

use crate::common::*;

const Q: &str = r#"query ($id: UUID!) { projectCompositeTerrain(projectId: $id) }"#;

#[sqlx::test(migrations = "./migrations")]
async fn composite_is_null_without_a_boundary(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "comp@example.com", "Comp Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "No Boundary").await;

    let data = exec_ok_vars(&schema, Q, serde_json::json!({ "id": pid }), auth).await;
    assert!(
        data["projectCompositeTerrain"].is_null(),
        "no boundary → coarse-only (null composite)"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn composite_is_null_when_a_dem_is_missing(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "comp2@example.com", "Comp2 Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Boundary No DEM").await;

    // A boundary but no cached terrain rows → still null (nothing to composite).
    sqlx::query("UPDATE projects SET boundary = $1 WHERE id = $2")
        .bind(sqlx::types::Json(vec![
            [0.0, 0.0],
            [100.0, 0.0],
            [100.0, 100.0],
        ]))
        .bind(pid)
        .execute(&pool)
        .await
        .unwrap();

    let data = exec_ok_vars(&schema, Q, serde_json::json!({ "id": pid }), auth).await;
    assert!(data["projectCompositeTerrain"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn composite_is_tenant_scoped(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "owner@example.com", "Owner Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth, "Owned").await;

    let (intruder, org2, _) = signup(&schema, "intruder@example.com", "Other Co").await;
    let err = exec_err_vars(
        &schema,
        Q,
        serde_json::json!({ "id": pid }),
        admin_ctx(intruder, org2),
    )
    .await;
    assert!(
        err.contains("not found"),
        "cross-tenant must be rejected: {err}"
    );
}
