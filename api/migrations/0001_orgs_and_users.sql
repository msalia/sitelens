-- Foundation schema: organizations and users with multi-tenant scoping.
-- Extensions are declared here too so ephemeral test databases match prod.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE orgs (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id             uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    email              text NOT NULL,
    password_hash      text,                 -- null until an invited user sets one
    role               text NOT NULL CHECK (role IN ('admin', 'surveyor', 'viewer')),
    email_verified     boolean NOT NULL DEFAULT false,
    verification_token text,                 -- email-verification token (dev: returned to caller)
    invite_token       text,                 -- invite-acceptance token
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- Email is globally unique (one org per user in v1), case-insensitive.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
CREATE INDEX users_org_id_idx ON users (org_id);

-- RLS scaffolding (Phase 1): the policy is defined but NOT forced. The API
-- connects as the table owner and bypasses RLS, so API-layer org_id scoping is
-- the enforced control for now. Phase 9 will FORCE RLS and set app.current_org
-- per request as defense-in-depth.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_isolation ON users
    USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
