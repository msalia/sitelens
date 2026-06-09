# SiteLens — Implementation Phases

> Sequenced roadmap. Each phase has clear deliverables and validation criteria.
> See [SPEC.md](./SPEC.md) for the full architecture and design decisions.

---

## Phase Summary

| Phase | Focus                                               | Depends On      | Status      |
| ----- | --------------------------------------------------- | --------------- | ----------- |
| 1     | Foundation: stack boots, DB, auth, tenancy          | —               | Complete\*   |
| 2     | Projects, grid, control points (data + forms)       | 1               | Complete\*   |
| 3     | Geo-core: Helmert transform + residuals (Rust)      | 2               | Complete    |
| 4     | Coordinate conversion + units (Rust + UI)           | 3               | Not started |
| 5     | Point import (CSV/LandXML) + categories/groups      | 2, 4            | Not started |
| 6     | 3D Cesium scene + terrain + point visualization     | 3, 5            | Not started |
| 7     | DXF vector import + georeferenced overlay           | 6               | Not started |
| 8     | Export (CSV/LandXML/image) + standalone converter   | 4, 5, 6         | Not started |
| 9     | Performance: benchmarks, profiling, API + UI tuning | 1–8 (API ready) | Not started |
| 10    | Hardening: security, file-safety, E2E, deploy       | all             | Not started |

\* Phase 1: rate-limiting, real email delivery, and forcing RLS are intentionally deferred to Phase 10.
Phase 2: a searchable EPSG picker is deferred (EPSG is a free integer field with a US default for now).

```
1 ──> 2 ──> 3 ──> 4 ──┐
            │         ├──> 8
            ▼         │
       5 ──>┤         │
            ▼         │
       6 ──> 7        │
       └──────────────┘
                      └──> 9 ──> 10 (after all)
```

---

## Phase 1 — Foundation

Stack boots end-to-end with auth and multi-tenant scoping in place.

### Deliverables

- [x] Dokploy compose: Next.js + Rust GraphQL + PostgreSQL+PostGIS, local Docker dev
- [x] PostGIS extension enabled; migration framework wired (`sqlx::migrate!`)
- [x] Org + User models; email/password signup + login + email verification (verify flow built; real email sending deferred)
- [x] Cookie-based JWT sessions; Argon2 hashing (auth rate-limiting → Phase 10 hardening)
- [x] `org_id` scoping pattern + Postgres RLS scaffolding; roles (Admin/Surveyor/Viewer)
- [x] Storage abstraction interface (local volume implementation)
- [x] Health-check endpoint; subdomain `sitelens.msalia.org` reachable (web + api `/health`, DB connected, live in prod)

### Tests

- [x] API integration: signup → verify → login → me, role enforcement
- [x] Tenancy: org A cannot read org B (foundational isolation test)
- [x] Storage abstraction unit tests (local impl)

### Validates

A user can sign up, verify, log in, and the app enforces org isolation. Services boot and health-check green in Dokploy. ✅ Verified live.

---

## Phase 2 — Projects, Grid & Control Points

The data backbone: create a project, define its grid, enter control points.

### Deliverables

- [x] Project CRUD (name, EPSG code, display unit, site origin lat/lon, scale factor)
- [~] EPSG code is a free integer field with a US default (2229); a searchable EPSG picker is deferred
- [x] GridSystem entry (lettered + numbered axes with offsets) — `setGridAxes`
- [x] ControlPoint CRUD (label, N, E, Z) — stored canonical meters
- [x] Project list + workspace shell (panels, no 3D yet)
- [x] shadcn/ui forms for grid + control entry (auth pages, projects list, workspace)

### Tests

- [x] API integration: project/grid/control CRUD, org-scoped (org A cannot touch org B; viewer denied)
- [x] Unit-conversion at I/O boundary (input feet → stored meters) round-trips

### Validates

A surveyor can create a site, define its gridlines, and enter the city control points — all persisted and org-scoped. ✅ Verified live through the web GraphQL proxy.

