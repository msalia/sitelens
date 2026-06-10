# SiteLens — Implementation Phases

> Sequenced roadmap. Each phase has clear deliverables and validation criteria.
> See [SPEC.md](./SPEC.md) for the full architecture and design decisions.

---

## Phase Summary

| Phase | Focus                                               | Depends On      | Status      |
| ----- | --------------------------------------------------- | --------------- | ----------- |
| 1     | Foundation: stack boots, DB, auth, tenancy          | —               | Complete\*  |
| 2     | Projects, grid, control points (data + forms)       | 1               | Complete    |
| 3     | Geo-core: Helmert transform + residuals (Rust)      | 2               | Complete    |
| 4     | Coordinate conversion + units (Rust + UI)           | 3               | Complete    |
| 5     | Point import (CSV/LandXML) + categories/groups      | 2, 4            | Complete    |
| 6     | 3D Cesium scene + terrain + point visualization     | 3, 5            | Complete\*  |
| 7     | DXF vector import + georeferenced overlay           | 6               | Complete    |
| 8     | Export (CSV/LandXML/image) + standalone converter   | 4, 5, 6         | Not started |
| 9     | Performance: benchmarks, profiling, API + UI tuning | 1–8 (API ready) | Not started |
| 10    | Hardening: security, file-safety, E2E, deploy       | all             | Not started |

\* Phase 1: rate-limiting, real email delivery, and forcing RLS are intentionally deferred to Phase 10.

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
- [x] EPSG library integration: searchable picker (`searchEpsg` over crs-definitions, by code or name; US default 2229)
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

- [x] EPSG projections projected ↔ lat/long — pure-Rust `proj4rs` + `crs-definitions` (`api/src/crs.rs`), no libproj system dep
- [x] Grid ↔ ground via combined scale factor
- [x] Building grid ↔ projected via the solved transform (Helmert forward/inverse)
- [x] Unit conversion: us-survey-foot / intl-foot / meter (distinct) — `units.rs`
- [x] `convertCoordinate` GraphQL op returning all representations
- [x] Per-point inspector showing all representations live (in project units)

### Tests

- [x] Rust unit tests: geographic↔projected round-trip + coarse reference (EPSG:2229 LA)
- [x] US-survey vs intl foot distinction verified (ppm-level)
- [x] Grid↔ground and grid↔projected round-trips (unit + integration)

### Validates

Clicking a control point shows it in every system + unit, all correct. ✅ Verified live (projected→grid via inverse transform; lat/long via EPSG 2229).

> Note: EPSG projection uses pure-Rust proj4rs (no libproj in Docker); NAD83↔WGS84 is treated as ~identity for now (sub-2 m), refine with a datum grid later if needed.

---

## Phase 5 — Point Import & Organization

Bring in field data; organize it.

### Deliverables

- [x] CSV import with interactive column-mapping (P/N/E/Z/Description) + unit pick
- [x] Saved ImportProfiles per project (`saveProfileName` on import)
- [x] LandXML import (CgPoints)
- [x] ImportBatch records; size/row caps in the parser (`import.rs`)
- [x] PointCategory: default set (seeded per org) + per-tenant custom (color/icon); one category + free-text tags per point
- [x] PointGroup (saved named selections) — multi-select → save group
- [x] Searchable/filterable points panel (category, label, description, tags), multi-select

### Tests

- [x] Parser unit tests: CSV column orders, LandXML; malformed/oversized rejected
- [x] API integration: import batch (feet→meters), search filter, LandXML, category/group CRUD
- [x] Round-trip: imported feet → stored meters → displayed correctly

### Validates

A surveyor imports a machine export, sees the points listed, categorized, searchable. ✅ Verified live (7 default categories, CSV `1000 ft → 304.8006 m`, search, saved profile).

> Note: timeouts on parsing are bounded by request handling; explicit per-job timeouts land with the sandboxing work in Phase 10.

---

## Phase 6 — 3D Visualization

See the site in 3D over terrain.

### Deliverables

- [x] CesiumJS scene in the workspace (lazy-loaded card; assets served from /cesium)
- [~] Terrain: flat-ellipsoid default (no token) + OSM imagery; optional Cesium Ion token enables World Terrain. Raw AWS Terrarium tiles deferred (need a quantized-mesh server)
- [x] Render grid lines + control points + surveyed points at their Z (via `sceneData`)
- [x] Category-driven marker color; category visibility toggles
- [x] Point selection in 3D → opens coordinate inspector
- [x] Scene centered on points (zoomTo) / project site origin

### Tests

- [x] API integration: `sceneData` projects points to geographic + builds grid lines
- [~] Browser/Playwright 3D render not run here (headless WebGL unavailable in sandbox); Cesium assets verified served from the container, build green

