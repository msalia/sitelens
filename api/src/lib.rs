pub mod auth;
pub mod convert;
pub mod crs;
pub mod db;
pub mod geo;
pub mod models;
pub mod schema;
pub mod storage;
pub mod units;

use std::sync::Arc;
use std::time::Duration;

use async_graphql::{EmptySubscription, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use serde_json::json;
use sqlx::PgPool;

use crate::auth::{auth_context_from_token, session_token_from_cookie_header, AuthConfig};
use crate::schema::{MutationRoot, QueryRoot};
use crate::storage::{LocalStorage, Storage};

pub type ApiSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

/// Builds the GraphQL schema with the pool, auth config, and storage in its data.
pub fn build_schema(pool: PgPool, config: AuthConfig, storage: Arc<dyn Storage>) -> ApiSchema {
    Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .data(pool)
        .data(config)
        .data(storage)
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

    let pool = connect_with_retry(&database_url).await;
    db::run_migrations(&pool).await.expect("migrations failed");

    let config = AuthConfig {
        jwt_secret,
        cookie_secure,
    };
    let storage: Arc<dyn Storage> = Arc::new(LocalStorage::new(storage_dir));
    let schema = build_schema(pool.clone(), config.clone(), storage);
    let state = AppState {
        schema,
        config,
        pool,
    };

    let app = Router::new()
        .route("/", get(|| async { "SiteLens API" }))
        .route("/health", get(health))
        .route("/graphql", get(graphiql).post(graphql_handler))
        .with_state(state);

    let addr = "0.0.0.0:4000";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind 0.0.0.0:4000");
    println!("SiteLens API listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}
