# Architecture Decisions

Record important technical decisions here as the project evolves.
Each entry includes: context, decision, and consequences.

See [SPEC.md](./SPEC.md) for the full product & architecture specification and
[PHASES.md](./PHASES.md) for the implementation roadmap.

---

## ADR-001: Initial Tech Stack

- **Date:** 2026-06-09
- **Context:** SiteLens needs precise coordinate math (Helmert least-squares,
  EPSG projections, grid/ground, unit conversion), spatial storage, and a 3D
  geospatial frontend with CAD overlay.
- **Decision:** Three-service Docker Compose stack — **Next.js** web (CesiumJS +
  client-side DXF parsing), a **Rust GraphQL API** (async-graphql + axum) housing
  the precision geo-core, and **PostgreSQL + PostGIS**. Deployed on Dokploy as a
  compose resource; Traefik routes to the web service.
- **Consequences:** Precision/perf-sensitive math lives in Rust; rendering/CAD in
  the browser. PostGIS gives spatial indexing. Compose (not a single Dockerfile)
  is required because there are three services.

## ADR-002: Canonical internal unit is meters

- **Date:** 2026-06-09
- **Context:** US survey foot vs international foot differ by ~2 ppm; mixing units
  silently corrupts coordinates.
- **Decision:** Store every coordinate in meters; convert only at I/O boundaries;
  always label units. The `api/src/units.rs` module is the single source of
  conversion truth, with exact constants and unit tests.
- **Consequences:** Unambiguous storage; foot/meter mistakes caught at the edges.

## ADR-003: DXF only (no DWG)

- **Date:** 2026-06-09
- **Context:** DWG is Autodesk's closed binary format with no reliable open
  parser; DXF is an open ASCII format.
- **Decision:** Support DXF vector import natively; do not support DWG. Users
  export to DXF from their CAD tool.
- **Consequences:** Avoids a paid SDK / fragile cloud-conversion dependency. Users
  with DWG must convert first.

## ADR-004: Open terrain is backdrop, not survey-grade

- **Date:** 2026-06-09
- **Context:** Surveyors' imported elevations are authoritative; open terrain
  tiles are approximate.
- **Decision:** Use open AWS Terrain Tiles for visual context only; imported Z is
  always the source of truth. Optional Cesium Ion token for higher quality.
- **Consequences:** No accidental reliance on inaccurate terrain elevations.

## ADR-005: Local file storage behind an interface (v1)

- **Date:** 2026-06-09
- **Context:** Uploads (DXF/CSV/LandXML, snapshots) need storage; S3 is the
  eventual target but adds setup.
- **Decision:** Use a local volume in v1, behind a storage abstraction so AWS S3
  slots in later without rework.
- **Consequences:** Faster v1; a clean seam for the future S3 implementation.

## ADR-006: Auth and tenancy enforcement (Phase 1)

- **Date:** 2026-06-09
- **Context:** Multi-tenant SaaS needs authentication and strict per-org
  isolation. Postgres RLS is desirable as defense-in-depth, but the API connects
  as the table owner (which bypasses RLS unless forced), and forcing RLS in
  Phase 1 would block legitimate cross-org auth queries (e.g. login-by-email).
- **Decision:** Email/password auth with Argon2 hashing and JWT carried in an
  HTTP-only `SameSite=Lax` cookie. The JWT carries `user_id`, `org_id`, and
  `role`; resolvers derive an `AuthContext` and enforce **org_id scoping** in
  every query as the primary control, plus role guards (Admin/Surveyor/Viewer).
  RLS policies are **scaffolded but not forced** in Phase 1; Phase 10 will FORCE
  RLS and set `app.current_org` per request as defense-in-depth. Self-service
  signup creates an org and its first Admin. Email verification is implemented
  but real email delivery is deferred (tokens surfaced in the API response for
  now).
- **Consequences:** Tenant isolation is enforced and tested (org A cannot read
  org B) without blocking auth flows. A clear, low-risk path to full RLS later.
  Rate-limiting and real email delivery are tracked as follow-ups.
