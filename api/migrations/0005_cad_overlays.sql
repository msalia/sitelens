-- Phase 7: DXF overlays. The DXF file is stored via the storage abstraction
-- (local volume in v1); only its key + georeference live in the DB.
CREATE TABLE cad_overlays (
    id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    original_filename text NOT NULL DEFAULT '',
    storage_key       text NOT NULL,
    offset_e          double precision NOT NULL DEFAULT 0,  -- meters
    offset_n          double precision NOT NULL DEFAULT 0,  -- meters
    rotation_deg      double precision NOT NULL DEFAULT 0,
    scale             double precision NOT NULL DEFAULT 1,
    assume_real_world boolean NOT NULL DEFAULT true,
    visible           boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_overlays_project_idx ON cad_overlays (project_id);
