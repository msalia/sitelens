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

## Phase 1 — Binary asset transport + quantized blobs ✅ COMPLETE + browser-verified

The foundation: stop base64-in-GraphQL, serve raw bytes over an authed `/asset` route, and shrink meshes. Two sub-steps: **1a transport** (raw bytes + gzip/brotli over the existing f64 formats — immediate win, low risk) then **1b quantization** (16-bit meshes — more win). The **pure-fetch** blobs (surface mesh, volume heatmap, coarse + detailed terrain GeoTIFFs, buildings) were retrofitted; the **computed** blobs (contours SCTR, earthwork solid/graded ESOL) were left on base64 GraphQL by design (see the deferred note below).

Seams (from the codebase map): router `api/src/lib.rs:282`; auth `auth_from_headers(&headers, &state.config.jwt_secret)` (`lib.rs:111`); storage `Storage::get(key)` (`storage.rs:11`); blob formats `api/src/surface/mod.rs`; existing resolvers in `schema/surface/query.rs` + `schema/terrain.rs` (Crew gate `require_feature(ctx, Feature::Surfaces)`); web decoders are already `ArrayBuffer`-native (`buildSurfaceGeometry`, surface-mesh.tsx:62); browser reaches the API only via the Next.js proxy (`web/src/app/api/graphql/route.ts`).

### Phase 1a — transport (raw bytes, no quantization)

- [x] Add `storage: Arc<dyn Storage>` to `AppState` so a plain axum route can reach it. (`lib.rs`; `router()` + `build_router()` extracted for tests.)
- [x] New axum handler + routes for the **pure-fetch** blobs under `/asset/…`: `surface/{id}/mesh`, `volume/{id}/heatmap`, `project/{id}/terrain`, `project/{id}/terrain-detailed`, `project/{id}/buildings`. Raw bytes; `ETag = sha256 hex`; `304` on `If-None-Match`; `Cache-Control: private, must-revalidate`; `Content-Type` + `Content-Disposition`. Core logic in `api/src/asset.rs` (`Asset` enum + `resolve_asset` → `AssetOutcome`).
- [x] `tower-http` `CompressionLayer` (`compression-gzip,compression-br`) on the asset sub-router.
- [x] Auth via `auth_from_headers`; org-scope every lookup (JOIN `projects`); Crew gate `mesh|heatmap` via `org_billing().has_feature(Feature::Surfaces)`; base terrain/buildings ungated. Order = auth → gate → ownership (mirrors resolvers).
- [x] Web infra: Next.js proxy `web/src/app/api/asset/[...path]/route.ts` (Next 16 async `ctx.params`) forwarding the session cookie + `If-None-Match`, relaying ETag/304; `web/src/lib/asset.ts` = `assetUrls` builders + `fetchAssetBuffer`/`fetchAssetText` (`credentials: 'same-origin'`, `null` on 404).
- [x] Web cutover — **terrain + buildings**: `scene-view.tsx` loaders fetch `/asset` (GeoTIFF → `ArrayBuffer`; buildings → text→JSON); `TerrainData` now carries `buffer: ArrayBuffer`; `terrain-viewer.tsx` decodes `terrain.buffer` directly (no base64). URLs are stable so the browser HTTP cache revalidates via ETag.
- [x] Web cutover — **surface mesh + volume heatmap**: `scene-view.tsx` `surface`/`volumeBlob` state now hold `ArrayBuffer`; loaders fetch `/asset`; `terrain-viewer.tsx` decodes `surface` directly (dropped `base64ToArrayBuffer`); `volume-heatmap.tsx` `readHeatmapRange`/`VolumeHeatmap` take `ArrayBuffer`.

**Deferred by design (not blocking Phase 1):**
- Computed blobs — `surface/{id}/contours` (SCTR), `volume/{id}/solid|graded` (ESOL) — stay on base64 GraphQL until their byte-producers are factored out of the resolvers (graded is rewritten in P4 anyway). CTER composite likewise (P2).
- GraphQL `assetUrl`/`etag` metadata fields — unnecessary: the client builds `/asset` URLs directly from ids (presence handled by the 404→null fetch).
- Removal of the now-unused base64 `content_base64` render fields — happens in **P6** once every consumer is cut over.

> **1a COMPLETE + browser-verified.** *Backend* — `api/src/asset.rs` + `/asset` routes in `lib.rs`, gzip/brotli, sha256 ETag/304; `api/tests/integration/asset.rs` (8) + `etag_for` unit; suite green (200 lib + 133 integration). *Web* — `/api/asset` proxy + `lib/asset.ts` (+ `asset.test.ts`, 6 tests); **terrain, buildings, surface mesh, volume heatmap** all cut over to the binary route; tsc + eslint clean, web unit 52 green. *E2E* — `web/e2e/asset-transport.spec.ts` green (surface mesh over `/api/asset`: 200 + octet-stream + ETag → 304; unauth → 401), run against the rebuilt local api container. **Remaining 1a:** computed-blob migration (deferred) + base64-field removal (P6).

