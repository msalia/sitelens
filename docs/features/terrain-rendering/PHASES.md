# Terrain Rendering — Implementation Phases

Feature within the existing SiteLens project. Each phase ends in a working, shippable state and follows the standard flow (lint → format → test → commit → push where appropriate — see [[feedback-phase-completion]], [[feedback-no-push]]). Ordering: efficient transport first (foundation everything ships over), then the split composite, then draping, then graded + cut/fill, then docs + acceptance.

```
Phase 1 ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5
(binary    (split      (compact   (graded    (docs +
 transport  composite   sampler +  boolean +  coverage +
 +quantize) coarse+     draping)   heatmap +  acceptance)
            detail                 cut/fill
            + seam)                ghosting)
```

Dependencies: P2 ships over P1's transport. P3 needs P2 (composite regions + boundary). P4 needs P2 (detail region to swap) + the existing volume/graded pipeline. P5 needs all prior.

---

## Phase 1 — Binary asset transport + quantized blobs

The foundation: stop base64-in-GraphQL, serve raw bytes over an authed `/asset` route, and shrink meshes. Independently shippable — retrofit the *existing* blobs (STIN/SCTR/SVOL/ESOL/GeoTIFF) first, before any new geometry exists. Two sub-steps: **1a transport** (raw bytes + gzip/brotli, existing f64 formats — immediate win, low risk) then **1b quantization** (16-bit meshes — more win).

Seams (from the codebase map): router `api/src/lib.rs:282`; auth `auth_from_headers(&headers, &state.config.jwt_secret)` (`lib.rs:111`); storage `Storage::get(key)` (`storage.rs:11`); blob formats `api/src/surface/mod.rs`; existing resolvers in `schema/surface/query.rs` + `schema/terrain.rs` (Crew gate `require_feature(ctx, Feature::Surfaces)`); web decoders are already `ArrayBuffer`-native (`buildSurfaceGeometry`, surface-mesh.tsx:62); browser reaches the API only via the Next.js proxy (`web/src/app/api/graphql/route.ts`).

### Phase 1a — transport (raw bytes, no quantization)

- [x] Add `storage: Arc<dyn Storage>` to `AppState` so a plain axum route can reach it. (`lib.rs`; `router()` + `build_router()` extracted for tests.)
- [x] New axum handler + routes for the **pure-fetch** blobs under `/asset/…`: `surface/{id}/mesh`, `volume/{id}/heatmap`, `project/{id}/terrain`, `project/{id}/terrain-detailed`, `project/{id}/buildings`. Raw bytes; `ETag = sha256 hex`; `304` on `If-None-Match`; `Cache-Control: private, must-revalidate`; `Content-Type` + `Content-Disposition`. Core logic in `api/src/asset.rs` (`Asset` enum + `resolve_asset` → `AssetOutcome`).
- [ ] **Computed** blobs (`surface/{id}/contours` SCTR, `volume/{id}/solid|graded` ESOL) — deferred within 1a; they stay on base64 until their byte-producers are factored out of the resolvers (graded is rewritten in P4 anyway).
- [x] `tower-http` `CompressionLayer` (`compression-gzip,compression-br`) on the asset sub-router.
- [x] Auth via `auth_from_headers`; org-scope every lookup (JOIN `projects`); Crew gate `mesh|heatmap` via `org_billing().has_feature(Feature::Surfaces)`; base terrain/buildings ungated. Order = auth → gate → ownership (mirrors resolvers).
- [x] Web infra: Next.js proxy `web/src/app/api/asset/[...path]/route.ts` (Next 16 async `ctx.params`) forwarding the session cookie + `If-None-Match`, relaying ETag/304; `web/src/lib/asset.ts` = `assetUrls` builders + `fetchAssetBuffer`/`fetchAssetText` (`credentials: 'same-origin'`, `null` on 404).
- [x] Web cutover — **terrain + buildings**: `scene-view.tsx` loaders fetch `/asset` (GeoTIFF → `ArrayBuffer`; buildings → text→JSON); `TerrainData` now carries `buffer: ArrayBuffer`; `terrain-viewer.tsx` decodes `terrain.buffer` directly (no base64). URLs are stable so the browser HTTP cache revalidates via ETag.
- [x] Web cutover — **surface mesh + volume heatmap**: `scene-view.tsx` `surface`/`volumeBlob` state now hold `ArrayBuffer`; loaders fetch `/asset`; `terrain-viewer.tsx` decodes `surface` directly (dropped `base64ToArrayBuffer`); `volume-heatmap.tsx` `readHeatmapRange`/`VolumeHeatmap` take `ArrayBuffer`.
- [ ] Computed blobs (`contours` SCTR, `solid`/`graded` ESOL) still ride base64 GraphQL — deferred within 1a (graded is rewritten in P4).
- [ ] GraphQL: (optional) `assetUrl`/`etag` metadata fields; the client builds URLs directly from ids, so this is only needed if a resolver must signal presence. Remove the base64 `content_base64` render fields in P6 once fully cut over.

