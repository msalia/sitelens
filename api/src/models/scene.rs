use async_graphql::SimpleObject;
use uuid::Uuid;

/// A geographic position (degrees) with height in meters.
#[derive(SimpleObject, Clone, Copy)]
pub struct LatLng {
    pub latitude: f64,
    pub longitude: f64,
    pub height: f64,
}

/// A renderable point in geographic coordinates. `easting`/`northing` (meters)
/// are carried so the client can open the coordinate inspector from a 3D pick.
#[derive(SimpleObject, Clone)]
pub struct ScenePoint {
    pub id: Option<Uuid>,
    pub label: String,
    pub latitude: f64,
    pub longitude: f64,
    pub height: f64,
    pub easting: f64,
    pub northing: f64,
    pub category_id: Option<Uuid>,
}

/// A renderable polyline (e.g. a grid axis) in geographic coordinates.
#[derive(SimpleObject, Clone)]
pub struct SceneLine {
    pub label: String,
    pub coordinates: Vec<LatLng>,
}

/// A utility run for the 3D scene: a polyline of geographic vertices (height =
/// invert/centerline Z, meters) drawn as a diameter-sized tube in its APWA color.
#[derive(SimpleObject, Clone)]
pub struct SceneUtilityRun {
    pub id: Uuid,
    pub type_key: String,
    pub label: String,
    pub apwa_color: String,
    /// Outer diameter in meters (tube radius = diameter / 2), if known.
    pub diameter: Option<f64>,
    pub vertices: Vec<LatLng>,
}

/// A utility structure for the 3D scene: a node drawn as a solid at its position,
/// with `rim_elev` (top, meters) driving its height.
#[derive(SimpleObject, Clone)]
pub struct SceneUtilityStructure {
    pub id: Uuid,
    pub type_key: String,
    pub label: String,
    pub apwa_color: String,
    pub latitude: f64,
    pub longitude: f64,
    pub rim_elev: Option<f64>,
    pub easting: f64,
    pub northing: f64,
}

/// Everything the 3D viewer needs, pre-projected to geographic coordinates.
#[derive(SimpleObject, Default)]
pub struct SceneData {
    pub origin: Option<LatLng>,
    /// The origin's projected easting/northing (meters) — lets the client place
    /// DXF overlays in a local east-north frame anchored at the origin.
    pub origin_projected_e: Option<f64>,
    pub origin_projected_n: Option<f64>,
    /// Site rotation (degrees, CCW about the origin) already applied to the points
    /// and grid below. The client reuses it to rotate DXF overlays — which it
    /// places in the projected frame itself — so overlays track the survey.
    pub site_rotation_deg: f64,
    pub control_points: Vec<ScenePoint>,
    pub survey_points: Vec<ScenePoint>,
    pub grid_lines: Vec<SceneLine>,
    pub utility_runs: Vec<SceneUtilityRun>,
    pub utility_structures: Vec<SceneUtilityStructure>,
}
