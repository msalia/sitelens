use async_graphql::{Enum, SimpleObject};

/// The space an input coordinate is expressed in (GraphQL enum).
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum CoordinateSpace {
    Grid,
    Projected,
    /// Geographic input: `x` is longitude, `y` is latitude (degrees); `unit` is
    /// ignored. Derives projected/grid/ground via the project's CRS + transform.
    Geographic,
}

impl From<CoordinateSpace> for crate::convert::Space {
    fn from(s: CoordinateSpace) -> Self {
        match s {
            CoordinateSpace::Grid => crate::convert::Space::Grid,
            CoordinateSpace::Projected => crate::convert::Space::Projected,
            CoordinateSpace::Geographic => crate::convert::Space::Geographic,
        }
    }
}

/// All derivable representations of a coordinate. Linear fields are meters;
/// latitude/longitude are degrees. `None` where a representation isn't derivable.
#[derive(SimpleObject, Default)]
pub struct CoordinateSet {
    pub grid_x: Option<f64>,
    pub grid_y: Option<f64>,
    pub projected_grid_e: Option<f64>,
    pub projected_grid_n: Option<f64>,
    pub projected_ground_e: Option<f64>,
    pub projected_ground_n: Option<f64>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

impl From<crate::convert::CoordinateSet> for CoordinateSet {
    fn from(c: crate::convert::CoordinateSet) -> Self {
        CoordinateSet {
            grid_x: c.grid_x,
            grid_y: c.grid_y,
            projected_grid_e: c.projected_grid_e,
            projected_grid_n: c.projected_grid_n,
            projected_ground_e: c.projected_ground_e,
            projected_ground_n: c.projected_ground_n,
            latitude: c.latitude,
            longitude: c.longitude,
        }
    }
}

/// An EPSG coordinate-reference-system entry for the picker.
#[derive(SimpleObject)]
pub struct EpsgEntry {
    pub code: i32,
    pub name: String,
}
