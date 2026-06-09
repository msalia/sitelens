# Architecture

A reference overview of how SiteLens is built. For the full specification see the
project's `docs/SPEC.md`.

## Topology

SiteLens is a three-service stack:

```
Browser (Next.js + CesiumJS + DXF parser)
        │  GraphQL over HTTPS (cookie-auth)
        ▼
Rust GraphQL API  ──►  PostgreSQL + PostGIS
   (geo-core)          (org-scoped data)
        │
        ▼
   File storage (uploads, snapshots)
```

- **Web** — Next.js (App Router). Renders the 3D scene with CesiumJS and parses
  DXF client-side. Talks to the API over GraphQL.
- **API** — a Rust GraphQL service. Owns the database and the precision geo-core.
- **Database** — PostgreSQL with the PostGIS extension for spatial columns and
  indexing.

## Why Rust for the geo-core

The coordinate math — the Helmert least-squares solve, EPSG projections, grid/
ground scale, and unit conversion — is precision-sensitive and runs in Rust. CAD
parsing and rendering stay in the browser where they belong.

## Storage in meters

Every coordinate is persisted in meters. Units convert only at I/O boundaries.
This keeps the database unambiguous and prevents foot-versus-meter mistakes.

## Multi-tenancy

Every row is scoped by organization. Isolation is enforced in the API and backed
by database row-level security, so one organization can never read another's data.

## Deployment

The stack runs as a Docker Compose deployment behind a reverse proxy with
automatic HTTPS. The database volume persists across redeploys.
