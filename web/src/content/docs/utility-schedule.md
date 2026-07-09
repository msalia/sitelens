# Utility Schedule PDF

The **PDF** export of a utility record is a deliverable-ready **utility schedule**:
a branded cover, an architectural **plan sheet** of the network, and dual-unit
tables of every run and structure. Export it from the **Utilities** tab — the
export button (top-right of the inventory) → **PDF**. Like every export, it
honors the **active search and type filter**: filtered-in entities are drawn in
color and listed in the tables; everything else is kept for context, drawn gray.
It's a Crew feature.

## The plan sheet

Across the top of the first content page is a plan drawing of the network, laid
out like a CAD title sheet so it reads at a glance and pairs with the tables
below it. It's a scaled, north-up plan — the same layout you see looking straight
down in the 3D view.

The sheet has three parts:

- **Left panel** — the drawing title and project, a **legend** of the utility
  types and structure symbols present, and metadata (drawing number, scale, date,
  CRS/EPSG, units).
- **Center column** — a **north arrow**, a headline figure (total run length in
  feet and meters, with run/structure counts), and a **graphic scale bar**.
- **Plan** — the network geometry over a building-grid backdrop.

## How to read the drawing

**Color tells you what matters.** Filtered-in utilities are drawn in their
**APWA type color** (blue water, green sewer/storm, and so on — see
[Utility Records](/docs/utilities)). Out-of-filter context utilities are drawn
**gray**. Everything measurement-related — gridlines, grid bubbles, dimensions,
labels, the north arrow, and the scale bar — is drawn in a single **indigo**
accent, and structure outlines are black, so the utilities themselves stand out.

**Line weight and style carry the pipe data:**

- **Thickness follows diameter** — larger mains draw heavier. Mains large enough
  to show at the sheet scale are drawn as a **to-scale double-line casing** with a
  shaded fill.
- **A solid line is measured; a dashed line is record.** Runs sourced from a
  field survey or a utility locate draw solid; runs imported from a DXF, GeoJSON,
  or other record source draw dashed, so surveyed and record data are never
  confused.
- **The casing hatch hints at material** (color still comes from the APWA type):

  | Material             | Hatch            |
  | -------------------- | ---------------- |
  | Ductile iron (DIP)   | Cross-hatch      |
  | Concrete / RCP       | Dots             |
  | Steel / metal / iron | Horizontal lines |
  | PVC / HDPE / other   | Diagonal lines   |

**Structures are type symbols:** manhole ●, catch basin ▪, valve ◆, hydrant ▲,
cleanout ✚, vault ⬗ — filled in the APWA color (or gray for context), with a
black outline.

**The grid is your building grid.** When the project has a solved coordinate tie,
the plan is drawn in **building-grid coordinates** and overlaid with the project's
real grid axes — lettered and numbered bubbles with dashed extension lines and
**dimension chains in US survey feet** — so it lines up with the 3D top view and
your control. Without a tie, it falls back to a plain projected-coordinate grid.
The sheet auto-orients to fill the page.

**Labels stay off the geometry.** Each drawn run and structure gets a short label
— a run shows its ID with size and material (`W-1 · 6" DIP`); a structure shows
its ID and rim (`MH-1 · RIM 30.5`). Labels are placed automatically with leader
lines so they clear the linework, the grid, and each other. A run or structure
with a noteworthy **condition** gets a flagged callout.

## The schedule tables

Below the plan are two tables listing every filtered-in entity:

- **Runs** — type, label, material, diameter, and length in **both meters and US
  survey feet**.
- **Structures** — type, label, material, and rim elevation in **both meters and
  US survey feet**.

Every linear value on the sheet is dual-unit — the scale bar, the headline figure,
and both tables — so the deliverable works whether the next reader thinks in
meters or feet.

For the machine-readable exports (GeoJSON, DXF, LandXML) and the project archive,
see [Utility Records](/docs/utilities).
