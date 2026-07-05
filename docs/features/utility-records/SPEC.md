# As-Built Utility Records — Product & Architecture Specification

> Capture, visualize in 3D, and permanently archive as-built utilities (sewer, water, gas, electric, comms, drainage) running through, under, and within a property — a durable record surveyors and owners reference long after construction.

This is a **feature within the existing SiteLens project**, not a standalone project. It builds on the shipped survey points, categories, control points, Helmert transform (grid ↔ projected), coordinate conversion, Three.js/React Three Fiber 3D scene, DXF parsing, and the Storage abstraction.

> **Depends on the [shared feature foundation](../_shared-foundation/SPEC.md).** This feature
> consumes the shared plan editor (digitize with snap + numeric entry), the format codec
> layer (DXF/GeoJSON/LandXML), labeled DXF export, scene overlay primitives, the WeasyPrint
> report service (§8 — **replaces `printpdf`**), the snapshot/audit pattern, and gating.
> Build against those shared blocks, not private copies.

---

## 1. Overview

Construction routinely buries and embeds utilities — sanitary/storm sewer, potable water, gas, electrical, comms, drainage — through, under, and inside a property's structure. Once backfilled, that infrastructure is invisible, and the as-built record of *where it is and how deep* is exactly what owners, GCs, and future crews need years later (for maintenance, conflict avoidance before digging, and handoff).

SiteLens today models only **points**. Utilities are different: a run is a **polyline** with depth/invert elevations along it, a diameter and material; **structures** (manholes, catch basins, valves, hydrants) sit at nodes; everything lives **below grade** (or inside the building). This feature adds a real linear/structure model, 3D underground visualization, and durable archival — without GIS-grade network analysis.

Two things this is **not**: it is not a hydraulic/network-analysis tool (no flow tracing, no connectivity topology), and it is not a live GIS sync. It is a **geometry + attributes + evidence record** optimized for capture, 3D reference, and permanent export.

### Core principles

- **A record outlives the app.** Geometry is snapshotted (immutable against later point edits), every change is audited, and the whole record exports to portable formats (PDF/DXF/GeoJSON/LandXML).
- **Absolute elevation is truth.** Utilities are measured by invert elevation; depth-of-cover is derived, never the stored source — a regrade must never silently invalidate the archive.
- **Industry conventions, built in.** Curated utility types with APWA color coding and the right typed attributes per type, so the record reads correctly to any surveyor.
- **Reuse before rebuild.** Lean on existing points, the transform, DXF parsing, the Three.js/R3F scene, Storage, and the shared WeasyPrint report service (see [foundation §8](../_shared-foundation/SPEC.md)).

---

## 2. Users & Access

- **Surveyors / Crew (Surveyor role):** digitize and import utilities, edit attributes, export the archive.
- **Admins:** same, plus manage utility-type defaults if exposed.
- **Viewers:** browse the inventory, inspect attributes, view in 3D, and export — read-only (no capture/edit).

**Plan gating:** the entire feature rides on the existing **Crew** tier (consistent with export + field-exchange). Solo users get the existing upgrade prompt. Gates via the **existing live plan-check** — `require_paid` on export resolvers, `require_editor_active` on mutations ([foundation §13](../_shared-foundation/SPEC.md)). No new tier. (Billing is live Stripe, **not** deferred — earlier "deferred" notes are stale.)

---

## 3. Data Model

Canonical storage is **meters, projected frame** (same as `survey_points`); building-grid and lat/long are derived via the existing transform + CRS. Migration is next in sequence (**0006**, after pending 0005).

### 3.1 `utility_types` — reference (seeded, not user-defined)

Curated, APWA-aligned. Seeded once (global or per-org), not edited in v1.

- `id`, `key` (e.g. `sanitary_sewer | storm_sewer | water | gas | electric | comms | drainage | other`)
- `label`, `apwa_color` (hex — green sewer/drain, blue water, yellow gas, red electric, orange comms, purple reclaimed, etc.)
- `default_geometry` (`line | structure | both`)

### 3.2 `utility_runs` — new (linear features)