> **Shipped so far (1a):** *Backend* — `api/src/asset.rs` + `/asset` routes in `lib.rs`, gzip/brotli, sha256 ETag/304; `api/tests/integration/asset.rs` (8) + `etag_for` unit; suite green (200 lib + 133 integration). *Web* — `/api/asset` proxy + `lib/asset.ts` (+ `asset.test.ts`, 6 tests); **terrain, buildings, surface mesh, volume heatmap** all cut over to the binary route; tsc + eslint clean, web unit 52 green. **Remaining 1a:** computed-blob migration (deferred) + base64-field removal (P6). **Not yet browser-verified** — needs a Playwright/manual scene check (sandbox can't launch Chromium).

### Phase 1b — quantization

- [ ] New quantized mesh encoding in `surface/mod.rs` (version-bumped magic): positions 16-bit bbox-relative (u16), plus the bbox as f64 for dequant; indices u16 when V ≤ 65535 else u32; carry per-vertex dz (SVOL) / rgb (ESOL) quantized to u8/u16. Keep f64 deserialize for back-compat during rollout.
- [ ] Web: `dequantize` decoders (DataView) → `BufferGeometry`; version-switch on the magic so old + new blobs both decode.

### Tests

- [ ] Rust unit: ETag stability (same bytes → same hash); quantize↔dequantize roundtrip within tolerance; header/version parity; index width switch at the 65535 boundary.
- [ ] Integration: `/asset` auth (cookie-JWT present/absent/expired), tenant isolation (cross-org → 404/403), Crew gate on `heatmap|solid|graded`, ETag → 304, gzip/br content-encoding negotiation, contours computed on demand.
- [ ] Client unit (**new — fills the current gap**): quantized + legacy-f64 decode → BufferGeometry for STIN/SVOL/ESOL; proxy URL building.
- [ ] Playwright: existing surface/volume/terrain scenes still render, now fetching `/asset` (not base64) — assert response carries no `content_base64`.

### Validates

Existing terrain/surface/volume payloads shrink substantially (no base64 inflation + no JSON parse in 1a; ~4× smaller meshes in 1b) and load over an authed binary route with ETag caching. No visual change — pure transport win.

---

## Phase 2 — Split composite: coarse + detail + seam

The core rework. Server clips both DEMs to the property boundary, adaptively decimates the detail, stitches the seam, and ships one `CTER` blob; the client renders it as a seamless ground with lighting-driven relief, replacing current terrain when a boundary exists.

### Deliverables

- [ ] `api/src/surface/terrain_composite.rs`: decode coarse + detail GeoTIFFs; clip coarse **outside** / detail **inside** the boundary (`geom.rs` PIP, centroid classification); **adaptive slope-aware decimation** of detail to the vertex budget (~250k tris); **seam stitch** (bridge coarse-ring ↔ detail-ring, elevation skirt); per-vertex normals; emit `CTER` (regions `coarse|detail|seam`), 16-bit-quantized, cached by hash.
- [ ] GraphQL: `projectCompositeTerrain { key, etag, regions{coarse,detail,seam}, vertexCount }`; falls back to null (coarse-only) when no boundary.
- [ ] Web: `CompositeTerrain` component — decode `CTER`, render coarse + seam as one mesh and **detail as a separate, independently-toggleable mesh**; flat-clay `meshStandardMaterial` + normals (lighting-driven relief); place via `toLocal`. Replaces the current single terrain mesh when a boundary is present; coarse-only path unchanged otherwise.

### Tests

- [ ] Rust unit: inside/outside clip classification; **seam has no gaps** (every boundary-ring edge bridged); decimation respects budget + preserves slope/breaks; `CTER` region-range roundtrip.
- [ ] Integration: composite resolver returns keys + region metadata; no-boundary → null; tenant scope.
- [ ] Client unit: `CTER` region parsing → three BufferGeometry ranges; detail mesh is separable.
- [ ] Playwright: project **with** boundary renders seamless composite (coarse + detail visible, no visible seam gap); project **without** boundary renders coarse-only.

### Validates

The scene ground is now two resolutions stitched into one continuous surface — high-res inside the property, cheap context outside — reading as a single ground.

---

## Phase 3 — Compact sampler + draping

Drop client GeoTIFF decode. Server ships a small heightfield; the client drapes points/grid/buildings onto detail inside the boundary and coarse outside.

### Deliverables

- [ ] `api/src/surface/sampler.rs`: build `SAMP` — downsampled heightfield (coarse full extent + detail inside boundary), cached by hash.
- [ ] GraphQL: `terrainSampler { key, etag, … }`.
- [ ] Web: `SAMP` sampler over `/assets`; replace the client GeoTIFF `sample()` used for draping with **detail-inside / coarse-outside** selection; remove the client-side GeoTIFF decode for the render/drape path.

### Tests

- [ ] Rust unit: sampler correctness (bilinear; detail inside boundary, coarse outside; nodata fallback).
- [ ] Client unit (extends `terrain.test.ts`): draping picks detail vs coarse by boundary membership; parity with prior GeoTIFF-sampled heights within tolerance.
- [ ] Playwright: points/grid/buildings sit on the rendered surface at and across the seam (no float/sink).

### Validates

The client no longer decodes multi-MB GeoTIFFs; draping is correct against whatever terrain is rendered beneath each object.

---

## Phase 4 — Graded terrain (multi-volume boolean) + heatmap + cut/fill ghosting

Wire the volume workflow into the split terrain. Multi-select graded toggle (one *or many* volumes combined into one surface), heatmap over the full graded surface, cut/fill mode that ghosts detail and shows solids.

### Deliverables

- [ ] Extend `shared.rs:build_graded_terrain_blob` → `GTER`: take an **ordered set of volumes**; cut the **inside-boundary 1 m detail** with each volume's earthwork (design grade inside each footprint, existing detail elsewhere), per-vertex normals, same material; **cached by the sorted set of `(volume_id, volume_version)`**.
- [ ] **All footprints as constraints:** re-triangulate the detail grid with **every selected footprint polygon as a hard constraint edge at once** (spade CDT, reuse `surface/geom.rs`) so each pad↔detail boundary is a smooth polyline — never a stair-stepped grid-cell edge.
- [ ] **Overlap precedence:** overlapping footprints resolve deterministically by **stacking order** (later wins; default = most-recently-updated on top). One clean region, no double-application.
- [ ] **Watertight fill:** stitch every pad, pad↔pad edges, and surrounding detail into **one continuous manifold mesh** (shared vertices, no T-junctions/cracks); close elevation differences at all edges with an explicit **wall strip** — proactively fill so there are no visible gaps. Degenerate-safe for footprints that clip the boundary / self-touch / overlap / contain holes.
- [ ] GraphQL: `gradedTerrain(volumeIds: [ID!]!) { key, etag }` (Crew-gated, gate + tenancy checked for **every** volume in the set); heatmap `SVOL` reused, draped over the combined surface (net Δz).
- [ ] Web: **multi-select** graded toggle — any number of volumes graded at once; swaps the detail region for the combined `GTER`; reorder controls for overlap precedence; **heatmap drapes the full combined surface**; **cut/fill mode** hides graded/detail as primary, shows **all selected volumes' solids (ESOL) as-is**, and **ghosts (dims) the existing detail** outside the footprints (no hole). Default = existing (ungraded) detail; all-off returns to existing.

### Tests

- [ ] Rust unit: graded boolean invariants for **single and multiple** volumes (each footprint = its design grade, elsewhere = detail; combined volume matches sum from `volume.rs`); overlap precedence deterministic (later wins); `GTER` roundtrip. **Clean cut:** each pad↔detail edge equals its design footprint polyline (not grid-aligned), within tolerance. **Watertight:** mesh is manifold across pad↔detail and pad↔pad edges — no gaps/holes, no unshared boundary edges, wall strips close elevation offsets. Degenerate footprints (boundary-clipping, overlapping, holes) still yield one closed surface.
- [ ] Integration: `gradedTerrain` Crew-gated + tenant-scoped for the whole set (rejects if any volume is cross-tenant); `/assets` gate on `gter`.
- [ ] Client unit: heatmap Δz over combined graded surface; detail↔graded region swap; multi-volume set → single blob.
- [ ] Playwright: toggle **two** volumes graded → detail becomes one combined graded surface + heatmap drapes; reorder changes overlap; enter cut/fill → detail ghosts, all selected solids crisp, no hole.

### Validates

A Crew user sees the finished grade booleaned into the site as **one continuous surface with a crisp design edge and no gaps**, reads cut/fill via the heatmap over it, and inspects earthwork solids without a hole in the ground.

---

## Phase 5 — Docs + coverage + acceptance

Ship the in-app docs page, finish any coverage gaps, and run end-to-end acceptance on the BAPS seed site.

### Deliverables

- [ ] In-app **Terrain Rendering** docs page (`content/docs/terrain.md` + `app/docs/terrain/page.tsx` + `docsOrder`), matching the surfaces/analysis docs pattern ([[feedback-frontend-docs-site]]).
- [ ] `lib/docs.test.ts` entry (nav → content + route).
- [ ] BAPS end-to-end acceptance: boundary present → seamless composite; per-volume graded + heatmap; cut/fill ghosting; all assets over `/assets` binary route.
- [ ] Remove deprecated base64 content fields once the client is fully cut over.

### Tests

- [ ] `lib/docs.test.ts` green (every nav entry has content + route).
- [ ] Full suite green (Rust unit + integration, web unit, Playwright incl. billing-checkout via `stripe listen` — see [[feedback-mail-capture-tests]]).
- [ ] Live-smoke on the BAPS compose stack.

### Validates

The full terrain rework is documented, covered, and verified end-to-end on a real seeded site; legacy base64 transport is retired.
