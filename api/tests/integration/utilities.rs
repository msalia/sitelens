//! Utility Records — Phase 1: migration + seeded catalog + audit append.

use crate::common::*;
use sitelens_api::utilities::audit;

#[sqlx::test(migrations = "./migrations")]
async fn migration_seeds_apwa_type_catalog(pool: PgPool) {
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM utility_types")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        count >= 15,
        "expected the APWA type catalog seeded, got {count}"
    );

    // A known linear type and a known structure type exist with the right kind.
    let (line,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM utility_types WHERE key = 'water' AND default_geometry = 'line'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(line, 1);
    let (structure,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM utility_types WHERE key = 'manhole' AND default_geometry = 'structure'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(structure, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn audit_log_appends_field_level_diff(pool: PgPool) {
    let schema = schema(pool.clone());
    let (admin, org, _) = signup(&schema, "a@example.com", "Org").await;
    let pid = create_project(&schema, admin_ctx(admin, org), "Site").await;

    let entity = Uuid::new_v4();
    let d = audit::diff(
        &serde_json::json!({}),
        &serde_json::json!({ "material": "PVC", "diameter": 8 }),
    );
    audit::log(&pool, pid, "run", entity, "create", Some(admin), &d)
        .await
        .unwrap();

    let (cnt,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM utility_audit \
         WHERE project_id = $1 AND entity_id = $2 AND action = 'create'",
    )
    .bind(pid)
    .bind(entity)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cnt, 1);

    // The field-level diff persisted as jsonb.
    let (diff,): (serde_json::Value,) =
        sqlx::query_as("SELECT diff FROM utility_audit WHERE entity_id = $1")
            .bind(entity)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(diff["material"]["after"], "PVC");
    assert_eq!(diff["diameter"]["after"], 8);
}
