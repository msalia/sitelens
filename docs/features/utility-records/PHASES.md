# As-Built Utility Records — Implementation Phases

Feature within the existing SiteLens project. Each phase ends in a working, shippable state and follows the standard flow (lint → format → test → commit → push → deploy where appropriate). Ordering: data model + derivations first, then capture, then visualization, then archival/export, then docs + acceptance.

```
Phase 1 ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5 ─► Phase 6
(schema +  (digitize  (DXF/      (3D viz +  (export    (docs +
 geom/      capture +  GeoJSON    underground inventory  audit UI +
 derive)    API)       import)    mode)       + export)  acceptance)
```

Dependencies: P2 needs P1. P3 needs P1 (import writes the same model). P4 needs P1–P2 (geometry to render). P5 needs P1 (+ P4 for the plan-view snapshot). P6 needs all prior.

---

## Phase 1 — Schema + geometry/derivation core

Data model and the pure math, before any capture UI.

### Deliverables

- [x] Migration **0015** (real number; doc said 0006): `utility_types` (seeded 15-row APWA catalog — linear + structure types), `utility_runs` (+ typed attrs + provenance + soft-delete), `utility_vertices` (owned, snapshotted, optional `source_point_id`), `utility_structures`, `utility_audit`.
- [x] `api/src/utilities/geom.rs` — pure: 3D + 2D run length, slope from inverts, depth-of-cover, diameter inches↔meters. (Grid/ground/geographic derivation reuses `convert.rs`, already tested there.)
- [x] `api/src/utilities/audit.rs` — pure `diff(before, after)` field-level diff + async `log(exec, …)` append (works with pool or tx).
- [x] Canonical storage = projected meters (consistent with `survey_points`).

### Tests

- [x] geom: length (3D/2D/short), slope, cover-vs-surface, no-elevation planimetric, diameter unit roundtrip (6 unit tests).
- [x] Migration applies + seeds APWA catalog; audit append persists a field-level diff (2 integration tests). audit `diff` unit tests (create/update/delete/identical).

### Validates

The model exists and the derivations are correct in isolation. No UI yet.

---

## Phase 2 — Digitize capture + core API

Create/edit utilities in-app from survey points.

### Deliverables

- [x] GraphQL (`schema/utilities.rs`, new `Feature::Utilities` gate): `utilityTypes`, `utilities`, `utility`/`utilityStructure`, `createUtilityRun`, `updateUtilityRun(+Geometry)`, `createUtilityStructure`, `updateUtilityStructure`, soft `deleteUtilityRun/Structure`, `utilityAudit` — all audited, tenancy + Crew-gated. Derived `length`/`slope` computed via `geom`.
- [x] Geometry snapshot on capture (+ optional `source_point_id` soft link).
- [x] Provenance fields (captured-by/at, as-built date, source, locate method) wired.
- [x] **Digitize UI** in a new Crew-gated Utilities panel: pick an APWA type, digitize a run by snapping survey-point markers in the 3D scene (exact projected coords + `source_point_id`) or by numeric E/N/Z entry, place a structure the same way, typed attribute form; inventory list with delete. Lean in-3D digitize (foundation §3 top-down "plan mode" deferred until SM/SA need it).

### Tests

- [x] CRUD + audit-on-write; snapshot survives source-point delete (soft link cleared, coords intact); soft-delete hides from inventory; Crew gate (5 integration tests).
- [x] Typed attrs (diameter inches→m, inverts, tags, free-form `attrs_extra`) + derived length/slope persist. *(Per-type field validation is minimal — attrs stored regardless of type.)*
- [x] Playwright (`web/e2e/utilities.spec.ts`): digitize a run + place a structure via coordinate entry → appear in inventory + delete; Solo-plan upgrade gate. (Runs against the full stack — user-run.)

### Validates

A Crew user can hand-build attributed utility runs + structures that persist as an immutable, audited record.

---

## Phase 3 — DXF / GeoJSON import

Bring in pre-drawn linework.

### Deliverables

- [x] `api/src/dxf.rs` — shared server-side DXF codec (ixmilia `dxf` crate); the client DXF parser was retired and the CAD overlay now renders from `cadOverlayGeometry`.
- [x] `api/src/utilities/import.rs` — DXF polylines→runs + block inserts→structures; GeoJSON LineString/Point (+Multi\*)→runs/structures with layer/property grouping; **APWA layer→type auto-mapping** (`guess_type`, structure keywords win); pure + unit-tested.
- [x] `importUtilities` mutation (layer→type mapping, geographic reprojection via `crs.rs` or projected-unit scaling, audited inserts) + `previewUtilityImport` query returning layers with suggested types for the mapping UI. (Unmapped layers are skipped and counted; auto-suggestions cover the `needsMapping` intent.)
- [x] Import UI in the Utilities panel: upload → auto-mapped layer/type form (+ coordinate space/unit) → commit; `utilities/import-dialog.tsx`.

