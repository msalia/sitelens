-- Site rotation correction (degrees, CCW) for georeferencing an assumed-datum
-- survey to true earth. The survey's local/assumed horizontal grid often has an
-- arbitrary orientation; this angle rotates the projected coordinates about the
-- centroid of the project's points so points, grid, and overlays align with
-- true-north context (terrain, OSM buildings). 0 = no correction (the default
-- for properly-tied projects whose stored projected coordinates are real-world).
ALTER TABLE projects
    ADD COLUMN site_origin_rotation_deg DOUBLE PRECISION NOT NULL DEFAULT 0;