---

## Phase 3 — Geo-Core: Helmert Transform

The heart: solve the building-grid → projected tie with residuals.

### Deliverables

- [x] Rust geo-core module: 4-parameter Helmert solve (translation, rotation, scale) — `api/src/geo.rs`
- [x] Exact solve (2 points) + least-squares best-fit (3+ points) via nalgebra (SVD)
- [x] Per-control-point residuals (ΔE, ΔN, magnitude) + RMS error
- [x] `solveTransform` GraphQL op; Transform persisted (one per project, upsert) with residuals
- [x] Residuals + RMS surfaced in the workspace transform panel (in display unit)

### Tests

- [x] Rust unit tests against known-good reference values (translation, rotation+scale)
- [x] Least-squares non-zero RMS; degenerate (coincident) + too-few-points handled
- [x] API integration: solve returns structured residuals even at high RMS; persisted transform query

### Validates

Given grid + 2..n control points, the app computes the transform and shows residuals/RMS so the surveyor can judge the tie. ✅ Verified live (translation/scale/rotation recovered, RMS ≈ 0).

> Note: control points carry **grid X/Y** (added in migration 0003) alongside their projected N/E — these correspondences are what the Helmert solve fits.

---

## Phase 4 — Coordinate Conversion & Units

Move any coordinate between systems and units, precisely.

### Deliverables

- [ ] Rust: EPSG projections via PROJ (projected ↔ lat/long)
- [ ] Grid ↔ ground via combined scale factor
- [ ] Building grid ↔ projected via the solved transform
- [ ] Unit conversion: us-survey-foot / intl-foot / meter (distinct)
- [ ] `convertCoordinate` GraphQL op returning all representations
- [ ] Per-point inspector showing all representations live (in project units)

### Tests

- [ ] Rust unit tests: projections vs PROJ/published reference values
- [ ] US-survey vs intl foot distinction verified (ppm-level)
- [ ] Grid↔ground and grid↔projected round-trips

### Validates

Clicking a (manually entered) point shows it in every system + unit, all correct.

---

## Phase 5 — Point Import & Organization

Bring in field data; organize it.

### Deliverables

- [ ] CSV import with interactive column-mapping (P/N/E/Z/Description) + unit pick
- [ ] Saved ImportProfiles per project
- [ ] LandXML import (points)
- [ ] ImportBatch records; sandboxed parsing with size/timeout limits
- [ ] PointCategory: default set + per-tenant custom (color/icon); one category + free-text tags per point
- [ ] PointGroup (saved named selections)
- [ ] Searchable/filterable point sidebar (category, label, description, tags), multi-select

### Tests

- [ ] Parser unit tests: CSV column orders, LandXML; malformed/oversized rejected
- [ ] API integration: import batch org-scoped; category/group CRUD
- [ ] Round-trip: imported feet → stored meters → displayed correctly

### Validates

A surveyor imports a machine export, sees the points listed, categorized, searchable.

---

## Phase 6 — 3D Visualization

See the site in 3D over terrain.

### Deliverables

- [ ] CesiumJS scene in the workspace viewport
- [ ] AWS open Terrain Tiles base (no token); optional per-tenant Cesium Ion token
- [ ] Render grid lines + control points + surveyed points at their Z
- [ ] Category-driven marker color/icon; category visibility toggles
- [ ] Point selection in 3D ↔ sidebar/inspector sync
- [ ] Scene centered on project site origin

### Tests

- [ ] Component tests: scene mounts, layers toggle
- [ ] Playwright: create project → enter data → solve → import → points visible in 3D

### Validates

The full grid + control + surveyed points render in 3D over terrain; imported Z drives elevation (terrain is backdrop).

---

## Phase 7 — DXF Vector Overlay

Overlay the architect's drawing.

### Deliverables