### Phase 1b — quantization ✅

- [x] Quantized encodings in `surface/mod.rs` — positions 16-bit bbox-relative (u16), reusing/adding the header bbox for dequant; indices stay u32. **STIN v2** (pos u16), **SVOL v3** (pos u16 + dz u16 over `[min_dz,max_dz]`, adds a pos bbox), **ESOL v1** (pos u16 + rgb u8, adds version + bbox). Shared `quantize`/`dequantize` helpers.
- [x] Back-compat: `deserialize_mesh` reads STIN v1+v2 (stored surfaces predate v2); web decoders version-switch — `buildSurfaceGeometry` (v1/v2), `buildHeatmapGeometry` (v2/v3), `readHeatmapRange` (header unchanged). ESOL is computed fresh (no legacy).
- [x] Web `dequantize` decoders → `BufferGeometry`; version guard rejects unknown versions.

> **1b COMPLETE.** ~4× smaller mesh vertices before gzip (STIN 24→6 B/vtx, SVOL 32→8, ESOL 48→9). Tests: Rust `mod.rs` (v1 back-compat + v2 roundtrip + v3 header); web `surface-mesh.test.ts` (4) + `volume-heatmap.test.ts` (5) — decoder coverage gap filled. Full suite green: 201 lib + 133 integration + web unit 61; fmt/clippy/eslint/tsc clean. Note: ESOL still rides base64-GraphQL (transport deferred with the other computed blobs); quantization shrinks that payload too.

### Tests (as shipped)

- [x] Rust unit: `etag_for` stability (same bytes → same hash, content-sensitive); STIN v1↔v2 quantize/dequantize roundtrip within tolerance + v1 back-compat decode; SVOL v3 + CTER/ESOL header/size parity.
- [x] Integration (`api/tests/integration/asset.rs`, 8): `resolve_asset` outcomes for all five pure-fetch assets — auth required, Crew gate (`mesh|heatmap`), tenant isolation (cross-org → NotFound), ungated terrain served to a Solo org, ETag → 304; plus HTTP `oneshot` wiring (401 no-cookie / 200 + ETag / 304 conditional).
- [x] Client unit (fills the prior decoder-coverage gap): `surface-mesh.test.ts` (v1 + v2 STIN decode, 4), `volume-heatmap.test.ts` (v2 + v3 SVOL decode + `readHeatmapRange`, 5), `asset.test.ts` (proxy URL builders + 404→null fetch, 6).
- [x] Playwright (`web/e2e/asset-transport.spec.ts`): surface mesh loads over `/api/asset` (200 + octet-stream + ETag) then revalidates to 304; unauthenticated `/asset` → 401. **Run green** against the rebuilt local api (1a and again after the 1b rebuild).

### Validates

Terrain/surface/volume payloads shrink substantially — base64 inflation + JSON parse gone (1a), ~4× smaller mesh vertices before gzip (1b) — and load over an authed binary route with ETag caching. No visual change: a pure transport win, browser-verified.

---

## Phase 2 — Split composite: coarse + detail + seam

The core rework. Server clips both DEMs to the property boundary, adaptively decimates the detail, stitches the seam, and ships one `CTER` blob; the client renders it as a seamless ground with lighting-driven relief, replacing current terrain when a boundary exists.

> **Build notes (from the Phase 2 seam map):**
> - **No server-side GeoTIFF decoder exists** (`geotiff.rs` only *writes*). Add one — decision: the **pure-Rust `tiff` crate** (robust vs 3DEP encoding variants; no C/C++). New `read_geotiff(bytes) -> DecodedDem` in `geotiff.rs`, validated by a write→read roundtrip against the existing `write_geotiff`.
> - **3DEP tiffs are EPSG:4326** — nodes are lon/lat directly, so terrain skips the Helmert `SiteRotation` (use the `dem_node_to_geographic` 4326 shortcut). Boundary polygon is projected `[e,n]` (`projects.boundary` jsonb) → convert to lon/lat for masking, or mask in projected space via `geographic_to_projected` on DEM nodes.
> - **`refresh_detailed_terrain` already requires + fetches** the 1 m AOI (clipped to the boundary *bbox*); Phase 2 adds the actual **polygon** masking. Both DEMs come from `fetch_3dep_geotiff` and are stored (`terrain/{id}.tif`, `terrain-detailed/{id}.tif`).
> - **`build_graded_terrain_blob` (shared.rs:715-874) is the template**: OUTSIDE = base retriangulated with the footprint as a `hole` constraint (`tin::triangulate_constrained`); INSIDE = fill; WALLS = ring-walk seam stitch (subdivide to `TARGET_M`, sample both surfaces). Reuse `geom::point_in_polygon`, `MetricFrame`, `SurfaceSampler`, `quantize`/`dequantize`.
> - Implementation sub-slices: **2a** server GeoTIFF decoder → **2b** composite (mask + clip + seam + `CTER` blob + resolver) → **2c** web `CompositeTerrain`.

