# SiteLens Feature Foundation — Shared Substrate Specification

> The common infrastructure that the SiteLens feature suite is built on. Not a user-facing
> feature — a set of shared building blocks that the four feature specs
> ([site-analysis](../site-analysis/SPEC.md), [utility-records](../utility-records/SPEC.md),
> [surface-modeling](../surface-modeling/SPEC.md), [field-exchange](../field-exchange/SPEC.md))
> each depend on instead of re-inventing.

---

## 1. Why this exists

Four features were specced independently and each re-derived the same plumbing: a
snap-enabled drawing editor, DXF/LandXML/CSV codecs, a PDF report generator, R3F scene
overlays, async job status, and reproducible-record snapshotting. Building these four
times would be wasteful and would drift (e.g. two PDF stacks, two DXF exporters that label
layers differently).

This document defines each shared block **once**, names its consumers, and sets the rule:

> **Whoever ships first builds the foundation piece; every later feature depends on it, not
> a copy.** When a feature's build starts, check this doc first — if a block already
> exists, extend it; if not, build it here (in a shared module) and this doc records it.

### The two feature families (design context)

The four features fall into two families, which is why the foundation is shared but not
every feature uses every block:

- **Records** — `utility-records`, `surface-modeling`, `field-exchange`. System-of-record
  semantics: snapshot inputs, audit trail, reproducible-forever exports. They **capture /
  derive and archive**.
- **Compute** — `site-analysis`. Disposable, re-runnable scenarios. It **analyzes**. It is
  the one family member that skips the snapshot/audit block.

---

## 2. Consumer matrix

| Shared block | site-analysis | utility-records | surface-modeling | field-exchange |
| --- | :---: | :---: | :---: | :---: |
| §3 Plan editor (snap + numeric entry) | ✓ paths/bays | ✓ runs/structures | ✓ breaklines/boundary | — |
| §4 Format codec layer | DXF, GeoTIFF | DXF, GeoJSON, LandXML | DXF, LandXML, GeoTIFF | CSV, LandXML, JobXML |
| §5 Labeled DXF export (site CRS/units) | ✓ | ✓ | ✓ | (points) |
| §6 Rust geometry stack (`geo`/`spade`) | ✓ | derive | ✓ | — |
| §7 Surface abstraction (GeoTIFF + grid) | ✓ (hydrology) | — | ✓ (provider) | — |
| §8 Report service (WeasyPrint) | ✓ | ✓ | ✓ | ✓ |
| §9 Scene overlay primitives | ✓ | ✓ | ✓ | ✓ |
| §10 Async job/status pattern | ✓ | — | ✓ | — |
| §11 Snapshot + audit pattern | — | ✓ | ✓ | ✓ |
| §12 FileBlob download + Storage | ✓ | ✓ | ✓ | ✓ |
| §13 Gating (existing plan-check) | ✓ | ✓ | ✓ | ✓ |

---

## 3. Plan editor (snap + numeric entry)

A **top-down orthographic "plan mode"** in the existing Three.js/R3F scene — **not** a
separate 2D canvas engine. Drawing happens in **world XY** (site CRS); existing survey
points, DXF overlay, terrain hillshade, and other overlays are the drawing backdrop, and
results drape straight back into 3D with no transform.

**Capabilities:**
- Drawing primitives: point, polyline, rectangle, closed polygon.
- **Snapping** to survey points, DXF vertices/lines, endpoints, and other feature geometry.
- **Numeric entry** for exact segment length, angle, and coordinates (the survey-grade
  dividing line — eyeballing is not acceptable).
- Each placed vertex may record an optional soft link to a source survey point (provenance
  only, never a live dependency — consumers that snapshot geometry own their copy).

**Consumers & what they draw:** site-analysis (turning paths, parking bays, hydrology
AOI/pour point), utility-records (run vertices, structure nodes), surface-modeling
(breaklines, boundary, holes). field-exchange does **not** draw (file import only).

---

## 4. Format codec layer

A trait-based codec module so geospatial formats are added uniformly and every feature's
import/export pipeline is format-agnostic. Generalizes the codec layer field-exchange
proposed (`FieldFormat` enum + `detect(bytes)` + dispatch) to the whole suite.

- **Shared shapes:** `ParsedPoint` / `ExportPoint` (and line/polygon equivalents) that all
  codecs convert to/from, so downstream code never sees a raw format.
- **Formats:** CSV (+ per-app presets), DXF, LandXML, GeoJSON, GeoTIFF, Trimble JobXML.
- **Auto-detect** with manual override; **layer→type mapping** for DXF (APWA-named layers
  auto-map; manual fallback UI) reused by utility-records, surface-modeling, and
  site-analysis (obstacle layers).
