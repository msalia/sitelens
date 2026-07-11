//! Binary asset serving for terrain-rendering render blobs (Phase 1a).
//!
//! The GraphQL resolvers base64-encode these same bytes into JSON; here we serve
//! them raw over an authed HTTP route (`/asset/…`), with a sha256 ETag so
//! conditional requests short-circuit to `304`. Ownership + Crew gating mirror
//! the corresponding resolvers exactly — this is a transport change, not a policy
//! change. `tower-http`'s `CompressionLayer` gzip/brotli-compresses the response
//! at the HTTP edge; the payloads themselves stay the existing wire formats.

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthContext;
use crate::billing::org_billing;
use crate::plan::Feature;
use crate::storage::Storage;

/// The outcome of resolving an asset request. The HTTP handler maps each variant
/// to a status code (+ body/headers for `Found`).
#[derive(Debug)]
pub enum AssetOutcome {
    /// No / invalid session cookie → `401`.
    Unauthorized,
    /// Authenticated, but the org's plan doesn't unlock the feature → `403`.
    Forbidden,
    /// Not found in the caller's org (missing, cross-tenant, or not yet
    /// computed) → `404`.
    NotFound,
    /// The client's `If-None-Match` matched the current ETag → `304`.
    NotModified,
    /// Serve these bytes → `200`.
    Found {
        bytes: Vec<u8>,
        etag: String,
        content_type: &'static str,
        filename: String,
    },
}

/// The strong ETag for a blob: a quoted hex sha256 of its bytes. Stable for
/// identical content, so a repeat load with `If-None-Match` short-circuits.
pub fn etag_for(bytes: &[u8]) -> String {
    format!("\"{}\"", hex::encode(Sha256::digest(bytes)))
}

/// A render blob addressable over `/asset/…`. Each variant maps 1:1 to an
/// existing base64 GraphQL resolver, preserving its ownership + gating.
#[derive(Debug, Clone, Copy)]
pub enum Asset {
    /// Surface STIN mesh (Crew).
    SurfaceMesh(Uuid),
    /// Volume cut/fill heatmap, SVOL (Crew).
    VolumeHeatmap(Uuid),
    /// Coarse project terrain GeoTIFF (ungated — the scene floor).
    ProjectTerrain(Uuid),
    /// Boundary-AOI 1 m detailed terrain GeoTIFF (ungated).
    ProjectDetailedTerrain(Uuid),
    /// Project buildings GeoJSON (ungated).
    ProjectBuildings(Uuid),
}

impl Asset {
    /// Whether the asset is behind the Crew (`Feature::Surfaces`) gate. Base
    /// terrain + buildings are ungated (they render for every plan).
    fn is_crew_gated(self) -> bool {
        matches!(self, Asset::SurfaceMesh(_) | Asset::VolumeHeatmap(_))
    }
}

/// A resolved-and-owned blob location, ready to fetch + serve.
struct Located {
    key: String,
    content_type: &'static str,
    filename: String,
}

