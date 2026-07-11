# Terrain Rendering — Implementation Phases

Feature within the existing SiteLens project. Each phase ends in a working, shippable state and follows the standard flow (lint → format → test → commit → push where appropriate — see [[feedback-phase-completion]], [[feedback-no-push]]). Ordering: efficient transport first (foundation everything ships over), then the split composite, then draping, then graded + cut/fill, then docs + acceptance.

```
Phase 1 ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5
(binary    (split      (compact   (graded    (docs +
 transport  composite   sampler +  boolean +  coverage +
 + Draco)   coarse+     draping)   heatmap +  acceptance)
            detail                 cut/fill
            + seam)                ghosting)
```

Dependencies: P2 ships over P1's transport. P3 needs P2 (composite regions + boundary). P4 needs P2 (detail region to swap) + the existing volume/graded pipeline. P5 needs all prior.

---

## Phase 1 — Binary asset transport + Draco/quantized blobs

The foundation: stop base64-in-GraphQL, serve raw bytes over an authed `/assets` route, and compress meshes. Independently shippable — retrofit the *existing* blobs (STIN/SCTR/SVOL/ESOL) first for an immediate payload win, before any new geometry exists.

### Deliverables

- [ ] New axum route `GET /assets/:kind/:key` → raw bytes, gzip/brotli, `ETag`/`Cache-Control: private, immutable`, `304` on `If-None-Match`.
- [ ] Cookie-JWT auth on the route: resolve key → org/project, verify ownership, enforce Crew gate for `svol|esol` (and future `gter`). Tenant isolation.
- [ ] Storage-key content-hash scheme (§3.1) + `algo_version` invalidation on deploy.
- [ ] Server-side **quantization** (16-bit bbox-relative) + **Draco** compression for mesh blobs.
- [ ] GraphQL: metadata resolvers return `{ key, etag, … }` for existing blobs (deprecate the base64 content fields).
- [ ] Web: `/assets` `ArrayBuffer` fetch helper + Draco decoder (`DRACOLoader`/wasm) with quantized-only fallback; cut STIN/SCTR/SVOL/ESOL renderers over to it.

### Tests

- [ ] Rust unit: quantize/Draco roundtrip within tolerance; blob header parity with the pre-Draco format.
- [ ] Integration: `/assets` auth (cookie-JWT), tenant isolation, Crew gate on `svol|esol`, ETag → 304, content-encoding negotiation.
- [ ] Client unit (**new — fills the current gap**): Draco/quantized decode → BufferGeometry for STIN/SVOL/ESOL.
- [ ] Playwright: existing surface/volume scenes still render, now fetching `/assets` (not base64) — assert no base64 content in the GraphQL response.

### Validates

Existing terrain/surface/volume payloads shrink 5–10× and load over an authed binary route with immutable caching. No visual change, pure transport win.

---

## Phase 2 — Split composite: coarse + detail + seam

The core rework. Server clips both DEMs to the property boundary, adaptively decimates the detail, stitches the seam, and ships one `CTER` blob; the client renders it as a seamless ground with lighting-driven relief, replacing current terrain when a boundary exists.

### Deliverables

- [ ] `api/src/surface/terrain_composite.rs`: decode coarse + detail GeoTIFFs; clip coarse **outside** / detail **inside** the boundary (`geom.rs` PIP, centroid classification); **adaptive slope-aware decimation** of detail to the vertex budget (~250k tris); **seam stitch** (bridge coarse-ring ↔ detail-ring, elevation skirt); per-vertex normals; emit `CTER` (regions `coarse|detail|seam`), quantized + Draco, cached by hash.
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
