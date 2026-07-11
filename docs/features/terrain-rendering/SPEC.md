# Terrain Rendering — Product & Architecture Specification

> Compose the 3D scene's ground from **two DEMs stitched into one continuous surface** — coarse context outside the property boundary, high-res detail inside — with per-volume **graded terrain** (existing ground booleaned with earthwork), all shipped over an **efficient binary transport** and rendered in the existing Three.js / React Three Fiber viewer.

This is a **feature within the existing SiteLens project**, not a standalone project. It reworks the *rendering and delivery* of terrain that already exists: the OpenTopography / USGS 3DEP pipeline (`schema/terrain.rs`), the client GeoTIFF decode path (`terrain-mesh.ts`, `geotiff.js`), the local ENU frame (`terrain-frame.ts`, `toLocal`/`makeFrame`), the surface-modeling volume + graded-terrain pipeline (`surface/volume.rs`, `shared.rs:build_graded_terrain_blob`), and the versioned binary blob formats (`surface/mod.rs`: STIN/SCTR/SVOL/ESOL).

> **Depends on — and provides — parts of the [shared feature foundation](../_shared-foundation/SPEC.md).**
> Consumes: the Rust geometry stack (`spade` constrained triangulation, `surface/geom.rs`
> point-in-polygon / hulls), the surface abstraction (§7 of surface-modeling), the volume
> engine (`surface/volume.rs`), scene overlay primitives, the Storage abstraction, and gating.
> **Provides:** a **binary asset transport** (§6) and a **composite-terrain abstraction**
> (§4) that any future scene layer can render over the seamless split surface.

---

## 1. Overview

Today the scene ground is a single decimated mesh: one USGS 3DEP GeoTIFF at ~10 m/px, capped to a hard **256×256** grid, base64'd through GraphQL, decoded client-side into one flat "clay" `meshStandardMaterial` mesh with a radial-alpha edge dissolve. The 1 m 3DEP DEM already fetched for the boundary AOI exists only as a volume base — it is never shown as relief. There is no runtime LOD, no tiling, and every blob (terrain GeoTIFF, STIN/SVOL/ESOL) rides base64-in-JSON, inflating payloads ~33% and forcing a JSON-parse + base64-decode before the bytes are usable.

This feature makes the ground **survey-grade where it matters and cheap everywhere else**:

- When a **property boundary** exists, the ground becomes a **composite**: coarse 10 m DEM outside the boundary, **1 m detail inside**, both clipped to the boundary polygon and **stitched with bridging faces** into one continuous, seamless surface. Same flat-clay material + lighting-driven relief on both, so it reads as a single ground.
- The inside-boundary detail can be **booleaned with the earthwork** to show the **graded** surface — the finished grade — for **one or many volumes at once**, with a **clean cut along each design edge and no gaps** (proactively filled into one continuous surface), carrying the same material, with the cut/fill **heatmap draped over the full graded surface**.
- The inside-boundary detail is **one adaptively-decimated, budgeted mesh**; the coarse backdrop is a single clipped mesh.
- Everything ships over a **binary asset endpoint** (raw bytes, gzip/brotli, ETag) with **Draco/quantized** mesh compression, and the client **stops decoding GeoTIFFs for draping** — a **compact server-side sampler** replaces that.

Critically, this rides the **existing Three.js / R3F renderer** — *not* Cesium (the Ion token in config is a dead stub). Heavy geometry (clip, stitch, decimate, boolean, tile) runs **server-side in Rust**; the client renders ready-made indexed meshes.

### Core principles

- **One ground, two resolutions.** Coarse outside + detail inside must read as a single continuous surface — clipped to the boundary and seam-stitched, same material, lighting-driven relief.
- **Detail where the work is.** 1 m only inside the property boundary; coarse everywhere else. No boundary → coarse only (current behavior, unchanged).
- **Graded is the detail booleaned with earthwork.** Reuse the existing graded-terrain pipeline; the heatmap drapes the full graded surface. Cut/fill volume solids are unchanged.
- **Compute in Rust, render in Three.js.** Clip / stitch / decimate / boolean server-side; the client renders indexed meshes. No Cesium, no client CSG.
- **Cheap on the wire.** Binary transport (no base64-in-JSON), Draco/quantized meshes, server precompute + versioned cache, and a compact sampler so the client stops decoding multi-MB GeoTIFFs.
- **Reuse before rebuild.** Lean on the 3DEP fetch, the ENU frame + `toLocal`, `spade`/`geom.rs`, the volume engine, `build_graded_terrain_blob`, Storage, and the existing blob formats.

