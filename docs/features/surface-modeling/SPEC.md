# Surface Modeling — Product & Architecture Specification

> Build survey-grade surfaces (TIN) from points + breaklines, derive contours, and compute cut/fill volumes — rendered in the existing Three.js / React Three Fiber viewer.

This is a **feature within the existing SiteLens project**, not a standalone project. It builds on the shipped survey points, categories/groups/tags, the Helmert transform + coordinate conversion, the OpenTopography terrain pipeline, `geotiff.js` parsing, DXF parsing, the Storage abstraction, and the server-side `printpdf` report pattern.

---

## 1. Overview

SiteLens models points and lines but has no surface. Surveyors need one: a **TIN** (triangulated irregular network) is the digital terrain model that everything downstream depends on — **contours** (the classic topo deliverable) and **volumes** (earthwork cut/fill, the number that prices a job) are both derived from it. A TIN is only as good as its constraints, so this feature is built around survey-grade triangulation (breaklines + boundary), not bare-point Delaunay.

Critically, this rides on the **existing Three.js/R3F renderer** — *not* Cesium (the Cesium Ion token in config is an unused stub). A TIN is a `BufferGeometry` with explicit triangle indices, contours are line geometry, and a cut/fill map is per-vertex vertex colors — all of which extend the current `terrain-mesh.ts` path directly. Triangulation and volume math run **server-side in Rust** (`spade` constrained Delaunay + `geo`), and the API ships the client a ready-made indexed mesh.

### Core principles

- **Survey-grade or it's a preview.** Constrained Delaunay with breaklines + boundary; bare-point hull triangulation is not a professional surface.
- **Absolute elevation, reproducible records.** Surfaces are named + versioned with their inputs snapshotted, so a volume report computed last month never silently changes.
- **Compute in Rust, render in Three.js.** Heavy geometry on the server; the client renders an indexed mesh + polylines through the existing BufferGeometry pipeline. No Cesium.
- **Two surface sources.** A point-built TIN *and* an uploaded high-res DEM (drone/LiDAR), unified so volumes can compare any two. Coarse OpenTopography stays context-only.
- **Reuse before rebuild.** Lean on points/categories/groups, the transform, `geotiff.js`, DXF parsing, Storage, and `printpdf`.

---

## 2. Users & Access

- **Surveyors / Crew (Surveyor role):** build/edit surfaces, set contour params, run volumes, export deliverables.
- **Admins:** same, plus manage any project-level defaults.
- **Viewers:** view surfaces/contours/volumes in 3D, read volume results, export — read-only (no build/edit).

**Plan gating:** entire feature on the existing **Crew** tier (consistent with export / field-exchange / utility-records). Solo users get the existing upgrade prompt. No new tier, no billing changes. Reuses the current plan-check mechanism.

---

## 3. Data Model

Canonical storage = **meters, projected frame** (consistent with `survey_points`). New migration is next in sequence (**0008**, after pending 0005 and existing 0007 terrain). The API currently has **no geometry crates** — `spade` + `geo` are added.

### 3.1 `surfaces` — new

A named, versioned surface that is *either* a point-built TIN or a DEM-derived grid.

- `id` (uuid, pk), `project_id` (uuid, fk)
- `name` (text), `version` (int — increments on rebuild)
- `kind` (enum `tin | dem`)
- `status` (enum `building | ready | failed`), `failure_reason` (text, nullable)
- **Inputs snapshot (JSONB `inputs`):** point selection (scope: all/category/group + ref; exclude lists by category/tag/ids), breakline ids, boundary id, params (e.g. max edge length), and for `dem`: the uploaded asset key + sampling params.
- `storage_key` (text — computed mesh blob in Storage: positions + triangle indices + bbox)
- `vertex_count`, `triangle_count` (int — for UI/perf)
- `created_by` (fk users), `created_at`

### 3.2 `surface_breaklines` — new

- `id`, `project_id` (fk), `kind` (`hard | boundary | hole`), `closed` (bool)
- `vertices` (JSONB — ordered `[{n,e,z}]`, meters; z optional for boundary/hole)
- `source` (enum `digitized | dxf`), `source_layer` (text, nullable), `created_at`, `updated_at`

> Boundary/holes are stored as breaklines of kind `boundary`/`hole`. An auto concave-hull boundary is generated as an editable default.

### 3.3 `surface_dems` — new (uploaded DEM assets)

