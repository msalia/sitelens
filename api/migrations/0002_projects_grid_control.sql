-- Projects and their grid + control points. All coordinates stored in meters.

CREATE TABLE projects (
    id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name                  text NOT NULL,
    description           text NOT NULL DEFAULT '',
    epsg_code             integer NOT NULL,
    display_unit          text NOT NULL DEFAULT 'us_survey_foot'
                              CHECK (display_unit IN ('us_survey_foot', 'international_foot', 'meter')),
    combined_scale_factor double precision NOT NULL DEFAULT 1.0,
    site_origin_lat       double precision,
    site_origin_lon       double precision,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_org_id_idx ON projects (org_id);

-- Building-grid axes: two families (lettered/numbered), each axis at a position
-- in grid space (meters).
CREATE TABLE grid_axes (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    family     text NOT NULL CHECK (family IN ('lettered', 'numbered')),
    label      text NOT NULL,
    position   double precision NOT NULL,  -- meters, grid space
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX grid_axes_project_id_idx ON grid_axes (project_id);

-- City-published control points, stored canonical in meters.
CREATE TABLE control_points (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    label      text NOT NULL,
    northing   double precision NOT NULL,  -- meters
    easting    double precision NOT NULL,  -- meters
    elevation  double precision,           -- meters, optional
    source     text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX control_points_project_id_idx ON control_points (project_id);
