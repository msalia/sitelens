# Field Exchange — Product & Architecture Specification

> Native field-survey-app file interop (export *and* import) plus an as-built / stakeout QC comparison, for SiteLens.

This is a **feature within the existing SiteLens project**, not a standalone project. It builds on the shipped point import/export, coordinate conversion, Helmert transform, and Three.js/React Three Fiber scene.

> **Depends on the [shared feature foundation](../_shared-foundation/SPEC.md).** Consumes the
> format codec layer (§4 — this feature's trait-based codec design is the model the shared
> layer generalizes: CSV presets, LandXML, JobXML), scene overlay primitives (§9 — status
> coloring / leader lines), the WeasyPrint report service (§8 — **replaces `printpdf`**), the
> snapshot/audit pattern, FileBlob/Storage, and gating. This feature does **not** use the
> plan editor (file-based import, no digitizing).

---

## 1. Overview

SiteLens already exports and imports generic **CSV** (configurable column mapping) and **LandXML** points, gated to the Crew plan, across Grid / Projected-grid / Projected-ground / Geographic spaces in US-survey-foot / international-foot / meter.

The gap: a generic CSV doesn't open *cleanly* in a field crew's data collector — each field app (Trimble Access, Carlson SurvCE/SurvPC, MicroSurvey FieldGenius, Topcon/Sokkia Magnet) wants its points in its own dialect, and silently mangles or rejects anything else. And when field-collected points come back, just appending them as new rows throws away the question the surveyor actually cares about: *how close did we stake to design?*

Field Exchange closes both gaps with two coupled capabilities:

- **A — Field-app file interop:** curated per-app presets over the existing CSV/LandXML, plus a true-native **Trimble JobXML (.jxl)** encoder/decoder, so files SiteLens emits open natively and files the collector emits import cleanly. Carlson/MicroSurvey is served via the PNEZD CSV preset + LandXML (both import cleanly); native Carlson CRD is deferred.
- **B — As-built QC comparison:** inbound field points become an as-built layer matched against a design baseline, producing per-point deltas, tolerance pass/warn/fail status, a 3D visual, and a deliverable stakeout report (CSV + PDF).

Both ship under the existing **Crew** tier. Transport is **file-based** ("directly" means natively openable, no reformatting — not vendor-cloud sync).

### Core principles

- **Native or it doesn't count.** A file is "supported" only when it opens in the real app without device-side fiddling — validated by a one-time real-device acceptance pass, not just spec conformance.
- **A QC report is a record.** Comparisons snapshot their inputs so a delivered report is reproducible forever.
- **Pairing by number, never by guess.** As-builts match design by point number; anything ambiguous goes to manual pairing, never a silent proximity snap.
- **Reuse before rebuild.** Lean on the existing import/export pipeline, coordinate conversion, category/group model, and Three.js/R3F scene.

---

## 2. Users & Access

- **Surveyors / Crew (Surveyor role):** export design + stake points to their collector; import as-built points back; run comparisons; generate reports.
- **Admins:** same, plus manage per-project tolerance defaults.
- **Viewers:** view comparison results and reports (read-only); no import/export.

**Plan gating:** the entire feature (field formats *and* as-built QC) rides on the existing **Crew** tier. Solo users get the existing upgrade prompt. Gates via the **existing live plan-check** — `require_paid` on export/report resolvers, `require_editor_active` on mutations ([foundation §13](../_shared-foundation/SPEC.md)); export is already Crew-gated. No new tier. (Billing is live Stripe, **not** deferred — earlier "deferred" notes are stale.)

---

## 3. Data Model

### 3.1 `survey_points` — extended (no new points table)

As-built points reuse the existing `survey_points` table with a discriminator. **Decision accepted with its cost:** every existing `survey_points` query must now filter by type or as-builts will leak into design views.

New column:

- `point_type` — enum `design | as_built`, default `design`, NOT NULL.

> **Mandatory audit (hard deliverable).** Every existing read of `survey_points` must be reviewed and filtered to `point_type = 'design'` unless it explicitly wants as-builts: scene data resolver, point export, baseline "all", the survey-points list/panel, point-group membership, category counts, and any aggregate. Tracked as an explicit task in PHASES Phase 3.

### 3.2 `as_built_batches` — new

One row per inbound as-built import + comparison run. Stores the **snapshot** that makes a report reproducible.

- `id` (uuid, pk)
- `project_id` (uuid, fk)
- `source_filename` (text)
- `format` (text — `jobxml | landxml | csv`)
- `imported_by` (uuid, fk users)
- `baseline_scope` (enum `all | category | group`) + `baseline_ref_id` (uuid, nullable — category or group id)
- `delta_space` (enum — `projected_ground` primary; `building_grid` always computed as secondary)
- `tol_h_warn`, `tol_h_fail`, `tol_v_warn`, `tol_v_fail` (double — the tolerance spec **snapshotted** at comparison time, in meters canonical)
- `report_unit` (enum LengthUnit — display unit chosen at comparison time)
- `created_at`

