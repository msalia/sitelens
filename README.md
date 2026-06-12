# SiteLens

Multi-tenant SaaS for construction surveyors: tie an architect's building grid to
city control points, import surveyed points, and visualize everything in a 3D
scene over real terrain — with full coordinate conversion across grid, projected,
and geographic systems.

- **Live:** https://sitelens.msalia.org
- **Docs site:** https://sitelens.msalia.org/docs

## Stack

- **Web** — Next.js (App Router, TypeScript, Tailwind, shadcn/ui), CesiumJS for
  the 3D scene (clustered points, ellipsoid/Ion terrain), client-side DXF
  parsing. Includes an in-app documentation site.
- **API** — Rust GraphQL (async-graphql + axum) housing the precision geo-core
  (Helmert least-squares, EPSG projections, grid/ground, unit conversion).
  Argon2 + JWT auth, per-org tenancy scoping, and auth rate limiting.
- **Database** — PostgreSQL + PostGIS (migrations run automatically on API start).
- **Cache** — Redis, backing the shared auth rate limiter.
- **Deploy** — Docker Compose on Dokploy, HTTPS via Traefik/Let's Encrypt.

## Quick start

```bash
cp .env.example .env   # local config; add secrets here (gitignored)
docker compose up --build
# Web:  http://localhost:3000
# Docs: http://localhost:3000/docs
# API:  http://localhost:4000/health
```

See [docs/SETUP.md](./docs/SETUP.md) for hybrid dev and tests, and
[docs/SPEC.md](./docs/SPEC.md) for the full product & architecture specification.

## Features

- **Auth & tenancy** — self-service signup creates an org + admin; Argon2 + JWT;
  Admin/Surveyor/Viewer roles; every query scoped by org (proven by a cross-org
  isolation suite); per-IP auth rate limiting.
- **Projects, grid & control points** — define an architect's building grid and
  the city control points that tie it to the real world.
- **The transform** — Helmert (4-param similarity) least-squares solve with
  per-point residuals and RMS.
- **Conversion** — any coordinate ↔ grid / projected (grid & ground) / geographic,
  across US-survey-foot, international-foot, and meter, with a standalone
  converter and a per-point inspector.
- **Import** — survey-machine CSV (configurable column mapping + saved profiles)
  and LandXML, with size/row/XML-bomb guards.
- **3D visualization** — CesiumJS scene of control/survey points and grid lines
  over terrain, clustered for dense sites, with georeferenced DXF overlays.
- **Export** — CSV (configurable columns/space/unit) and LandXML; PNG snapshot of
  the 3D view.

## Project status

**v1 feature-complete**: foundation, auth/tenancy, projects/grid/control, the
transform, conversion, import, 3D + DXF, export, billing, performance, and
hardening. The full product & architecture spec (including billing) is in
[docs/SPEC.md](./docs/SPEC.md); performance baselines and budgets in
[docs/PERFORMANCE.md](./docs/PERFORMANCE.md).
