pub mod auth;
pub mod convert;
pub mod crs;
pub mod db;
pub mod export;
pub mod geo;
pub mod import;
pub mod models;
pub mod ratelimit;
pub mod schema;
pub mod storage;
pub mod units;

use std::sync::Arc;
use std::time::Duration;

use async_graphql::{EmptySubscription, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use serde_json::json;
use sqlx::PgPool;

use crate::auth::{auth_context_from_token, session_token_from_cookie_header, AuthConfig};
use crate::ratelimit::{ClientIp, RateLimiter};
use crate::schema::{MutationRoot, QueryRoot};
use crate::storage::{LocalStorage, Storage};

pub type ApiSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

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
    Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .data(pool)
        .data(config)
        .data(storage)
        .data(limiter)
        .finish()
}

#[derive(Clone)]
struct AppState {
    schema: ApiSchema,
    config: AuthConfig,
    pool: PgPool,
}

async fn graphql_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut request = req.into_inner();
    if let Some(cookie) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        if let Some(token) = session_token_from_cookie_header(cookie) {
            if let Some(auth) = auth_context_from_token(&token, &state.config.jwt_secret) {
                request = request.data(auth);
            }
        }
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
            .finish(),
    )
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
    let schema = build_schema_with(pool.clone(), config.clone(), storage, limiter);
    let state = AppState {
        schema,
        config,
        pool,
    };

    let app = Router::new()
        .route("/", get(|| async { "SiteLens API" }))
        .route("/health", get(health))
        .route("/graphql", get(graphiql).post(graphql_handler))
        // Axum defaults to a 2 MB request body; a 10 MB DXF (plus JSON-string
        // escaping) needs headroom, so lift the cap well above MAX_DXF_BYTES.
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(state);

    let addr = "0.0.0.0:4000";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind 0.0.0.0:4000");
    println!("SiteLens API listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}