### 3.3 `as_built_comparisons` — new (one row per paired/unpaired as-built point)

Snapshots both sides so the comparison is frozen even if design points later move or the transform is re-solved.

- `id` (uuid, pk)
- `batch_id` (uuid, fk `as_built_batches`)
- `as_built_label` (text), `as_built_n`, `as_built_e`, `as_built_z` (double, meters — the imported field coords, snapshotted)
- `design_point_id` (uuid, nullable, fk `survey_points` — null = unmatched)
- `design_n`, `design_e`, `design_z` (double, nullable, meters — **snapshotted** design coords at comparison time)
- `match_method` (enum `number | manual | unmatched`)
- `delta_n`, `delta_e`, `delta_z`, `delta_h_radial` (double, nullable, meters — projected-ground frame)
- `delta_grid_n`, `delta_grid_e` (double, nullable, meters — building-grid frame, secondary)
- `status` (enum `pass | warn | fail | unmatched | no_vertical`)

> Deltas are stored (not just computed on read) because the inputs are snapshotted — recomputation on read would defeat reproducibility. Manual re-pairing creates/updates the row and recomputes that row's deltas against the *snapshotted* design coords of the newly chosen point.

### 3.4 `project` — tolerance defaults

Add to the existing `projects` table:

- `tol_h_warn`, `tol_h_fail`, `tol_v_warn`, `tol_v_fail` (double, meters) — per-project defaults, editable, copied into a batch's snapshot at comparison time (and overridable per import).

Sensible construction defaults on creation, e.g. H warn 0.05 ft / fail 0.10 ft, V warn 0.05 ft / fail 0.10 ft (stored as meters).

### 3.5 Existing entities reused

- `point_categories`, `point_groups` — baseline scoping for comparisons.
- `import_batches` — unchanged; design imports still use it.
- `projects.epsg_code`, `combined_scale_factor`, `site_origin_*` — drive projected-ground and geographic conversion for both directions.

---

## 4. Architecture

```
                         SiteLens (web + API, file-based — no vendor cloud)
   ┌──────────────────────────────────────────────────────────────────────┐
   │  WEB (Next.js)                            API (Rust async-graphql)     │
   │                                                                        │
   │  Field panel ──exportField()──►  format encoders  ──► download blob    │
   │   (presets)                       ├ csv preset                         │
   │                                   ├ landxml                            │
   │                                   └ jobxml (native, .jxl)              │
   │                                                                        │
   │  Field panel ──uploadAsBuilt()─► format auto-detect + decoders ──┐     │
   │   (import)                                                       │     │
   │                                  ┌──────────────────────────────▼───┐ │
   │                                  │ comparison engine                 │ │
   │                                  │  match by number → manual pair    │ │
   │                                  │  baseline scope (all/cat/group)   │ │
   │                                  │  deltas: proj-ground + grid       │ │
   │                                  │  tolerance pass/warn/fail         │ │
   │                                  │  snapshot → as_built_batches/      │ │
   │                                  │             as_built_comparisons   │ │
   │                                  └───────┬───────────────┬──────────┘ │
   │  Results table ◄──comparison(id)─────────┘               │            │
   │  3D overlay (Three.js leader lines) ◄────────────────────┘            │
   │  Report ◄──reportCsv / reportPdf (WeasyPrint report service)─────────┐│
   └──────────────────────────────────────────────────────────────────────┘
```

### Format codec layer (Rust, `api/src/field/`)

A trait-based codec layer so formats are added uniformly and the comparison/import pipeline is format-agnostic:

```
api/src/field/
  mod.rs        // FieldFormat enum, detect(bytes) -> FieldFormat, dispatch
  preset.rs     // per-app CSV/LandXML presets (column order, delimiter, header, space, unit)
  csv_preset.rs // delimited writer/reader keyed by preset
  landxml.rs    // reuse/extend existing CgPoint read/write
  jobxml.rs     // Trimble JobXML (.jxl) encoder/decoder (ASCII)
```

- **Encode/decode contract:** every codec converts to/from the shared `ParsedPoint` / `ExportPoint` shape already used by import/export, so the rest of the pipeline is unchanged.
- **Auto-detect:** `detect(bytes)` sniffs JobXML root element, LandXML root element, else CSV; UI allows manual override.
- **Coordinate space:** export converts to the chosen space (default **projected-ground**) and unit (default **feet**) before encoding, reusing `convert.rs`. Import decodes to the file's stated space/unit, converts to canonical meters projected, then derives grid/ground via the transform.

### Comparison engine (Rust, `api/src/field/compare.rs`)