- `id`, `project_id` (fk), `filename`, `storage_key` (GeoTIFF bytes via Storage), `bbox` (JSONB), `source_crs` (text), `uploaded_by`, `uploaded_at`

> Reuses the existing terrain GeoTIFF storage + `geotiff.js` parse path. Distinct from `project_terrain` (OpenTopography backdrop), which is **not** a surface source.

### 3.4 `volumes` — new (reproducible volume computations)

- `id`, `project_id` (fk), `name`
- `method` (enum `grid`)
- `comparison` (enum `surface_to_surface | surface_to_elevation`)
- `base_surface_id` (fk `surfaces`, **with version** snapshot), `compare_surface_id` (fk `surfaces` + version, nullable), `reference_elev` (double, nullable, meters)
- `cell_size` (double, meters — the accuracy knob)
- **Results (snapshotted):** `cut_volume`, `fill_volume`, `net_volume` (m³), `area` (m²), `computed_at`, `computed_by`
- `heatmap_key` (text, nullable — per-cell Δz grid blob in Storage for the heatmap render)

> Volume rows snapshot the surface **versions** and parameters used, so the report reproduces forever even if a surface is later rebuilt.

### 3.5 Existing entities reused

- `survey_points` (+ categories/groups/tags) — TIN point source + exclusions.
- `projects` (epsg/transform/units) — grid/ground/geographic derivation + display units.
- `project_terrain` (OpenTopography) — context backdrop only, not a surface.
- Storage abstraction — mesh blobs, DEM bytes, heatmap grids, export packages.

---

## 4. Architecture

```
   WEB (Next.js · Three.js / R3F)              API (Rust async-graphql)
   ┌──────────────────────────────────────────────────────────────────────┐
   │  Surfaces panel                                                        │
   │   ├ build TIN (point sel + excl, breaklines, boundary) ─buildSurface─► │
   │   ├ upload DEM (geotiff.js preview) ─uploadDem──────────────────────►  │
   │   ├ contours (minor/major, smooth, labels) ─surfaceContours────────►   │
   │   ├ volumes (surf↔surf / surf↔elev, cell size) ─computeVolume───────►  │
   │   └ export (LandXML/DXF/PDF+CSV/GeoTIFF) ─exportSurface──────blob────► │
   │                                                                        │
   │  3D scene (extends terrain-mesh.ts)         api/src/surface/           │
   │   ├ TIN mesh (indexed BufferGeometry)         mod.rs   (types,dispatch)│
   │   │   · elevation ramp · slope · wireframe    tin.rs   (spade CDT,     │
   │   ├ contour polylines (+ labels)                       boundary/holes) │
   │   └ cut/fill heatmap (vertex colors)          contour.rs(iso lines,    │
   │       ◄──── indexed mesh + polylines + grid            smooth, label)  │
   │            from API                           volume.rs (grid sample,  │
   │                                                         cut/fill,heat) │
   │                                               dem.rs   (geotiff→grid)  │
   │                                               export.rs (landxml,dxf,  │
   │                                                         pdf,csv,gtiff) │
   └──────────────────────────────────────────────────────────────────────┘
```

### Triangulation (`api/src/surface/tin.rs`)

- **`spade` constrained Delaunay (CDT):** insert selected points; insert breaklines as constraint edges (forces triangle edges along curbs/ridges/swales); clip to the boundary; remove triangles inside holes and outside the boundary; optional max-edge-length filter to drop spurious long slivers on concave fringes.
- Inputs converted to canonical projected meters; output is an **indexed mesh** (vertex positions + triangle index list + bbox) stored as a blob and streamed to the client.
- Auto concave-hull boundary (alpha-shape) generated when the user hasn't supplied one.

### DEM source (`api/src/surface/dem.rs`)

- Uploaded GeoTIFF parsed/sampled to a `dem` surface (reprojected via `crs.rs`); represented uniformly so volumes treat TIN and DEM identically. Client preview reuses `geotiff.js`.

### Contours (`api/src/surface/contour.rs`)

- Per-triangle iso-line interpolation at minor/major intervals → ordered polylines; optional spline **smoothing**; **elevation labels** on major contours (label points + values). Rendered as Three.js line geometry.

### Volumes (`api/src/surface/volume.rs`)

