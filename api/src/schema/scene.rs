#![allow(clippy::too_many_arguments)]
#![allow(clippy::type_complexity)]
use super::*;

#[derive(Default)]
pub struct SceneQuery;

#[Object]
impl SceneQuery {
    /// Everything the 3D viewer needs, pre-projected to geographic coordinates.
    async fn scene_data(&self, ctx: &Context<'_>, project_id: Uuid) -> Result<SceneData> {
        let auth = require_auth(ctx)?;
        let pool = pool(ctx)?;
        ensure_project_in_org(pool, project_id, auth.org_id).await?;

        // The independent reads (project params, transform, centroid, control +
        // survey points) are fetched concurrently — one round-trip instead of ~5.
        type SurveyRow = (Uuid, String, f64, f64, Option<f64>, Option<Uuid>);
        let proj_q = sqlx::query_as::<_, (i32, Option<f64>, Option<f64>, f64)>(
            "SELECT epsg_code, site_origin_lat, site_origin_lon, site_origin_rotation_deg \
             FROM projects WHERE id = $1",
        )
        .bind(project_id)
        .fetch_one(pool);
        let cp_q = sqlx::query_as::<_, (String, f64, f64, Option<f64>)>(
            "SELECT label, easting, northing, elevation FROM control_points \
             WHERE project_id = $1 ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool);
        let sp_q = sqlx::query_as::<_, SurveyRow>(
            "SELECT id, label, easting, northing, elevation, category_id FROM survey_points \
             WHERE project_id = $1 AND point_type = 'design' ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(pool);
        let ((epsg, lat, lon, rot_deg), params, centroid, cps, sps) = tokio::try_join!(
            async { proj_q.await.map_err(async_graphql::Error::from) },
            load_transform_params(pool, project_id),
            points_centroid(pool, project_id),
            async { cp_q.await.map_err(async_graphql::Error::from) },
            async { sp_q.await.map_err(async_graphql::Error::from) },
        )?;
        // The site spins about the centroid of all points, not the origin.
        let rotation = site_rotation(centroid, rot_deg);

        let to_scene = |id: Option<Uuid>,
                        label: String,
                        e: f64,
                        n: f64,
                        z: Option<f64>,
                        cat: Option<Uuid>|
         -> Option<ScenePoint> {
            // Rotate the stored projected coords to true earth for placement, but
            // keep the stored easting/northing on the point (the converter applies
            // the same rotation, so the inspector stays consistent).
            let (te, tn) = rotation.map_or((e, n), |r| r.to_true(e, n));
            crs::projected_to_geographic(epsg, te, tn).map(|(latitude, longitude)| ScenePoint {
                id,
                label,
                latitude,
                longitude,
                height: z.unwrap_or(0.0),
                easting: e,
                northing: n,
                category_id: cat,
            })
        };

        let control_points: Vec<ScenePoint> = cps
            .into_iter()
            .filter_map(|(label, e, n, z)| to_scene(None, label, e, n, z, None))
            .collect();
        let survey_points: Vec<ScenePoint> = sps
            .into_iter()
            .filter_map(|(id, label, e, n, z, cat)| to_scene(Some(id), label, e, n, z, cat))
            .collect();

        // Grid lines need the transform to place axes in projected space.
        let mut grid_lines = Vec::new();
        if let Some(t) = params {
            let axes: Vec<(String, String, f64)> = sqlx::query_as(
                "SELECT family, label, position FROM grid_axes WHERE project_id = $1",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?;
            let span = |vals: Vec<f64>| -> (f64, f64) {
                if vals.is_empty() {
                    (-50.0, 50.0)
                } else {
                    let min = vals.iter().cloned().fold(f64::INFINITY, f64::min);
                    let max = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                    (min, max)
                }
            };
            let (xmin, xmax) = span(
                axes.iter()
                    .filter(|(f, _, _)| f == "numbered")
                    .map(|(_, _, p)| *p)
                    .collect(),
            );
            let (ymin, ymax) = span(
                axes.iter()
                    .filter(|(f, _, _)| f == "lettered")
                    .map(|(_, _, p)| *p)
                    .collect(),
            );
            for (family, label, pos) in &axes {
                let ends = if family == "lettered" {
                    [(xmin, *pos), (xmax, *pos)]
                } else {
                    [(*pos, ymin), (*pos, ymax)]
                };
                let coords: Vec<crate::models::LatLng> = ends
                    .iter()
                    .filter_map(|&(gx, gy)| {
                        let (e, n) = t.apply(gx, gy);
                        let (te, tn) = rotation.map_or((e, n), |r| r.to_true(e, n));
                        crs::projected_to_geographic(epsg, te, tn).map(|(latitude, longitude)| {
                            crate::models::LatLng {
                                latitude,
                                longitude,
                                height: 0.0,
                            }
                        })
                    })
                    .collect();
                if coords.len() == 2 {
                    grid_lines.push(SceneLine {
                        label: label.clone(),
                        coordinates: coords,
                    });
                }
            }
        }

        // Utilities → geographic, drawn as tubes/solids by the viewer. Projected
        // coords go through the same rotation as points so everything lines up.
        let to_latlng = |e: f64, n: f64, z: Option<f64>| -> Option<crate::models::LatLng> {
            let (te, tn) = rotation.map_or((e, n), |r| r.to_true(e, n));
            crs::projected_to_geographic(epsg, te, tn).map(|(latitude, longitude)| {
                crate::models::LatLng {
                    latitude,
                    longitude,
                    height: z.unwrap_or(0.0),
                }
            })
        };

        let run_rows: Vec<(Uuid, String, String, Option<f64>, String)> = sqlx::query_as(
            "SELECT r.id, r.type_key, r.label, r.diameter, t.apwa_color \
             FROM utility_runs r JOIN utility_types t ON t.key = r.type_key \
             WHERE r.project_id = $1 AND r.deleted_at IS NULL ORDER BY r.created_at",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        let mut utility_runs = Vec::with_capacity(run_rows.len());
        for (id, type_key, label, diameter, apwa_color) in run_rows {
            let verts: Vec<(f64, f64, Option<f64>)> = sqlx::query_as(
                "SELECT northing, easting, elevation FROM utility_vertices \
                 WHERE run_id = $1 ORDER BY seq",
            )
            .bind(id)
            .fetch_all(pool)
            .await?;
            let vertices: Vec<crate::models::LatLng> = verts
                .into_iter()
                .filter_map(|(n, e, z)| to_latlng(e, n, z))
                .collect();
            if vertices.len() >= 2 {
                utility_runs.push(SceneUtilityRun {
                    id,
                    type_key,
                    label,
                    apwa_color,
                    diameter,
                    vertices,
                });
            }
        }

        let struct_rows: Vec<(Uuid, String, String, f64, f64, Option<f64>, String)> =
            sqlx::query_as(
                "SELECT s.id, s.type_key, s.label, s.northing, s.easting, s.rim_elev, t.apwa_color \
                 FROM utility_structures s JOIN utility_types t ON t.key = s.type_key \
                 WHERE s.project_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?;
        let utility_structures: Vec<SceneUtilityStructure> = struct_rows
            .into_iter()
            .filter_map(|(id, type_key, label, n, e, rim_elev, apwa_color)| {
                to_latlng(e, n, rim_elev).map(|ll| SceneUtilityStructure {
                    id,
                    type_key,
                    label,
                    apwa_color,
                    latitude: ll.latitude,
                    longitude: ll.longitude,
                    rim_elev,
                    easting: e,
                    northing: n,
                })
            })
            .collect();

        let origin = match (lat, lon) {
            (Some(latitude), Some(longitude)) => Some(crate::models::LatLng {
                latitude,
                longitude,
                height: 0.0,
            }),
            _ => control_points
                .first()
                .or(survey_points.first())
                .map(|p| crate::models::LatLng {
                    latitude: p.latitude,
                    longitude: p.longitude,
                    height: 0.0,
                }),
        };
        let origin_proj = match (lat, lon) {
            (Some(la), Some(lo)) => crs::geographic_to_projected(epsg, la, lo),
            _ => control_points
                .first()
                .or(survey_points.first())
                .map(|p| (p.easting, p.northing)),
        };

        Ok(SceneData {
            origin,
            origin_projected_e: origin_proj.map(|(e, _)| e),
            origin_projected_n: origin_proj.map(|(_, n)| n),
            site_rotation_deg: rot_deg,
            control_points,
            survey_points,
            grid_lines,
            utility_runs,
            utility_structures,
        })
    }
}
