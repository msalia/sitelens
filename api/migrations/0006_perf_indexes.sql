-- Phase 9 performance indexes.
--
-- Survey-point search uses leading-wildcard ILIKE on label/description/tags,
-- which a btree index cannot serve. Trigram (pg_trgm) GIN indexes make those
-- substring searches index-backed instead of full scans. The composite
-- (project_id, created_at) index serves the common "list a project's points in
-- insertion order" query and keyset/offset pagination without a sort step.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Substring search on the free-text fields. (Tag substring search falls back to
-- a scan: array_to_string is not IMMUTABLE, so it can't back an expression index;
-- tags are a secondary filter, and label/description cover the common searches.)
CREATE INDEX survey_points_label_trgm
    ON survey_points USING gin (label gin_trgm_ops);
CREATE INDEX survey_points_desc_trgm
    ON survey_points USING gin (description gin_trgm_ops);

-- Stable insertion order for pagination. created_at alone ties for rows inserted
-- in the same transaction (a bulk import), making ORDER BY created_at a
-- non-deterministic sort. A monotonic sequence gives a total order, and the
-- composite index serves "list a project's points in order" with LIMIT/OFFSET
-- (and future keyset pagination) without a sort step.
ALTER TABLE survey_points ADD COLUMN seq bigserial;
CREATE INDEX survey_points_project_seq_idx
    ON survey_points (project_id, seq);