- `id` (uuid, pk), `project_id` (uuid, fk)
- `type_key` (fk `utility_types`)
- `name` / `label` (text)
- `level` (text, nullable — optional floor/level tag for interior utilities)
- **Typed attributes** (nullable, per-type relevance): `diameter` (double, stored canonical; unit inches default), `material` (text), `invert_up` / `invert_down` (double, meters — absolute), `slope` (double, derived-or-entered), `owner` (text), `install_date` (date), `condition` (text)
- `attrs_extra` (JSONB — free-form key/value), `tags` (text[])
- **Provenance:** `captured_by` (fk users), `captured_at`, `as_built_date` (date), `source` (enum `field_survey | dxf | geojson | locate_company | other`), `locate_method` (text), `created_at`, `updated_at`

### 3.3 `utility_vertices` — new (owned geometry)

Geometry is **snapshotted** onto the run (immutable against `survey_points` edits) with an optional soft link to the source point.

- `id`, `run_id` (fk `utility_runs`), `seq` (int — vertex order)
- `northing`, `easting`, `elevation` (double, meters — absolute; elevation = invert/centerline Z)
- `source_point_id` (uuid, nullable, fk `survey_points` — provenance only, never a live dependency)

### 3.4 `utility_structures` — new (node features)

- `id`, `project_id` (fk), `type_key` (fk `utility_types` — manhole, catch basin, valve, hydrant, vault, cleanout, …)
- `label`, `level` (text, nullable)
- `northing`, `easting` (double, meters)
- `rim_elev` (double, meters — top, at grade), `inverts` (JSONB — one or more pipe inverts: `[{label, elev, pipe?}]`)
- Typed attrs (`material`, `owner`, `condition`, …), `attrs_extra` (JSONB), `tags` (text[])
- Same **provenance** columns as runs; `source_point_id` (nullable soft link)

> **Depth-of-cover is derived, not stored:** `cover = ground_surface_Z − utility_Z` computed at render/report time wherever a surface exists. No stored cover field.

### 3.5 `utility_audit` — new (change history / audit trail)

Immutable log so the record is defensible years later.

- `id`, `project_id`, `entity_type` (`run | structure | vertex`), `entity_id`
- `action` (`create | update | delete`), `changed_by` (fk users), `changed_at`
- `diff` (JSONB — field-level before/after)

### 3.6 Existing entities reused

- `survey_points` — digitize source (soft-linked only).
- `projects` (epsg_code, combined_scale_factor, site_origin_*) — drive grid/ground/geographic derivation.
- Terrain/surface (existing scene) — drives derived cover depth.
- Storage abstraction — used for generated export packages.

---

## 4. Architecture

```
   WEB (Next.js)                              API (Rust async-graphql)
   ┌──────────────────────────────────────────────────────────────────────┐
   │  Utilities panel                                                       │
   │   ├ Digitize (snap survey points / click scene) ─createRun/Structure─► │
   │   ├ Import (DXF / GeoJSON) ─importUtilities──► layer→type mapper ─────► │
   │   ├ Inventory list (filter type/level) ◄─utilities() query──────────── │
   │   ├ Attribute editor ─updateRun/Structure──► (writes utility_audit) ──► │
   │   └ Export ─exportUtilities──► PDF/DXF/GeoJSON/LandXML encoders ──blob─►│
   │                                                                        │
   │  3D scene (Three.js/R3F)                    api/src/utilities/         │
   │   ├ tubes (diameter-sized)                    mod.rs   (types, dispatch)│
   │   ├ structures (3D solids)                    geom.rs  (derive cover,   │
   │   ├ APWA colors + per-type toggles                     slope, length)   │
   │   └ underground mode (ground α / hide) ◄──── import.rs (dxf, geojson)   │
   │                                              export.rs (pdf,dxf,geojson,│
   │                                                         landxml)        │
   │                                              audit.rs  (change log)     │
   └──────────────────────────────────────────────────────────────────────┘
```

### Geometry/derivation layer (`api/src/utilities/geom.rs`)

Pure functions, unit-tested: run length (3D), slope from invert_up/down + length, depth-of-cover at a point (surface Z − utility Z), grid/ground/geographic derivation via existing transform + `convert.rs`. Diameter normalized to canonical (inches in, meters stored for rendering scale).

### Capture — import (`api/src/utilities/import.rs`)