---

## 2. Users & Access

- **Everyone (all roles, all plans):** the improved **base split terrain** (coarse + detail composite, seamless, lighting-driven relief) renders whenever a property boundary exists. **Ungated** — it is the base scene, not a paid capability.
- **Surveyors / Crew:** graded-terrain (per-volume boolean), the cut/fill **heatmap over graded**, and volume **solids** stay **Crew** (consistent with surface-modeling — `Feature::Surfaces`).
- **Viewers:** see everything read-only.

**Plan gating:** base terrain is ungated; graded/volume overlays gate through the existing live plan-check (`require_feature(ctx, Feature::Surfaces)` on the graded/heatmap/solid resolvers), exactly as today. No new tier, no feature flag — the split composite **replaces** current terrain rendering whenever a boundary is present, and falls back to coarse-only otherwise.

---

## 3. Data Model

Canonical storage = **meters, projected frame** (consistent with `survey_points` and surface-modeling). Terrain vertices continue to be shipped **geographic (lat, lon, height)** and placed via the shared `toLocal`, guaranteeing exact registration on the point cloud.

**No new tables expected.** Composite, graded, coarse-tile, and sampler artifacts are **computed on demand and cached in Storage**, keyed by a content hash of their inputs (see §5). If a persisted cache index proves necessary it lands as the next sequential migration (**0019**), but the working assumption is Storage-key caching with no schema change.

### 3.1 Cache keys (Storage, not DB)

Each derived artifact is a Storage blob keyed by a stable hash so identical inputs never recompute:

- **Composite terrain:** `hash(project_id, boundary_version, coarse_dem_version, detail_dem_version, budget, algo_version)`
- **Graded terrain (set of volumes):** `hash(sorted[(volume_id, volume_version)…], detail_dem_version, boundary_version, algo_version)` — keyed by the exact active set + order, so any combination caches independently.
- **Compact sampler:** `hash(project_id, coarse_dem_version, detail_dem_version, boundary_version, sampler_res)`

`*_version` bumps whenever the source (boundary polygon, fetched DEM, volume snapshot) changes; `algo_version` bumps when the generation code changes, invalidating stale caches on deploy.

---

## 4. Architecture

```
 Property boundary polygon        Coarse 3DEP GeoTIFF (~10m)      Detail 3DEP GeoTIFF (1m, AOI)
 (existing property boundary) ──┐        │ (Storage)                    │ (Storage)
                                ▼        ▼                              ▼
                        ┌──────────────────────────────────────────────────────┐
                        │  Rust composite pipeline (surface/terrain_composite)  │
                        │  • decode DEMs (geotiff.rs)                            │
                        │  • clip coarse to OUTSIDE boundary (geom.rs PIP)       │
                        │  • clip detail to INSIDE boundary                      │
                        │  • adaptive-decimate detail to vertex budget           │
                        │  • stitch seam: bridge coarse-ring ↔ detail-ring faces │
                        │  • per-vertex normals (lighting-driven relief)         │
                        │  • quantize + Draco-compress                           │
                        └──────────────────────────────────────────────────────┘
                                │ CTER blob (regions: coarse | detail | seam)     ▲
                                ▼                                                 │ cached (Storage, §3.1)
                    ┌────────────────────────────┐                               │
   per volume ─────►│ graded pipeline (reuse      │── GTER blob ──┐              │
   (Crew)           │ build_graded_terrain_blob): │ (detail ⊕ vol)│              │
                    │ detail ⊕ earthwork boolean  │               │              │
                    └────────────────────────────┘               │              │
                                │                                 │              │
   compact sampler ─► SAMP blob (downsampled heightfield)         │              │
                                                                  ▼              │
        ┌─────────────────────────── Binary asset endpoint (axum) ──────────────┘
        │   GET /assets/:kind/:key  → raw bytes, gzip/brotli, ETag/Cache-Control
        │   Cookie-JWT auth: verify org/project ownership (+ Crew gate for GTER/SVOL/ESOL)
        └───────────────────────────────────────────────────────────────────────
                                │ ArrayBuffer fetch (no base64, no JSON parse)
                                ▼
        ┌──────────────────── Client (React Three Fiber) ───────────────────────┐
        │  Draco/quantized decode → BufferGeometry                               │
        │  • CompositeTerrain: coarse mesh + detail mesh + seam                  │
        │  • GradedTerrain: swaps detail region when a volume is "graded"        │
        │  • VolumeHeatmap: SVOL Δz draped over graded detail                    │
        │  • VolumeSolid (ESOL): unchanged                                       │
        │  • Draping: SAMP sampler — detail inside boundary, coarse outside      │
        │  • Cut/fill mode: ghost (dim) detail, show solids crisp                │
        └───────────────────────────────────────────────────────────────────────
```

