-- Cached OpenStreetMap building footprints per project (visual context only).
-- The footprint+height JSON lives in the Storage abstraction (keyed by
-- storage_key); this row holds the count + fetch metadata so we only hit the
-- free Overpass API rarely (lazy fetch + manual refresh, 7-day cooldown).
CREATE TABLE project_buildings (
    project_id  UUID PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