- **CRS handling:** decode to the file's stated space/unit → convert to canonical meters
  projected via the existing `crs.rs` / `convert.rs`; encode converts to the chosen
  space/unit first.
- **Bounded parsing:** shared size/row/feature caps; XML via `roxmltree` (no entity
  expansion).

---

## 5. Labeled DXF export (site CRS / units)

One geometry-to-DXF-layers exporter: analysis envelopes/stalls/flow-lines, utility runs
(APWA layers) + structure blocks, and surface faces/contours all export as **labeled DXF
layers in the site's projected CRS and the project's survey units**, so results open
directly in Civil 3D / AutoCAD. Single implementation guarantees consistent layer naming
and coordinate handling across features.

---

## 6. Rust geometry stack

The computational-geometry crates the suite shares, added once:

- **`geo` / `geo-types`** — polygon ops, intersection/clipping, length/area. Used by
  site-analysis (swept-path clearance intersection, parking tiling, D8 support),
  surface-modeling (geometry ops), utility-records (derivations).
- **`spade`** — constrained Delaunay triangulation. Primary consumer surface-modeling; the
  surface abstraction (§7) that site-analysis hydrology depends on is built on it.

Whoever builds the first geometry-heavy feature adds these deps; the rest reuse.

---

## 7. Surface abstraction (GeoTIFF + grid sampling)

A **grid-samplable surface** interface so any elevation source is consumed uniformly. This
is the deepest cross-feature integration and the reason surface-modeling and site-analysis
are complementary rather than overlapping.

- **Provider:** `surface-modeling` produces surfaces — point-built **TIN** (`spade` CDT)
  and uploaded high-res **DEM** (drone/LiDAR GeoTIFF sampled to grid via `dem.rs`) — both
  exposed as a grid-samplable surface, plus the grid-sampling machinery in `volume.rs`.
- **Server-side GeoTIFF** parse/sample (the `tiff` reader surface-modeling adds) is shared
  with site-analysis hydrology's raster handling.
- **Consumer:** `site-analysis` **hydrology** runs D8 flow-direction/accumulation on a
  surface. Resolution order:
  1. **surface-modeling surface** (TIN or high-res DEM) when one exists → design-precision
     flow analysis, including *proposed graded* surfaces.
  2. **open 1 m 3DEP LiDAR** (fetched + cached) as fallback / off-site context when no
     surface-modeling surface is present → existing-conditions screening.
- Coarse OpenTopography terrain remains **context backdrop only**, never an analysis
  surface.

> This lifts the "existing-conditions only" ceiling from site-analysis hydrology *when
> surface-modeling is present*, while keeping site-analysis fully functional standalone via
> the open-LiDAR fallback. The two features stay decoupled through this interface.

---

## 8. Report service (WeasyPrint)

**One PDF report path for the whole suite** — a stateless **Python + WeasyPrint** service
(4th container in the Dokploy compose: `web` / `api` / `db` / `report`). **Retires
`printpdf`**, which utility-records, surface-modeling, and field-exchange each originally
specced separately; all three produce tabular documents (utility schedule, volume report,
stakeout report) that are textbook WeasyPrint (HTML/CSS → PDF, precise pagination).

- **Contract:** single endpoint, `{figures[], data, branding}` in → PDF out. Stateless,
  single-purpose.
- **Figures:** WeasyPrint does not execute JS, so 3D/plan figures are **rasterized to PNG
  client-side** first (each feature already captures scene PNGs); the payload carries PNGs
  + JSON data + citations.
- **CSV export stays separate** — trivial, per-feature, unchanged.
- **Mandatory appendix** on every report: data-source + methodology + disclaimer block
  (OSM ODbL, USGS 3DEP, NOAA Atlas 14, DOT AADT source, vehicle-template source, advisory
  disclaimers where applicable).

---

## 9. Scene overlay primitives

Shared R3F scene layer system so every feature renders consistently:

- **Typed layers** with on/off toggles and legends.
- **Status coloring** (pass/warn/fail — green/amber/red) reused by field-exchange
  (comparison leader lines), site-analysis (clearance/compliance), and others.
- **Click-to-inspect** selection → attribute/result panel.
- Feature-specific renderables plug in: analysis envelopes/flow-lines, utility tubes/solids
  + underground mode, surface mesh/contours/heatmap, comparison markers + leader lines.

---

## 10. Async job / status pattern

The existing `refreshTerrain` / `projectTerrain` job pattern, generalized: kick off →
`status` (`running` → `complete`/`failed` + `error`) → poll → fetch result. Consumers:
site-analysis (hydrology, traffic), surface-modeling (surface build/rebuild). Interactive
and file-based operations (turning/parking, field-exchange comparison) stay synchronous.

