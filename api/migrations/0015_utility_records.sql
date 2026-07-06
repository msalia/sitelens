-- As-Built Utility Records (Phase 1): curated utility types, linear runs with
-- owned/snapshotted vertices, node structures, and an append-only audit log.
-- Canonical storage is projected meters (consistent with survey_points).

-- Curated, APWA-aligned catalog. Covers both linear utilities and node
-- structures; `default_geometry` distinguishes them. Seeded globally below.
CREATE TABLE utility_types (
    key              text PRIMARY KEY,
    label            text NOT NULL,
    apwa_color       text NOT NULL,            -- hex
    default_geometry text NOT NULL CHECK (default_geometry IN ('line', 'structure', 'both'))
);

-- Linear features: a polyline with typed attributes. Geometry lives in
-- utility_vertices (snapshotted, immutable against survey-point edits).
CREATE TABLE utility_runs (
    id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    type_key      text NOT NULL REFERENCES utility_types (key),
    label         text NOT NULL DEFAULT '',
    level         text,                        -- optional floor/level for interior utilities
    -- Typed attributes (per-type relevance; all nullable).
    diameter      double precision,            -- canonical meters (entered in inches)
    material      text,
    invert_up     double precision,            -- meters, absolute
    invert_down   double precision,            -- meters, absolute
    slope         double precision,            -- derived or entered
    owner         text,
    install_date  date,
    condition     text,
    attrs_extra   jsonb NOT NULL DEFAULT '{}',
    tags          text[] NOT NULL DEFAULT '{}',
    -- Provenance.
    captured_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    captured_at   timestamptz NOT NULL DEFAULT now(),
    as_built_date date,
    source        text NOT NULL DEFAULT 'field_survey'
        CHECK (source IN ('field_survey', 'dxf', 'geojson', 'locate_company', 'other')),
    locate_method text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz                  -- soft delete (audited)
);
CREATE INDEX utility_runs_project_idx ON utility_runs (project_id) WHERE deleted_at IS NULL;

-- Owned geometry: a run's ordered vertices, snapshotted in meters. The optional
-- soft link to a source survey point is provenance only, never a live dependency.
CREATE TABLE utility_vertices (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id          uuid NOT NULL REFERENCES utility_runs (id) ON DELETE CASCADE,
    seq             integer NOT NULL,
    northing        double precision NOT NULL,   -- meters
    easting         double precision NOT NULL,   -- meters
    elevation       double precision,            -- meters, absolute (invert/centerline Z)
    source_point_id uuid REFERENCES survey_points (id) ON DELETE SET NULL
);
CREATE INDEX utility_vertices_run_idx ON utility_vertices (run_id, seq);

-- Node features (manholes, catch basins, valves, hydrants, …).
CREATE TABLE utility_structures (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    type_key        text NOT NULL REFERENCES utility_types (key),
    label           text NOT NULL DEFAULT '',
    level           text,
    northing        double precision NOT NULL,   -- meters
    easting         double precision NOT NULL,
    rim_elev        double precision,            -- meters (top, at grade)
    inverts         jsonb NOT NULL DEFAULT '[]', -- [{label, elev, pipe?}]
    material        text,
    owner           text,
    condition       text,
    attrs_extra     jsonb NOT NULL DEFAULT '{}',
    tags            text[] NOT NULL DEFAULT '{}',
    captured_by     uuid REFERENCES users (id) ON DELETE SET NULL,
    captured_at     timestamptz NOT NULL DEFAULT now(),
    as_built_date   date,
    source          text NOT NULL DEFAULT 'field_survey'
        CHECK (source IN ('field_survey', 'dxf', 'geojson', 'locate_company', 'other')),
    locate_method   text,
    source_point_id uuid REFERENCES survey_points (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX utility_structures_project_idx ON utility_structures (project_id) WHERE deleted_at IS NULL;

-- Append-only change history so the record is defensible years later.
CREATE TABLE utility_audit (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    entity_type text NOT NULL CHECK (entity_type IN ('run', 'structure', 'vertex')),
    entity_id   uuid NOT NULL,
    action      text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    changed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    changed_at  timestamptz NOT NULL DEFAULT now(),
    diff        jsonb NOT NULL DEFAULT '{}'   -- field-level before/after
);
CREATE INDEX utility_audit_project_idx ON utility_audit (project_id, changed_at DESC);
CREATE INDEX utility_audit_entity_idx ON utility_audit (entity_id);

-- Curated, APWA-aligned type catalog (global). Linear utilities + node
-- structures; colors follow the APWA uniform color code.
INSERT INTO utility_types (key, label, apwa_color, default_geometry) VALUES
    ('sanitary_sewer', 'Sanitary Sewer',   '#16a34a', 'line'),
    ('storm_sewer',    'Storm Sewer',       '#16a34a', 'line'),
    ('drainage',       'Drainage',          '#16a34a', 'line'),
    ('water',          'Water',             '#2563eb', 'line'),
    ('gas',            'Gas',               '#eab308', 'line'),
    ('electric',       'Electric',          '#dc2626', 'line'),
    ('comms',          'Communications',    '#f97316', 'line'),
    ('reclaimed',      'Reclaimed Water',   '#a855f7', 'line'),
    ('manhole',        'Manhole',           '#16a34a', 'structure'),
    ('catch_basin',    'Catch Basin',       '#16a34a', 'structure'),
    ('cleanout',       'Cleanout',          '#16a34a', 'structure'),
    ('valve',          'Valve',             '#2563eb', 'structure'),
    ('hydrant',        'Hydrant',           '#2563eb', 'structure'),
    ('vault',          'Vault',             '#dc2626', 'structure'),
    ('other',          'Other',             '#6b7280', 'both');
