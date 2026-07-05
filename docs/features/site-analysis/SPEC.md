# SiteLens Site Analysis — Product & Architecture Specification

> A survey-grade civil site-analysis module layered on SiteLens: turning-radius swept paths, parking layout, existing-conditions terrain hydrology, and traffic overlays — all computed on the georeferenced survey foundation and exported to PDF/DXF/image.

> **Depends on the [shared feature foundation](../_shared-foundation/SPEC.md).** Consumes the
> shared plan editor (draw paths/bays with snap + numeric entry), the format codec layer
> (DXF, GeoTIFF), labeled DXF export, the Rust geometry stack (`geo`/`spade`), the
> **surface abstraction** (§7 — hydrology runs on a surface-modeling surface when present,
> open 1 m 3DEP as fallback), the WeasyPrint report service, scene overlay primitives, the
> async job pattern, FileBlob/Storage, and the shared gating mechanism. This is the one
> *compute* feature — it **opts out** of the snapshot/audit pattern (analyses are
> disposable/re-runnable).

---

## 1. Overview

SiteLens today is a precision coordinate-tie and visualization tool for construction
surveyors: solve a Helmert transform tying an architect's grid to city control, import
survey points, overlay georeferenced DXF, and convert/export coordinates across CRSs —
all in a Three.js/R3F 3D scene over real OpenTopography terrain.

This module **repositions SiteLens as a survey-grade site-analysis platform**, where the
surveyor workflow becomes the **data foundation** and a set of civil analyses becomes the
**value layer** on top of it. It targets **site / civil engineers** in addition to
surveyors.

### Core principles

- **Deterministic geometry over physics.** Ship what is tractable and defensible math
  (swept paths, stall tiling, DEM flow routing). Do **not** build physics engines (CFD,
  traffic microsimulation).
- **Survey-grade or don't ship it.** Snapping and numeric entry are first-class; analysis
  geometry is computed authoritatively server-side and is the single source of truth for
  what appears on screen, in DXF, and in the PDF.
- **Open data, honestly labeled.** Open datasets power hydrology and traffic. Every
  derived layer carries its source, resolution, and an advisory disclaimer. Nothing is
  presented as permit-stampable.
- **One product, one codebase.** The analyses are a gated module on the existing SiteLens
  foundation (scene, CRS/units engine, DXF I/O, terrain), not a fork.

### v1 capabilities

1. **Turning radius** — tractrix swept-path with obstacle-clearance pass/fail.
2. **Parking** — bay-based stall tiling with auto-count, ADA-table check, ratio check.
3. **Terrain hydrology** — existing-conditions drainage screening on 1 m LiDAR.
4. **Traffic** — real AADT overlay (NJ first) + OSM road context.
5. **Reports/export** — formatted PDF, DXF (in site CRS), PNG images.

---

## 2. Users & Access

- **Audiences:** construction surveyors (existing) + site/civil engineers (new). Surveyor
  workflow feeds the analyses; engineers consume and act on them.
- **Auth:** unchanged — email/password, cookie JWT, Argon2, one-org-per-user.
- **Roles:** unchanged — **Admin / Surveyor / Viewer**. Surveyor+ can create and run
  analyses; Viewer is read-only (can view results and export reports).
