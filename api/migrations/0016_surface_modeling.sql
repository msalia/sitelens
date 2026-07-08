-- Surface Modeling: named, versioned surfaces (point-built TIN or uploaded DEM),
-- their constraints (breaklines/boundary/holes), uploaded DEM assets, and
-- reproducible cut/fill volume computations. Canonical storage is projected
-- meters (consistent with survey_points). Phase 1 reads/writes `surfaces` only;
-- the constraint / DEM / volume tables are created now so later phases add no
-- further migrations.

-- A named, versioned surface: either a point-built TIN or a DEM-derived grid.
-- The computed indexed mesh (positions + triangle indices + bbox) lives in the
-- Storage abstraction keyed by storage_key; `inputs` snapshots exactly what built
-- this version so a volume report reproduces forever even after a rebuild.
CREATE TABLE surfaces (
    id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name           text NOT NULL,
    version        integer NOT NULL DEFAULT 1,
    kind           text NOT NULL CHECK (kind IN ('tin', 'dem')),
    status         text NOT NULL DEFAULT 'building'
        CHECK (status IN ('building', 'ready', 'failed')),
    failure_reason text,
    -- Input snapshot: point selection (scope + exclusions), breakline/boundary
    -- ids, params, and (for dem) the source asset key + sampling params.
    inputs         jsonb NOT NULL DEFAULT '{}',
    storage_key    text,                          -- computed mesh blob in Storage
    vertex_count   integer NOT NULL DEFAULT 0,
    triangle_count integer NOT NULL DEFAULT 0,
    created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX surfaces_project_idx ON surfaces (project_id);

-- Survey-grade constraints: hard breaklines, the outer boundary, and interior
-- holes. Vertices are snapshotted in meters (immutable against survey-point
-- edits). z is optional for boundary/hole rings.
CREATE TABLE surface_breaklines (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('hard', 'boundary', 'hole')),
    closed       boolean NOT NULL DEFAULT false,
    -- Ordered vertices as a JSON array: [{n, e, z?}] in meters.
    vertices     jsonb NOT NULL DEFAULT '[]',
    source       text NOT NULL DEFAULT 'digitized'
        CHECK (source IN ('digitized', 'dxf')),
    source_layer text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX surface_breaklines_project_idx ON surface_breaklines (project_id);

-- Uploaded high-resolution DEM assets (drone / LiDAR GeoTIFF). Reuses the
-- terrain GeoTIFF storage + geotiff.js parse path. Distinct from project_terrain
-- (OpenTopography backdrop), which is NOT a surface source.
CREATE TABLE surface_dems (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    filename    text NOT NULL,
    storage_key text NOT NULL,                    -- GeoTIFF bytes via Storage
    bbox        jsonb NOT NULL DEFAULT '{}',
    source_crs  text,
    uploaded_by uuid REFERENCES users (id) ON DELETE SET NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX surface_dems_project_idx ON surface_dems (project_id);

-- Reproducible cut/fill volume computations. Results snapshot the surface
-- versions + parameters used, so the report never silently changes.
CREATE TABLE volumes (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id         uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name               text NOT NULL,
    method             text NOT NULL DEFAULT 'grid' CHECK (method IN ('grid')),
    comparison         text NOT NULL
        CHECK (comparison IN ('surface_to_surface', 'surface_to_elevation')),
    base_surface_id    uuid NOT NULL REFERENCES surfaces (id) ON DELETE CASCADE,
    base_version       integer NOT NULL,
    compare_surface_id uuid REFERENCES surfaces (id) ON DELETE CASCADE,
    compare_version    integer,
    reference_elev     double precision,          -- meters
    cell_size          double precision NOT NULL, -- meters (accuracy knob)
    -- Snapshotted results.
    cut_volume         double precision,          -- m^3
    fill_volume        double precision,          -- m^3
    net_volume         double precision,          -- m^3 (fill - cut)
    area               double precision,          -- m^2
    heatmap_key        text,                      -- per-cell dz grid blob
    computed_by        uuid REFERENCES users (id) ON DELETE SET NULL,
    computed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX volumes_project_idx ON volumes (project_id);
