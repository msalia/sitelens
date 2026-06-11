#![allow(clippy::too_many_arguments)]
use super::*;

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
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
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
        let storage = ctx.data::<Arc<dyn Storage>>()?;
        let bytes = storage.get(&key).await.map_err(async_graphql::Error::new)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
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
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        // `demtype` is optional: when omitted we auto-select the best available
        // (USGS 3DEP 10 m for the US, falling back to global SRTM 30 m).
        let explicit_demtype = demtype.filter(|d| !d.trim().is_empty());
        let force = force.unwrap_or(false);

        let existing: Option<(DateTime<Utc>,)> =
            sqlx::query_as("SELECT fetched_at FROM project_terrain WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        if let Some((fetched_at,)) = existing {
            if !force {
                // Already cached and no forced refresh requested — reuse it.
                let row = sqlx::query_as(&format!(
                    "SELECT {TERRAIN_COLUMNS} FROM project_terrain WHERE project_id = $1"
                ))
                .bind(project_id)
                .fetch_one(pool)
                .await?;
                return Ok(row);
            }
            let age = Utc::now() - fetched_at;
            if age < chrono::Duration::days(7) {
                let days = (7 - age.num_days()).max(1);
                return Err(async_graphql::Error::new(format!(
                    "Terrain was refreshed recently — try again in {days} day(s)."
                )));
            }
        }

        let api_key = std::env::var("OPENTOPO_API_KEY")
            .map_err(|_| async_graphql::Error::new("OPENTOPO_API_KEY is not configured"))?;
        let client = reqwest::Client::new();

        // Fetch a GeoTIFF DEM from a URL; None on any non-success/empty response.
        async fn fetch_dem(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
            let resp = client.get(url).send().await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let b = resp.bytes().await.ok()?;
            if b.is_empty() {
                None
            } else {
                Some(b.to_vec())
            }
        }
        let bbox = format!("south={south}&north={north}&west={west}&east={east}");

        let (bytes, used_demtype): (Vec<u8>, String) = if let Some(dt) = explicit_demtype {
            // Caller asked for a specific global DEM type.
            let url = format!(
                "https://portal.opentopography.org/API/globaldem?demtype={dt}&{bbox}\
                 &outputFormat=GTiff&API_Key={api_key}"
            );
            match fetch_dem(&client, &url).await {
                Some(b) => (b, dt),
                None => return Err(async_graphql::Error::new("OpenTopography returned no data")),
            }
        } else {
            // Auto: USGS 3DEP 10 m (US), else global SRTM 30 m.
            let usgs = format!(
                "https://portal.opentopography.org/API/usgsdem?datasetName=USGS10m&{bbox}\
                 &outputFormat=GTiff&API_Key={api_key}"
            );
            let srtm = format!(
                "https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1&{bbox}\
                 &outputFormat=GTiff&API_Key={api_key}"
            );
            if let Some(b) = fetch_dem(&client, &usgs).await {
                (b, "USGS10m".to_string())
            } else if let Some(b) = fetch_dem(&client, &srtm).await {
                (b, "SRTMGL1".to_string())
            } else {
                return Err(async_graphql::Error::new(
                    "OpenTopography returned no terrain for this area",
                ));
            }
        };

        let storage = ctx.data::<Arc<dyn Storage>>()?;
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
        let auth = require_editor(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;
        let force = force.unwrap_or(false);

        let existing: Option<(DateTime<Utc>,)> =
            sqlx::query_as("SELECT fetched_at FROM project_buildings WHERE project_id = $1")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        if let Some((fetched_at,)) = existing {
            if !force {
                let row = sqlx::query_as(&format!(
                    "SELECT {BUILDINGS_COLUMNS} FROM project_buildings WHERE project_id = $1"
                ))
                .bind(project_id)
                .fetch_one(pool)
                .await?;
                return Ok(row);
            }
            let age = Utc::now() - fetched_at;
            if age < chrono::Duration::days(7) {
                let days = (7 - age.num_days()).max(1);
                return Err(async_graphql::Error::new(format!(
                    "Buildings were refreshed recently — try again in {days} day(s)."
                )));
            }
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
        let storage = ctx.data::<Arc<dyn Storage>>()?;
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
        Ok(row)
    }
}
