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

### Deliverables

- [ ] Add Rust deps `spade` + `geo`/`geo-types`; migration **0008** (`surfaces`, `surface_breaklines`, `surface_dems`, `volumes`).
- [ ] `api/src/surface/tin.rs` — Delaunay from selected points (point scope + exclusions), indexed-mesh output (positions + triangle indices + bbox), stored as a Storage blob; async build status (`building → ready/failed`); versioned + inputs snapshot.
- [ ] GraphQL: `buildSurface`, `rebuildSurface`, `deleteSurface`, `surfaces`, `surface`, `surfaceMesh` (Crew-gated, tenant-scoped).
- [ ] Web: minimal Surfaces panel (build from point scope/exclusions) + render indexed TIN mesh in the scene (extends `terrain-mesh.ts`) with the **elevation color ramp** + **wireframe** modes.

### Tests

- [ ] Delaunay correctness on known point sets; degenerate/insufficient-point handling; version increment + inputs snapshot.
- [ ] Migration up/down.
- [ ] Playwright: build a TIN from points → renders as a mesh; toggle ramp/wireframe.

### Validates

A Crew user builds a (still unconstrained) TIN from selected points and sees it shaded in 3D. Establishes the compute→blob→BufferGeometry pipeline.

---

## Phase 2 — Breaklines, boundary & constrained triangulation

Make the surface survey-grade.

### Deliverables

- [ ] `tin.rs`: insert breaklines as CDT constraint edges; clip to boundary; remove holes + outside-boundary triangles; max-edge-length filter.
- [ ] Breakline/boundary model + CRUD (`createBreakline`/`update`/`delete`); `autoBoundary` (concave-hull/alpha-shape) editable default; interior holes.
- [ ] Capture UI: digitize breaklines/boundary in-scene (snap survey points) **and** import from DXF (layer mapping); **slope analysis** display mode.

### Tests

- [ ] Constraint edges honored in output; boundary clip + hole removal; self-intersecting breakline rejected; auto-boundary sanity.
- [ ] DXF breakline import + layer mapping.
- [ ] Playwright: add a breakline → rebuild → triangle edges follow it (new version); slope mode renders.

### Validates

Surfaces honor breaklines and boundaries — professionally usable terrain models with versioned rebuilds.

---

## Phase 3 — Contours

The classic topo deliverable.

### Deliverables

- [ ] `api/src/surface/contour.rs` — per-triangle iso-line interpolation at minor/major intervals; optional spline **smoothing**; **elevation labels** on majors.
- [ ] `surfaceContours` query; contour polylines + labels rendered as Three.js line geometry, draped on the surface; panel controls (interval/smooth/labels) with live preview.

### Tests

- [ ] Iso-lines on a known tilted plane (straight, correctly spaced); smoothing preserves topology; major-label placement.
- [ ] Playwright: set intervals → contours render + labels appear.

### Validates

Users generate and view smoothed, labeled contours from any surface.

---

## Phase 4 — Volumes + cut/fill heatmap

The money output.

### Deliverables

- [ ] `api/src/surface/volume.rs` — grid sampling; surface-to-surface + surface-to-reference-elevation; cut/fill/net/area; per-cell Δz grid persisted for heatmap; results snapshot surface **versions** + params.
- [ ] `computeVolume`, `volumes`, `volume`, `volumeHeatmap`, `deleteVolume`.
- [ ] Web: volume UI (comparison type, base/compare or reference elev, cell size) → results + **cut/fill heatmap** display mode (vertex colors + legend). Default cubic yards (m³ option).

### Tests

- [ ] Cut/fill vs closed-form solids (prism/cone/flat-pad-to-datum) within cell tolerance; net = fill − cut; surface-to-elevation; non-overlap → zero.
- [ ] Snapshot immutability: rebuild a referenced surface → existing volume unchanged.
- [ ] Playwright: run a surface-to-elevation volume → totals + heatmap.

### Validates

A Crew user computes reproducible earthwork volumes and sees the cut/fill heatmap.

---

## Phase 5 — DEM source + exports

Second surface source and all deliverables.

### Deliverables

- [ ] `api/src/surface/dem.rs` — uploaded GeoTIFF → `dem` surface (sample + reproject via `crs.rs`); `uploadDem` + build as `kind: dem`; client preview via `geotiff.js`.
- [ ] `api/src/surface/export.rs`: **LandXML** surface (faces + breaklines), **DXF** (3DFACE + contour layers), **GeoTIFF DEM**, **volume report** (server-side `printpdf` + CSV: cut/fill/net/area, method, cell size, surface versions).
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