/// Resolves any [`Asset`] to an [`AssetOutcome`]: auth required, Crew-gated where
/// applicable, org-scoped, with a sha256 ETag driving conditional `304`s. This is
/// the single policy point the HTTP handler wraps.
pub async fn resolve_asset(
    pool: &PgPool,
    storage: &dyn Storage,
    auth: Option<&AuthContext>,
    asset: Asset,
    if_none_match: Option<&str>,
) -> Result<AssetOutcome, String> {
    let auth = match auth {
        Some(a) => a,
        None => return Ok(AssetOutcome::Unauthorized),
    };
    // Gate before ownership (matches resolver order; a Solo user probing another
    // org's blob learns nothing about whether it exists).
    if asset.is_crew_gated()
        && !org_billing(pool, auth.org_id)
            .await
            .map_err(|e| e.to_string())?
            .has_feature(Feature::Surfaces)
    {
        return Ok(AssetOutcome::Forbidden);
    }
    let located = match asset {
        Asset::SurfaceMesh(id) => {
            locate_keyed(
                pool,
                "SELECT s.name, s.storage_key FROM surfaces s \
                 JOIN projects p ON p.id = s.project_id \
                 WHERE s.id = $1 AND p.org_id = $2",
                id,
                auth.org_id,
                "application/octet-stream",
                "stin",
            )
            .await?
        }
        Asset::VolumeHeatmap(id) => {
            locate_keyed(
                pool,
                "SELECT v.name, v.heatmap_key FROM volumes v \
                 JOIN projects p ON p.id = v.project_id \
                 WHERE v.id = $1 AND p.org_id = $2",
                id,
                auth.org_id,
                "application/octet-stream",
                "svol",
            )
            .await?
        }
        Asset::ProjectTerrain(pid) => {
            locate_project(
                pool,
                "project_terrain",
                pid,
                auth.org_id,
                "image/tiff",
                "terrain.tif",
            )
            .await?
        }
        Asset::ProjectDetailedTerrain(pid) => {
            locate_project(
                pool,
                "project_detailed_terrain",
                pid,
                auth.org_id,
                "image/tiff",
                "terrain-detailed.tif",
            )
            .await?
        }
        Asset::ProjectBuildings(pid) => {
            locate_project(
                pool,
                "project_buildings",
                pid,
                auth.org_id,
                "application/json",
                "buildings.json",
            )
            .await?
        }
    };
    let Some(loc) = located else {
        return Ok(AssetOutcome::NotFound);
    };
    let bytes = match storage.get(&loc.key).await {
        Ok(b) => b,
        Err(_) => return Ok(AssetOutcome::NotFound),
    };
    let etag = etag_for(&bytes);
    if if_none_match == Some(etag.as_str()) {
        return Ok(AssetOutcome::NotModified);
    }
    Ok(AssetOutcome::Found {
        bytes,
        etag,
        content_type: loc.content_type,
        filename: loc.filename,
    })
}

/// Serves a surface's STIN render mesh — a thin alias for [`resolve_asset`] with
/// [`Asset::SurfaceMesh`].
pub async fn surface_mesh_asset(
    pool: &PgPool,
    storage: &dyn Storage,
    auth: Option<&AuthContext>,
    id: Uuid,
    if_none_match: Option<&str>,
) -> Result<AssetOutcome, String> {
    resolve_asset(pool, storage, auth, Asset::SurfaceMesh(id), if_none_match).await
}

/// Ownership lookup for a `(name, nullable storage_key)` row addressed by its own
/// id + org. Builds the filename as `{name}.{ext}`. `None` for missing / cross-
/// tenant rows *and* rows whose blob hasn't been computed yet.
async fn locate_keyed(
    pool: &PgPool,
    sql: &str,
    id: Uuid,
    org_id: Uuid,
    content_type: &'static str,
    ext: &str,
) -> Result<Option<Located>, String> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(sql)
        .bind(id)
        .bind(org_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(match row {
        Some((name, Some(key))) => Some(Located {
            key,
            content_type,
            filename: format!("{name}.{ext}"),
        }),
        _ => None,
    })
}

/// Ownership lookup for a per-project singleton blob (`project_terrain` etc.),
/// keyed by `project_id` and org-scoped via a join to `projects`. `table` is a
/// trusted constant, never user input.
async fn locate_project(
    pool: &PgPool,
    table: &str,
    project_id: Uuid,
    org_id: Uuid,
    content_type: &'static str,
    filename: &str,
) -> Result<Option<Located>, String> {
    let sql = format!(
        "SELECT t.storage_key FROM {table} t \
         JOIN projects p ON p.id = t.project_id \
         WHERE t.project_id = $1 AND p.org_id = $2"
    );
    let row: Option<(String,)> = sqlx::query_as(&sql)
        .bind(project_id)
        .bind(org_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.map(|(key,)| Located {
        key,
        content_type,
        filename: filename.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etag_is_quoted_stable_and_content_sensitive() {
        let a = etag_for(b"STIN....payload");
        assert!(a.starts_with('"') && a.ends_with('"'));
        assert_eq!(a, etag_for(b"STIN....payload"), "same bytes → same ETag");
        assert_ne!(
            a,
            etag_for(b"different"),
            "different bytes → different ETag"
        );
    }
}
