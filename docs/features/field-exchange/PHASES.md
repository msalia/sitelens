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

- [x] `api/src/field/mod.rs` — `FieldFormat` enum, `detect(bytes)`, `FieldCodec` trait + dispatch.
- [x] `api/src/field/preset.rs` — `FieldPreset` definitions (Trimble CSV/JobXML, Carlson PNEZD CSV, Topcon/Sokkia CSV, Generic CSV, LandXML) with column order, delimiter, header, default space (projected-ground) + unit (ft).
- [x] `api/src/field/csv_preset.rs` — delimited reader/writer keyed by preset, converting to/from existing `ParsedPoint` / `ExportPoint`.
- [x] `api/src/field/landxml.rs` — reuse existing CgPoint read/write under the codec trait.
- [x] GraphQL: `fieldExportPresets` query + `exportField` query returning encoded blob (`FieldExportResult` = filename/mimeType/contentBase64). Gated via `Feature::FieldExchange` (new plan-catalog entry). SDL regenerated.

### Tests

- [x] Round-trip identity (`write → read → equal`) for each CSV preset + LandXML.
- [x] Preset column-order/delimiter assertions (PNEZD vs PENZD, header) + `detect()` sniffing.

### Validates

Crew users can export points in any of the curated CSV/LandXML presets; files are byte-shaped per app. No UI yet (exercised via GraphQL/tests).

---

## Phase 2 — Native Trimble JobXML

The one true-native encoder/decoder in v1, the format differentiator. (Carlson/MicroSurvey is served by the PNEZD CSV preset + LandXML from Phase 1; native Carlson CRD is deferred.)

### Deliverables

- [x] `api/src/field/jobxml.rs` — Trimble JobXML (.jxl) encoder + decoder (ASCII, `roxmltree`).
- [x] Wire JobXML into `exportField` (via `trimble_jobxml` preset) and into `detect(bytes)` (`<JOBFile` root).

### Tests

- [x] Decode known JobXML fixture → expected points (observation-only Points w/o `<Grid>` skipped).
- [x] `write → read → equal` round-trip for JobXML.
- [x] Malformed-input + oversized bounds tests; Grid-missing-coords error.

### Validates

Export produces native JobXML files; the decoder parses real samples. (Real-device confirmation happens in Phase 7.)

---

## Phase 3 — Schema migration + design/as-built separation

Data model groundwork and the mandatory query audit — done before any as-built data exists.

### Deliverables

- [x] Migration **0014** (real number; specs said 0006): add `survey_points.point_type` (default `design`, CHECK design|as_built, `(project_id, point_type)` index), create `as_built_batches` + `as_built_comparisons`, add `projects` tolerance columns (construction defaults ≈0.05/0.10 ft).
- [x] **Audit (hard item):** filter `point_type='design'` in every existing `survey_points` read — scene resolver, `exportPoints`, `exportField`, survey-points list + count, `points_centroid` (site-rotation pivot), archive export. (Group membership uses explicit `member_ids` + the filtered list; no separate category-count aggregate exists.)
- [x] `setProjectTolerances` mutation (Crew-gated, canonical meters) + `Project` tolerance fields + defaults plumbed (PROJECT_COLUMNS/ProjectRow).

### Tests

- [x] Migration applies cleanly (via `#[sqlx::test]` against real PostGIS).
- [x] Regression: list/count/scene/export/field-export return only `design` points (plant an `as_built` row, assert it never appears).
- [x] Tolerance default + update + Crew-gate tests. (Also fixed a pre-existing non-hermetic rate-limit test that broke under the dev `.env`'s `AUTH_RATE_LIMIT_MAX`.)

### Validates

Existing SiteLens behavior is unchanged; as-built rows are invisible to all design surfaces. Nothing user-facing yet.

---

## Phase 4 — Comparison engine + as-built import

The core QC logic.

### Deliverables

- [x] `api/src/field/compare.rs` — pure engine: match by number, projected-ground primary + building-grid secondary deltas, tolerance status (worse-of h/v, `no_vertical` when a Z is missing), snapshot of design coords. 8 unit tests.
- [x] `detectFieldFormat` + `importAsBuilt` mutation (decode → convert `space`/`unit` → compare → snapshot batch + rows → persist). `to_projected_grid` inverts `space_ne`.
- [x] `repairComparison` (manual pairing → recompute against snapshotted as-built coords + batch tolerance → `match_method='manual'`).
- [x] `asBuiltBatches` + `comparison` queries (batch + rows + summary: counts + max/RMS miss).
- [x] `deleteAsBuiltBatch` (cascade removes comparison rows).

**Design note:** as-builts live only in `as_built_comparisons` (snapshotted), not duplicated into `survey_points` — the comparison row is self-contained (0014's schema already stores `as_built_n/e/z` inline + only `design_point_id` FK). The P3 `point_type='design'` audit stays as defensive hardening.

### Tests (integration, real PostGIS)

- [x] Number-match + unmatched persistence + manual re-pair + baseline **category** scoping.
- [x] Delta correctness (ground/csf + grid frames) + tolerance pass/warn/fail boundaries + no-vertical (unit tests).
- [x] **Snapshot immutability:** move a design point after import → comparison `designN`/deltas unchanged.
- [x] `deleteAsBuiltBatch` removes it; all mutations Crew-gated.

### Validates

Full inbound round trip works via API: import an as-built file, get matched/unmatched rows with correct deltas and frozen snapshots.

---

## Phase 5 — Field panel UI + 3D overlay

User-facing surface for both directions.

### Deliverables

- [x] New **Field** panel (`field-panel.tsx`, Crew-gated tab): Export-to-device (preset/space/unit/category), Import as-built (auto-detect + CSV preset, space/unit, baseline all/category), Comparisons list with delete.
- [x] **Results table** (`field/results-table.tsx`): ΔN/ΔE/ΔH/ΔZ (report unit), status chips, unmatched rows get an inline manual-pairing picker, filter by status. *(Grid-frame secondary columns are in the data (`deltaGridN/E`) but not yet rendered → P5b.)*
- [ ] **3D scene overlay (Three.js/R3F):** design vs as-built markers + status-colored leader lines → **deferred to P5b** (needs the `comparison` query to also return geographic coords + Field↔Scene selection wiring).
- [x] Solo-plan upgrade gate on the Field tab (shared `CREW_TABS` pattern, `feature="field_exchange"`). shadcn components, sharp roundedness.

### Tests

- [x] Playwright e2e written (`e2e/field.spec.ts`): export-with-preset download; import → table renders → manual pair unmatched → row leaves unmatched; Solo-plan gate. (Runs against the full stack; user runs once the API container is up.)
- [x] Static: codegen + tsc + eslint clean, `next build` green, 46 vitest pass.

### Validates

A Crew user does the entire flow in the browser: export to their app's format, import field data, see and fix pairings, view the miss in 3D.

---

## Phase 6 — Stakeout reports (CSV + PDF)

The deliverables surveyors hand to the GC.

### Deliverables

- [ ] `api/src/field/report.rs` — CSV report (reuse CSV writer).
- [ ] PDF report via the **shared WeasyPrint report service** (not `printpdf`): project header, tolerance spec, summary stats (counts, max/RMS miss), per-point table.
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