1. Decode inbound file → as-built points (meters, projected).
2. Resolve baseline design set (all / category / group) at the chosen `point_type='design'` scope.
3. Match each as-built to a design point by **exact point number/label**. No proximity snapping.
4. Compute deltas in **projected-ground** (scale-corrected) as primary and **building-grid** as secondary.
5. Apply tolerance spec → status. Vertical delta only when both Zs present (else `no_vertical`).
6. Snapshot design coords + tolerance spec; persist batch + per-point comparison rows.
7. Unmatched as-builts persist with `match_method='unmatched'` for later manual pairing.

### Report generation (Rust, `api/src/field/report.rs`)

- **CSV report:** reuse the existing CSV writer — point, design N/E/Z, as-built N/E/Z, ΔN/ΔE/ΔZ, radial, status.
- **PDF report:** via the shared **WeasyPrint report service** ([foundation §8](../_shared-foundation/SPEC.md); **not** `printpdf`) — project header, tolerance spec, summary stats (counts pass/warn/fail/unmatched, max/RMS miss), and the per-point table. The API assembles the JSON payload (+ any client-rasterized figure); the service returns the PDF, delivered as a downloadable blob from the GraphQL query.

---

## 5. API Design

GraphQL, extending the existing schema (new module `api/src/schema/field.rs`). All resolvers enforce org/project tenancy and the Crew plan gate.

### Queries

- `fieldExportPresets: [FieldPreset!]!` — available app presets (id, app, format, default space/unit, description).
- `exportField(projectId, presetId, space, unit, scope, codeField): FieldExportResult!`
  — returns `{ filename, mimeType, contentBase64 }` for the encoded file. `codeField` ∈ `description | category | tag:<name>` (default `description`).
- `asBuiltBatches(projectId): [AsBuiltBatch!]!`
- `comparison(batchId): Comparison!` — batch metadata + paired/unpaired rows + summary stats.
- `comparisonReportCsv(batchId): FileBlob!`
- `comparisonReportPdf(batchId): FileBlob!`

### Mutations

- `detectFieldFormat(contentBase64): DetectedFormat!` — `{ format, confidence, needsMapping }`.
- `importAsBuilt(projectId, contentBase64, format, space, unit, baselineScope, baselineRefId, tolOverride): AsBuiltBatch!`
  — decodes, runs the comparison, snapshots, persists, returns the batch (client then queries `comparison`).
- `repairComparison(batchId, asBuiltCompId, designPointId): ComparisonRow!` — manual pairing; recomputes that row against snapshotted design coords.
- `deleteAsBuiltBatch(batchId): Boolean!` — removes batch + its as-built points + comparison rows.
- `setProjectTolerances(projectId, tolHWarn, tolHFail, tolVWarn, tolVFail): Project!`

### Error handling

- Oversized files → reuse existing `MAX_BYTES` caps.
- Malformed/native-parse failures → structured error with format + byte offset where possible.
- Plan-gate / tenancy violations → existing error variants.
- Ambiguous auto-detect → `needsMapping=true`, client falls to the mapping UI.

---

## 6. UI/UX

### New "Field" panel (project view)

A dedicated panel (sibling to scene / survey-points / cad-overlay panels), with three sections:

1. **Export to device**
   - App preset picker (Trimble Access / Carlson / MicroSurvey / Topcon-Sokkia / Generic CSV / LandXML).
   - Space (default Projected-ground) + unit (default ft) + scope (all / category / group / selection) + code-field picker (default description).
   - Live "what this produces" hint per preset; download button.

2. **Import as-built**
   - Drop/upload → **auto-detect** format (override dropdown).
   - Baseline picker (all / category / group), tolerance override (pre-filled from project defaults).
   - Runs comparison, opens results.

3. **Comparisons**
   - List of batches (filename, date, format, pass/warn/fail/unmatched counts).
   - Selecting a batch opens the **results table**: per-point design vs as-built, ΔN/ΔE/ΔZ, horizontal radial, vertical, grid-frame delta (secondary columns), status chip (green/amber/red), and an **unmatched** section with a **manual-pairing** control (pick the design point).
   - Sort/filter by status; jump-to-point in scene.
   - **Download report:** CSV / PDF.

### 3D scene overlay

In the existing Three.js/R3F scene: render design vs as-built markers with **leader lines** connecting each pair, colored by status (green/amber/red), unmatched as-builts in a distinct style. Toggle layer on/off. Reuses the terrain-viewer/scene primitives.

### Conventions

- shadcn/ui components first (per project convention); low roundedness per SiteLens (sharp).
- Solo-plan users see the existing upgrade prompt on the Field panel.

### Customer-facing in-app docs page (required deliverable)

Add a **"Field Exchange"** page to the in-app `/docs` site so customers can self-serve:

