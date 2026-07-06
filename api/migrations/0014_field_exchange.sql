-- Field Exchange (Phase 3): separate design points from imported as-builts,
-- add as-built QC comparison snapshots, and per-project stakeout tolerances.

-- 1. Discriminate design points from imported as-builts. Every existing row is
--    a design point. All design-surface reads filter point_type = 'design';
--    only the as-built QC comparison surfaces read 'as_built'.
ALTER TABLE survey_points
    ADD COLUMN point_type text NOT NULL DEFAULT 'design'
        CHECK (point_type IN ('design', 'as_built'));
CREATE INDEX survey_points_project_type_idx ON survey_points (project_id, point_type);

-- 2. Per-project default stakeout tolerances (meters, canonical). Construction
--    defaults: ~0.05 ft warn / ~0.10 ft fail, horizontal and vertical. Copied
--    into an as-built batch snapshot at comparison time (overridable per import).
ALTER TABLE projects
    ADD COLUMN tol_h_warn double precision NOT NULL DEFAULT 0.01524,  -- ~0.05 ft
    ADD COLUMN tol_h_fail double precision NOT NULL DEFAULT 0.03048,  -- ~0.10 ft
    ADD COLUMN tol_v_warn double precision NOT NULL DEFAULT 0.01524,
    ADD COLUMN tol_v_fail double precision NOT NULL DEFAULT 0.03048;

-- 3. One row per inbound as-built import + comparison run. Snapshots the
--    tolerance spec so a delivered report reproduces forever.
CREATE TABLE as_built_batches (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_filename text NOT NULL DEFAULT '',
    format          text NOT NULL CHECK (format IN ('jobxml', 'landxml', 'csv')),
    imported_by     uuid REFERENCES users (id) ON DELETE SET NULL,
    baseline_scope  text NOT NULL DEFAULT 'all'
        CHECK (baseline_scope IN ('all', 'category', 'group')),
    baseline_ref_id uuid,
    delta_space     text NOT NULL DEFAULT 'projected_ground',
    tol_h_warn      double precision NOT NULL,
    tol_h_fail      double precision NOT NULL,
    tol_v_warn      double precision NOT NULL,
    tol_v_fail      double precision NOT NULL,
    report_unit     text NOT NULL DEFAULT 'us_survey_foot',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX as_built_batches_project_idx ON as_built_batches (project_id);

-- 4. One row per paired/unpaired as-built point. Snapshots both sides (imported
--    field coords + design coords at comparison time) so the comparison is
--    frozen even if design points later move or the transform is re-solved.
CREATE TABLE as_built_comparisons (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id        uuid NOT NULL REFERENCES as_built_batches (id) ON DELETE CASCADE,
    as_built_label  text NOT NULL,
    as_built_n      double precision NOT NULL,   -- meters, snapshotted
    as_built_e      double precision NOT NULL,
    as_built_z      double precision,
    design_point_id uuid REFERENCES survey_points (id) ON DELETE SET NULL,
    design_n        double precision,            -- meters, snapshotted
    design_e        double precision,
    design_z        double precision,
    match_method    text NOT NULL CHECK (match_method IN ('number', 'manual', 'unmatched')),
    delta_n         double precision,            -- projected-ground frame
    delta_e         double precision,
    delta_z         double precision,
    delta_h_radial  double precision,
    delta_grid_n    double precision,            -- building-grid frame (secondary)
    delta_grid_e    double precision,
    status          text NOT NULL
        CHECK (status IN ('pass', 'warn', 'fail', 'unmatched', 'no_vertical')),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX as_built_comparisons_batch_idx ON as_built_comparisons (batch_id);