---

## 11. Snapshot + audit pattern (records family)

For the record features, a shared approach to reproducibility:

- **Input/geometry snapshot** — a record copies the inputs it was computed from (design
  coords, surface versions, tolerances) so a delivered report reproduces forever even if
  source data later changes.
- **Audit trail** — append-only change log (create/update/delete with field-level diffs);
  deletes are soft + audited.
- **Versioning** — where a record is rebuilt (surfaces), increment a version and snapshot
  per version.

Consumers: utility-records (`utility_audit`, snapshotted vertices), surface-modeling
(versioned surfaces, snapshotted volume inputs), field-exchange (snapshotted comparisons).
**site-analysis opts out** — analyses are disposable/re-runnable.

---

## 12. FileBlob download + Storage

Shared GraphQL `FileBlob` return shape (`{ filename, mimeType, contentBase64 }` or Storage
ref) and the existing Storage abstraction for all generated artifacts (report packages,
mesh blobs, DEM bytes, export files). Downloadable individually or zipped.

---

## 13. Gating (existing plan-check)

**One gating mechanism, the existing live billing/plan-check.** Verified in code
(2026-07-05): SiteLens has a **complete Stripe billing system** — *not* deferred. The model
is **binary**: `Solo` (free) vs `Crew` (paid), **derived** from the Stripe
`subscription_status` (no stored plan column; one product, monthly/annual prices). Solo caps:
1 project / 1 admin / 5 members.

The plan → capability mapping is a **single catalog module, `api/src/plan.rs`** (added
2026-07-05): `Plan` (Solo/Crew), `Feature` (enum of gated capabilities), `Feature::meta()`
(the one mapping table: key/label/blurb/min_plan), and `Plan::limits()` (per-plan caps).
**To gate a new feature: add a `Feature` variant + its `meta()` row + include it in
`Feature::all()` — nothing else hard-codes feature names or caps.** The catalog is exposed
to the web via the **`planCatalog`** GraphQL query, and the web renders all upgrade dialogs
+ selling points from it (no hand-maintained `CREW_FEATURES` list anymore).

**All four suite features gate as Crew** through the ready-made helpers in
`api/src/schema/mod.rs` — do not invent a parallel entitlement system:

