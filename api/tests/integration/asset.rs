//! Integration tests for the binary `/asset` endpoint core logic (terrain-
//! rendering Phase 1a): raw-bytes serving, sha256 ETag + 304, tenancy, Crew gate,
//! and auth — mirroring the checks in the base64 GraphQL resolvers.

use crate::common::*;
use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use sitelens_api::asset::{resolve_asset, surface_mesh_asset, Asset, AssetOutcome};
use sitelens_api::auth::{issue_jwt, Role, SESSION_COOKIE};
use sitelens_api::build_router;
use tower::ServiceExt; // for `oneshot`

fn http_config() -> AuthConfig {
    AuthConfig {
        jwt_secret: "test-secret".to_string(),
        cookie_secure: false,
        cesium_ion_token: String::new(),
    }
}

const BUILD: &str = r#"mutation ($pid: UUID!, $input: SurfaceInput!) {
    buildSurface(projectId: $pid, input: $input) { id } }"#;

async fn add_point(schema: &ApiSchema, auth: AuthContext, pid: Uuid, label: &str, e: f64, n: f64) {
    let q = format!(
        r#"mutation {{ addSurveyPoint(projectId: "{pid}", label: "{label}", space: PROJECTED, x: {e}, y: {n}, elevation: 10.0, unit: METER) {{ id }} }}"#
    );
    exec_ok(schema, &q, Some(auth)).await;
}

/// Paid org + project + a 4-point square surface.
/// Returns (auth, org_id, project_id, surface_id).
async fn seed_surface(schema: &ApiSchema, pool: &PgPool) -> (AuthContext, Uuid, Uuid, Uuid) {
    let (admin, org, _) = signup(schema, "asset@example.com", "Asset Co").await;
    set_paid(pool, org).await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(schema, auth.clone(), "Grade").await;
    add_point(schema, auth.clone(), pid, "P1", 0.0, 0.0).await;
    add_point(schema, auth.clone(), pid, "P2", 100.0, 0.0).await;
    add_point(schema, auth.clone(), pid, "P3", 100.0, 100.0).await;
    add_point(schema, auth.clone(), pid, "P4", 0.0, 100.0).await;
    let data = exec_ok_vars(
        schema,
        BUILD,
        serde_json::json!({ "pid": pid, "input": { "name": "Existing grade", "scope": "ALL" } }),
        auth.clone(),
    )
    .await;
    let sid = uuid_at(&data, &["buildSurface", "id"]);
    (auth, org, pid, sid)
}

