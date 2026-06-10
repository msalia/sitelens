-- Cached OpenTopography DEM per project. The GeoTIFF bytes live in the Storage
-- abstraction (keyed by storage_key); this row holds the bbox + fetch metadata
-- so we only hit the OpenTopography API rarely (lazy fetch + manual refresh).
CREATE TABLE project_terrain (
    project_id  UUID PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
    demtype     TEXT NOT NULL,
    south       DOUBLE PRECISION NOT NULL,
    north       DOUBLE PRECISION NOT NULL,
    west        DOUBLE PRECISION NOT NULL,
    east        DOUBLE PRECISION NOT NULL,
    storage_key TEXT NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
