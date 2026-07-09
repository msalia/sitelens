-- Synthetic demo terrain for the BAPS Mandir project's design points.
--
-- The survey plan carried only a local 2D grid (all Z = 0), so the point-built
-- TIN is flat and the Surface Modeling UI (contours, cut/fill heatmap) has
-- nothing to show. This assigns an illustrative height field — a gentle tilt plus
-- a central mound, ~8–16 m — so the surface has relief to visualize + iterate on.
-- These elevations are DEMO ONLY, not survey data.
--
-- Idempotent: re-running just recomputes the same deterministic field. After
-- running, rebuild the surface via scripts/seed-baps-surfaces.mjs.
--
--   docker exec -i sitelens-db-1 psql -U postgres -d sitelens < scripts/seed-baps-surface-elevations.sql

WITH prj AS (
    SELECT p.id
    FROM projects p
    JOIN orgs o ON o.id = p.org_id
    WHERE p.name LIKE 'BAPS Mandir%' AND o.name = 'Helix Surveying'
    LIMIT 1
),
c AS (
    SELECT avg(easting) AS e0, avg(northing) AS n0
    FROM survey_points
    WHERE project_id = (SELECT id FROM prj) AND point_type = 'design'
)
UPDATE survey_points sp
SET elevation = 10.0
    + 0.03 * (sp.easting - c.e0)                                   -- west→east tilt
    + 0.02 * (sp.northing - c.n0)                                  -- south→north tilt
    + 4.5 * exp(-((sp.easting - c.e0) ^ 2 + (sp.northing - c.n0) ^ 2) / (2 * 30.0 ^ 2)) -- central mound
FROM c
WHERE sp.project_id = (SELECT id FROM prj) AND sp.point_type = 'design';