- **Frame:** unchanged. `makeFrame` builds the flat-Earth ENU frame; all terrain, detail, graded, tile, and volume vertices ship geographic and place via the same `toLocal`. Any new layer that emits geographic vertices registers correctly for free.
- **Regions in one blob:** the composite `CTER` blob carries three index ranges — `coarse` (outside), `detail` (inside), `seam` (bridge). The client renders **detail as a separately-materialed, independently-toggleable mesh** so cut/fill mode can dim/hide it without touching coarse or seam.
- **Graded swap:** when a volume is toggled graded, the client swaps the detail region for that volume's `GTER` blob (detail ⊕ earthwork); the heatmap `SVOL` drapes over it.

---

## 5. Server compute

All heavy geometry runs in Rust in `api/src/surface/` (new `terrain_composite.rs`, `sampler.rs`; graded reuses `shared.rs:build_graded_terrain_blob`), inside `spawn_blocking` per the codebase convention. Results are cached in Storage (§3.1).

### 5.1 Composite terrain (`CTER`)

1. Decode coarse + detail GeoTIFFs (`geotiff.rs`).
2. **Clip** coarse to *outside* the boundary polygon and detail to *inside*, via `geom.rs` point-in-polygon on cells (triangle-centroid classification, matching the graded-terrain clip).
3. **Adaptive-decimate** the detail grid — dense on slopes/breaks, sparse on flats — down to a **fixed vertex budget** (see §7), so a small site keeps native 1 m and a large one degrades gracefully into one mesh.
4. **Stitch the seam:** the coarse boundary ring and the detail boundary ring have non-matching vertices (different resolutions); generate a **bridging triangle strip** between the two rings so there is no gap. Where boundary elevations differ slightly (both are 3DEP, so cm–dm), the strip forms a thin skirt.
5. Compute **per-vertex normals** for lighting-driven relief (no baked hillshade).
6. Quantize positions/normals + Draco-compress; emit `CTER` with `coarse|detail|seam` region ranges.

### 5.2 Graded terrain (`GTER`) — multi-volume from the start

`GTER` is built for a **set of volumes** (one or many), not a single volume — the user can view any combination of volumes graded at once, as **one continuous surface**. Extend `build_graded_terrain_blob` to take an ordered list of volumes: the terrain being cut is the **inside-boundary 1 m detail**; within **each** volume's design footprint, apply that volume's graded design grade; outside all footprints (but inside boundary) keep existing detail. Same material, per-vertex normals. The blob is cached by the **sorted set of `(volume_id, volume_version)`** (§3.1), so common combinations recur without recompute.

**The cut must be clean and the surface gap-free — this is a hard requirement, not a nicety:**

