-- Phase 3: grid coordinates on control points + the solved Helmert transform.

-- Each control point's location in building-grid space (meters). Required to be
-- part of the transform solve; nullable so points can be entered incrementally.
ALTER TABLE control_points ADD COLUMN grid_x double precision;
ALTER TABLE control_points ADD COLUMN grid_y double precision;

-- One solved transform per project (replaced on re-solve).
CREATE TABLE transforms (
    id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id    uuid NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
    translation_e double precision NOT NULL,
    translation_n double precision NOT NULL,
    rotation_rad  double precision NOT NULL,
    scale         double precision NOT NULL,
    rms_error     double precision NOT NULL,  -- meters
    point_count   integer NOT NULL,
    residuals     jsonb NOT NULL,             -- [{label, de, dn, magnitude}] in meters
    created_at    timestamptz NOT NULL DEFAULT now()
);
