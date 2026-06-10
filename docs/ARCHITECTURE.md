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

## ADR-007: Tenancy enforced at the API layer; forced RLS deliberately deferred (Phase 10)

- **Date:** 2026-06-09
- **Status:** Supersedes the "Phase 10 will FORCE RLS" intent in ADR-006.
- **Context:** ADR-006 anticipated *forcing* Postgres RLS in Phase 10 as
  defense-in-depth. Implementing it correctly requires setting
  `app.current_org` per request via `SET LOCAL` inside a transaction, and having
  every resolver run its queries on that one pinned connection. But
  `async-graphql` resolves sibling fields **concurrently**, and the resolvers
  intentionally use the shared `PgPool` (a different connection per query) so
  those concurrent fields don't contend on a single connection. Pinning one
  GUC-scoped connection per request is fundamentally at odds with that model and
  would require a significant architecture change (request-scoped transaction +
  serialized field execution), with real latency cost — for a backstop behind a
  control we already enforce and test.
- **Decision:** Keep **API-layer org_id scoping as the enforced tenancy control**.
  Every project-scoped resolver validates ownership (`ensure_project_in_org`, or a
  JOIN to `projects` on `org_id`) before reading or writing. This is proven by a
  comprehensive cross-org isolation suite (`cross_org_isolation_comprehensive`)
  that asserts Org B is denied on every project-scoped read and mutation and
  cannot even see Org A's project. The RLS policy scaffolding is retained as
  documentation of the future model but is **not forced**. Revisit forced RLS if
  we move to a dedicated-connection-per-request architecture or add direct DB
  access paths outside the API.
- **Consequences:** Strong, tested isolation without the latency and complexity of
  connection pinning. The trade-off is explicit: a SQL-injection or a logic bug
  in a resolver's scoping is not caught by a second DB-level net — so the
  isolation test suite is the guardrail and must grow with every new
  project-scoped resolver.

## ADR-008: Per-IP rate limiting on auth endpoints

- **Date:** 2026-06-09
- **Context:** `login` and `signup` are abuse targets (credential brute-force,
  mass org creation). There was no throttle.
- **Decision:** A rate limiter (`api/src/ratelimit.rs`) caps each client IP at 10
  login/signup attempts per minute. The client IP comes from `X-Forwarded-For`
  (the API runs behind Traefik); the limiter is injected into the GraphQL context
  and checked at the top of both resolvers. Two backends share one interface: an
  **in-process** sliding window (default; used by tests) and a **Redis** fixed
  window (`INCR`+`EXPIRE`) selected via `REDIS_URL`, so the limit holds across
  multiple API instances. The Redis path **fails open** on any cache error so an
  outage never locks users out.
- **Consequences:** Cheap brute-force / abuse defense. With Redis (a small
  container in the compose stack), the limit is enforced globally even when the
  API is scaled horizontally; without `REDIS_URL` it degrades gracefully to
  per-process. Redis stores only ephemeral counters (no persistence configured).