#[sqlx::test(migrations = "./migrations")]
async fn surface_mesh_asset_serves_stin_with_stable_etag_and_304(pool: PgPool) {
    let schema = schema(pool.clone());
    let storage = test_storage();
    let (auth, _org, _pid, sid) = seed_surface(&schema, &pool).await;

    let out = surface_mesh_asset(&pool, storage.as_ref(), Some(&auth), sid, None)
        .await
        .unwrap();
    let etag = match out {
        AssetOutcome::Found {
            bytes,
            etag,
            content_type,
            ..
        } => {
            assert_eq!(content_type, "application/octet-stream");
            assert_eq!(&bytes[0..4], b"STIN", "should serve the raw STIN blob");
            assert!(
                etag.starts_with('"') && etag.ends_with('"'),
                "ETag must be a quoted string: {etag}"
            );
            etag
        }
        other => panic!("expected Found, got {other:?}"),
    };

    // Same bytes → same ETag → a conditional request short-circuits to 304.
    let again = surface_mesh_asset(&pool, storage.as_ref(), Some(&auth), sid, Some(&etag))
        .await
        .unwrap();
    assert!(
        matches!(again, AssetOutcome::NotModified),
        "matching If-None-Match should yield NotModified"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn surface_mesh_asset_requires_auth(pool: PgPool) {
    let schema = schema(pool.clone());
    let storage = test_storage();
    let (_auth, _org, _pid, sid) = seed_surface(&schema, &pool).await;

    let out = surface_mesh_asset(&pool, storage.as_ref(), None, sid, None)
        .await
        .unwrap();
    assert!(matches!(out, AssetOutcome::Unauthorized));
}

#[sqlx::test(migrations = "./migrations")]
async fn surface_mesh_asset_is_crew_gated(pool: PgPool) {
    let schema = schema(pool.clone());
    let storage = test_storage();
    let (auth, org, _pid, sid) = seed_surface(&schema, &pool).await;

    // Downgrade the org below Crew: the surface exists but the feature locks.
    sqlx::query("UPDATE orgs SET subscription_status = 'canceled' WHERE id = $1")
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();

    let out = surface_mesh_asset(&pool, storage.as_ref(), Some(&auth), sid, None)
        .await
        .unwrap();
    assert!(
        matches!(out, AssetOutcome::Forbidden),
        "a Solo org must not fetch a surface mesh"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn surface_mesh_asset_isolates_tenants(pool: PgPool) {
    let schema = schema(pool.clone());
    let storage = test_storage();
    let (_auth, _org, _pid, sid) = seed_surface(&schema, &pool).await;

    // A second, unrelated paid org must not see the first org's surface.
    let (other_admin, other_org, _) = signup(&schema, "intruder@example.com", "Other Co").await;
    set_paid(&pool, other_org).await;
    let intruder = admin_ctx(other_admin, other_org);

    let out = surface_mesh_asset(&pool, storage.as_ref(), Some(&intruder), sid, None)
        .await
        .unwrap();
    assert!(
        matches!(out, AssetOutcome::NotFound),
        "cross-tenant fetch must be NotFound"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn project_terrain_asset_is_ungated_and_serves_tiff(pool: PgPool) {
    let schema = schema(pool.clone());
    let storage = test_storage();
    // A deliberately *unpaid* org — base terrain is ungated (it's the scene floor).
    let (admin, org, _) = signup(&schema, "solo@example.com", "Solo Co").await;
    let auth = admin_ctx(admin, org);
    let pid = create_project(&schema, auth.clone(), "Site").await;

    let key = format!("terrain/{pid}.tif");
    let tiff = b"II*\0fake-geotiff-bytes".to_vec();
    storage.put(&key, &tiff).await.unwrap();
    sqlx::query(
        "INSERT INTO project_terrain (project_id, demtype, south, north, west, east, storage_key) \
         VALUES ($1, '3DEPElevation', 0, 1, 0, 1, $2)",
    )
    .bind(pid)
    .bind(&key)
    .execute(&pool)
    .await
    .unwrap();

    let out = resolve_asset(
        &pool,
        storage.as_ref(),
        Some(&auth),
        Asset::ProjectTerrain(pid),
        None,
    )
    .await
    .unwrap();
    match out {
        AssetOutcome::Found {
            bytes,
            content_type,
            ..
        } => {
            assert_eq!(content_type, "image/tiff");
            assert_eq!(bytes, tiff, "serves the exact stored GeoTIFF bytes");
        }
        other => panic!("ungated terrain should be Found for a Solo org, got {other:?}"),
    }

    // Still tenant-isolated even though ungated.
    let (o2, org2, _) = signup(&schema, "t2@example.com", "T2 Co").await;
    let out = resolve_asset(
        &pool,
        storage.as_ref(),
        Some(&admin_ctx(o2, org2)),
        Asset::ProjectTerrain(pid),
        None,
    )
    .await
    .unwrap();
    assert!(matches!(out, AssetOutcome::NotFound));
}

#[sqlx::test(migrations = "./migrations")]
async fn volume_heatmap_asset_is_crew_gated_and_serves_svol(pool: PgPool) {
    let schema = schema(pool.clone());
    let storage = test_storage();
    let (auth, org, pid, sid) = seed_surface(&schema, &pool).await;

    // Insert a volume row with a heatmap blob directly (asset logic is under test,
    // not the volume-compute pipeline).
    let vid = Uuid::new_v4();
    let key = format!("volume/{pid}/{vid}.bin");
    storage.put(&key, b"SVOL....heatmap").await.unwrap();
    sqlx::query(
        "INSERT INTO volumes (id, project_id, name, comparison, base_surface_id, base_version, cell_size, heatmap_key) \
         VALUES ($1, $2, 'Balance', 'surface_to_elevation', $3, 1, 1.0, $4)",
    )
    .bind(vid)
    .bind(pid)
    .bind(sid)
    .bind(&key)
    .execute(&pool)
    .await
    .unwrap();

    let out = resolve_asset(
        &pool,
        storage.as_ref(),
        Some(&auth),
        Asset::VolumeHeatmap(vid),
        None,
    )
    .await
    .unwrap();
    match out {
        AssetOutcome::Found {
            content_type,
            filename,
            ..
        } => {
            assert_eq!(content_type, "application/octet-stream");
            assert_eq!(filename, "Balance.svol");
        }
        other => panic!("expected Found, got {other:?}"),
    }

    // Downgrading below Crew locks the heatmap.
    sqlx::query("UPDATE orgs SET subscription_status = 'canceled' WHERE id = $1")
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();
    let out = resolve_asset(
        &pool,
        storage.as_ref(),
        Some(&auth),
        Asset::VolumeHeatmap(vid),
        None,
    )
    .await
    .unwrap();
    assert!(matches!(out, AssetOutcome::Forbidden));
}

// --- HTTP wiring (drives the real axum router via `oneshot`) ----------------

#[sqlx::test(migrations = "./migrations")]
async fn asset_http_route_requires_session_cookie(pool: PgPool) {
    let app = build_router(pool.clone(), http_config(), test_storage());
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/asset/surface/{}/mesh", Uuid::new_v4()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn asset_http_route_serves_mesh_and_honors_if_none_match(pool: PgPool) {
    let schema = schema(pool.clone());
    let (auth, _org, _pid, sid) = seed_surface(&schema, &pool).await;
    let token = issue_jwt(auth.user_id, auth.org_id, Role::Admin, "test-secret").unwrap();
    let cookie = format!("{SESSION_COOKIE}={token}");

    // Authenticated GET → 200 with an ETag + octet-stream content type.
    let app = build_router(pool.clone(), http_config(), test_storage());
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/asset/surface/{sid}/mesh"))
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let etag = resp
        .headers()
        .get(header::ETAG)
        .expect("ETag header")
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        resp.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/octet-stream"
    );

    // Conditional GET with the same ETag → 304 Not Modified.
    let app = build_router(pool.clone(), http_config(), test_storage());
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/asset/surface/{sid}/mesh"))
                .header(header::COOKIE, &cookie)
                .header(header::IF_NONE_MATCH, &etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_MODIFIED);
}
