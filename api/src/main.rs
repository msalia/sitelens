use std::env;

use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::{FromRef, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use serde_json::json;
use sqlx::{postgres::PgPoolOptions, PgPool};

mod units;

/// GraphQL query root. Foundation only — feature resolvers land in later phases.
struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Liveness check — returns "ok" if the API is serving.
    async fn health(&self) -> &str {
        "ok"
    }

    /// Database connectivity check.
    async fn db_status(&self, ctx: &Context<'_>) -> String {
        let pool = ctx.data_unchecked::<PgPool>();
        match sqlx::query("SELECT 1").execute(pool).await {
            Ok(_) => "connected".to_string(),
            Err(_) => "disconnected".to_string(),
        }
    }
}

type ApiSchema = Schema<QueryRoot, EmptyMutation, EmptySubscription>;

#[derive(Clone)]
struct AppState {
    schema: ApiSchema,
    pool: PgPool,
}

impl FromRef<AppState> for ApiSchema {
    fn from_ref(state: &AppState) -> Self {
        state.schema.clone()
    }
}

impl FromRef<AppState> for PgPool {
    fn from_ref(state: &AppState) -> Self {
        state.pool.clone()
    }
}

async fn graphql_handler(State(schema): State<ApiSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

async fn graphiql() -> impl IntoResponse {
    Html(
        async_graphql::http::GraphiQLSource::build()
            .endpoint("/graphql")
            .finish(),
    )
}

/// JSON health endpoint mirrored by the web tier. 200 when the DB is reachable, 503 otherwise.
async fn health(State(pool): State<PgPool>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&pool).await {
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

#[tokio::main]
async fn main() {
    let db_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    // Lazy pool: the server boots even if the DB is briefly unavailable; the
    // health endpoint reflects the live connection state.
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(&db_url)
        .expect("failed to create database pool");

    let schema = Schema::build(QueryRoot, EmptyMutation, EmptySubscription)
        .data(pool.clone())
        .finish();

    let state = AppState { schema, pool };

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
