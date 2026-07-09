# Surface Modeling — Implementation Phases

Feature within the existing SiteLens project. Each phase ends in a working, shippable state and follows the standard flow (lint → format → test → commit → push → deploy where appropriate). Ordering: triangulation core first, then constraints, then contours, then volumes, then DEM source + export, then docs + acceptance.

```
Phase 1 ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5 ─► Phase 6
(TIN core  (breaklines (contours) (volumes + (DEM source (docs +
 + render)  + boundary)            heatmap)   + exports)  acceptance)
```

Dependencies: P2 needs P1 (constraints feed the same triangulator). P3 needs P1 (contours from TIN). P4 needs P1 (+P2 for accurate surfaces). P5 DEM source needs P1's surface abstraction; exports need P1–P4. P6 needs all prior.

---

## Phase 1 — TIN core + mesh render

Triangulation in Rust + the indexed-mesh render path. The riskiest, most foundational piece.

> **Build notes (as shipped):**
> - Migration shipped as **0016** (sequential; the spec's "0008" was a placeholder).
>   All four tables created up front; Phase 1 only reads/writes `surfaces`.
> - Only **`spade`** added now (the `geo`/`geo-types` crates are deferred to Phase 2
>   when constrained triangulation first needs them — avoids an unused dep and a
>   name clash with the existing internal `crate::geo` Helmert module).
> - **Synchronous build** (no background worker): triangulation runs inside the
>   mutation via `spawn_blocking`, matching the codebase's existing convention;
>   `status` set `ready`/`failed` inline (a failing build returns a structured
>   error rather than persisting a `failed` row). The `status` column exists for
>   the larger DEM surfaces in P5.
> - Mesh blob = the **STIN** binary format (geographic vertices + `u32` indices);
>   the client `toLocal`s each vertex so the TIN registers on the point cloud.

### Deliverables

- [x] Add Rust dep `spade`; migration **0016** (`surfaces`, `surface_breaklines`, `surface_dems`, `volumes`).
- [x] `api/src/surface/tin.rs` — Delaunay from selected points (point scope + exclusions), indexed-mesh output (positions + triangle indices + bbox), stored as a Storage blob; synchronous build status (`ready`/`failed`); versioned + inputs snapshot.
- [x] GraphQL: `buildSurface`, `rebuildSurface`, `deleteSurface`, `surfaces`, `surface`, `surfaceMesh` (Crew-gated, tenant-scoped); `Feature::Surfaces` added to the plan catalog.
- [x] Web: minimal Surfaces panel (build from point scope/exclusions) + render indexed TIN mesh in the scene (extends the terrain render path) with the **elevation color ramp** + **wireframe** modes.

### Tests

- [x] Delaunay correctness on known point sets; degenerate/insufficient-point handling (unit tests in `tin.rs` + STIN blob tests in `surface/mod.rs`); `plan.rs` feature-catalog test covers `Feature::Surfaces`.
- [x] Migration up (every `#[sqlx::test]` runs all migrations incl. 0016; this project is forward-only, no down migrations).
- [x] Resolver integration (`tests/integration/surface.rs`): build → mesh (STIN magic) + list, version increment on rebuild + `inputs` snapshot, Crew gate, tenant isolation, insufficient-points error, delete. All green against the compose DB.
- [x] Playwright (`web/e2e/surfaces.spec.ts`): build a TIN from points → renders + list shows triangle count; toggle ramp/wireframe; Solo-plan gate. (Authored + lint-clean; run locally — sandbox can't launch Chromium.)

### Validates

A Crew user builds a (still unconstrained) TIN from selected points and sees it shaded in 3D. Establishes the compute→blob→BufferGeometry pipeline.

---

## Phase 2 — Breaklines, boundary & constrained triangulation

Make the surface survey-grade.

> **Build notes (as shipped):**
> - **No `geo`/`geo-types` crate** — the repo avoids new deps and had no polygon
>   code, so geometry is hand-rolled + unit-tested in `api/src/surface/geom.rs`
>   (ray-cast point-in-polygon, segment/self-intersection, alpha-shape concave
>   hull over the spade Delaunay with convex-hull fallback, nearest-point z-fill).
>   This also sidesteps the `crate::geo` (Helmert) name clash. (Supersedes the P1
>   note that P2 would add `geo`.)
> - Breaklines, boundary, and holes are all inserted as CDT constraint edges;
>   boundary + holes additionally clip by triangle centroid. 2D/DXF vertices are
>   z-filled from the nearest survey point. `add_constraint` is `can_add_constraint`-
>   guarded so crossing constraints never panic.
> - No new migration — `surface_breaklines` already exists (0016). Breakline CRUD
>   is un-audited + hard-delete (survey constraints, not records-of-record).
> - Constraint scene overlay places vertices via the projected origin (like DXF
>   overlays) — correct for un-rotated sites; consistent with that existing layer.

### Deliverables

- [x] `tin.rs`: `triangulate_constrained` — breaklines as CDT constraint edges; clip to boundary; remove holes + outside-boundary triangles; max-edge-length filter (bare path routes through it).
- [x] Breakline/boundary model + CRUD (`createBreakline`/`update`/`delete`); `autoBoundary` (alpha-shape concave hull) editable default; interior holes; build integration (`select_constraints` + `inputs` snapshot of ids).
- [x] Capture UI: digitize breaklines/boundary/holes in-scene (snap survey points, reuses the utilities `pickRef` bridge) **and** import from DXF (layer→kind mapping); **slope analysis** display mode; in-scene constraint overlay.

### Tests

- [x] Constraint edge honored in output; boundary clip + hole removal; max-edge filter; self-intersecting breakline rejected; PIP / concave-hull sanity (unit tests in `tin.rs` + `geom.rs`).
- [x] DXF breakline import + layer mapping; breakline CRUD; boundary clips build + `inputs` records id; `autoBoundary`; Crew gate (integration tests in `tests/integration/surface.rs`).
- [x] Playwright (`web/e2e/surfaces.spec.ts`): auto boundary → rebuild bumps version; slope shading offered. (Digitize-by-scene-click covered manually — the e2e harness can't click 3D markers.) Run locally.

### Validates

Surfaces honor breaklines and boundaries — professionally usable terrain models with versioned rebuilds.

---

## Phase 3 — Contours

The classic topo deliverable.

> **Build notes (as shipped):**
> - **Marching-triangles** in `api/src/surface/contour.rs`: each crossing is keyed
>   by the mesh **edge** it lies on, so adjacent triangles interpolate the *same*
>   crossing point and segments chain into polylines with no float endpoint
>   matching. Vertices on a level are treated as below (consistent classification),
>   so no coordinate perturbation is needed. Smoothing is **Chaikin** corner-cutting
>   (0–3 passes; the spec's "spline" — Chaikin preserves open ends + closed loops).
> - Contours are computed **on demand** from the stored STIN mesh (new
>   `surface::deserialize_mesh`), not persisted — so interval/smoothing changes need
>   no rebuild. Returned as a new **SCTR** binary blob (base64), decoded client-side
>   like STIN. No migration, no model change (reuses `FileBlob`).
> - Geographic-space extraction: crossings interpolate on the stored `[lat, lon, h]`
>   mesh, so contour points land exactly on rendered mesh edges (client `toLocal`s
>   them, same as the surface + constraints).
> - Panel intervals are entered in the **project display unit** (converted to meters
>   for the API); labels are formatted back to the display unit. Contour settings
>   are lifted to the project page and shared by the panel (edit) + scene (fetch).

### Deliverables

- [x] `api/src/surface/contour.rs` — per-triangle iso-line interpolation at minor/major intervals; optional spline **smoothing** (Chaikin); **elevation labels** on majors (client-placed at major polyline midpoints).
- [x] `surfaceContours` query (SCTR blob); contour polylines + labels rendered as Three.js line geometry (`terrain/surface-contours.tsx`), draped on the surface; panel controls (interval/major/smooth/labels + show toggle) with live preview.

### Tests

- [x] Iso-lines on a known tilted plane (straight, correctly spaced); smoothing preserves topology + endpoints; closed loop stays closed; major-flag placement; flat/degenerate + bad-interval errors (unit tests in `contour.rs` + STIN roundtrip / SCTR blob tests in `surface/mod.rs`).
- [x] Integration (`tests/integration/surface.rs`): `surfaceContours` serves an SCTR blob, bad interval errors, tenant isolation. All green (170 lib + 101 integration).
- [x] Playwright (`web/e2e/surfaces.spec.ts`): enable contours → the API returns a non-empty SCTR blob + the interval/label controls appear. (Authored + lint-clean; run locally — sandbox can't launch Chromium.)

### Validates

Users generate and view smoothed, labeled contours from any surface.

---

## Phase 4 — Volumes + cut/fill heatmap

The money output.

> **Build notes (as shipped):**
> - `volume.rs` is a **grid-Riemann** engine over a height-field `SurfaceSampler`
>   (uniform spatial index → barycentric point query). `Δz = compare − base` (or
>   `reference − base`); + = fill, − = cut; `net = fill − cut`; `area` = footprint
>   of cells with data. Analysis window = the two surfaces' overlap (s↔s) or the
>   base extent (s↔e).
> - The stored mesh is **geographic**, so the resolver builds a shared local
>   **equirectangular metric frame** (from the base centroid) to do the planar math
>   (rigid → areas/volumes unaffected), then converts heatmap cells back to
>   geographic. No `crs` inverse needed; the engine stays pure + unit-tested.
> - Heatmap = a new **SVOL** blob (per-cell `[lat, lon, base_z, Δz]` + Δz range +
>   cell size), rendered client-side as a diverging red→blue colored quad grid over
>   the base surface, with a legend. No persistence beyond the Storage blob.
> - **No new migration** — the `volumes` table shipped in 0016. Results snapshot the
>   base/compare **versions**, so a later rebuild never changes a computed volume.
> - Volume display defaults to **cubic yards** (m³ toggle); area in the display
>   unit². Cell size is meters (matches the max-edge convention).

### Deliverables

- [x] `api/src/surface/volume.rs` — grid sampling; surface-to-surface + surface-to-reference-elevation; cut/fill/net/area; per-cell Δz grid persisted for heatmap; results snapshot surface **versions** + params.
- [x] `computeVolume`, `volumes`, `volume`, `volumeHeatmap`, `deleteVolume` (Crew-gated, tenant-scoped).
- [x] Web: volume UI (comparison type, base/compare or reference elev, cell size) → results + **cut/fill heatmap** display (vertex-colored quad grid + legend). Default cubic yards (m³ option).

### Tests

- [x] Cut/fill vs closed-form solids (flat-pad-to-datum, square **pyramid** to closed form, surface-to-surface pure fill) within cell tolerance; net = fill − cut; non-overlap → zero; bad-input errors (unit tests in `volume.rs` + SVOL blob test in `surface/mod.rs`).
- [x] Snapshot immutability: rebuild a referenced surface → existing volume's `baseVersion` + result unchanged (integration `tests/integration/surface.rs`); s↔e all-cut-above-datum; Crew gate; comparison-target validation.
- [x] Playwright (`web/e2e/surfaces.spec.ts`): compute a surface-to-elevation volume → totals appear + heatmap toggle. (Authored + lint-clean; run locally — sandbox can't launch Chromium.)

### Validates

A Crew user computes reproducible earthwork volumes and sees the cut/fill heatmap.

---

## Phase 5 — DEM source + exports

Second surface source and all deliverables.

### Deliverables

- [ ] `api/src/surface/dem.rs` — uploaded GeoTIFF → `dem` surface (sample + reproject via `crs.rs`); `uploadDem` + build as `kind: dem`; client preview via `geotiff.js`.
- [ ] `api/src/surface/export.rs`: **LandXML** surface (faces + breaklines), **DXF** (3DFACE + contour layers), **GeoTIFF DEM**, **volume report** (shared WeasyPrint report service, not `printpdf`, + CSV: cut/fill/net/area, method, cell size, surface versions).
- [ ] `exportSurface` + `exportVolumeReport`; export UI (formats + scope).

### Tests

- [ ] DEM GeoTIFF → grid + reprojection; TIN↔DEM volume works.
- [ ] LandXML round-trip (faces/breaklines), DXF faces+contours, GeoTIFF validity, PDF smoke + CSV values.
- [ ] Playwright: upload a DEM → build → compare to a TIN → export package.

### Validates

DEM surfaces participate in volumes, and surfaces/contours/volumes export to LandXML/DXF/GeoTIFF/PDF+CSV.

---

## Phase 6 — Customer docs + acceptance

Self-serve docs and end-to-end validation.

### Deliverables

- [ ] In-app docs page: add `surfaces` to `web/src/lib/docs.ts` `docsOrder` (group "Visualization"); create `web/src/content/docs/surfaces.md`; create `web/src/app/docs/surfaces/page.tsx` per the `[slug]` pattern.
- [ ] Docs content: TIN + why breaklines/boundary matter, point selection/exclusions, digitize vs DXF breaklines, DEM upload, contour params, volumes (types + cell size) + heatmap, exports; note OpenTopography is context-only.
- [ ] End-to-end acceptance on a real sample site (e.g. BAPS seed site): build surface → contours → volume → export; verify LandXML opens in CAD/Civil 3D and DXF/GeoTIFF validate.

### Tests

- [ ] Docs page renders in nav + route resolves.
- [ ] Acceptance checklist run; sample export files locked as fixtures.

### Validates

Customers can self-serve via in-app docs, and the full surface → contour → volume → export workflow is verified end-to-end.

---

## Cross-phase conventions

- Lint + format + commit + push at each phase boundary; update these checkboxes as items complete.
- Migrations: apply pending **0005** then **0008** on the next deploy.
- All shared utilities (triangulation, contour, volume, DEM math) get unit tests (project convention).
- Performance: server-side compute + mesh decimation/LOD for large surfaces; async build status; coordinate with the project's existing Performance phase.
- New resolvers land in their own `schema/surface.rs` module (pairs with the existing `schema.rs` split refactor TODO), not the monolith.
- Verify locally via integration tests / Playwright; if a scripted multi-mutation curl flow trips the security guardrail false positive, run via `!` or the integration suite.
