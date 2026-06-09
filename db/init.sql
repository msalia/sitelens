-- Initialization for SiteLens — runs once when the PostgreSQL container is
-- first created. Enables PostGIS (spatial columns/indexing for survey points)
-- and uuid generation.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
