# Plan-View Drawing Sheet — Shared PDF Renderer Spec

> A reusable, domain-agnostic architectural **drawing sheet** renderer (`api/src/report/drawing.rs`)
> embedded in PDF exports. First consumer: the utility schedule. Later: surface/volume/field reports.
> Resolved via a grill-me design interview (2026-07-07).

---

## 1. Overview

An editorial, CAD-style plan sheet rendered as self-contained SVG and embedded in a
WeasyPrint PDF body. Aesthetic modeled on a modern architectural title sheet (RFXEL reference):
warm **beige block, no border, sharp corners**, generous whitespace, a **single indigo accent**
for the whole measurement/annotation system, and **content colored by importance** (utilities by
APWA type) over an otherwise **grayscale** base.

The renderer is **domain-free**: it draws generic primitives from a `Sheet` model. Each feature
(utilities today) maps its own data onto that model.

## 2. Layout (three columns, left → right)

1. **Left info panel** — caption; title (indigo) + subtitle (project); **legend** (color swatch → type
   + count, structure symbol key, convention notes: *gray = context/out-of-filter*, *dashed =
   record/imported*); **metadata** (drawing no · scale · date · CRS/EPSG · units). **No brand lockup**
   (the report cover already brands the doc).
2. **Center column** — minimalist **north arrow** (up = projected/grid north); **headline stat**
   (total run length, big US ft + m beneath, "N runs · M structures"); **graphic scale bar** (ft, m note).
3. **Plan** — the geometry with the indigo annotation layer around it.

## 3. Placement (configurable, reusability requirement)

`Placement::Band { height_mm }` (utility export uses a **landscape band** inside the portrait page)
or `Placement::FullPage { landscape }` (available for other exports; not wired for a feature in v1).

## 4. Color system

- Background: beige `#e7e5e1`, no border, sharp corners.
- **Important content = APWA type color:** in-filter utilities (runs + structures).
- **Indicators + labels = app primary indigo `#6366f1`:** gridlines, grid bubbles, dimension chains
  + values, north arrow, scale bar, entity ID/size labels. (The CSS `--primary` token is near-black;
  the intended primary is the brand indigo.)
- **Everything else = grayscale/black-white:** out-of-filter context utilities (gray), structure
  symbol outlines (black), non-utility base linework.
- Label halo = the **beige background color** (not white), so labels sit into the sheet.
- Theme (primary/ink/gray/bg) is overridable on the `Sheet`.

## 5. Utility geometry encoding (grounded in stored columns)

- **Thickness ∝ diameter**, clamped to a readable range.
- **Casing + shading/hatch for mains:** when `diameter · scale ≥ ~4px`, draw a to-scale double-line
  pipe casing with a light APWA-tinted fill + gray diagonal hatch; below that, a single weighted line.
- **Line style = provenance/confidence via `utility_runs.source`** (enum): **solid** for measured
  (`field_survey`, `locate_company`); **dashed** for record/imported (`dxf`, `geojson`, `other`).
- **Structures = type symbols:** manhole ●, catch basin ▪, valve ◆, hydrant ▲, cleanout ✚, vault ⬗;
  APWA fill (or gray if context) + black outline; ~constant size.
- `material`, `condition`, `locate_method`, `owner`, inverts, slope → **schedule table only**
  (free-text / detail), not encoded on the plan.

## 6. Annotation layer

- **Coordinate grid** (no building axes exist): auto "nice" spacing (1/2/5 × 10ᵏ) for ~4–8 divisions,
  light indigo gridlines across the plot.
- **Grid bubbles:** circled **letters** (A, B, …) on vertical/easting gridlines top & bottom; circled
  **numbers** (1, 2, …) on horizontal/northing gridlines both sides.
- **Dimension chains** outside the plot (top + left): tick-marked segment spacings + an overall
  dimension, in **US survey feet**.
- Scale bar + headline stat show both units; schedule tables carry both.

## 7. Labels on geometry (minimal, indigo, beige halo)

- Runs: `W-1 · 12″ PVC` (ID + diameter + material) near midpoint.
- Structures: `MH-1 · RIM 30.5` (ID + rim).
- Inverts/slope/condition/owner/dates → table only.

## 8. Reusable API (`report::drawing`)

```rust
Sheet { theme, placement, info: InfoPanel, center: CenterColumn, grid: Grid, entities: Vec<Entity> }
Theme { primary, ink, gray, bg }                         // defaults: indigo / near-black / gray / beige
InfoPanel { caption, title, subtitle, legend: Vec<LegendItem>, meta: Vec<(String,String)>, notes }
LegendItem { swatch: Swatch (Color|Marker), label, note }
CenterColumn { north: bool, scale_bar: bool, unit, stat: Option<Stat{ big, sub, note }> }
Grid { bubbles: bool, dims: bool, unit }
Entity { geom: Polyline|Point|Polygon, style: Style }
Style { color, weight, dashed, emphasis, casing_m: Option<f64>, fill: Option<String>,
        marker: Circle|Square|Diamond|Triangle|Bowtie|Plus|None, label: Option<String> }
```

The renderer knows **generic markers, not "manhole."** The utilities caller maps
type→color, diameter→weight+casing, source→dashed, structure-type→marker, and builds the legend.
`Polygon` supports future cut/fill heatmaps.

## 9. Scope boundaries

**v1:** the renderer + utilities landscape-band wiring + dual-unit schedule tables.
**Deferred (API-ready):** full-page landscape/portrait usage + actual surface/volume/field sheets;
material→hatch pattern mapping (generic hatch only); detail/section tags + arbitrary leader callouts.
**Assumption:** north = projected/grid north (up), consistent with the 3D scene.