- **All footprints as constraints in one triangulation.** Re-triangulate the detail grid with **every selected footprint polygon as a hard constraint edge at once** (spade CDT, reusing `surface/geom.rs` + the constrained path). Each pad↔detail boundary is a smooth polyline following the design edge — **never** a stair-stepped grid-cell edge.
- **Overlap precedence (deterministic).** When two footprints overlap, the region resolves to a single grade by explicit **stacking order** — later in the ordered list wins (default order = most-recently-updated volume on top; user-reorderable in the UI). No ambiguous double-application; the overlap is one clean region with a clean internal edge between the two grades.
- **Watertight, no gaps.** Every pad and the surrounding detail (and pad↔pad edges) are **stitched into one continuous mesh** — shared vertices, **no T-junctions, cracks, or z-fighting slivers**. Elevation differences at any edge (cut/fill faces, and pad-to-pad steps) are closed with an explicit **vertical/near-vertical wall strip** — proactively filled, never left open. Same approach as the boundary seam (§5.1).
- **Degenerate-safe.** Footprints that clip the boundary, self-touch, overlap, or contain holes still produce a single closed surface (reuse the boundary/hole centroid-clip + `can_add_constraint` guards proven in surface-modeling).

The result is one continuous graded terrain — any number of volumes combined — with crisp design edges and no visible gaps, carrying the same clay + lighting-driven material as the rest of the ground. The cut/fill **heatmap** (`SVOL`, base mesh + per-vertex Δz) drapes over this combined surface, showing net Δz across all selected volumes vs. existing detail.

### 5.3 Compact sampler (`SAMP`)

A small downsampled heightfield (coarse full-extent + detail inside boundary) the client uses for **draping** (points/grid/buildings) — **detail sampler inside the boundary, coarse outside** — replacing the current client GeoTIFF decode entirely.

---

## 6. API & Transport

### 6.1 Binary asset endpoint

New axum route, **outside** the GraphQL base64 path:

```
GET /assets/:kind/:key      kind ∈ { cter, gter, samp, stin, sctr, svol, esol }
→ 200 raw bytes (Draco/quantized where mesh), Content-Encoding: gzip|br,
  ETag: <content-hash>, Cache-Control: private, immutable, max-age=…
→ 304 on If-None-Match match
```

- **Auth:** Cookie-JWT (reuse existing session middleware). Per request: resolve the key → owning org/project, verify the caller's org matches, and **enforce the Crew gate** for `gter|svol|esol` (graded/volume artifacts). No signed URLs in v1 (route is designed so signed URLs can be added later without client changes).
- **Discovery:** GraphQL still returns **metadata + asset keys/ETags** (not bytes) — e.g. `projectCompositeTerrain { key, etag, regions{…}, vertexCount }`, `gradedTerrain(volumeIds: [ID!]!) { key, etag }` (accepts the ordered set of active volumes), `terrainSampler { key, etag }`. The client fetches bytes over `/assets`.
- **Existing blobs retrofitted:** STIN/SCTR/SVOL/ESOL move to `/assets` too (the base64 GraphQL content fields are deprecated, then removed once the client is cut over).

### 6.2 Mesh compression

Positions/normals **quantized** (16-bit, bbox-relative) and **Draco-compressed** server-side; client decodes via Draco (drei/three `DRACOLoader` or a wasm decoder). Falls back to quantized-only if Draco decode is unavailable.

---

## 7. Performance

- **Detail budget:** one mesh, **adaptive slope-aware decimation** to a fixed vertex/triangle budget (target ~250k tris). Native 1 m where the boundary is small; graceful degradation when large. No client GeoTIFF decode (sampler replaces it).
- **Coarse:** a single clipped mesh (outside the boundary), decimated to a budget like today's terrain — no runtime tiling.
- **Transport:** binary + gzip/brotli + Draco (5–10× smaller than base64 mesh), immutable caching by content hash (repeat loads = 304 / cache hit), server precompute so nothing recomputes per request.
- **Render:** keep existing wins — `RenderGate` demand frameloop, in-place geometry swap + dispose, precomputed-normal morph, `<Fade cull>`. Detail is a separate mesh so graded-swap / cut-fill-ghost never re-tessellate coarse.

