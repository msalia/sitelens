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
| 1 | Analysis foundation (domain, schema, gating, plan editor) | — | Shipped |
| 2 | Turning radius (flagship) | 1 | Shipped |
| 3 | Parking | 1 | Shipped |
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

> **Build notes (as shipped):**
> - `analysis/turning.rs` — single-unit **tractrix** pursuit (rear axle trails the
>   drawn front-axle path by the wheelbase) → body quads + front/rear tracks +
>   envelope. Golden test: front axle on a circle radius R ⇒ rear radius √(R²−L²).
> - **Clearance** tests obstacle vertices/segments against the per-step body quads
>   (exact swept region) → clip points; pass = no clips.
> - Migration **0018** seeds global vehicle presets (P, SU-30, BUS-40, WB-40/50/62,
>   fire pumper + aerial) with AASHTO/NFPA sources. **Articulated WB-\* are
>   approximated as a single unit** at the trailer's effective wheelbase (dominates
>   off-tracking) — flagged in each `source`; true articulation is a v2 refinement.
> - `runTurningAnalysis` is synchronous (`spawn_blocking`); it stores the envelope/
>   tracks/decimated bodies/clips in `result_geometry` and pass/fail in `result`.
> - UI: turning draw → vehicle picker + step → **Run**; the scene overlays the
>   envelope, front/rear tracks, vehicle outlines, and red clip markers, with a
>   Pass/Fail badge in the list. Obstacle-layer selection (DXF/survey) as clearance
>   input is deferred; the engine + `obstacles` param already support it.

### Deliverables
- [x] Seed `vehicle_template` presets (AASHTO P, SU-30, WB-40/50/62, BUS-40; pumper + aerial fire apparatus) with sources (migration 0018).
- [x] Per-org **custom vehicle** create/edit/delete (`createVehicleTemplate`/`update`/`delete`, presets read-only).
- [x] **Tractrix swept-path** compute in Rust (rear-axle track → body corners + tracks), 2D plan, authoritative.
- [x] **Obstacle-clearance pass/fail**: swept quads vs obstacle geometry, with clip locations.
- [x] `runTurningAnalysis` synchronous mutation; result geometry stored.
- [~] UI: draw centerline path, pick vehicle, render envelope + tracks + verdict in 3D. (Obstacle-**layer** picker deferred; the run accepts obstacle geometry today.)

### Tests
- [x] **Golden-value test**: tractrix rear-axle radius matches √(R²−L²) off-tracking; straight-trail + quarter-turn + degenerate cases (`analysis/turning.rs`).
- [x] Clearance detection: on-centerline clip, off-to-the-side clear, crossing-segment clip.
- [x] Integration: presets global + custom org-scoped; turning run pass vs clipped; Crew gate. Playwright: draw path → run → Pass verdict. (Run locally.)

### Validates
An engineer can prove a fire truck fits (or doesn't) a driveway — the module's flagship
value, exploiting the geometry core.

---

## Phase 3 — Parking

Draw bays, tile stalls, count them, check ADA and required ratio.

> **Build notes (as shipped):**
> - `analysis/parking.rs` — deterministic **bay-based tiling**. The user draws a
>   bay **baseline** (the aisle-side edge of a stall row) as a polyline; each
>   straight segment is tiled independently (so L-shaped bays work), stalls
>   extending to the **left** of the drawn direction. A stall is a parallelogram:
>   frontage/pitch along the aisle = `width / sin θ`, module depth into the lot =
>   `length · sin θ`; at 90° it is a plain `width × length` rectangle. Each stall
>   stays exactly `width` wide perpendicular to its own axis (golden-tested). The
>   engine accepts **multiple bays**; the v1 UI sends one baseline per run.
> - **ADA §208.2** table (`ada_required`) plus **§208.2.4** van count
>   (`van_required`, 1 per 6 accessible) — both unit-tested at every published
>   boundary. Above 500 stalls it is 2 % of the total; above 1000, 20 + 1 per 100.
> - **Code checks are opt-in**: `requiredCount` (min stalls) and
>   `accessibleProvided` (checked vs the ADA requirement) are each optional — an
>   unconfigured check never fails a run, and the ADA requirement is always
>   *reported* even when nothing is provided. The **required-ratio** deliverable
>   ships as a user-supplied **count** (`requiredCount`); a ratio-with-basis
>   (spaces per 1000 ft²) is deferred — it needs a floor-area input this feature
>   doesn't yet collect. `oneWay`/`aisleWidth` are carried for reporting; they do
>   not change stall geometry in v1.
> - `runParkingAnalysis` is synchronous (`spawn_blocking`); it stores the stall
>   quads + drawn bays in `result_geometry` and counts/verdicts in `result`. No
>   migration — the Phase-1 `analysis` tables already cover it.
> - UI: parking type → stall size/angle/aisle/one-way + optional required &
>   accessible fields → **Run**; the scene overlays tiled stall outlines (blue) +
>   the dashed bay baseline, with a stall-count badge (and Pass/Fail when a check
>   is configured) in the list.

### Deliverables
- [x] **Bay-based stall tiling** in Rust: tile stalls along drawn bays/aisles at given size/angle/aisle width; snap to module.
- [x] Auto **stall count**; **ADA-table (§208)** required-vs-provided check; **required-count** check (user-supplied). (Ratio-with-floor-area-basis deferred — no area input yet.)
- [x] `runParkingAnalysis` synchronous mutation; stall geometry + counts stored.
- [x] UI: draw bays, module param panel, render tiled stalls + count + ADA/ratio verdicts.

### Tests
- [x] Tiling count correct for 90/60/45° bays of known dimensions (`analysis/parking.rs`), plus perpendicular-width preservation, L-shaped bays, degenerate-input errors.
- [x] ADA-table thresholds correct across §208 boundary cases (incl. the 2 % and 20+1/100 tiers) + van table.
- [x] Integration (`tests/integration/analysis.rs`): parking run tiles + counts, required-count fail, ADA-provided fail, Crew gate.
- [x] Playwright (`web/e2e/analysis.spec.ts`): switch to Parking, draw a bay → run → stall-count badge. (Run locally — sandbox can't launch Chromium.)

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