- **Nav config:** add an entry to `web/src/lib/docs.ts` `docsOrder` (group: **"Working with Data"**), `slug: 'field-exchange'`, href `/docs/field-exchange`.
- **Content:** `web/src/content/docs/field-exchange.md` — plain Markdown covering: supported apps/formats, how to export for each collector, getting the file onto the device, importing as-built, choosing a baseline + tolerances, reading the results table, and downloading the stakeout report. Include per-app notes (Trimble JobXML, Carlson PNEZD CSV, Topcon CSV) and the projected-ground/feet default.
- **Route:** `web/src/app/docs/field-exchange/page.tsx` following the existing `[slug]` page pattern (`getDocNav` / `getDocContent` + `DocsPageContent`).

---

## 7. Security

- **File parsing is the attack surface.** Decoders (JobXML/LandXML XML, delimited CSV) must be bounded: reuse `MAX_BYTES`/`MAX_ROWS` caps, no XML entity expansion (continue using `roxmltree`).
- **Tenancy:** every resolver scopes by org/project; as-built batches and comparisons inherit project ACLs.
- **No new secrets, no external network** — file-based only; nothing leaves the deployment.
- Uploaded raw files: only what's needed is persisted (as-built coords snapshotted into rows); raw blobs handled via the existing Storage abstraction if retained, else discarded after parse.

---

## 8. Testing

Per SiteLens conventions (shared utils get tests; Playwright lives in `web/e2e`).

- **Rust unit tests per codec:** decode known fixture → expected points; `write → read → equal` **round-trip identity** for JobXML, LandXML, and each CSV preset.
- **Fixture corpus:** `api/tests/fixtures/field/` — real sample files (public specs + files exported once from the actual apps) per format.
- **Comparison engine tests:** number-match, unmatched handling, manual re-pair, baseline scoping, projected-ground vs grid deltas, tolerance pass/warn/fail boundaries, no-vertical case, snapshot immutability (mutate design point → existing comparison unchanged).
- **Report tests:** CSV content assertions; PDF smoke (generates, non-empty, expected summary counts).
- **Playwright e2e (`web/e2e`):** export-with-preset download; import as-built → results table renders → manual pair an unmatched → status updates → download CSV/PDF; Solo-plan gate.
- **One-time real-device acceptance pass (manual, user-driven):** load each emitted file into the actual collector (Trimble Access, Carlson, Topcon Magnet) and import a real file back; lock the verified files as golden fixtures. Documented as a checklist; gates "supported" status per format.

---

## 9. Deployment

- New migration (provisional **0006**) adding `point_type`, `as_built_batches`, `as_built_comparisons`, and `projects` tolerance columns. (Note: 0005 cad_overlays still pending deploy per project state — apply 0005 first.) **Migration number collides with other feature specs — assign the real sequential number at build time in ship order; see [foundation §14](../_shared-foundation/SPEC.md).**
- No `printpdf` — **PDF via the shared WeasyPrint report service** ([foundation §8](../_shared-foundation/SPEC.md)). JobXML implemented in-crate (no heavy deps); CSV/XML reuse existing `csv` + `roxmltree`.
- Web only adds UI + the docs page. CSV report generated in-API (unchanged); PDF payload assembled in-API and rendered by the report service.
- Standard SiteLens flow: lint → format → test → commit → push → deploy (Dokploy compose, server-1). Apply migrations on deploy.
- Customer docs page ships with the web build — no separate deploy.

---

## 10. Scope Boundaries

**In v1:**
- Targets: Trimble Access, Carlson/MicroSurvey, Topcon/Sokkia Magnet.
- Formats: per-app CSV/LandXML presets + native Trimble JobXML; auto-detect on import. (Carlson/MicroSurvey served via PNEZD CSV preset + LandXML.)
- As-built QC: number-match + manual pairing, selectable baseline (default all), projected-ground primary + grid secondary deltas, per-project pass/warn/fail tolerances with per-import override, snapshotted comparisons.
- Outputs: results table, 3D scene overlay (Three.js/R3F), CSV report, server-side PDF report.
- Crew-tier gating; customer-facing in-app docs page.

**Explicitly deferred (out of v1):**
- Native Carlson **CRD** (binary) — Carlson/MicroSurvey covered by PNEZD CSV preset + LandXML in v1; revisit native CRD if a customer's CSV import workflow proves insufficient.
- Leica formats (GSI / DBX).
- Carlson RW5 raw-observation files; binary `.job` / `.dbx` / `.dc`.
- Vendor-cloud sync (Trimble Connect, Leica ConX, Carlson Cloud) — file-based only.
- Per-org feature-code ↔ category mapping table (using simple code → description).
- Proximity / bulk auto-matching aids.
- Live field/GPS capture; PWA / offline tablet mode.
- New pricing tier for QC.