- **Grid sampling:** overlay a regular grid (cell size param) across the comparison region; sample base vs (compare surface | reference elevation) at each cell; `cut/fill = Σ(Δz × cell_area)`, `net = fill − cut`, plus `area`. Per-cell Δz grid persisted for the **heatmap** (cut = warm, fill = cool, with legend).
- Works identically for TIN↔TIN, TIN↔DEM, surface↔elevation.

### Rendering (web, extends `terrain-mesh.ts`)

Indexed TIN mesh built into `BufferGeometry`; display modes via vertex colors / material: **elevation color ramp**, **slope analysis**, **wireframe/triangle** (TIN QC, shows breaklines), plus the **cut/fill heatmap** and **contour drape**. Existing MeshPhong lighting provides relief. Decimation/LOD for large meshes (see Performance).

---

## 5. API Design

GraphQL, new module `api/src/schema/surface.rs`. All resolvers enforce org/project tenancy + the Crew gate.

### Queries

- `surfaces(projectId): [Surface!]!` / `surface(id): Surface!` (+ mesh metadata)
- `surfaceMesh(id): FileBlob!` — indexed mesh blob (positions + indices) for render.
- `surfaceContours(surfaceId, minor, major, smooth, labels): ContourSet!`
- `volumes(projectId): [Volume!]!` / `volume(id): Volume!` (+ results + heatmap key)
- `volumeHeatmap(id): FileBlob!`
- `exportSurface(surfaceId, formats: [SurfaceExportFormat!]!, contourParams?): FileBlob!` — `landxml | dxf | geotiff`
- `exportVolumeReport(volumeId): FileBlob!` — PDF + CSV

### Mutations

- `buildSurface(projectId, name, kind, inputs): Surface!` — triangulate (async `building → ready/failed`), snapshot inputs, new version.
- `rebuildSurface(id, inputs): Surface!` — re-triangulate → new version.
- `deleteSurface(id): Boolean!`
- `uploadDem(projectId, filename, contentBase64): SurfaceDem!` → then `buildSurface(kind: dem, ...)`.
- Breakline/boundary CRUD: `createBreakline`, `updateBreakline`, `deleteBreakline`, `autoBoundary(projectId, pointScope): Breakline!`.
- `computeVolume(projectId, name, comparison, baseSurfaceId, compareSurfaceId?, referenceElev?, cellSize): Volume!`
- `deleteVolume(id): Boolean!`

### Error handling

- Degenerate/insufficient points, self-intersecting breaklines, boundary not closed → structured errors; surface goes `failed` with `failure_reason`.
- Oversized inputs → caps (`MAX_SURFACE_POINTS`, reuse DEM/GeoTIFF caps).
- Non-overlapping surfaces in a volume → zero area + warning.

---

## 6. UI/UX

### New "Surfaces" panel (project view)

Sibling to scene / survey-points / utilities / field panels. Sections:

1. **Surfaces** — list (name, version, kind, tri count, status); **build TIN** (point scope + exclusions, pick/draw breaklines, boundary auto/draw/import, params) or **upload DEM**; rebuild (→ new version); delete.
2. **Constraints** — digitize breaklines/boundary in-scene (snap survey points) or **import from DXF** (layer mapping); auto concave-hull boundary as editable default; interior holes.
3. **Contours** — minor/major interval, smoothing toggle, label toggle; live preview in scene.
4. **Volumes** — surface-to-surface or surface-to-reference-elevation; pick base/compare (versioned) or reference elevation; cell size; run → cut/fill/net/area + heatmap.
5. **Display** — toggle elevation ramp / slope / wireframe / heatmap / contours; legends.
6. **Export** — formats (LandXML / DXF / GeoTIFF / volume PDF+CSV) + scope → download.

shadcn/ui components; sharp roundedness (SiteLens convention). Solo users see the upgrade prompt.

### Customer-facing in-app docs page (required deliverable)

Add a **"Surfaces (TIN / Contours / Volumes)"** page to the in-app `/docs` site:

- **Nav:** entry in `web/src/lib/docs.ts` `docsOrder` (group **"Visualization"**), `slug: 'surfaces'`, href `/docs/surfaces`.
- **Content:** `web/src/content/docs/surfaces.md` — what a TIN is and why breaklines/boundary matter, choosing the point set + exclusions, digitizing vs importing breaklines, uploading a DEM, contour intervals/smoothing/labels, running cut/fill volumes (surface-to-surface vs to-elevation, cell size), reading the heatmap, and exporting (LandXML/DXF/GeoTIFF/PDF). Note OpenTopography is context-only, not a survey surface.
- **Route:** `web/src/app/docs/surfaces/page.tsx` following the `[slug]` pattern (`getDocNav` / `getDocContent` + `DocsPageContent`).

