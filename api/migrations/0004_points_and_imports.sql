-- Phase 5: surveyed points, categories, groups, and imports.

CREATE TABLE point_categories (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id     uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name       text NOT NULL,
    color      text NOT NULL DEFAULT '#888888',
    icon       text NOT NULL DEFAULT 'point',
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX point_categories_org_idx ON point_categories (org_id);

CREATE TABLE import_batches (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_filename text NOT NULL DEFAULT '',
    format          text NOT NULL CHECK (format IN ('csv', 'landxml')),
    row_count       integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_project_idx ON import_batches (project_id);

CREATE TABLE survey_points (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    label           text NOT NULL,
    northing        double precision NOT NULL,        -- meters
    easting         double precision NOT NULL,        -- meters
    elevation       double precision,                 -- meters, optional
    description     text NOT NULL DEFAULT '',
    category_id     uuid REFERENCES point_categories (id) ON DELETE SET NULL,
    tags            text[] NOT NULL DEFAULT '{}',
    import_batch_id uuid REFERENCES import_batches (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX survey_points_project_idx ON survey_points (project_id);
CREATE INDEX survey_points_category_idx ON survey_points (category_id);

CREATE TABLE import_profiles (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       text NOT NULL,
    unit       text NOT NULL,
    mapping    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_profiles_project_idx ON import_profiles (project_id);

CREATE TABLE point_groups (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       text NOT NULL,
    member_ids uuid[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX point_groups_project_idx ON point_groups (project_id);

-- Seed the default category set for every existing organization. New orgs are
-- seeded in application code at signup.
INSERT INTO point_categories (org_id, name, color, icon, is_default)
SELECT o.id, c.name, c.color, c.icon, true
FROM orgs o
CROSS JOIN (VALUES
    ('Control/Reference', '#ef4444', 'target'),
    ('Station/Setup', '#f59e0b', 'station'),
    ('Column', '#3b82f6', 'column'),
    ('Corner', '#8b5cf6', 'corner'),
    ('Spot/Elevation', '#10b981', 'spot'),
    ('Utility', '#6b7280', 'utility'),
    ('Other', '#94a3b8', 'other')
) AS c (name, color, icon);