### Deliverables

- [x] `api/src/surface/terrain_composite.rs` — `build_composite()`: decode coarse + detail (P2a decoder); mask nodes by `geom::point_in_polygon` (coarse outside / detail inside); insert the **shared boundary ring as a breakline constraint** (both sides align to it → watertight, no separate seam walls); triangulate (spade, isotropic planar frame `lon·cos lat0`); tag triangles coarse/detail by centroid; emit geographic `[lat,lon,h]`. **Uniform** stride decimation to a 120k-vertex budget (adaptive/slope-aware = follow-up).
- [x] `CTER` blob (`serialize_composite`, 16-bit-quantized, `coarse` then `detail` triangle ranges). Seam is implicit (shared ring vertices), so regions are `coarse|detail` (no separate seam range).
- [x] GraphQL `projectCompositeTerrain(projectId) -> base64 CTER` (computed on demand via `spawn_blocking`); null when no boundary or a DEM is missing. Ungated.
- [x] Web `CompositeTerrain` — decode `CTER`, render coarse + detail as two meshes sharing one position+normal buffer (normals over the full mesh → continuous seam shading); flat-clay `meshStandardMaterial`; `toLocal`. Replaces the plain terrain when `composite` is present (`scene-view` fetches it; `terrainMesh` still built as the drape sampler until P3).

### Tests

- [x] Rust unit (`terrain_composite`): inside/outside split; **watertight** (coarse+detail share ring vertices); geographic output; degenerate-boundary rejection. `CTER` header/size unit.
- [x] Integration (`composite.rs`): resolver null without boundary / without a DEM; tenant-scoped.
- [x] Client unit (`composite-terrain.test.ts`): `CTER` → two geometries sharing position+normal buffers; bad magic/version rejected.
- [ ] Playwright: deferred — a real composite needs a boundary + live 3DEP fetch (US-only, non-deterministic); covered by unit + integration instead. Existing scene/surfaces specs still pass (composite is null without boundary+DEMs).

> **2b + 2c shipped.** Backend `c5d7aa3` (composite core + CTER + resolver, 209 lib + 136 integration). Web: `composite-terrain.tsx` (+ test) wired through `scene-view`/`terrain-viewer`; tsc + eslint clean, web unit 63. **Follow-ups:** adaptive decimation (uniform for now); move CTER off base64 GraphQL onto `/asset` + content-hash cache (it's a computed blob like graded/solid — the biggest remaining transport win). **Not yet browser-verified** on a real boundary site.

### Validates

The scene ground is now two resolutions stitched into one continuous surface — high-res inside the property, cheap context outside — reading as a single ground.

---

## Phase 3 — Compact sampler + draping

Drop client GeoTIFF decode. Server ships a small heightfield; the client drapes points/grid/buildings onto detail inside the boundary and coarse outside.

### Deliverables

- [x] `api/src/surface/sampler.rs`: `build_sampler()` — a downsampled lat/lon heightfield over the coarse extent, detail elevation inside the boundary + coarse outside. New `SAMP` blob (`serialize_sampler`, `u16`-quantized over `[min_h,max_h]`, `0xFFFF` nodata).
- [x] GraphQL: `terrainSampler(projectId) -> base64 SAMP` (computed on demand; `null` until terrain is cached).
- [x] Web: `terrain/terrain-sampler.ts` decodes `SAMP` → bilinear `(lat,lon)->m` sampler; `scene-view` fetches it; `terrain-viewer` drapes via it and **skips the client GeoTIFF decode when the composite is present** (detail-inside/coarse-outside is baked into the grid server-side).

### Tests

- [x] Rust unit: sampler detail-inside / coarse-outside; no-boundary all-coarse; `SAMP` blob header/quantize/nodata roundtrip. Also `sample()` far-edge epsilon-clamp.
- [x] Client unit (`terrain-sampler.test.ts`, 3): bilinear at nodes + midpoints; null outside extent; null over a nodata corner; bad-magic rejected.
- [ ] Playwright: deferred (needs live 3DEP + boundary, like P2); draping verified manually.

> **P3 COMPLETE** (`57f32cc` sampler core, `fe83faf` resolver + web + composite **Fade** fix). On the boundary path the client no longer runs geotiff.js — the composite renders + the SAMP grid drapes. Also restored the terrain toggle's fade (composite wrapped in `<Fade cull>`). Rust 209 lib + integration green; web unit 66. **Follow-ups:** adaptive/finer detail inside the boundary (sampler is uniform over the coarse extent); move computed CTER/SAMP blobs off base64 onto `/asset` + content-hash cache.

### Validates

On a boundary project the client decodes no multi-MB GeoTIFF; draping rides the compact SAMP grid (detail inside, coarse outside).

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
