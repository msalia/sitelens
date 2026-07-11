//! Integration tests for auth + multi-tenancy. Each test runs against an
//! ephemeral database provisioned by `#[sqlx::test]` (requires DATABASE_URL to
//! point at a Postgres/PostGIS server with create-db privileges).

mod common;

mod analysis;
mod asset;
mod auth;
mod billing;
mod coords;
mod export;
mod field;
mod grid_transform;
mod overlays;
mod points;
mod projects;
mod scene;
mod surface;
mod tenancy;
mod utilities;
mod webhooks;
