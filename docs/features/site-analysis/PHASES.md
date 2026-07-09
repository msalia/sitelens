# SiteLens Site Analysis — Implementation Phases

> Sequenced roadmap. Each phase produces a working, demonstrable state.
> See [SPEC.md](./SPEC.md) for the full architecture and design decisions, and the
> [shared feature foundation](../_shared-foundation/SPEC.md) for shared blocks (plan editor,
> geometry stack, surface abstraction, report service) — build against those, not copies.
> If the foundation pieces don't exist yet when this feature ships first, Phase 1 builds
> them in the shared modules.

---

## Phase Summary

| Phase | Focus | Depends On | Status |
| ----- | ----- | ---------- | ------ |
| 1 | Analysis foundation (domain, schema, gating, plan editor) | — | Not started |
| 2 | Turning radius (flagship) | 1 | Not started |
| 3 | Parking | 1 | Not started |
| 4 | Terrain hydrology (existing-conditions screening) | 1 | Not started |
| 5 | Traffic (AADT + OSM roads) | 1 | Not started |
| 6 | Reports & export (DXF / PNG / PDF service) | 2–5 | Not started |
| 7 | Hardening, docs, polish | 2–6 | Not started |

```
        ┌── 2 Turning ──┐
        ├── 3 Parking ──┤
1 ──────┼── 4 Hydrology ┼──► 6 Reports ──► 7 Hardening
        └── 5 Traffic ──┘
```

Phases 2–5 are independent of each other and can be built in any order (or in parallel)
once Phase 1 lands. Phase 6 needs at least one analysis type to report on.

---

## Phase 1 — Analysis Foundation

Stand up the module skeleton: everything boots, the schema exists, gating works, and the
plan editor can draw survey-grade geometry — but no analysis computes yet.

> **Build notes (as shipped):**
> - Migration shipped as **0017** (sequential). Geometry (`input_geometry`,
>   `result_geometry`, cache `bbox`) is **JSONB**, matching every other geometry in
>   the repo (survey points, breaklines, utilities, surfaces) — no PostGIS geometry
>   columns exist and sqlx has no geometry codec; no server-side spatial query needs
>   it. Documented deviation from the spec's "PostGIS geometry".
> - Gating: a single **`Feature::SiteAnalysis`** (Crew) gates the whole module via
>   the existing plan catalog; mutations use `require_editor_active`.
> - Plan drawing reuses the existing scene **digitize bridge** (`pickRef`): clicking
>   survey points snaps vertices, plus **numeric E/N entry**, drawn as a polyline
>   and rendered live via a new `terrain/analysis-overlay.tsx`. Deferred to the
>   compute phases (2–5, which draw their own inputs): a dedicated orthographic
>   projection, rectangle/line primitives, and DXF-vertex snapping.

### Deliverables
- [x] DB migration **0017**: `analysis`, `vehicle_template`, `ext_data_cache`, `report` tables.
- [x] New Rust GraphQL `analysis` domain module (`schema/analysis.rs`: analyses/analysis + create/update/delete/duplicate), tenancy-scoped.
- [x] **Crew gating** via existing plan-check (`Feature::SiteAnalysis`; `require_editor_active` on mutations); Admin/Surveyor/Viewer roles enforced by the shared guards.
- [~] **Plan mode**: drawing in world XY on the survey backdrop via the scene digitize bridge + a plan-path overlay. (Orthographic top-down projection deferred; top view is available via the camera presets.)
- [~] Drawing primitives: **polyline** with **snap-to-survey** + **numeric entry** (coords). (Rectangle/line + DXF-vertex snap deferred to the compute phases.)
- [x] `analysis` list/detail UI section (empty states) with **duplicate** action (Analysis tab).

