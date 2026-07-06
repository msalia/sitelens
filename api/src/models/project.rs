use async_graphql::SimpleObject;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::units::LengthUnit;

/// A building site. All stored coordinates are canonical meters.
#[derive(SimpleObject, Clone)]
pub struct Project {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub description: String,
    pub epsg_code: i32,
    pub display_unit: LengthUnit,
    pub combined_scale_factor: f64,
    pub site_origin_lat: Option<f64>,
    pub site_origin_lon: Option<f64>,
    /// Rotation (degrees, CCW) applied about the site origin to georeference an
    /// assumed-datum survey to true earth. 0 for properly-tied projects.
    pub site_origin_rotation_deg: f64,
    /// Default stakeout tolerances (meters, canonical): horizontal/vertical
    /// warn + fail thresholds, copied into an as-built comparison at run time.
    pub tol_h_warn: f64,
    pub tol_h_fail: f64,
    pub tol_v_warn: f64,
    pub tol_v_fail: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct ProjectRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub description: String,
    pub epsg_code: i32,
    pub display_unit: String,
    pub combined_scale_factor: f64,
    pub site_origin_lat: Option<f64>,
    pub site_origin_lon: Option<f64>,
    pub site_origin_rotation_deg: f64,
    pub tol_h_warn: f64,
    pub tol_h_fail: f64,
    pub tol_v_warn: f64,
    pub tol_v_fail: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<ProjectRow> for Project {
    fn from(r: ProjectRow) -> Self {
        Project {
            id: r.id,
            org_id: r.org_id,
            name: r.name,
            description: r.description,
            epsg_code: r.epsg_code,
            display_unit: LengthUnit::from_db_str(&r.display_unit).unwrap_or(LengthUnit::Meter),
            combined_scale_factor: r.combined_scale_factor,
            site_origin_lat: r.site_origin_lat,
            site_origin_lon: r.site_origin_lon,
            site_origin_rotation_deg: r.site_origin_rotation_deg,
            tol_h_warn: r.tol_h_warn,
            tol_h_fail: r.tol_h_fail,
            tol_v_warn: r.tol_v_warn,
            tol_v_fail: r.tol_v_fail,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

/// Public, non-secret runtime config the client needs (e.g. the shared Cesium
/// Ion token used for World Terrain — Ion tokens are client-exposed by design).
#[derive(SimpleObject)]
pub struct PublicConfig {
    pub cesium_ion_token: String,
}