- **DXF:** reuse existing DXF parsing; polylines → runs, mapped by **layer → utility type** (APWA-named layers auto-mapped, with a manual mapping UI fallback); LWPOLYLINE/3DPOLY vertices → `utility_vertices`; block inserts on recognized layers → structures. Attributes thin → mostly post-import editing.
- **GeoJSON:** LineString/MultiLineString → runs, Point → structures; properties → typed attrs (mapped) + `attrs_extra`; CRS assumed project CRS or WGS84 (reproject via `crs.rs`).
- Bounded by existing size caps (reuse `MAX_DXF_BYTES`, add `MAX_GEOJSON_BYTES`).

### Capture — digitize (web)

Connect existing survey points (snap) or click in the 3D scene to lay vertices; each vertex snapshots coords (+ optional `source_point_id`); place structures on nodes; typed attribute form per type. Interior utilities get a `level` tag; placement uses absolute Z (and the grid frame is available via transform).

### Visualization (web, Three.js/R3F)

Runs render as **tubes** scaled by diameter; structures as **3D solids** (manhole cylinder, valve marker, etc.); APWA-colored by type; per-type **layer toggles**; **underground mode** sets the ground surface to semi-transparent or hides it so the buried network is visible; click selects → attribute inspect. Reuses terrain-viewer/scene primitives.

### Export/archive (`api/src/utilities/export.rs`)

- **PDF** (shared **WeasyPrint report service**, [foundation §8](../_shared-foundation/SPEC.md); **not** `printpdf`): utility schedule (per run: type, size, material, length, invert up/down, slope, depth; per structure: rim/invert/depth) + plan-view snapshot (client-rasterized PNG) + project/provenance header.
- **DXF:** 3D polylines on APWA-named layers + structure blocks (Civil 3D/AutoCAD handoff).
- **GeoJSON:** geometry + full attributes (durable, machine-readable).
- **LandXML:** included for completeness; **flagged — LandXML utility support is weak/inconsistent**, lower fidelity than the other three.
- Packages written via the Storage abstraction; downloadable as a zip or individually.

---

## 5. API Design

GraphQL, new module `api/src/schema/utilities.rs`. All resolvers enforce org/project tenancy + the Crew plan gate; all mutations write `utility_audit`.

### Queries

- `utilityTypes: [UtilityType!]!`
- `utilities(projectId, typeKey?, level?, search?): UtilityInventory!` — runs + structures, filtered.
- `utility(id): UtilityRun!` / `utilityStructure(id): UtilityStructure!` — full attrs + derived (length, slope, cover) + audit.
- `utilityAudit(projectId, entityId?): [UtilityAuditEntry!]!`
- `exportUtilities(projectId, formats: [UtilityExportFormat!]!, scope?): FileBlob!` — `pdf | dxf | geojson | landxml`.

### Mutations

- `createUtilityRun(projectId, typeKey, vertices, attrs, provenance): UtilityRun!`
- `updateUtilityRun(id, attrs)` / `updateUtilityRunGeometry(id, vertices)`
- `createUtilityStructure(...)` / `updateUtilityStructure(...)`
- `deleteUtilityRun(id)` / `deleteUtilityStructure(id)` (soft, audited)
- `importUtilities(projectId, format, contentBase64, layerMapping?): UtilityImportResult!`

### Error handling

- Oversized/malformed import → structured error; ambiguous DXF layers → `needsMapping` with the unmapped layer list.
- Geometry with no elevation → allowed (cover/slope reported as N/A).
- Tenancy / plan-gate → existing error variants.

---

## 6. UI/UX

### New "Utilities" panel (project view)

Sibling to scene / survey-points / cad-overlay / field panels. Sections:

1. **Capture** — *Digitize* (pick type → snap survey points / click scene to lay a run, or place a structure → attribute form) and *Import* (DXF/GeoJSON upload → layer-to-type mapping → review → commit).
2. **Inventory** — filterable/searchable list (by type, level, tag); row → focus + inspect in 3D; attribute editor (typed fields + free-form extras); per-entity audit history.
3. **Visualization controls** — per-type layer toggles, underground mode, tube/solid styling.
4. **Export** — choose formats (PDF/DXF/GeoJSON/LandXML) + scope → download package.

### 3D scene

Diameter-sized tubes + 3D structures, APWA-colored, underground mode, click-to-inspect. shadcn/ui components, sharp roundedness (SiteLens convention). Solo users see the upgrade prompt.