---

## 8. UI / UX

- **Base:** with a property boundary, the ground renders as the seamless composite (coarse + detail), flat clay + lighting relief. No new controls — it replaces the current terrain.
- **Graded (Crew):** per-volume toggle, **multi-select** — any number of volumes can be graded at once. The inside-boundary detail is swapped for the **combined** graded surface built from the active set (one continuous surface, §5.2); the cut/fill **heatmap** drapes the full combined surface (net Δz). Overlapping footprints resolve by **stacking order** (reorderable). Default state is **existing** (ungraded) detail; toggling all off returns to existing.
- **Cut/fill mode (Crew):** hides the graded/detail as the primary surface and shows the **solids for all selected volumes as-is**; the existing detail is **ghosted (dimmed / semi-transparent)** outside the footprints so there is no hole, solids crisp inside.
- **No boundary:** coarse-only, exactly as today.

---

## 9. Security

- Binary asset route enforces tenancy on **every** request (org/project ownership from the resolved key) and the **Crew gate** for graded/volume artifacts — the bytes must not be reachable by guessing a key. For a multi-volume `gter` key, tenancy is verified for **every** volume in the set (reject if any is cross-tenant).
- Cache keys are content hashes (non-enumerable), but access control never relies on key secrecy.
- No survey coordinates in logs; asset keys are opaque.

---

## 10. Testing

Follows the repo pattern (Rust unit + closed-form geometry, integration resolvers, Playwright e2e) **and closes the current client-decoder coverage gap**:

- **Rust unit:** boundary clip (inside/outside classification), **seam stitch** (no gaps, ring bridging, elevation skirt), adaptive decimation (budget respected, slope preservation), graded boolean (detail ⊕ volume matches existing `build_graded_terrain_blob` invariants; clean footprint edges, no gaps), sampler correctness (detail-inside / coarse-outside), `CTER`/`GTER`/`SAMP` blob header + roundtrip.
- **Integration:** `/assets` route — cookie-JWT auth, tenant isolation, Crew gate on `gter|svol|esol`, ETag/304, content-encoding; GraphQL metadata resolvers return keys/etags.
- **Client unit (new — fills the gap):** Draco/quantized decoders, `CTER` region parsing into BufferGeometry, sampler draping (detail inside / coarse outside), heatmap-over-graded.
- **Playwright e2e:** boundary present → seamless composite renders; per-volume graded toggle swaps detail + heatmap drapes; cut/fill mode ghosts detail + shows solids; no boundary → coarse-only; asset requests hit `/assets` (not base64).

---

## 11. Deployment

- New axum `/assets` route + static/compression middleware; Draco decoder shipped with the web bundle.
- Likely **no migration** (Storage-key caching); if a cache index is needed → **0019**.
- `algo_version` bump on deploy invalidates stale composite/graded/tile/sampler caches automatically.
- Rust image rebuild only if a new migration lands (per the `sqlx::migrate!` compile-time bake note); otherwise a normal deploy.

---

## 12. Scope Boundaries

**In v1:** boundary split composite (coarse + detail, clipped + seam-stitched), lighting-driven relief, per-volume graded boolean + heatmap-over-graded, cut/fill ghosting, binary asset endpoint (+ retrofit existing blobs), Draco/quantized compression, **adaptive detail decimation**, **compact server-side sampler**, server precompute + versioned cache.

**Deferred (post-v1):**

- **Aerial / satellite imagery drape** (photoreal orthoimagery) — clay + lighting-driven relief chosen instead.
- **Signed short-lived asset URLs / CDN** — cookie-JWT for v1; route designed to add them later without client changes.
- **Baked cartographic hillshade** (fixed-sun shaded relief) — lighting-driven only for v1.
- **Surface-model (TIN) as the inside-boundary source** — v1 uses the 1 m 3DEP DEM inside the boundary; surfaces remain a separate layer.

**Explicitly not doing:** runtime distance-LOD / tiled streaming (quadtree). Coarse and detail are each a single budgeted mesh; not needed at the target site scales.
