pub mod analysis;
pub mod archive;
pub mod asset;
pub mod auth;
pub mod billing;
pub mod convert;
pub mod crs;
pub mod db;
pub mod dxf;
pub mod export;
pub mod field;
pub mod geo;
pub mod import;
pub mod mail;
pub mod models;
pub mod plan;
pub mod pubsub;
pub mod ratelimit;
pub mod report;
pub mod schema;
pub mod storage;
pub mod surface;
pub mod units;
pub mod utilities;

use std::sync::Arc;
use std::time::Duration;

use async_graphql::http::ALL_WEBSOCKET_PROTOCOLS;
use async_graphql::{Data, Schema};
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::{
    body::Bytes,
    extract::{ws::WebSocketUpgrade, DefaultBodyLimit, FromRequestParts, Path, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use sqlx::PgPool;
use tower_http::compression::CompressionLayer;
use uuid::Uuid;

use crate::asset::{resolve_asset, Asset, AssetOutcome};

use crate::auth::{auth_context_from_token, session_token_from_cookie_header, AuthConfig};
use crate::billing::StripeConfig;
use crate::mail::Mailer;
use crate::pubsub::ScenePubSub;
use crate::ratelimit::{ClientIp, RateLimiter};
use crate::schema::{MutationRoot, QueryRoot, SubscriptionRoot};
use crate::storage::{LocalStorage, Storage};

pub type ApiSchema = Schema<QueryRoot, MutationRoot, SubscriptionRoot>;

/// Auth rate-limit policy: defaults to 10 login/signup attempts per IP per
/// minute. Overridable via env (e.g. raised for local E2E runs); prod leaves
/// the env unset and keeps the defaults.
fn rl_max() -> u64 {
    std::env::var("AUTH_RATE_LIMIT_MAX")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10)
}
fn rl_window_secs() -> u64 {
    std::env::var("AUTH_RATE_LIMIT_WINDOW_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60)
}

/// Builds the GraphQL schema with an in-process auth rate limiter. Used by tests,
/// the schema printer, and as the fallback when Redis is unconfigured.
pub fn build_schema(pool: PgPool, config: AuthConfig, storage: Arc<dyn Storage>) -> ApiSchema {
    build_schema_with(
        pool,
        config,
        storage,
        RateLimiter::memory(rl_max() as usize, Duration::from_secs(rl_window_secs())),
    )
}

/// Builds the GraphQL schema with an explicit rate limiter (e.g. Redis-backed).
pub fn build_schema_with(
    pool: PgPool,
    config: AuthConfig,
    storage: Arc<dyn Storage>,
    limiter: RateLimiter,
) -> ApiSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        SubscriptionRoot,
    )
    .data(pool)
    .data(config)
    .data(storage)
    .data(limiter)
    .data(Mailer::from_env())
    .data(ScenePubSub::new())
    .data(StripeConfig::from_env())
    .finish()
}

#[derive(Clone)]
struct AppState {
    schema: ApiSchema,
    config: AuthConfig,
    pool: PgPool,
    stripe: StripeConfig,
    /// Blob store, held directly on state so the plain `/asset` routes can reach
    /// it (the schema also gets its own `Arc` clone via `.data(storage)`).
    storage: Arc<dyn Storage>,
}

/// Derives the authenticated principal (if any) from the request's session
/// cookie. Shared by the HTTP and WebSocket entry points.
fn auth_from_headers(headers: &HeaderMap, jwt_secret: &str) -> Option<crate::auth::AuthContext> {
    let cookie = headers.get(header::COOKIE).and_then(|v| v.to_str().ok())?;
    let token = session_token_from_cookie_header(cookie)?;
    auth_context_from_token(&token, jwt_secret)
}

async fn graphql_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut request = req.into_inner();
    if let Some(auth) = auth_from_headers(&headers, &state.config.jwt_secret) {
        request = request.data(auth);
    }
    // Client IP for rate limiting. Behind Traefik the real IP is the first hop
    // of X-Forwarded-For; fall back to a constant so the limiter still applies.
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    request = request.data(ClientIp(ip));
    state.schema.execute(request).await.into()
}

