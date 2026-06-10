//! Prints the GraphQL SDL to stdout. Used to generate `api/schema.graphql` for
//! the frontend's GraphQL Codegen. No database connection is made (lazy pool).

use std::sync::Arc;

use sitelens_api::auth::AuthConfig;
use sitelens_api::build_schema;
use sitelens_api::storage::{LocalStorage, Storage};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/sitelens")
        .expect("lazy pool");
    let config = AuthConfig {
        jwt_secret: "schema-only".to_string(),
        cookie_secure: false,
    };
    let storage: Arc<dyn Storage> = Arc::new(LocalStorage::new("/tmp"));
    let schema = build_schema(pool, config, storage);
    print!("{}", schema.sdl());
}
