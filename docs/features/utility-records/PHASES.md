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

- [ ] Migration **0006**: `utility_types` (seeded, APWA colors), `utility_runs`, `utility_vertices`, `utility_structures`, `utility_audit`.
- [ ] `api/src/utilities/geom.rs` — 3D run length, slope from invert_up/down, depth-of-cover (surface Z − utility Z), grid/ground/geographic derivation via existing transform + `convert.rs`, diameter unit normalization (inches→canonical).
- [ ] `api/src/utilities/audit.rs` — append-only change logging helper used by all mutations.
- [ ] Canonical storage = projected meters (consistent with `survey_points`).

### Tests

- [ ] geom: length, slope, cover-vs-surface, no-elevation N/A, unit normalization, grid/ground derivation.
- [ ] Migration up/down; audit append + field-level diff.

### Validates

The model exists and the derivations are correct in isolation. No UI yet.

---

## Phase 2 — Digitize capture + core API

Create/edit utilities in-app from survey points.

### Deliverables

- [ ] GraphQL: `utilityTypes`, `utilities`, `utility`/`utilityStructure`, `createUtilityRun`, `updateUtilityRun(+Geometry)`, `createUtilityStructure`, `updateUtilityStructure`, soft `delete*`, `utilityAudit` — all audited, tenancy + Crew-gated.
- [ ] Geometry snapshot on capture (+ optional `source_point_id` soft link).
- [ ] Provenance fields (captured-by/at, as-built date, source, locate method) wired.
- [ ] Minimal digitize UI in a new **Utilities** panel: pick type → snap survey points / click scene to lay a run, place a structure, typed attribute form (+ free-form extras, level tag).

### Tests

- [ ] CRUD + audit-on-write; snapshot survives source point edit/delete.
- [ ] Typed-attribute validation per type; level tag persists.
- [ ] Playwright: digitize a run from points + attribute it.

### Validates

A Crew user can hand-build attributed utility runs + structures that persist as an immutable, audited record.

---

## Phase 3 — DXF / GeoJSON import

Bring in pre-drawn linework.

### Deliverables

- [ ] `api/src/utilities/import.rs` — DXF polylines→runs via **layer→utility-type mapping** (auto-map APWA-named layers, manual fallback), block inserts→structures; GeoJSON LineString/Point→runs/structures with property→attr mapping + reprojection (`crs.rs`).
- [ ] `importUtilities` mutation + `needsMapping` response for unmapped layers; size caps.
- [ ] Import UI in the Utilities panel: upload → layer/property mapping → review → commit (audited).

### Tests

- [ ] DXF polyline→run + mapping; GeoJSON→features + reprojection + property mapping; malformed/oversized bounds.
- [ ] Playwright: import a DXF → map layers → commit → appears in inventory.

### Validates

Existing CAD/GIS utility linework imports into the same model and is then attributable.

---

## Phase 4 — 3D visualization + underground mode

See the buried network.

### Deliverables

- [ ] Three.js/R3F rendering: diameter-sized **tubes** for runs, **3D solids** for structures, APWA color by type.
- [ ] Per-type **layer toggles**; click-to-select → attribute inspect.
- [ ] **Underground mode**: ground surface semi-transparent / hideable so below-grade utilities are visible.
- [ ] Reuse terrain-viewer/scene primitives; sharp roundedness, shadcn controls.

### Tests

- [ ] Playwright: digitized run renders as a tube; structure renders as a solid; toggle a type off/on; underground mode reveals buried run; click → inspect.

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