async fn graphiql() -> impl IntoResponse {
    Html(
        async_graphql::http::GraphiQLSource::build()
            .endpoint("/graphql")
            .subscription_endpoint("/graphql")
            .finish(),
    )
}

/// GET /graphql serves either the GraphQL-over-WebSocket transport (when the
/// request is a WS upgrade carrying a GraphQL subprotocol) or the GraphiQL IDE.
/// Subscription auth comes from the session cookie sent on the upgrade.
async fn graphql_get(State(state): State<AppState>, req: Request) -> Response {
    let (mut parts, _body) = req.into_parts();
    // A WS upgrade carrying a GraphQL subprotocol → subscriptions; otherwise the
    // GraphiQL IDE. Both extractors only read headers, so probing them is cheap.
    let protocol = GraphQLProtocol::from_request_parts(&mut parts, &()).await;
    let upgrade = WebSocketUpgrade::from_request_parts(&mut parts, &()).await;
    match (upgrade, protocol) {
        (Ok(ws), Ok(protocol)) => {
            let mut data = Data::default();
            if let Some(auth) = auth_from_headers(&parts.headers, &state.config.jwt_secret) {
                data.insert(auth);
            }
            let schema = state.schema.clone();
            ws.protocols(ALL_WEBSOCKET_PROTOCOLS)
                .on_upgrade(move |stream| {
                    GraphQLWebSocket::new(stream, schema, protocol)
                        .with_data(data)
                        .serve()
                })
                .into_response()
        }
        _ => graphiql().await.into_response(),
    }
}

/// JSON health endpoint. 200 when the DB is reachable, 503 otherwise.
async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"status":"healthy","db":"connected"})),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status":"unhealthy","db":"disconnected"})),
        ),
    }
}