- **Module gating:** gates as **Crew** via the **existing live plan-check** — `require_paid`
  on run/export resolvers, `require_editor_active` on mutations ([foundation §13](../_shared-foundation/SPEC.md);
  billing is live Stripe, **not** deferred). No separate entitlement system, no billing
  change. **Accepted tradeoff ([decision 2026-07-05](../_shared-foundation/SPEC.md#132-tiering-decision)):**
  a pure civil engineer buys the whole surveyor Crew bundle to access this module; a
  dedicated "Engineer/Pro" tier is a deferred future billing workstream, not a v1 blocker.

---

## 3. Data Model

All analysis geometry is stored as PostGIS geometry in the **site's projected CRS**
(canonical internal unit = meters, consistent with existing SiteLens). New tables hang off
the existing `project`.

### 3.1 `analysis`

The central record — one per analysis instance. Duplicable (clone-and-tweak provides
informal scenarios; formal scenario comparison is deferred to v2).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `project_id` | uuid | FK → project |
| `type` | enum | `turning` \| `parking` \| `hydrology` \| `traffic` |
| `name` | text | user-facing label |
| `status` | enum | `draft` \| `running` \| `complete` \| `failed` |
| `params` | jsonb | per-type parameters (see §3.4) |
| `input_geometry` | geometry | drawn path / bay / boundary / pour point (nullable for traffic) |
| `result` | jsonb | summary metrics + references to result geometry |
| `result_geometry` | geometry | computed output (swept envelope, stalls, flow lines, etc.) |
| `error` | text | failure detail when `status = failed` |
| `created_by` | uuid | FK → user |
| `created_at` / `updated_at` | timestamptz | |

### 3.2 `vehicle_template`

Vehicle library for turning analysis. Global presets **plus** per-org custom vehicles.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `org_id` | uuid | null = global preset; set = org-custom |
| `name` | text | e.g. "WB-62", "Pumper (NFPA)" |
| `vehicle_class` | text | AASHTO class / fire / custom |
| `wheelbase` | numeric | meters (internal) |
| `front_overhang` | numeric | |
| `rear_overhang` | numeric | |
| `width` | numeric | |
| `max_steering_angle` | numeric | degrees |
| `lock_to_lock_time` | numeric | seconds (optional, for future steering-drive) |
| `source` | text | citation string for reports |

Seed presets: AASHTO **P, SU-30, WB-40, WB-50, WB-62, BUS-40**, plus a representative
**pumper** and **aerial/ladder** fire apparatus (source published in the seed).

### 3.3 `ext_data_cache`

Server-side cache of fetched open data, keyed by bounding box + TTL, with attribution
stored alongside so reports can cite it.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `source` | enum | `3dep` \| `aadt` \| `osm` |
| `bbox` | geometry | polygon (query key) |
| `payload_ref` | text | Storage ref (rasters) or inline jsonb for small vector sets |
| `attribution` | text | license + source string (e.g. OSM ODbL, USGS 3DEP) |
| `resolution` | text | e.g. "1m", "10m" — drives confidence labeling |
| `fetched_at` | timestamptz | |
| `ttl` | interval | |

### 3.4 `report`

A composed report — which analyses are included and the generated artifact.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `project_id` | uuid | FK → project |
| `analysis_ids` | uuid[] | included analyses |
| `format` | enum | `pdf` \| `dxf` \| `png` |
| `artifact_ref` | text | Storage ref to generated file |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

### 3.5 Per-type `params` shapes (informal)

- **turning:** `{ vehicle_template_id, obstacle_layer_ids[], step_resolution }`
- **parking:** `{ stall_length, stall_width, angle (90|60|45), aisle_width, one_way,
  required_ratio | required_count }`
- **hydrology:** `{ area_of_interest?, pour_point?, min_flow_accumulation_threshold }`
- **traffic:** `{ state, aadt_bands (terciles), show_osm_roads }`

---

## 4. Architecture

One codebase, one product. The module adds a new **`analysis` domain** to the Rust
GraphQL API, new PostGIS tables, and a new frontend section — sitting on top of the
existing project/scene/CRS/DXF/terrain primitives. Aligns with the deferred refactor to
split `schema.rs` by domain.

### 4.1 Compute model

Two runtime classes, handled differently:

- **Interactive geometry** (turning, parking) — **synchronous** GraphQL mutations. Fast
  (sub-second) Rust compute. Client draws the input and shows a cheap visual preview
  during drag; the committed / exported / reported result always comes from the Rust
  compute.
- **Batch / external-data** (hydrology, traffic) — **async jobs with status polling**,
  reusing the existing `refreshTerrain` / `projectTerrain` pattern. Network-bound, can
  fail or rate-limit.

**Rust is the single source of truth for all analysis geometry.** No divergent
client-side implementation of the math — this prevents "PDF says it fits, screen said it
clips" drift.

### 4.2 External data

Fetched **server-side** from the Rust API, reprojected into the site CRS via the existing
`proj4rs` + `crs-definitions` engine, and cached in `ext_data_cache` (bbox + TTL +
attribution). Sources:

- **USGS 3DEP 1 m DEM** (LiDAR) via the existing OpenTopography pipeline — for hydrology.
  A **coverage check** determines availability; on miss, downgrade to a clearly-labeled
  "regional context only" mode or disable, never silently serve 10 m as 1 m.
- **State DOT AADT** feeds — NJ first; additional states added on demand.
- **OpenStreetMap** roads via Overpass — **ODbL**: mandatory attribution; OSM road
  geometry is kept visually separate and is **not** baked into customer survey exports
  (to stay clear of share-alike derivative-database obligations).

### 4.3 Hydrology pipeline (critical detail)

Hydrology runs D8 flow routing on a **grid-samplable surface** obtained through the shared
**surface abstraction** ([foundation §7](../_shared-foundation/SPEC.md)), always on the
**raw, un-decimated** grid — distinct from the render mesh (which stays decimated to ~256²
for display). Surface source is resolved in this order:

1. **surface-modeling surface** (point-built TIN or uploaded high-res DEM) when one exists
   for the project → **design-precision** flow analysis, including *proposed graded*
   surfaces. Labeling reflects the actual surface (design vs existing).
2. **Open 1 m 3DEP LiDAR** fetched for the project bbox and cached (fallback / off-site
   context when no surface-modeling surface is present) → **existing bare-earth
   conditions** screening.

Then, regardless of source:

3. Server-side **D8 flow-direction + flow-accumulation** on the raw grid.
4. Derive flow lines (accumulation ≥ threshold), watershed(s) from a pour point,
   ponding/low-point polygons.
5. Return simplified vector geometry to the client for overlay in plan and 3D.

Coarse OpenTopography terrain remains **context backdrop only**, never an analysis surface.

**Framing (feature name, report text, export watermark):** advisory / screening; when
running on the **1 m 3DEP fallback** it is explicitly **existing bare-earth conditions, not
permit-stampable**. Running on a surface-modeling **design surface** lifts the
"existing-conditions only" limitation but stays advisory. Standalone (no surface-modeling)
the feature is fully functional via the 1 m 3DEP fallback.

### 4.4 Report service

A new **stateless Python "report service"** (4th container in the Dokploy compose:
`web` / `api` / `db` / `report`) using **WeasyPrint** (HTML/CSS → PDF, no browser).

Flow: client rasterizes 3D/plan **figures to PNG** → Rust API assembles the **JSON data
payload** (metrics + citations) → report service renders an HTML/CSS template →
returns a multi-page PDF. Single endpoint: `{figures[], data, branding}` in, PDF out.
(WeasyPrint does not execute JS, which is fine — figures are pre-rasterized.)

### 4.5 Deployment topology

```
Dokploy compose (sitelens.msalia.org)
├── web     Next.js 16 (R3F scene, plan editor, report route)
├── api     Rust async-graphql + axum + sqlx (analysis domain, ext-data fetch, geo math)
├── db      postgis/postgis:16-3.4 (analysis tables + ext_data_cache)
└── report  Python + WeasyPrint (stateless PDF renderer)  ← NEW
```

---

## 5. API Design

New GraphQL `analysis` domain on the existing schema.

### Queries
- `analyses(projectId)` — list analyses for a project.
- `analysis(id)` — single analysis with result + geometry.
- `vehicleTemplates(orgId)` — presets + org-custom.
- `trafficData(bbox, state)` — cached AADT + OSM roads for overlay.

### Mutations — interactive (synchronous)
- `runTurningAnalysis(projectId, params, path)` → `analysis` (computed envelope +
  clearance verdict).
- `runParkingAnalysis(projectId, params, bays)` → `analysis` (tiled stalls + counts + ADA
  check + ratio check).
- `createVehicleTemplate(...)` / `updateVehicleTemplate(...)` / `deleteVehicleTemplate(...)`.
- `duplicateAnalysis(id)` — clone for informal scenarios.

### Mutations — batch (async, status-polled)
- `startHydrologyAnalysis(projectId, params)` → job; poll `analysis.status`.
- `startTrafficFetch(projectId, params)` → job; poll status.

### Mutations — export
- `generateReport(projectId, analysisIds, format)` → `report` (artifact ref).

Error handling: async jobs surface failures via `status = failed` + `error`. Coverage/
data-availability gaps return explicit "no data" states, never silent fallback.

---

## 6. UI/UX

### 6.1 Plan editor (built into the existing scene)

- A **top-down orthographic "plan mode"** added to the existing R3F scene — **not** a
  separate 2D canvas engine. Drawing happens in **world XY** coordinates.
- Existing survey points, DXF overlay, terrain hillshade, and OSM roads render as the
  drawing backdrop for free; results drape straight back into the 3D view with no
  transform.
- **Snapping** to survey points / DXF vertices / endpoints **and numeric entry** (exact
  segment length, angle, stall dimensions, coordinates) are v1 requirements — this is the
  survey-grade dividing line.

### 6.2 Per-feature input primitives

- **Turning** — draw a **polyline centerline path**; select existing DXF/survey layers as
  clearance obstacles; pick a vehicle from the library (or custom). Output: swept envelope
  + tire tracks + **pass/fail** with clip locations highlighted.
- **Parking** — draw **bay rectangles / aisle centerlines**; module params (stall size,
  angle, aisle width, one-way/two-way, required ratio) in a side panel. Output: tiled
  stalls, total count, ADA required-vs-provided, ratio pass/fail.
- **Hydrology** — mostly automatic over the project bbox; optional draw of an
  **area-of-interest** or a **pour point**. Output: flow lines, watershed, ponding — with
  advisory labeling.
- **Traffic** — **no drawing**: select state/data source, toggle AADT bands and OSM road
  layer, click a road segment to inspect its AADT value.

### 6.3 Results & reporting

- Every analysis viewable in plan and 3D.
- Report builder: pick which analyses to include → generate PDF / DXF / PNG.
- Mandatory **data-sources + methodology + disclaimers appendix** on every export.

---

## 7. Data Sources, Licensing & Disclaimers

- **USGS 3DEP** (1 m / 10 m DEM) — public domain; cite source + resolution.
- **NOAA Atlas 14** (rainfall IDF), **NRCS SSURGO** (soils → HSG), **NLCD** (land cover)
  — for curve-number runoff where applicable; US-only, cite each.
- **State DOT AADT** — per-state open feeds; NJ first; cite the specific source.
- **OpenStreetMap** — **ODbL**: attribution mandatory; keep OSM geometry visually
  separate from and not baked into customer survey exports.
- **Vehicle templates** — AASHTO / NFPA dimensions; publish source in seed + reports.
- **Disclaimers** — hydrology and traffic are **screening/advisory, existing-conditions,
  not for permit or construction**. Present on-screen and on every export.

Coverage is **US-only** (the open-data stack is US federal/state). Non-US coverage is out
of scope.

---

## 8. Security

- No change to auth model (JWT cookie, Argon2, one-org-per-user).
- Module access gated as **Crew** via the existing live plan-check (`require_paid` /
  `require_editor_active`) + existing roles.
- External data fetched server-side only (no client-side keys); cached with attribution.
- Report service is **stateless**, single-purpose (payload in, PDF out), not exposed
  publicly beyond the API's internal call.
- Advisory disclaimers are a **liability control**, not polish — enforced on all exports.

---

## 9. Testing

Follows existing SiteLens conventions:

- **Rust unit/integration tests** for all analysis math (geo domain).
- **Golden-value tests** for precision-critical math:
  - Tractrix swept-path against a hand-computed / reference turn.
  - D8 flow routing + watershed against a synthetic DEM with a known drainage pattern.
  - Parking tiling count + ADA-table thresholds against §208 cases.
- **Playwright e2e** for the plan editor flows (draw path → run → result; draw bays →
  count; generate report) — kept in `web/e2e` per project convention.
- Report service: snapshot/structural tests on generated PDF (page count, presence of
  required sections + citations).

---

## 10. Deployment

- Add the **`report`** container (Python + WeasyPrint) to the existing Dokploy compose.
- New DB migration(s) for `analysis`, `vehicle_template`, `ext_data_cache`, `report`
  (+ vehicle preset seed). **Assign the sequential migration number at build time in ship
  order — other feature specs collide on provisional numbers; see
  [foundation §14](../_shared-foundation/SPEC.md).**
- Server-side external-data fetching from the Rust API; bbox+TTL cache in Postgres/Storage.
- Standard flow: lint → format → test → commit → push → deploy; migrations applied on
  deploy (per existing SiteLens ops).

---

## 11. Scope Boundaries

### In v1
- Turning radius (tractrix, 2D plan, path-drawn, preset+custom vehicles, clearance pass/fail).
- Parking (bay-based tiling, auto-count, ADA-table check, user-supplied ratio check).
- Terrain hydrology (D8 flow paths / accumulation / watershed / ponding on the shared
  surface abstraction — surface-modeling surface when present, open 1 m 3DEP fallback;
  un-decimated analysis pipeline + coverage fallback; advisory).
- Traffic (real AADT overlay, NJ first, banded by measured value; OSM roads w/ ODbL).
- Reports/export (Python+WeasyPrint PDF, DXF in site CRS/units, PNG images, mandatory
  data-source + disclaimer appendix).
- Platform: one product repositioned survey-grade; module gated by org entitlement;
  Rust-authoritative geometry; plan-mode editor in the existing scene with snapping +
  numeric entry.

### Deferred / out (with reason)
- **True physics** — CFD water depth/velocity, traffic microsimulation, design/proposed-
  grading hydrology (needs survey TIN): engine-class effort, entrenched competitors.
- **Survey TIN/surface generation** — not built here; it is [surface-modeling](../surface-modeling/SPEC.md)'s
  job. Site-analysis *consumes* a surface via the shared abstraction when available and
  falls back to open LiDAR otherwise.
- **Parking auto-packing** — v2 ("optimize" button).
- **Turning steering-drive simulation mode** — v2 (v1 is path-drawn only).
- **Scenario comparison** (formal side-by-side) — v2 (informal via duplicate).
- **Ingress/egress** — dropped from v1; folds into turning / sight-distance later.
- **Separate paid tier for civil engineers** — v1 gates as Crew (billing is already live);
  a dedicated Engineer/Pro SKU (binary → multi-product billing) is deferred until segment
  data justifies it.
- **Multi-state AADT & non-US coverage** — US-only stack; add states on demand.
</content>
</invoke>