### Customer-facing in-app docs page (required deliverable)

Add a **"Utilities (As-Built Records)"** page to the in-app `/docs` site:

- **Nav:** entry in `web/src/lib/docs.ts` `docsOrder` (group **"Working with Data"**), `slug: 'utilities'`, href `/docs/utilities`.
- **Content:** `web/src/content/docs/utilities.md` — what utilities are, capturing by digitizing from points vs importing DXF/GeoJSON, utility types + APWA colors, entering attributes (invert/slope/diameter/material), reading depth in underground mode, interior utilities + level tags, and exporting the archive (PDF/DXF/GeoJSON/LandXML).
- **Route:** `web/src/app/docs/utilities/page.tsx` following the `[slug]` pattern (`getDocNav` / `getDocContent` + `DocsPageContent`).

---

## 7. Security

- **Import parsing is the attack surface.** DXF/GeoJSON decoders bounded by size caps; reuse `roxmltree`/existing DXF parser (no entity expansion); validate vertex/feature counts.
- **Tenancy:** every resolver scopes by org/project; runs/structures/audit inherit project ACLs.
- **Immutability:** audit log is append-only; deletes are soft + audited.
- **No new external network** — file-based import/export only; export packages handled via Storage.

---

## 8. Testing

Per SiteLens conventions (shared utils get tests; Playwright in `web/e2e`).

- **Rust unit tests** (`geom.rs`): 3D length, slope from inverts, depth-of-cover vs a surface, grid/ground/geographic derivation, diameter unit normalization, no-elevation N/A handling.
- **Import tests:** DXF polyline→run + layer→type mapping; GeoJSON LineString/Point→run/structure + property mapping + reprojection; malformed/oversized bounds.
- **Export tests:** PDF smoke (generates, schedule rows correct); DXF round-trip (write→read layers/geometry); GeoJSON schema + attribute fidelity; LandXML generates (with the weak-support caveat documented).
- **Audit/immutability tests:** edits write diffs; geometry snapshot survives source `survey_point` edit/delete.
- **Playwright e2e:** digitize a run from points + attribute it → renders as tube; toggle underground mode; import a DXF → map layers → commit; export package download; Solo-plan gate.

---

## 9. Deployment

- Migration **0006**: `utility_types` (seeded), `utility_runs`, `utility_vertices`, `utility_structures`, `utility_audit`. (Apply pending **0005** then **0006**.) **Migration number collides with other feature specs — assign the real sequential number at build time in ship order; see [foundation §14](../_shared-foundation/SPEC.md).**
- Rust deps: existing DXF parsing, `roxmltree`; add a GeoJSON serde (`geojson` crate or `serde_json` shapes). **PDF via the shared WeasyPrint report service — no `printpdf`, no headless browser in the API.**
- Web: Utilities panel + Three.js/R3F tube/solid rendering + the docs page; reuse existing DXF parse path where applicable.
- Standard flow: lint → format → test → commit → push → deploy (Dokploy compose, server-1); apply migrations on deploy. Docs page ships with the web build.

---

## 10. Scope Boundaries

**In v1:**
- Lines + structures + curated APWA-typed attributes (+ free-form extras/tags); no network topology.
- Absolute-Z model with derived cover; interior utilities via same model + optional level tag.
- Capture by in-app digitize **and** DXF/GeoJSON import.
- 3D tubes + solids, APWA colors, per-type toggles, underground mode, click-to-inspect.
- Record-keeping: provenance metadata + change-history/audit trail + export package (PDF + DXF + GeoJSON + LandXML).
- Reference: 3D scene + filterable inventory + attribute inspect (core only).
- New Utilities panel; Crew-tier gating; customer-facing in-app docs page.

**Explicitly deferred (out of v1):**
- Photo / document attachments (manhole photos, inspection PDFs, locate tickets) — likely top fast-follow.
- Network topology / flow tracing / connectivity / hydraulic analysis.
- First-class floors/levels (defined level elevations + per-floor sectioning).
- Profile / long-section view, in-scene measurement, spatial/proximity search.
- Live GIS sync (ArcGIS / municipal asset systems); Shapefile / KML import.
- User-defined utility types / custom schema builder.