### Validates

The full grid + control + surveyed points render in 3D over terrain; imported Z drives elevation (terrain is backdrop).

> Note: Cesium is loaded from the prebuilt `/cesium/Cesium.js` (script tag) rather than bundled, to avoid the bundler choking on Cesium's KML/zip internals. AWS-tiles terrain remains a deferred enhancement.

---

## Phase 7 — DXF Vector Overlay

Overlay the architect's drawing.

### Deliverables

- [x] DXF upload + client-side vector parse (`dxf-parser` → lines, polylines, arcs, circles; layers collected). Text entities skipped for now.
- [x] Render DXF geometry in the Cesium scene (local east-north frame at origin via `originProjected`)
- [x] Georeference: default real-world coords + manual offset/rotation/scale (apply → re-render)
- [x] Toggle DXF visibility; per-layer handling (layers parsed; hidden-layers plumbed to the renderer)
- [x] CadOverlay persisted: raw DXF in the storage abstraction (local volume), georeference in DB

### Tests

- [x] Backend integration: upload → content round-trip → georeference → list → delete (org-scoped)
- [~] Parser/Playwright in-browser not run here (headless WebGL); parser is straightforward + backend covered

### Validates

A DXF drawing drops into the 3D scene aligned to the grid/control points, adjustable by the user.

> Note: DXF is placed via an ENU frame anchored at the scene origin (no per-vertex projection needed client-side). Live-preview is apply-on-save (not drag-live) for now.

---

## Phase 8 — Export & Standalone Converter

Get data back out; ad-hoc conversions.

### Deliverables

- [x] Export selected points / current category filter / all to CSV (choose coordinate space, unit, and which columns to include — point/N/E/Z/desc/lat/long, emitted in canonical order)
- [x] LandXML export
- [x] Image snapshot (PNG) of the 3D view (Snapshot button on the 3D panel)
- [x] Standalone converter tool (enter a coord in any space+unit → all representations)

### Tests

- [x] Unit tests on CSV/LandXML format generation (`export.rs`: headers, row order, quoting, CgPoint output)
- [x] Integration test: `exportPoints` resolver returns CSV + LandXML through the schema with auth + org scoping
- [ ] Playwright: select points → export → verify file contents (deferred — headless Chromium/WebGL blocked in this sandbox)

### Validates

A surveyor exports points in the format/system their machine expects, and can do ad-hoc conversions without storing a point.

---

## Phase 9 — Performance & Optimization

Once the API is feature-complete, measure and make the API and UIs as fast as
possible. Optimize against real benchmarks, not guesses.

### Deliverables

- [x] **Establish baselines** — Criterion harness (`api/benches/core_bench.rs`) with recorded numbers for `solveTransform`, `convertCoordinate`/CRS projection, and CSV import throughput; baselines recorded in `docs/PERFORMANCE.md`. (GraphQL resolver latency + frontend web-vitals: measured via the load-test script / browser, not committed numbers — sandbox can't run the full stack under load.)
- [x] **Profile the API** — benchmarks isolate the hotspot (CRS projection dominates `convert`; Helmert math is negligible); resolver audit found no N+1 (`sceneData` is a fixed, small query set); index gaps identified and closed. (No flamegraph captured.)
- [x] **Database tuning** — verified FK indexes on all org_id/project_id; added trigram GIN indexes for substring search + a `(project_id, seq)` index for stable paginated listing (`0006`); large lists paginated.
- [x] **API optimizations** — `surveyPoints` bounded/paginated (`limit`/`offset` + `surveyPointCount`); confirmed no N+1s. (Response caching / streamed exports deferred — not needed at current scale.)
- [x] **Frontend optimizations** — Cesium loaded via script tag (out of the JS bundle) + lazy `ssr:false` 3D import; survey points on a clustered `CustomDataSource` (LOD for dense sites); survey-points table paginated at 50/page. (DXF parser already client-side, per-overlay.)
- [x] **Load testing** — `scripts/loadtest.sh` (oha) for sustained load against health + authenticated GraphQL. (Run against the deployed instance; not executed in the sandbox.)
- [x] **Set budgets** — latency / bundle / frame-rate budgets codified in `docs/PERFORMANCE.md` with a repeatable `cargo bench` harness.

### Tests

- [x] Benchmark suite is repeatable and committed (`cargo bench --bench core_bench`; baseline numbers in `docs/PERFORMANCE.md`)
- [x] Integration test for paginated `surveyPoints` + `surveyPointCount` (stable order across pages)
- [ ] Large-dataset E2E: UI stays responsive with a high point count (deferred — headless Chromium/WebGL blocked in this sandbox; pagination + clustering address the underlying risk)

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