### Tests
- [x] Migration applies (every `#[sqlx::test]` runs all migrations incl. 0017).
- [x] GraphQL resolvers enforce tenancy + the Crew gate + invalid-JSON rejection (`tests/integration/analysis.rs`).
- [x] Playwright (`web/e2e/analysis.spec.ts`): create an analysis by numeric entry + save + duplicate; Solo-plan gate. (Run locally — sandbox can't launch Chromium.)

### Validates
The analysis module is reachable, gated, and a user can draw precise geometry on the
survey backdrop and save it — the shared substrate every analysis builds on.

---

## Phase 2 — Turning Radius (flagship)

Draw a path, pick a vehicle, get a swept envelope and a pass/fail against obstacles.

### Deliverables
- [ ] Seed `vehicle_template` presets (AASHTO P, SU-30, WB-40/50/62, BUS-40; pumper + aerial fire apparatus) with sources.
- [ ] Per-org **custom vehicle** create/edit/delete.
- [ ] **Tractrix swept-path** compute in Rust (rear-axle track → body corners + tire tracks), 2D plan, authoritative.
- [ ] **Obstacle-clearance pass/fail**: envelope vs selected DXF/survey obstacle layers, with clip locations.
- [ ] `runTurningAnalysis` synchronous mutation; result geometry stored.
- [ ] UI: draw centerline path, pick vehicle, select obstacle layers, render envelope + verdict (drape in 3D too).

### Tests
- [ ] **Golden-value test**: tractrix envelope for a known turn matches reference within tolerance.
- [ ] Clearance detection: known clipping vs clearing cases.
- [ ] Playwright: draw path → run → see envelope + pass/fail.

### Validates
An engineer can prove a fire truck fits (or doesn't) a driveway — the module's flagship
value, exploiting the geometry core.

---

## Phase 3 — Parking

Draw bays, tile stalls, count them, check ADA and required ratio.

### Deliverables
- [ ] **Bay-based stall tiling** in Rust: tile stalls along drawn bays/aisles at given size/angle/aisle width; snap to module.
- [ ] Auto **stall count**; **ADA-table (§208)** required-vs-provided check; **required-ratio** check (user-supplied ratio/count).
- [ ] `runParkingAnalysis` synchronous mutation; stall geometry + counts stored.
- [ ] UI: draw bays, module param panel, render tiled stalls + count + ADA/ratio verdicts.

### Tests
- [ ] Tiling count correct for 90/60/45° bays of known dimensions.
- [ ] ADA-table thresholds correct across §208 boundary cases.
- [ ] Playwright: draw bays → count + ADA/ratio verdict.

### Validates
An engineer gets stall counts and ADA compliance from a drawn layout in seconds.

---

## Phase 4 — Terrain Hydrology (existing-conditions screening)

Show how water moves across the existing ground, on real LiDAR, honestly labeled.

### Deliverables
- [ ] **Surface source resolution** via the shared surface abstraction: use a surface-modeling surface (TIN/DEM) when present; else **1 m 3DEP** fallback.
- [ ] **1 m 3DEP** fetch via existing OpenTopography pipeline; cache in `ext_data_cache` (bbox+TTL+attribution+resolution).
- [ ] **Coverage check** + graceful fallback (labeled "regional context only" or disabled; never silent 10 m-as-1 m).
- [ ] **Un-decimated D8** flow-direction + flow-accumulation on the raw grid (server-side, separate from render mesh).
- [ ] Derive flow lines (threshold), watershed from pour point, ponding/low-point polygons.
- [ ] `startHydrologyAnalysis` **async job** (reuse `refreshTerrain` pattern) + status polling.
- [ ] UI: optional AOI/pour-point draw, run, overlay flow/watershed/ponding in plan + 3D; **advisory/existing-conditions labeling** everywhere.

### Tests
- [ ] **Golden-value test**: D8 flow routing + watershed on a synthetic DEM with a known drainage pattern.
- [ ] Coverage fallback path renders the correct labeled state.
- [ ] Playwright: run hydrology → overlay appears with advisory label.

### Validates
Pre-design drainage screening no survey tool offers in the same georeferenced 3D scene.

---

## Phase 5 — Traffic (AADT + OSM roads)

Overlay real measured traffic and road context around the site.

### Deliverables
- [ ] **NJ DOT AADT** fetch + reprojection into site CRS; cache in `ext_data_cache` with source attribution.
- [ ] AADT **banding** (terciles of measured values); explicit "no data" rendering for uncounted roads.
- [ ] **OSM roads** via Overpass; **ODbL attribution**; kept visually separate, not baked into survey exports.
- [ ] `startTrafficFetch` async job + status; `trafficData` query for overlay.
- [ ] UI: select state/source, toggle AADT bands + OSM layer, click a road to inspect AADT.

### Tests
- [ ] AADT parse + banding correct for sample NJ data; "no data" state renders.
- [ ] Reprojection into site CRS correct; attribution present.
- [ ] Playwright: enable traffic → banded roads render + inspect a segment.

### Validates
Real traffic context around the site, with an architecture ready to add states on demand.

---

## Phase 6 — Reports & Export

Turn analyses into deliverables engineers act on: DXF, images, and formatted PDF.

### Deliverables
- [ ] **DXF export** of analysis result geometry as labeled layers, in **site CRS + survey units** (swept paths, stalls, flow lines/watershed, AADT-tagged roads).
- [ ] **PNG scene capture** (plan/3D with overlays + legend).
- [ ] **Python + WeasyPrint report service** (4th Dokploy container; stateless: `{figures[], data, branding}` → PDF).
- [ ] Rust JSON payload assembly (metrics + citations); client figure rasterization.
- [ ] Composable report builder (pick analyses → format) + mandatory **data-source + methodology + disclaimer appendix**.
- [ ] `generateReport` mutation → `report` artifact via Storage.

### Tests
- [ ] DXF round-trip: written layers/geometry read back in correct CRS/units.
- [ ] PDF structural test: page count, required sections, citations + disclaimer present.
- [ ] Playwright: select analyses → generate PDF/DXF/PNG → download.

### Validates
The survey-in → analysis-out → back-to-CAD round-trip — the module's moat — works end to end.

---

## Phase 7 — Hardening, Docs, Polish

Make it shippable and legible to customers.

### Deliverables
- [ ] Customer-facing in-app **`/docs`** page for the analysis module (each feature, data sources, disclaimers), following the existing docs pattern.
- [ ] Error/empty/failure states polished across async jobs and coverage gaps.
- [ ] Performance pass on hydrology raster handling + large scenes.
- [ ] Full e2e sweep; lint/format/test green.

### Tests
- [ ] e2e across all four analyses + report generation.
- [ ] Coverage/failure/no-data states verified.

### Validates
The module is documented, robust to missing data, and ready to enable per org.
</content>