---

## 7. Security

- **Parsing/compute is the attack surface.** DEM GeoTIFF + DXF decoders bounded by size caps; bound point/triangle counts before triangulation; guard against pathological breaklines (self-intersection) and unbounded grid sizes (cell size floor relative to extent) to prevent OOM/CPU exhaustion.
- **Tenancy:** every resolver scopes by org/project; surfaces/breaklines/volumes inherit project ACLs.
- **No new external network** — uploads/exports are file-based via Storage; OpenTopography fetch path is unchanged.

---

## 8. Testing

Per SiteLens conventions (shared utils tested; Playwright in `web/e2e`).

- **Rust unit tests (`tin.rs`):** Delaunay correctness on known point sets; breakline edges are honored (constraint present in output); boundary clip + hole removal; max-edge filtering; degenerate input handling.
- **`contour.rs`:** iso-line interpolation on a known tilted plane (contours are straight, correctly spaced); smoothing preserves topology; label placement on majors.
- **`volume.rs`:** cut/fill against closed-form solids (e.g. a known prism / cone / flat-pad to datum) within grid-cell tolerance; net = fill − cut; surface-to-elevation; non-overlap → zero.
- **`dem.rs`:** GeoTIFF → grid sampling + reprojection.
- **Export tests:** LandXML surface round-trip (faces/breaklines), DXF 3DFACE + contour layers, GeoTIFF DEM validity, PDF smoke + CSV values; volume report shows method/cell size/surface versions.
- **Playwright e2e:** build a TIN from points + a breakline → renders as mesh; toggle elevation ramp/slope/wireframe; generate contours; run a surface-to-elevation volume → cut/fill + heatmap; export; Solo-plan gate.

---

## 9. Deployment

- Migration **0008**: `surfaces`, `surface_breaklines`, `surface_dems`, `volumes`. (Apply pending **0005**, then **0008**; 0007 terrain already exists.)
- New Rust deps: **`spade`** (constrained Delaunay), **`geo`/`geo-types`** (geometry ops), a GeoTIFF reader for server-side DEM sampling (e.g. `tiff`), reuse `printpdf` (PDF) + `csv`. First computational-geometry surface in the backend.
- Web: Surfaces panel + Three.js TIN/contour/heatmap rendering (extends `terrain-mesh.ts`) + docs page; reuse `geotiff.js` for DEM preview and existing DXF parse path.
- **Performance:** triangulation + volume grid run server-side; mesh decimation/LOD for large surfaces before render (consistent with existing 256² terrain decimation); async build status. Coordinate with the project's existing Performance phase.
- Standard flow: lint → format → test → commit → push → deploy (Dokploy compose, server-1); apply migrations on deploy. Docs page ships with the web build.

---

## 10. Scope Boundaries

**In v1:**
- Constrained TIN (points + breaklines + boundary + holes) via Rust `spade`; auto concave-hull boundary default.
- Two surface sources: point-built TIN + uploaded high-res DEM (OpenTopography context-only).
- Named, versioned surfaces (stored mesh + input snapshot); input-level editing (rebuild → new version).
- Point selection scopeable (category/group) + explicit exclusions.
- Contours: minor/major intervals + smoothing + major labels.
- Volumes: surface-to-surface + surface-to-reference-elevation via grid sampling (adjustable cell), cut/fill heatmap; snapshotted/reproducible.
- Display: elevation ramp + slope + wireframe + heatmap + contour drape.
- Exports: LandXML surface + DXF (faces+contours) + volume report (PDF+CSV) + GeoTIFF DEM.
- New Surfaces panel; Crew-tier gating; customer-facing in-app docs page.

**Explicitly deferred (out of v1):**
- Prismoidal / exact TIN-intersection volumes; bounded-region (drawn footprint) quantities.
- Triangle-level surface editing (edge swap, delete triangle, add/move point).
- Depression hachures; dedicated hillshade-only / extra cartographic modes.
- Grading design, watershed / drainage / flow analysis.
- OpenTopography (coarse) as a volume surface; DWG.
- User-defined volume units beyond cubic yards (default) / cubic meters.
