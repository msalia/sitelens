-- Site Analysis: civil analyses layered on the survey — turning radius, parking,
-- terrain hydrology, and traffic — plus a vehicle library, an external-data cache,
-- and composed reports. Phase 1 creates all four tables + the analysis CRUD; the
-- later phases fill in compute, seeds, external fetches, and reports (no further
-- migration needed).
--
-- Geometry note: analysis input/result geometry, cache bboxes, and vehicle dims
-- are stored as JSONB (+ numeric), matching the rest of SiteLens (survey points,
-- breaklines, utilities, surfaces all use JSONB/columns, never PostGIS geometry).
-- No server-side spatial query needs the geometry type; canonical unit = meters.

-- One analysis instance (draft → running → complete/failed). Duplicable for
-- informal scenarios. input/result geometry are GeoJSON-ish JSON in the site's
-- projected meters.
CREATE TABLE analysis (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    type            text NOT NULL
        CHECK (type IN ('turning', 'parking', 'hydrology', 'traffic')),
    name            text NOT NULL,
    status          text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'complete', 'failed')),
    -- Per-type parameters (see the feature spec §3.4).
    params          jsonb NOT NULL DEFAULT '{}',
    -- Drawn input (path / bay / boundary / pour point); null for traffic.
    input_geometry  jsonb,
    -- Summary metrics + references to result geometry.
    result          jsonb NOT NULL DEFAULT '{}',
    -- Computed output (swept envelope, stalls, flow lines, …).
    result_geometry jsonb,
    error           text,
    created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analysis_project_idx ON analysis (project_id);

-- Vehicle library for turning analysis: org_id NULL = global preset, set = custom.
-- Dimensions are meters (internal); steering angle in degrees.
CREATE TABLE vehicle_template (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id             uuid REFERENCES orgs (id) ON DELETE CASCADE,
    name               text NOT NULL,
    vehicle_class      text NOT NULL DEFAULT 'custom',
    wheelbase          double precision NOT NULL,
    front_overhang     double precision NOT NULL DEFAULT 0,
    rear_overhang      double precision NOT NULL DEFAULT 0,
    width              double precision NOT NULL,
    max_steering_angle double precision NOT NULL DEFAULT 30,
    lock_to_lock_time  double precision,
    source             text,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_template_org_idx ON vehicle_template (org_id);

-- Server-side cache of fetched open data (3DEP rasters, AADT, OSM), keyed by
-- bbox + TTL, with attribution stored for report citations.
CREATE TABLE ext_data_cache (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    source      text NOT NULL CHECK (source IN ('3dep', 'aadt', 'osm')),
    bbox        jsonb NOT NULL DEFAULT '{}',       -- {west,south,east,north}
    payload_ref text,                              -- Storage key or inline jsonb ref
    payload     jsonb,                             -- small vector payloads inline
    attribution text NOT NULL DEFAULT '',
    resolution  text,                              -- "1m" / "10m" — confidence label
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    ttl         interval NOT NULL DEFAULT interval '30 days'
);
CREATE INDEX ext_data_cache_source_idx ON ext_data_cache (source);

-- A composed report: which analyses + the generated artifact.
CREATE TABLE report (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    analysis_ids uuid[] NOT NULL DEFAULT '{}',
    format       text NOT NULL CHECK (format IN ('pdf', 'dxf', 'png')),
    artifact_ref text,
    created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_project_idx ON report (project_id);
