//! GraphQL schema wiring.
//!
//! The shared resolver toolkit (context accessors, auth/tenancy guards, the plan
//! gate, coordinate-reference helpers, and the re-exported prelude) lives in
//! [`common`] and reaches every resolver module through `pub(crate) use
//! common::*` here + each module's `use super::*`. Domain-specific support lives
//! in the owning resolver module. This file only declares the modules and merges
//! the per-domain Query/Mutation/Subscription objects into the roots.
// Resolvers idiomatically take many arguments (each maps to a GraphQL field arg).
#![allow(clippy::too_many_arguments)]

use async_graphql::MergedObject;

mod common;
pub(crate) use common::*;

mod analysis;
mod auth;
mod billing;
mod coords;
mod field;
mod grid;
mod overlays;
mod points;
mod projects;
mod scene;
mod subscription;
mod surface;
mod system;
mod terrain;
mod utilities;

pub use subscription::SubscriptionRoot;

/// The GraphQL query root — a merge of the per-domain query objects.
#[derive(MergedObject, Default)]
pub struct QueryRoot(
    system::SystemQuery,
    auth::AuthQuery,
    projects::ProjectQuery,
    grid::GridQuery,
    points::PointsQuery,
    overlays::OverlayQuery,
    terrain::TerrainQuery,
    coords::CoordsQuery,
    scene::SceneQuery,
    field::FieldQuery,
    utilities::UtilitiesQuery,
    surface::SurfaceQuery,
    analysis::AnalysisQuery,
    billing::BillingQuery,
    billing::PlanCatalogQuery,
);

/// The GraphQL mutation root — a merge of the per-domain mutation objects.
#[derive(MergedObject, Default)]
pub struct MutationRoot(
    auth::AuthMutation,
    projects::ProjectMutation,
    grid::GridMutation,
    points::PointsMutation,
    overlays::OverlayMutation,
    terrain::TerrainMutation,
    field::FieldMutation,
    utilities::UtilitiesMutation,
    surface::SurfaceMutation,
    analysis::AnalysisMutation,
    billing::BillingMutation,
);