### Tests

- [x] Pure: APWA `guess_type`, GeoJSON parse, DXF parse, layer summarize (import.rs) + DXF codec (dxf.rs). Integration (real PostGIS): GeoJSON import creates runs+structures in the inventory with mapped types + kept coords; preview suggests APWA types.
- [x] Playwright (`e2e/utilities.spec.ts`): import a GeoJSON → map layers → commit → appears in inventory. (Runs against the full stack — user-run.)

### Validates

Existing CAD/GIS utility linework imports into the same model and is then attributable.

---

## Phase 4 — 3D visualization + underground mode

See the buried network.

### Deliverables

- [x] `sceneData` now carries `utilityRuns` (geographic vertices + diameter + APWA color) and `utilityStructures` (position + rim + color), reprojected server-side with the same site rotation as points.
- [x] Three.js/R3F rendering (`terrain/utilities.tsx`): diameter-sized **tubes** (CatmullRom `tubeGeometry`, radius = ½ diameter) for runs, **cylinder solids** for structures, **APWA color** by type, at absolute invert Z (buried).
- [x] **Underground mode**: terrain surface drops to 0.18 opacity (via `TerrainSurface` `opacity` prop, `key`ed so `Fade` re-captures) so below-grade utilities show through. **Click-to-select** → attribute card (label · kind · type). Per-type filter plumbed (`visibleUtilityTypes`); the Display menu currently exposes a single **Utilities** toggle + **Underground mode** (per-type checkboxes are a small follow-up).
- [x] Reuses terrain-viewer/`Fade`/frame primitives; shadcn Display-menu controls.

### Tests

- [x] e2e (`utilities.spec.ts`): after capture the **Utilities** + **Underground mode** toggles appear in the Display menu. WebGL tube/solid rendering + 3D picking verified manually (raycast picking isn't reliably automatable in Playwright — consistent with the existing 3D phases).

### Validates

The captured record is legible in 3D, including depth, for both exterior and interior utilities.

---

## Phase 5 — Inventory, export & archive package

The reference + handoff surface.

### Deliverables

- [ ] Inventory list (filter by type/level/tag, search) + attribute editor + per-entity audit history in the panel.
- [ ] `api/src/utilities/export.rs`: **PDF** (shared WeasyPrint report service, not `printpdf`: utility schedule + client-rasterized plan-view PNG + provenance header), **DXF** (3D polylines on APWA layers + structure blocks), **GeoJSON** (geometry + full attrs), **LandXML** (with documented weak-support caveat).
- [ ] `exportUtilities` query returning package blob (via Storage); export UI (format + scope picker).

### Tests

- [ ] PDF smoke + schedule-row correctness; DXF write→read layers/geometry; GeoJSON schema + attribute fidelity; LandXML generates.
- [ ] Playwright: filter inventory → export package → download.

### Validates

The record can be browsed, queried, and exported to portable formats that survive independent of SiteLens.

---

## Phase 6 — Customer docs + acceptance

Self-serve docs and end-to-end validation.

### Deliverables

- [ ] In-app docs page: add `utilities` to `web/src/lib/docs.ts` `docsOrder` (group "Working with Data"); create `web/src/content/docs/utilities.md`; create `web/src/app/docs/utilities/page.tsx` per the `[slug]` pattern.
- [ ] Docs content: capture (digitize vs import), utility types + APWA colors, attributes (invert/slope/diameter/material), reading depth in underground mode, interior utilities + level tags, exporting the archive.
- [ ] End-to-end acceptance: capture → visualize → export round-trip on a real sample site (e.g. the BAPS seed site); verify DXF opens in CAD and GeoJSON validates.

### Tests

- [ ] Docs page renders in nav + route resolves.
- [ ] Acceptance checklist run; sample export files locked as fixtures.

### Validates

Customers can self-serve via in-app docs, and the full capture→archive workflow is verified end-to-end.

---

## Cross-phase conventions

- Lint + format + commit + push at each phase boundary; update these checkboxes as items complete.
- Migrations: apply pending **0005** then **0006** on the next deploy.
- All shared utilities (geom derivations, import/export codecs) get unit tests (project convention).
- Verify locally via integration tests / Playwright; if a scripted multi-mutation curl flow trips the security guardrail false positive, run via `!` or the integration suite.
- Pairs naturally with the existing `schema.rs` split refactor TODO — new resolvers land in their own `schema/utilities.rs` module rather than the monolith.
