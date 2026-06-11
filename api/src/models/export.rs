use async_graphql::Enum;

#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ExportFormat {
    Csv,
    Landxml,
}

/// Which coordinate space the exported northing/easting are in.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ExportSpace {
    ProjectedGrid,
    ProjectedGround,
    Grid,
    Geographic,
}

/// A selectable CSV column (caller chooses inclusion + order).
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ExportColumn {
    Point,
    Northing,
    Easting,
    Elevation,
    Description,
    Latitude,
    Longitude,
}
