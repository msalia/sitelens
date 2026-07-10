-- Detailed (1 m USGS 3DEP LiDAR) terrain fetched for the property-boundary AOI,
-- kept separate from the coarse context terrain (project_terrain). It is the
-- accurate base for cut/fill volumes and (future) hydrology. One row per project;
-- fetched alongside the coarse terrain by the same refresh when a boundary exists.
CREATE TABLE project_detailed_terrain (
    project_id  UUID PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
    demtype     TEXT NOT NULL,
    south       DOUBLE PRECISION NOT NULL,
    north       DOUBLE PRECISION NOT NULL,
    west        DOUBLE PRECISION NOT NULL,
    east        DOUBLE PRECISION NOT NULL,
    storage_key TEXT NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
