# SiteLens

Multi-tenant SaaS for construction surveyors: tie an architect's building grid to
city control points, import surveyed points, and visualize everything in a 3D
scene over real terrain — with full coordinate conversion across grid, projected,
and geographic systems.

- **Live:** https://sitelens.msalia.org
- **Docs site:** https://sitelens.msalia.org/docs

## Stack

- **Web** — Next.js (App Router, TypeScript, Tailwind, shadcn/ui), CesiumJS for
  the 3D scene, client-side DXF parsing. Includes an in-app documentation site.
- **API** — Rust GraphQL (async-graphql + axum) housing the precision geo-core
  (Helmert least-squares, EPSG projections, grid/ground, unit conversion).
- **Database** — PostgreSQL + PostGIS.
- **Deploy** — Docker Compose on Dokploy, HTTPS via Traefik/Let's Encrypt.

## Quick start

```bash
docker compose up --build
# Web:  http://localhost:3000
# Docs: http://localhost:3000/docs
# API:  http://localhost:4000/health
```

See [docs/SETUP.md](./docs/SETUP.md) for hybrid dev and tests,
[docs/SPEC.md](./docs/SPEC.md) for the full specification, and
[docs/PHASES.md](./docs/PHASES.md) for the implementation roadmap.

## Project status

Phase 1 (foundation) — stack boots, services health-check, DB connected, in-app
docs live. Subsequent phases (auth/tenancy, projects/grid/control, the transform,
conversion, import, 3D, DXF, export) are tracked in
[docs/PHASES.md](./docs/PHASES.md).
