#![allow(clippy::too_many_arguments)]
use super::*;
// `.encode()` resolves through the base64 `Engine` trait; it must be in scope
// (method-only import, no name bound).
use base64::Engine as _;

const TERRAIN_COLUMNS: &str = "project_id, demtype, south, north, west, east, fetched_at";
const BUILDINGS_COLUMNS: &str = "project_id, count, fetched_at";

/// Best-effort building height (meters) from OSM tags: `height`, else
/// `building:levels` × 3 m, else a 2-storey default.
fn building_height(tags: &serde_json::Value) -> f64 {
    if let Some(h) = tags.get("height").and_then(|v| v.as_str()) {
        if let Some(n) = h
            .split_whitespace()
            .next()
            .and_then(|s| s.parse::<f64>().ok())
        {
            if n > 0.0 {
                return n;
            }
        }
    }
    if let Some(l) = tags.get("building:levels").and_then(|v| v.as_str()) {
        if let Ok(n) = l.trim().parse::<f64>() {
            return (n * 3.0).max(2.0);
        }
    }
    6.0
}

/// Outcome of the refresh cooldown check (see [`refresh_cooldown`]).
enum Refresh<T> {
    /// A cached row exists and no forced refresh was requested — return it.
    Cached(T),
    /// No cache (or a forced refresh past the cooldown) — go fetch.
    Proceed,
}

/// Shared cache + 7-day cooldown gate for the terrain/buildings refresh mutations.
/// Reads `fetched_at` from `table`; if present and not `force`, returns the cached
/// row (`SELECT {columns}`); if present, `force`, and still within 7 days, errors
/// with "{subject} refreshed recently…". `subject` is the full phrase up to the
/// verb (e.g. "Terrain was", "Buildings were") so each message reads naturally.
async fn refresh_cooldown<T>(
    pool: &PgPool,
    table: &str,
    columns: &str,
    subject: &str,
    project_id: Uuid,
    force: bool,
) -> Result<Refresh<T>>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> + Send + Unpin,
{
    let existing: Option<(DateTime<Utc>,)> = sqlx::query_as(&format!(
        "SELECT fetched_at FROM {table} WHERE project_id = $1"
    ))
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    if let Some((fetched_at,)) = existing {
        if !force {
            let row = sqlx::query_as(&format!(
                "SELECT {columns} FROM {table} WHERE project_id = $1"
            ))
            .bind(project_id)
            .fetch_one(pool)
            .await?;
            return Ok(Refresh::Cached(row));
        }
        let age = Utc::now() - fetched_at;
        if age < chrono::Duration::days(7) {
            let days = (7 - age.num_days()).max(1);
            return Err(async_graphql::Error::new(format!(
                "{subject} refreshed recently — try again in {days} day(s)."
            )));
        }
    }
    Ok(Refresh::Proceed)
}

/// Fetches a GeoTIFF from the free, keyless **USGS 3DEP ImageServer** for a
/// geographic bbox at the given output pixel size (`nx`×`ny`). The service is
/// seamless bare-earth 3DEP (~1 m native where available, coarser elsewhere), so
/// the caller picks `nx`/`ny` to set the effective resolution. US-only. Returns
/// the tiff bytes, or an error carrying the service's HTTP status + message.
async fn fetch_3dep_geotiff(
    client: &reqwest::Client,
    west: f64,
    south: f64,
    east: f64,
    north: f64,
    nx: i64,
    ny: i64,
) -> std::result::Result<Vec<u8>, String> {
    let url = format!(
        "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage\
         ?bbox={west},{south},{east},{north}&bboxSR=4326&imageSR=4326&size={nx},{ny}\
         &format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image"
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("3DEP request failed: {e}"))?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("3DEP read failed: {e}"))?;
    // A GeoTIFF starts with II* / MM; an error comes back as JSON/text.
    let is_tiff = bytes.len() > 4 && (&bytes[..2] == b"II" || &bytes[..2] == b"MM");
    if !status.is_success() || !is_tiff {
        let body = String::from_utf8_lossy(&bytes);
        let snippet: String = body.trim().chars().take(300).collect();
        return Err(format!(
            "USGS 3DEP fetch failed (HTTP {status}): {}",
            if snippet.is_empty() {
                "no 3DEP elevation for this area (US-only coverage)".to_string()
            } else {
                snippet
            }
        ));
    }
    Ok(bytes.to_vec())
}

