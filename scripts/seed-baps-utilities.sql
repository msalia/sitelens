-- Demo utility records for the "BAPS Mandir — North Bergen" project.
--
-- Seeds a few as-built utility runs + node structures routed along the site's
-- real survey points (vertices snapshot each point's projected-meter coords and
-- soft-link its source_point_id). Canonical storage is meters; inverts are
-- absolute below-grade elevations (site grade ≈ 0, so negative = buried).
--
-- Idempotent: clears the project's existing utilities first. Run with:
--   docker exec -i sitelens-db-1 psql -U postgres -d sitelens \
--     < scripts/seed-baps-utilities.sql
-- Requires migration 0015 (utility_* tables + APWA type catalog).

DO $$
DECLARE
  proj uuid;
  usr  uuid;
  r_id uuid;
BEGIN
  SELECT id INTO proj FROM projects WHERE name = 'BAPS Mandir — North Bergen' LIMIT 1;
  IF proj IS NULL THEN
    RAISE EXCEPTION 'BAPS Mandir project not found — seed it first.';
  END IF;
  SELECT id INTO usr FROM users
    WHERE org_id = (SELECT org_id FROM projects WHERE id = proj)
    ORDER BY created_at LIMIT 1;

  -- Idempotent reset (audit rows are harmless history; leave them).
  DELETE FROM utility_runs WHERE project_id = proj;
  DELETE FROM utility_structures WHERE project_id = proj;

  ------------------------------------------------------------------ Storm sewer
  INSERT INTO utility_runs
    (project_id, type_key, label, diameter, material, invert_up, invert_down,
     source, as_built_date, locate_method, captured_by, tags)
  VALUES
    (proj, 'storm_sewer', 'Storm main — plaza to Line 11', 0.6096, 'RCP',
     -1.80, -3.60, 'field_survey', CURRENT_DATE, 'GPR + potholing', usr,
     ARRAY['24in'])
  RETURNING id INTO r_id;
  INSERT INTO utility_vertices (run_id, seq, easting, northing, elevation, source_point_id)
  SELECT r_id, v.seq, sp.easting, sp.northing, v.elev, sp.id
  FROM (VALUES
    (0, 'FRONT PLAZA / REF 1', -1.80),
    (1, 'LINE 4 / REF A',      -2.40),
    (2, 'LINE 8 / REF A',      -3.00),
    (3, 'LINE 11 / REF A',     -3.60)
  ) AS v(seq, label, elev)
  JOIN survey_points sp ON sp.project_id = proj AND sp.label = v.label;

  --------------------------------------------------------------- Sanitary sewer
  INSERT INTO utility_runs
    (project_id, type_key, label, diameter, material, invert_up, invert_down,
     source, as_built_date, locate_method, captured_by, tags)
  VALUES
    (proj, 'sanitary_sewer', 'Sanitary lateral — Line N', 0.2032, 'PVC SDR-35',
     -2.20, -4.00, 'field_survey', CURRENT_DATE, 'Open-trench observation', usr,
     ARRAY['8in'])
  RETURNING id INTO r_id;
  INSERT INTO utility_vertices (run_id, seq, easting, northing, elevation, source_point_id)
  SELECT r_id, v.seq, sp.easting, sp.northing, v.elev, sp.id
  FROM (VALUES
    (0, 'LINE 1 / REF N', -2.20),
    (1, 'LINE 5 / REF N', -3.10),
    (2, 'LINE 9 / REF N', -4.00)
  ) AS v(seq, label, elev)
  JOIN survey_points sp ON sp.project_id = proj AND sp.label = v.label;

  ----------------------------------------------------------------------- Water
  INSERT INTO utility_runs
    (project_id, type_key, label, diameter, material, invert_up, invert_down,
     source, as_built_date, locate_method, captured_by, tags)
  VALUES
    (proj, 'water', 'Domestic water — 6in DIP', 0.1524, 'DIP',
     -1.20, -1.20, 'locate_company', CURRENT_DATE, 'Locate company (electromagnetic)', usr,
     ARRAY['6in', 'pressurized'])
  RETURNING id INTO r_id;
  INSERT INTO utility_vertices (run_id, seq, easting, northing, elevation, source_point_id)
  SELECT r_id, v.seq, sp.easting, sp.northing, v.elev, sp.id
  FROM (VALUES
    (0, 'FRONT Ret. WALL / REF 1', -1.20),
    (1, 'LINE 6 / REF N',          -1.20),
    (2, 'LINE 10 / REF N',         -1.20)
  ) AS v(seq, label, elev)
  JOIN survey_points sp ON sp.project_id = proj AND sp.label = v.label;

  ------------------------------------------------------------------ Structures
  -- Storm manhole at the plaza-to-Line-4 junction.
  INSERT INTO utility_structures
    (project_id, type_key, label, easting, northing, rim_elev, inverts,
     material, source, as_built_date, captured_by, source_point_id, tags)
  SELECT proj, 'manhole', 'STMH-1', sp.easting, sp.northing, 0.05,
         '[{"label":"IN","elev":-2.40},{"label":"OUT","elev":-2.50}]'::jsonb,
         'Precast concrete', 'field_survey', CURRENT_DATE, usr, sp.id,
         ARRAY[]::text[]
  FROM survey_points sp WHERE sp.project_id = proj AND sp.label = 'LINE 4 / REF A';

  -- Catch basin at the front plaza inlet.
  INSERT INTO utility_structures
    (project_id, type_key, label, easting, northing, rim_elev, inverts,
     material, source, as_built_date, captured_by, source_point_id, tags)
  SELECT proj, 'catch_basin', 'CB-1', sp.easting, sp.northing, 0.00,
         '[{"label":"OUT","elev":-1.80}]'::jsonb,
         'Precast concrete', 'field_survey', CURRENT_DATE, usr, sp.id,
         ARRAY[]::text[]
  FROM survey_points sp WHERE sp.project_id = proj AND sp.label = 'FRONT PLAZA / REF 1';

  -- Gate valve on the water line.
  INSERT INTO utility_structures
    (project_id, type_key, label, easting, northing, rim_elev, inverts,
     material, source, as_built_date, captured_by, source_point_id, tags)
  SELECT proj, 'valve', 'GV-1', sp.easting, sp.northing, 0.00,
         '[]'::jsonb, 'Ductile iron', 'locate_company', CURRENT_DATE, usr, sp.id,
         ARRAY['water']
  FROM survey_points sp WHERE sp.project_id = proj AND sp.label = 'FRONT Ret. WALL / REF 1';

  RAISE NOTICE 'Seeded utilities for BAPS project %', proj;
END $$;

-- Summary.
SELECT type_key, label, array_length(t.v, 1) AS vertices
FROM utility_runs r
CROSS JOIN LATERAL (SELECT array_agg(seq) AS v FROM utility_vertices WHERE run_id = r.id) t
WHERE r.project_id = (SELECT id FROM projects WHERE name = 'BAPS Mandir — North Bergen')
  AND r.deleted_at IS NULL
ORDER BY r.created_at;