/// Stripe webhook endpoint. Verifies the signature, then updates the org's billing
/// state from checkout/subscription events. 200 on success (Stripe stops retrying),
/// 400 on a bad signature, 500 on a transient apply error (Stripe retries).
async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    if !state.stripe.enabled() {
        return StatusCode::OK;
    }
    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if billing::verify_signature(&state.stripe.webhook_secret, &body, sig).is_err() {
        return StatusCode::BAD_REQUEST;
    }
    let event: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    if let Err(e) = billing::apply_event(&state.pool, &event).await {
        eprintln!("stripe webhook apply error: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    StatusCode::OK
}

/// Resolves an [`Asset`] request against session auth + `If-None-Match`, mapping
/// the [`AssetOutcome`] to an HTTP response. `tower-http`'s `CompressionLayer`
/// gzip/brotli-compresses the body on the way out.
async fn serve_asset(state: &AppState, headers: &HeaderMap, asset: Asset) -> Response {
    let auth = auth_from_headers(headers, &state.config.jwt_secret);
    let inm = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok());
    match resolve_asset(
        &state.pool,
        state.storage.as_ref(),
        auth.as_ref(),
        asset,
        inm,
    )
    .await
    {
        Ok(AssetOutcome::Unauthorized) => StatusCode::UNAUTHORIZED.into_response(),
        Ok(AssetOutcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(AssetOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Ok(AssetOutcome::NotModified) => StatusCode::NOT_MODIFIED.into_response(),
        Ok(AssetOutcome::Found {
            bytes,
            etag,
            content_type,
            filename,
        }) => (
            [
                (header::CONTENT_TYPE, content_type.to_string()),
                (header::ETAG, etag),
                (
                    header::CACHE_CONTROL,
                    "private, must-revalidate".to_string(),
                ),
                (
                    header::CONTENT_DISPOSITION,
                    format!("inline; filename=\"{filename}\""),
                ),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => {
            eprintln!("asset error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn asset_surface_mesh(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    serve_asset(&s, &headers, Asset::SurfaceMesh(id)).await
}

async fn asset_volume_heatmap(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    serve_asset(&s, &headers, Asset::VolumeHeatmap(id)).await
}

async fn asset_project_terrain(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    serve_asset(&s, &headers, Asset::ProjectTerrain(id)).await
}

async fn asset_project_detailed_terrain(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    serve_asset(&s, &headers, Asset::ProjectDetailedTerrain(id)).await
}

async fn asset_project_buildings(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    serve_asset(&s, &headers, Asset::ProjectBuildings(id)).await
}

/// Assembles the full axum app from an [`AppState`]. Shared by `run()` and tests.
fn router(state: AppState) -> Router {
    // Compression only wraps the asset routes: mesh/GeoTIFF blobs are large and
    // repetitive; GraphQL JSON already goes through the Next.js proxy.
    let assets = Router::new()
        .route("/asset/surface/{id}/mesh", get(asset_surface_mesh))
        .route("/asset/volume/{id}/heatmap", get(asset_volume_heatmap))
        .route("/asset/project/{id}/terrain", get(asset_project_terrain))
        .route(
            "/asset/project/{id}/terrain-detailed",
            get(asset_project_detailed_terrain),
        )
        .route(
            "/asset/project/{id}/buildings",
            get(asset_project_buildings),
        )
        .layer(CompressionLayer::new());

    Router::new()
        .route("/", get(|| async { "SiteLens API" }))
        .route("/health", get(health))
        .route("/graphql", get(graphql_get).post(graphql_handler))
        .route("/stripe/webhook", post(stripe_webhook))
        .merge(assets)
        // Axum defaults to a 2 MB request body; a 10 MB DXF (plus JSON-string
        // escaping) needs headroom, so lift the cap well above MAX_DXF_BYTES.
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(state)
}

/// Builds the full app (schema + `/asset` routes) with an in-memory rate limiter.
/// For tests that need to drive the HTTP surface (e.g. via `tower::oneshot`).
pub fn build_router(pool: PgPool, config: AuthConfig, storage: Arc<dyn Storage>) -> Router {
    let schema = build_schema(pool.clone(), config.clone(), storage.clone());
    let state = AppState {
        schema,
        config,
        pool,
        stripe: StripeConfig::from_env(),
        storage,
    };
    router(state)
}

async fn connect_with_retry(database_url: &str) -> PgPool {
    let mut attempt = 0;
    loop {
        match db::connect(database_url).await {
            Ok(pool) => return pool,
            Err(e) if attempt < 10 => {
                attempt += 1;
                eprintln!("DB not ready (attempt {attempt}/10): {e}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(e) => panic!("could not connect to database: {e}"),
        }
    }
}

pub async fn run() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        eprintln!("WARNING: JWT_SECRET not set — using an insecure development secret");
        "dev-insecure-secret".to_string()
    });
    let cookie_secure = std::env::var("COOKIE_SECURE")
        .map(|v| v != "false")
        .unwrap_or(true);
    let storage_dir = std::env::var("STORAGE_DIR").unwrap_or_else(|_| "./data/uploads".to_string());
    let cesium_ion_token = std::env::var("CESIUM_ION_TOKEN").unwrap_or_default();

    let pool = connect_with_retry(&database_url).await;
    db::run_migrations(&pool).await.expect("migrations failed");

    let config = AuthConfig {
        jwt_secret,
        cookie_secure,
        cesium_ion_token,
    };
    let storage: Arc<dyn Storage> = Arc::new(LocalStorage::new(storage_dir));

    // Prefer a shared Redis-backed rate limiter (so the limit holds across API
    // instances); fall back to in-process if REDIS_URL is unset or unreachable.
    let limiter = match std::env::var("REDIS_URL") {
        Ok(url) if !url.is_empty() => {
            match RateLimiter::connect_redis(&url, rl_max(), rl_window_secs()).await {
                Ok(rl) => {
                    println!("auth rate limiter: redis ({url})");
                    rl
                }
                Err(e) => {
                    eprintln!(
                        "WARNING: REDIS_URL set but unreachable ({e}); using in-process rate limiter"
                    );
                    RateLimiter::memory(rl_max() as usize, Duration::from_secs(rl_window_secs()))
                }
            }
        }
        _ => RateLimiter::memory(rl_max() as usize, Duration::from_secs(rl_window_secs())),
    };
    let schema = build_schema_with(pool.clone(), config.clone(), storage.clone(), limiter);
    let state = AppState {
        schema,
        config,
        pool,
        stripe: StripeConfig::from_env(),
        storage,
    };

    let app = router(state);

    let addr = "0.0.0.0:4000";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind 0.0.0.0:4000");
    println!("SiteLens API listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}