#[derive(Default)]
pub struct TerrainQuery;

#[Object]
impl TerrainQuery {
    /// Cached OpenTopography terrain metadata for a project (null until first
    /// fetched). Drives the "Refresh terrain" 7-day cooldown on the client.
    async fn project_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<ProjectTerrain>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row = sqlx::query_as(&format!(
            "SELECT {TERRAIN_COLUMNS} FROM project_terrain WHERE project_id = $1"
        ))
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// Base64-encoded cached DEM GeoTIFF for the project's terrain.
    async fn project_terrain_content(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let key: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let Some((key,)) = key else {
            return Err(async_graphql::Error::new(
                "no terrain cached for this project",
            ));
        };
        let storage = storage(ctx)?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        // Base64-encoding a multi-MB GeoTIFF is CPU-bound; do it off the async
        // worker so it doesn't stall other requests on the same thread.
        tokio::task::spawn_blocking(move || base64::engine::general_purpose::STANDARD.encode(bytes))
            .await
            .map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    /// Cached detailed (1 m 3DEP) terrain metadata for a project (null until first
    /// fetched). Present only when a boundary was defined at refresh time.
    async fn project_detailed_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<ProjectTerrain>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row = sqlx::query_as(&format!(
            "SELECT {TERRAIN_COLUMNS} FROM project_detailed_terrain WHERE project_id = $1"
        ))
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// Base64 detailed-terrain GeoTIFF, or null when none is cached (so the client
    /// can fall back to the coarse terrain).
    async fn project_detailed_terrain_content(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<String>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let key: Option<(String,)> = sqlx::query_as(
            "SELECT storage_key FROM project_detailed_terrain WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        let Some((key,)) = key else {
            return Ok(None);
        };
        let storage = storage(ctx)?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        let b64 = tokio::task::spawn_blocking(move || {
            base64::engine::general_purpose::STANDARD.encode(bytes)
        })
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(Some(b64))
    }

    /// Cached OSM buildings metadata for a project (null when none fetched yet).
    async fn project_buildings(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<ProjectBuildings>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let row = sqlx::query_as(&format!(
            "SELECT {BUILDINGS_COLUMNS} FROM project_buildings WHERE project_id = $1"
        ))
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// The cached building footprints as a JSON string:
    /// `[{"poly":[[lat,lon],...],"height":<m>}, ...]`.
    async fn project_buildings_content(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<String> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let key: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_buildings WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let Some((key,)) = key else {
            return Err(async_graphql::Error::new(
                "no buildings cached for this project",
            ));
        };
        let storage = storage(ctx)?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The boundary-split **composite terrain**: coarse DEM outside the property
    /// boundary + the 1 m detail DEM inside it, stitched at a shared ring into one
    /// continuous surface. Returned as a base64 **CTER** blob. `null` when the
    /// project has no boundary or is missing either DEM (the client then falls
    /// back to the plain coarse terrain). Ungated — the base scene floor.
    async fn project_composite_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<Option<String>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let row: Option<(Option<serde_json::Value>, i32)> = sqlx::query_as(
            "SELECT boundary, epsg_code FROM projects WHERE id = $1 AND org_id = $2",
        )
        .bind(project_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (boundary, epsg) = found_in_org(row, "project")?;
        let Some(boundary) = boundary else {
            return Ok(None); // no boundary → no split; client uses coarse terrain
        };
        let pts: Vec<[f64; 2]> = serde_json::from_value(boundary)
            .map_err(|e| async_graphql::Error::new(format!("invalid boundary geometry: {e}")))?;
        // Boundary → geographic [lon, lat] (matches how the detail AOI was fetched).
        let boundary_lonlat: Vec<[f64; 2]> = pts
            .iter()
            .filter_map(|[e, n]| crate::crs::projected_to_geographic(epsg, *e, *n))
            .map(|(lat, lon)| [lon, lat])
            .collect();
        if boundary_lonlat.len() < 3 {
            return Ok(None);
        }

        // Need both DEMs cached.
        let ckey: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let dkey: Option<(String,)> = sqlx::query_as(
            "SELECT storage_key FROM project_detailed_terrain WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
        let (Some((ckey,)), Some((dkey,))) = (ckey, dkey) else {
            return Ok(None);
        };
        let storage = storage(ctx)?;
        let coarse_bytes = storage
            .get(&ckey)
            .await
            .map_err(async_graphql::Error::new)?;
        let detail_bytes = storage
            .get(&dkey)
            .await
            .map_err(async_graphql::Error::new)?;

        // Decode + composite + serialize off the async workers (CPU-bound).
        let b64 = tokio::task::spawn_blocking(move || -> Result<String, String> {
            let coarse = crate::surface::geotiff::read_geotiff(&coarse_bytes)?;
            let detail = crate::surface::geotiff::read_geotiff(&detail_bytes)?;
            let mesh = crate::surface::terrain_composite::build_composite(
                &coarse,
                &detail,
                &boundary_lonlat,
            )?;
            let blob = crate::surface::serialize_composite(
                &mesh.vertices,
                &mesh.alpha,
                &mesh.coarse_tris,
                &mesh.detail_tris,
            );
            use base64::Engine;
            Ok(base64::engine::general_purpose::STANDARD.encode(blob))
        })
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?
        .map_err(async_graphql::Error::new)?;
        Ok(Some(b64))
    }

    /// A compact draping heightfield (base64 **SAMP** blob): a small lat/lon grid
    /// over the coarse extent, detail elevation inside the property boundary and
    /// coarse outside. The client bilinear-samples it to drape points/grid/
    /// buildings — no client GeoTIFF decode. `null` until terrain is cached.
    async fn terrain_sampler(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<Option<String>> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        let ckey: Option<(String,)> =
            sqlx::query_as("SELECT storage_key FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        let Some((ckey,)) = ckey else {
            return Ok(None); // no coarse terrain yet
        };

        // Optional detail DEM + boundary → detail elevations inside the boundary.
        let row: Option<(Option<serde_json::Value>, i32)> = sqlx::query_as(
            "SELECT boundary, epsg_code FROM projects WHERE id = $1 AND org_id = $2",
        )
        .bind(project_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (boundary, epsg) = found_in_org(row, "project")?;
        let boundary_lonlat: Option<Vec<[f64; 2]>> = boundary.and_then(|b| {
            serde_json::from_value::<Vec<[f64; 2]>>(b).ok().map(|pts| {
                pts.iter()
                    .filter_map(|[e, n]| crate::crs::projected_to_geographic(epsg, *e, *n))
                    .map(|(lat, lon)| [lon, lat])
                    .collect()
            })
        });
        let dkey: Option<(String,)> = sqlx::query_as(
            "SELECT storage_key FROM project_detailed_terrain WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

        let storage = storage(ctx)?;
        let coarse_bytes = storage
            .get(&ckey)
            .await
            .map_err(async_graphql::Error::new)?;
        let detail_bytes = match dkey {
            Some((k,)) => Some(storage.get(&k).await.map_err(async_graphql::Error::new)?),
            None => None,
        };

        let b64 = tokio::task::spawn_blocking(move || -> Result<String, String> {
            let coarse = crate::surface::geotiff::read_geotiff(&coarse_bytes)?;
            let detail = match detail_bytes {
                Some(b) => Some(crate::surface::geotiff::read_geotiff(&b)?),
                None => None,
            };
            // Only use detail when we also have a boundary (≥3 verts) to bound it.
            let bnd = boundary_lonlat.as_deref().filter(|b| b.len() >= 3);
            let grid = crate::surface::sampler::build_sampler(
                &coarse,
                if bnd.is_some() { detail.as_ref() } else { None },
                bnd,
                256,
            );
            let blob = crate::surface::serialize_sampler(&grid);
            use base64::Engine;
            Ok(base64::engine::general_purpose::STANDARD.encode(blob))
        })
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))?
        .map_err(async_graphql::Error::new)?;
        Ok(Some(b64))
    }
}

#[derive(Default)]
pub struct TerrainMutation;

#[Object]
impl TerrainMutation {
    /// Fetches (if needed) and caches the OpenTopography DEM for a project's
    /// bbox. Lazy: a cached terrain is reused unless `force`. A forced refresh is
    /// blocked for 7 days after the last fetch (OpenTopography is rate-limited).
    /// The DEM is fetched server-side here; the API key never reaches the client.
    async fn refresh_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        south: f64,
        north: f64,
        west: f64,
        east: f64,
        demtype: Option<String>,
        force: Option<bool>,
    ) -> Result<ProjectTerrain> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        // `demtype` is optional: when omitted we auto-select the best available
        // (USGS 3DEP 10 m for the US, falling back to global SRTM 30 m).
        let explicit_demtype = demtype.filter(|d| !d.trim().is_empty());
        let force = force.unwrap_or(false);

        if let Refresh::Cached(row) = refresh_cooldown::<ProjectTerrain>(
            pool,
            "project_terrain",
            TERRAIN_COLUMNS,
            "Terrain was",
            project_id,
            force,
        )
        .await?
        {
            return Ok(row);
        }

        // Coarse context backdrop from the keyless USGS 3DEP ImageServer (US-only),
        // sized at ~10 m/px over the bbox. `demtype` is accepted for API
        // compatibility but no longer selects a provider.
        let _ = explicit_demtype;
        let client = reqwest::Client::new();
        let mid_lat = (south + north) / 2.0;
        let w_m = (east - west) * 111_320.0 * mid_lat.to_radians().cos().abs();
        let h_m = (north - south) * 111_320.0;
        let nx = ((w_m / 10.0).round() as i64).clamp(2, 800);
        let ny = ((h_m / 10.0).round() as i64).clamp(2, 800);
        let bytes = fetch_3dep_geotiff(&client, west, south, east, north, nx, ny)
            .await
            .map_err(async_graphql::Error::new)?;
        let used_demtype = "USGS3DEP";

        let storage = storage(ctx)?;
        let key = format!("terrain/{project_id}.tif");
        storage
            .put(&key, &bytes)
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectTerrain = sqlx::query_as(&format!(
            "INSERT INTO project_terrain \
             (project_id, demtype, south, north, west, east, storage_key, fetched_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, now()) \
             ON CONFLICT (project_id) DO UPDATE SET \
               demtype = EXCLUDED.demtype, south = EXCLUDED.south, north = EXCLUDED.north, \
               west = EXCLUDED.west, east = EXCLUDED.east, storage_key = EXCLUDED.storage_key, \
               fetched_at = now() \
             RETURNING {TERRAIN_COLUMNS}"
        ))
        .bind(project_id)
        .bind(used_demtype.trim())
        .bind(south)
        .bind(north)
        .bind(west)
        .bind(east)
        .bind(&key)
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row)
    }

    /// Fetches (if needed) the **~1 m USGS 3DEP** DEM for the project's
    /// property-boundary AOI — the accurate base for cut/fill volumes (and future
    /// hydrology), distinct from the coarse context terrain. Requires a boundary;
    /// the client calls this alongside `refreshTerrain` when one is defined. Same
    /// 7-day cooldown. Uses the free, keyless USGS 3DEP ImageServer.
    async fn refresh_detailed_terrain(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        force: Option<bool>,
    ) -> Result<ProjectTerrain> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let force = force.unwrap_or(false);

        // The boundary (projected meters) + CRS define the AOI to fetch at 1 m.
        let row: Option<(Option<serde_json::Value>, i32)> = sqlx::query_as(
            "SELECT boundary, epsg_code FROM projects WHERE id = $1 AND org_id = $2",
        )
        .bind(project_id)
        .bind(auth.org_id)
        .fetch_optional(pool)
        .await?;
        let (boundary, epsg) = found_in_org(row, "project")?;
        let Some(boundary) = boundary else {
            return Err(async_graphql::Error::new(
                "define a property boundary first — the 1 m fetch is bounded to it",
            ));
        };
        let pts: Vec<[f64; 2]> = serde_json::from_value(boundary)
            .map_err(|e| async_graphql::Error::new(format!("invalid boundary geometry: {e}")))?;
        // Projected extent (meters) — for the ~1 m output pixel sizing.
        let (mut min_e, mut max_e, mut min_n, mut max_n) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        // Geographic bbox (degrees) — for the request + stored metadata.
        let (mut south, mut north, mut west, mut east) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        for [e, n] in &pts {
            min_e = min_e.min(*e);
            max_e = max_e.max(*e);
            min_n = min_n.min(*n);
            max_n = max_n.max(*n);
            if let Some((lat, lon)) = crate::crs::projected_to_geographic(epsg, *e, *n) {
                south = south.min(lat);
                north = north.max(lat);
                west = west.min(lon);
                east = east.max(lon);
            }
        }
        if !south.is_finite() || !west.is_finite() {
            return Err(async_graphql::Error::new(
                "could not derive a lat/lon bbox from the boundary",
            ));
        }
        // Small pad so the AOI edge isn't clipped.
        let pad_lat = ((north - south) * 0.05).max(0.0005);
        let pad_lon = ((east - west) * 0.05).max(0.0005);
        south -= pad_lat;
        north += pad_lat;
        west -= pad_lon;
        east += pad_lon;
        // Output size ≈ 1 px/m over the padded projected extent, clamped to the
        // ImageServer's export limits.
        let width_m = (max_e - min_e).max(1.0) * 1.1;
        let height_m = (max_n - min_n).max(1.0) * 1.1;
        let nx = (width_m.round() as i64).clamp(2, 4000);
        let ny = (height_m.round() as i64).clamp(2, 4000);

        if let Refresh::Cached(row) = refresh_cooldown::<ProjectTerrain>(
            pool,
            "project_detailed_terrain",
            TERRAIN_COLUMNS,
            "Detailed terrain was",
            project_id,
            force,
        )
        .await?
        {
            return Ok(row);
        }

        // Keyless USGS 3DEP ImageServer at ~1 m over the boundary AOI.
        let client = reqwest::Client::new();
        let bytes = fetch_3dep_geotiff(&client, west, south, east, north, nx, ny)
            .await
            .map_err(async_graphql::Error::new)?;

        let storage = storage(ctx)?;
        let key = format!("terrain-detailed/{project_id}.tif");
        storage
            .put(&key, &bytes)
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectTerrain = sqlx::query_as(&format!(
            "INSERT INTO project_detailed_terrain \
             (project_id, demtype, south, north, west, east, storage_key, fetched_at) \
             VALUES ($1, 'USGS3DEP1m', $2, $3, $4, $5, $6, now()) \
             ON CONFLICT (project_id) DO UPDATE SET \
               demtype = EXCLUDED.demtype, south = EXCLUDED.south, north = EXCLUDED.north, \
               west = EXCLUDED.west, east = EXCLUDED.east, storage_key = EXCLUDED.storage_key, \
               fetched_at = now() \
             RETURNING {TERRAIN_COLUMNS}"
        ))
        .bind(project_id)
        .bind(south)
        .bind(north)
        .bind(west)
        .bind(east)
        .bind(&key)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Fetches (if needed) and caches OSM building footprints for the bbox from
    /// the free Overpass API. Same 7-day cooldown as terrain. Visual context only.
    async fn refresh_buildings(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
        south: f64,
        north: f64,
        west: f64,
        east: f64,
        force: Option<bool>,
    ) -> Result<ProjectBuildings> {
        let auth = require_editor_active(ctx).await?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let force = force.unwrap_or(false);

        if let Refresh::Cached(row) = refresh_cooldown::<ProjectBuildings>(
            pool,
            "project_buildings",
            BUILDINGS_COLUMNS,
            "Buildings were",
            project_id,
            force,
        )
        .await?
        {
            return Ok(row);
        }

        // Overpass QL: building ways within the bbox, with node geometry + tags.
        let query = format!(
            "[out:json][timeout:25];(way[\"building\"]({south},{west},{north},{east}););out geom tags;"
        );
        // The public Overpass instances are frequently overloaded (transient 504s)
        // and reject a missing/default User-Agent with HTTP 406. We try the primary
        // endpoint then community mirrors in turn, retrying past transient failures
        // (network errors, timeouts, 429, 5xx) but bailing on a definitive 4xx. The
        // query is sent as the canonical form-encoded `data=` parameter.
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(40))
            .build()
            .map_err(|e| async_graphql::Error::new(format!("HTTP client error: {e}")))?;
        const OVERPASS_ENDPOINTS: [&str; 3] = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        ];
        let mut json: Option<serde_json::Value> = None;
        let mut last_err = String::from("Overpass request failed");
        for endpoint in OVERPASS_ENDPOINTS {
            match client
                .post(endpoint)
                .header("User-Agent", "SiteLens/1.0 (+https://sitelens.msalia.org)")
                .form(&[("data", query.as_str())])
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.bytes().await {
                            Ok(body) => match serde_json::from_slice(&body) {
                                Ok(parsed) => {
                                    json = Some(parsed);
                                    break;
                                }
                                Err(e) => last_err = format!("Overpass parse failed: {e}"),
                            },
                            Err(e) => last_err = format!("Overpass read failed: {e}"),
                        }
                    } else {
                        let code = status.as_u16();
                        last_err = format!("Overpass error ({code})");
                        // 4xx (other than rate-limit) is a definitive client error —
                        // retrying another mirror won't help, so stop now.
                        if (400..500).contains(&code) && code != 429 {
                            return Err(async_graphql::Error::new(last_err));
                        }
                    }
                }
                Err(e) => last_err = format!("Overpass request failed: {e}"),
            }
        }
        let json = json.ok_or_else(|| {
            async_graphql::Error::new(format!(
                "{last_err}. OpenStreetMap's building service is busy — please try again shortly."
            ))
        })?;

        let mut buildings: Vec<serde_json::Value> = Vec::new();
        if let Some(elements) = json["elements"].as_array() {
            for el in elements {
                let Some(geom) = el["geometry"].as_array() else {
                    continue;
                };
                let poly: Vec<[f64; 2]> = geom
                    .iter()
                    .filter_map(|g| Some([g["lat"].as_f64()?, g["lon"].as_f64()?]))
                    .collect();
                if poly.len() < 3 {
                    continue;
                }
                buildings.push(serde_json::json!({
                    "poly": poly,
                    "height": building_height(&el["tags"]),
                }));
                if buildings.len() >= 4000 {
                    break;
                }
            }
        }

        let count = buildings.len() as i32;
        let payload = serde_json::Value::Array(buildings).to_string();
        let storage = storage(ctx)?;
        let key = format!("buildings/{project_id}.json");
        storage
            .put(&key, payload.as_bytes())
            .await
            .map_err(async_graphql::Error::new)?;
        let row: ProjectBuildings = sqlx::query_as(&format!(
            "INSERT INTO project_buildings (project_id, storage_key, count, fetched_at) \
             VALUES ($1, $2, $3, now()) \
             ON CONFLICT (project_id) DO UPDATE SET \
               storage_key = EXCLUDED.storage_key, count = EXCLUDED.count, fetched_at = now() \
             RETURNING {BUILDINGS_COLUMNS}"
        ))
        .bind(project_id)
        .bind(&key)
        .bind(count)
        .fetch_one(pool)
        .await?;
        publish_scene(ctx, project_id);
        Ok(row)
    }
}
