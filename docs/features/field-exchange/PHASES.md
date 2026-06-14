# Field Exchange — Implementation Phases

Feature within the existing SiteLens project. Each phase ends in a working, shippable state and follows the standard flow (lint → format → test → commit → push → deploy where appropriate). Phases are ordered so the format plumbing (A) lands before the QC layer (B) that depends on it.

```
Phase 1 ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5 ─► Phase 6 ─► Phase 7
(codec     (native    (schema +  (compare   (results+  (reports)  (docs +
 layer +    JobXML)    type-flag  engine +   3D over-              real-device
 presets)              audit)     import)    lay UI)               acceptance)
```

Dependencies: P2 needs P1 (codec trait). P3 is independent of P1/P2 but must precede P4. P4 needs P1–P3. P5 needs P4. P6 needs P4. P7 needs P1–P6.

---

## Phase 1 — Codec layer + per-app presets

Establish the format-agnostic codec layer and ship the cheap wins (presets over existing CSV/LandXML).

### Deliverables

- [ ] `api/src/field/mod.rs` — `FieldFormat` enum, `detect(bytes)` stub, dispatch to codecs.
- [ ] `api/src/field/preset.rs` — `FieldPreset` definitions (Trimble CSV, Carlson PNEZD CSV, Topcon/Sokkia CSV, Generic CSV, LandXML) with column order, delimiter, header, default space (projected-ground) + unit (ft).
- [ ] `api/src/field/csv_preset.rs` — delimited reader/writer keyed by preset, converting to/from existing `ParsedPoint` / `ExportPoint`.
- [ ] `api/src/field/landxml.rs` — reuse/extend existing CgPoint read/write under the codec trait.
- [ ] GraphQL: `fieldExportPresets` query + `exportField` query returning encoded blob (CSV/LandXML presets only this phase).

### Tests

- [ ] Round-trip identity (`write → read → equal`) for each CSV preset + LandXML.
- [ ] Preset column-order/delimiter assertions against fixture files.

### Validates

Crew users can export points in any of the curated CSV/LandXML presets; files are byte-shaped per app. No UI yet (exercised via GraphQL/tests).

---

## Phase 2 — Native Trimble JobXML

The one true-native encoder/decoder in v1, the format differentiator. (Carlson/MicroSurvey is served by the PNEZD CSV preset + LandXML from Phase 1; native Carlson CRD is deferred.)

### Deliverables

- [ ] `api/src/field/jobxml.rs` — Trimble JobXML (.jxl) encoder + decoder (ASCII).
- [ ] Wire JobXML into `exportField` and into `detect(bytes)` (JobXML root).

### Tests

- [ ] Decode known JobXML fixtures → expected points.
- [ ] `write → read → equal` round-trip for JobXML.
- [ ] Malformed-input bounds tests (bad/oversized XML).

### Validates

Export produces native JobXML files; the decoder parses real samples. (Real-device confirmation happens in Phase 7.)

---

## Phase 3 — Schema migration + design/as-built separation

Data model groundwork and the mandatory query audit — done before any as-built data exists.

### Deliverables

- [ ] Migration **0006**: add `survey_points.point_type` (default `design`), create `as_built_batches`, `as_built_comparisons`, add `projects` tolerance columns (with construction defaults).
- [ ] **Audit (hard item):** filter `point_type='design'` in every existing `survey_points` read — scene data resolver, point export, baseline "all", survey-points list/panel, point-group membership, category counts, aggregates.
- [ ] `setProjectTolerances` mutation + project tolerance defaults plumbed.

### Tests

- [ ] Migration up/down.
- [ ] Regression: existing scene/export/list queries return only `design` points (insert an `as_built` row, assert it never appears in design surfaces).
- [ ] Tolerance default + update tests.

### Validates

Existing SiteLens behavior is unchanged; as-built rows are invisible to all design surfaces. Nothing user-facing yet.

---

## Phase 4 — Comparison engine + as-built import

The core QC logic.

### Deliverables