- **`require_feature(ctx, Feature::X)`** — gates a catalog feature; the error message is
  built from the feature's catalog label. (`require_export` = `require_feature(ctx,
  Feature::Export)`; export is already Crew-gated.) Use for run / capture / build / export
  resolvers.
- **`require_editor_active(ctx)`** — editor role **and** not `restricted()` (a lapsed org
  over Solo caps is read-only). Use on every data mutation.
- Backing state: `billing::org_billing(pool, org_id)` → `OrgBilling::plan()` /
  `has_feature(Feature)` / `restricted()`.

So gating the new suite features is literally: add a `Feature` variant per capability
(e.g. `TurningRadius`, `Utilities`, `Surfaces`, `FieldExchange`) and call
`require_feature` in their resolvers.

> **Correction to site-analysis:** its spec originally introduced a "per-org entitlement
> flag." Superseded — it gates as **Crew via `require_paid`**, no billing change
> ([decision 2026-07-05](#132-tiering-decision)).

### 13.1 Fix stale language in feature specs

All four feature specs still say "Stripe/billing remains deferred" / "no billing changes."
**That is factually wrong** — billing is live. Each spec's gating note must be corrected to:
"gates as Crew via the existing live plan-check (`require_paid` / `require_editor_active`)."

### 13.2 Tiering decision (2026-07-05)

The record features are surveyor features → **Crew** is the right bundle. **site-analysis
targets a new audience (site/civil engineers)** and the binary model cannot express a
separate SKU or a non-subscription entitlement without extending billing (second Stripe
product/price + non-binary plan derivation reading *which* product the org is on).

**Decision: v1 gates site-analysis as Crew** (fastest, zero billing work). Accepted
tradeoff: a pure civil engineer must buy the whole surveyor Crew bundle to get it. A
dedicated "Engineer/Pro" tier for that audience is a **deliberately deferred future billing
workstream** (binary → multi-product), to be taken on only if segment data shows civil
engineers are a distinct segment willing to pay a premium — not a blocker for the build.

---

## 14. Coordination notes

- **Migration numbering collides across specs, and every spec is stale.** utility-records
  and field-exchange both claim `0006`; surface-modeling claims `0008`. **Verified against
  the repo (2026-07-05): `api/migrations/` is already at `0013`** (`0005_cad_overlays` is
  committed, and `0013_billing.sql` exists — plan/billing infra is real, reinforcing
  gating via the existing plan-check in §13). **The next free migration is `0014`.** Do not
  trust any hard-coded number in the feature specs; assign sequentially per the §16 build
  order.
- **`geo`/`spade`/`tiff` deps** are added by the first geometry/surface feature to ship;
  later features reuse.
- **`printpdf` must not be added** by any feature — all PDF goes through the §8 service.
- When starting any feature, read this doc first and depend on existing blocks.

---

## 15. Future cross-feature product ideas (not v1)

Noted so they aren't lost; each is a v2 cross-feature integration, not foundation:

- **Hydrology on the design surface** — promote surface-modeling-surface flow analysis to a
  first-class site-analysis mode (beyond existing-conditions screening). Enabled by §7.
- **Parking ADA slope compliance** — check accessible-stall slope (≤2%) against
  surface-modeling's slope analysis; a compliance feature no competitor bundles.
- **Cut/fill from a proposed layout** — bridge site-analysis geometry (pad/parking) into
  surface-modeling volumes.

---

## 16. Master build order

The canonical sequencing across all four features + the foundation blocks. Feature-at-a-time
in dependency order; each of the 26 phases still ends in a deployable state. Each shared
block is **built once** by the first feature that needs it, then reused.

### 16.1 Feature order & rationale

**Field-exchange → Utility-records → Surface-modeling → Site-analysis**

1. **Field-exchange** — self-contained (no plan editor / geometry stack / surface). Does the
   invasive **`point_type` design/as-built split** (audits every existing `survey_points`
   read) — cheapest *now*, before more readers exist. Stands up three shared blocks: codec
   framework, scene-overlay primitives, WeasyPrint report service.
2. **Utility-records** — builds the **plan editor** (snap + numeric entry), the
   **snapshot/audit** pattern, **DXF/GeoJSON codecs** + **labeled DXF export**. Simplest
   drawing feature → earliest records win.
3. **Surface-modeling** — builds the **geometry stack** (`spade`/`geo`) and the **surface
   abstraction**. Placed immediately before site-analysis so the surface is fresh.
4. **Site-analysis** — most dependent; consumes everything. Hydrology launches with
   **design-surface mode** from day one (surface-modeling just shipped) — no throwaway
   1 m-3DEP-only version.

**Critical path:** codec + overlays + report (FE) → plan editor + DXF export (UR) →
geometry stack + surface abstraction (SM) → analyses (SA).

### 16.2 Foundation block → built by → reused by

| Foundation block | Built in | Reused by |
| --- | --- | --- |
| Codec framework (trait/detect/dispatch) | Field-exchange | UR, SM, SA |
| Scene-overlay primitives (layers, status color, inspect) | Field-exchange | UR, SM, SA |
| WeasyPrint report service (4th container) | Field-exchange | UR, SM, SA |
| `point_type` design/as-built hygiene | Field-exchange | all `survey_points` readers |
| Plan editor (snap + numeric entry) | Utility-records | SM, SA |
| Snapshot/audit pattern | Utility-records | SM, FE (retrofit ok) |
| DXF/GeoJSON codecs + labeled DXF export | Utility-records | SM, SA |
| Geometry stack (`spade`/`geo`) | Surface-modeling | SA |
| Surface abstraction (TIN/DEM/GeoTIFF/grid) | Surface-modeling | SA (hydrology) |
| Analysis compute (tractrix/tiling/D8) | Site-analysis | — |

### 16.3 Migration assignment (verified next free = `0014`)

| Order | Feature | Migration | Tables |
| --- | --- | --- | --- |
| 1 | Field-exchange | **0014** | `point_type`, `as_built_batches`, `as_built_comparisons`, `projects` tolerance cols |
| 2 | Utility-records | **0015** | `utility_types`, `utility_runs`, `utility_vertices`, `utility_structures`, `utility_audit` |
| 3 | Surface-modeling | **0016** | `surfaces`, `surface_breaklines`, `surface_dems`, `volumes` |
| 4 | Site-analysis | **0017** | `analysis`, `vehicle_template`, `ext_data_cache`, `report` |

> Each feature's own PHASES doc references a provisional/older number — **use the number in
> this table**, not the one in the feature doc.

### 16.4 Value tradeoff (recorded)

Dependency-optimal order lands **site-analysis last** — the feature that motivated the suite.
Alternative: move it earlier, have it build the plan editor + geometry stack + report service
itself, and ship **hydrology on 1 m 3DEP only** first (design-surface mode arrives when
surface-modeling later lands). Only worth it if getting turning-radius/traffic in front of
customers early outweighs the extra upfront work + one throwaway hydrology mode.
**Recommendation: keep the dependency-optimal order above.**
</content>