- [ ] DXF upload + client-side vector parse (lines, polylines, arcs, text, layers)
- [ ] Render DXF geometry in the Cesium scene
- [ ] Georeference: default assume real-world coords + manual offset/rotation/scale with live preview
- [ ] Toggle DXF visibility; per-layer handling
- [ ] CadOverlay persisted (file + georeference params)

### Tests

- [ ] Parser unit tests on sample DXFs (entity types, layers)
- [ ] Playwright: upload DXF → appears → adjust georeference → persists

### Validates

A DXF drawing drops into the 3D scene aligned to the grid/control points, adjustable by the user.

---

## Phase 8 — Export & Standalone Converter

Get data back out; ad-hoc conversions.

### Deliverables

- [ ] Export selected points / group / category to CSV (choose system, unit, column order incl. PNEZD presets)
- [ ] LandXML export
- [ ] Image snapshot (PDF/PNG) of the 3D view
- [ ] Standalone converter tool (paste coord in any system+unit → all others, copy buttons)

### Tests

- [ ] Export round-trip: export → re-import yields equivalent coordinates
- [ ] Unit tests on column-order presets + format generation
- [ ] Playwright: select points → export → verify file contents

### Validates

A surveyor exports points in the format/system their machine expects, and can do ad-hoc conversions without storing a point.

---

## Phase 9 — Performance & Optimization

Once the API is feature-complete, measure and make the API and UIs as fast as
possible. Optimize against real benchmarks, not guesses.

### Deliverables

- [ ] **Establish baselines** — benchmark harness + recorded baseline numbers for: GraphQL resolver latency (auth, project/point queries, `solveTransform`, `convertCoordinate`), import throughput (points/sec for large CSV/LandXML), and frontend metrics (TTFB, LCP, INP, bundle size, 3D scene first-render + frame rate with N points).
- [ ] **Profile the API** — flamegraph the hot paths; identify N+1 queries, missing indexes, serialization costs, and geo-core hotspots.
- [ ] **Database tuning** — add/verify indexes (org_id, project_id, spatial GiST on points), use connection pooling effectively, paginate large lists, batch where possible (dataloader pattern for nested resolvers).
- [ ] **API optimizations** — eliminate N+1s, add response caching where safe, stream/segment large exports, parallelize independent work, tighten allocations in the geo-core.
- [ ] **Frontend optimizations** — code-split heavy deps (Cesium, DXF parser), lazy-load the 3D scene, virtualize the point sidebar for large datasets, level-of-detail / clustering for many points, memoize expensive renders, trim bundle.
- [ ] **Load testing** — sustained-load test (e.g. k6/oha) at realistic concurrency; confirm no regressions and acceptable p95/p99.
- [ ] **Set budgets** — codify performance budgets (latency, bundle size, frame rate) and a repeatable benchmark script so regressions are caught later.

### Tests

- [ ] Benchmark suite is repeatable and committed (before/after numbers recorded)
- [ ] Regression check: key operations stay within defined budgets
- [ ] Large-dataset E2E: UI stays responsive with a high point count

### Validates

The app meets its performance budgets: API p95 latencies are low, large imports and exports are fast, and the 3D UI stays smooth with realistic data volumes — all backed by recorded benchmarks.

---

## Phase 10 — Hardening & Launch

Security, robustness, and deploy.

### Deliverables

- [ ] Postgres RLS fully enforced + verified; API tenancy audit
- [ ] File-upload safety: size limits, timeouts, XML-bomb defense confirmed
- [ ] HTTPS/Traefik, Argon2, auth rate-limiting verified in prod
- [ ] Full Playwright E2E core-flow suite green
- [ ] Production deploy on Dokploy; migrations on deploy; PostGIS init
- [ ] Docs: README + deploy notes

### Tests

- [ ] Cross-org isolation suite (comprehensive)
- [ ] Malicious-file rejection tests
- [ ] End-to-end smoke on production environment

### Validates

SiteLens is deployed, isolated per tenant, resilient to bad uploads, and the full surveyor workflow works in production.