- [ ] `api/src/field/compare.rs` — match by number, projected-ground primary + grid secondary deltas, tolerance status, no-vertical handling, snapshot of design coords + tolerance spec.
- [ ] `detectFieldFormat` + `importAsBuilt` mutation (decode → compare → snapshot → persist).
- [ ] `repairComparison` (manual pairing, recompute against snapshot).
- [ ] `asBuiltBatches` + `comparison` queries (rows + summary stats).
- [ ] `deleteAsBuiltBatch`.

### Tests

- [ ] Number-match, unmatched persistence, manual re-pair, baseline scoping (all/category/group).
- [ ] Delta correctness in both frames; tolerance pass/warn/fail boundaries; no-vertical case.
- [ ] **Snapshot immutability:** mutate a design point / re-solve transform → existing comparison numbers unchanged.

### Validates

Full inbound round trip works via API: import an as-built file, get matched/unmatched rows with correct deltas and frozen snapshots.

---

## Phase 5 — Field panel UI + 3D overlay

User-facing surface for both directions.

### Deliverables

- [ ] New **Field** panel: Export-to-device (preset/space/unit/scope/code-field), Import as-built (auto-detect + override, baseline, tolerance override), Comparisons list.
- [ ] **Results table:** design vs as-built, ΔN/ΔE/ΔZ, radial, vertical, grid-frame secondary columns, status chips, unmatched section + manual-pairing control; sort/filter by status.
- [ ] **3D scene overlay (Three.js/R3F):** design vs as-built markers + status-colored leader lines, layer toggle, unmatched styling.
- [ ] Solo-plan upgrade gate on the panel. shadcn components, sharp roundedness.

### Tests

- [ ] Playwright e2e: export-with-preset download; import → table renders → manual pair unmatched → status updates.
- [ ] Playwright: Solo-plan gate.

### Validates

A Crew user does the entire flow in the browser: export to their app's format, import field data, see and fix pairings, view the miss in 3D.

---

## Phase 6 — Stakeout reports (CSV + PDF)

The deliverables surveyors hand to the GC.

### Deliverables

- [ ] `api/src/field/report.rs` — CSV report (reuse CSV writer).
- [ ] PDF report via **`printpdf`**: project header, tolerance spec, summary stats (counts, max/RMS miss), per-point table.
- [ ] `comparisonReportCsv` + `comparisonReportPdf` queries returning blobs; download buttons in the Field panel.

### Tests

- [ ] CSV content assertions.
- [ ] PDF smoke: generates, non-empty, expected summary counts.
- [ ] Playwright: download CSV + PDF from a comparison.

### Validates

A comparison produces a clean, reproducible CSV and PDF stakeout report.

---

## Phase 7 — Customer docs + real-device acceptance

Self-serve docs and the validation that makes "supported" real.

### Deliverables

- [ ] In-app docs page: add `field-exchange` to `web/src/lib/docs.ts` `docsOrder` (group "Working with Data"); create `web/src/content/docs/field-exchange.md`; create `web/src/app/docs/field-exchange/page.tsx` per the `[slug]` pattern.
- [ ] Docs content: supported apps/formats, export-per-collector how-to, getting files onto the device, import + baseline + tolerances, reading results, downloading reports, projected-ground/feet default, per-app notes.
- [ ] **Real-device acceptance checklist:** load each emitted file into Trimble Access (JobXML + CSV) / Carlson (PNEZD CSV + LandXML) / Topcon Magnet (CSV); import a real file back from each; lock verified files as golden fixtures in `api/tests/fixtures/field/`.
- [ ] Mark each format's "supported" status only after its device pass.

### Tests

- [ ] Docs page renders in the nav + route resolves.
- [ ] Golden-fixture decode tests added from the real-device files.

### Validates

Customers can self-serve via in-app docs, and every shipped format is confirmed to open/round-trip in the real collector — not just spec-compliant.

---

## Cross-phase conventions

- Lint + format + commit + push at each phase boundary; update these checkboxes as items complete.
- Migrations: apply pending **0005** then **0006** on the next deploy.
- All shared utilities (codecs, comparison math) get unit tests (project convention).
- Verify locally via integration tests / Playwright; if a scripted multi-mutation curl flow trips the security guardrail false positive, run via `!` or the integration suite.
