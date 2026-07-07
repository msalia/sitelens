# Utility Records

Utility Records capture the buried and interior networks on a site — water, sewer,
storm, gas, electric, comms — as an attributed, audited as-built record you can see
in 3D and hand off in CAD/GIS formats. Everything lives in the **Utilities** tab of
a project. It's a Crew feature.

A record has two kinds of entities:

- **Runs** — linear utilities (a pipe, a conduit, a duct bank) drawn as a
  vertex-to-vertex line with a diameter.
- **Structures** — point features (a manhole, catch basin, valve, vault, hydrant)
  placed at a single position.

Both are stored in **projected meters** internally, the same canonical frame as
your survey points, and both are **immutable snapshots**: the geometry is frozen at
capture, so a delivered record reproduces even if the underlying survey points are
later edited or deleted.

## Utility types & APWA colors

Every run and structure is tagged with a **type** from the built-in APWA catalog
(American Public Works Association uniform color code). The type sets the display
color everywhere — inventory, 3D scene, and exports:

| Utility | APWA color |
| --- | --- |
| Potable water | Blue |
| Sewer / storm / drainage | Green |
| Reclaimed water / irrigation | Purple |
| Gas / oil / steam | Yellow |
| Electric power | Red |
| Communications / fiber | Orange |
| Proposed excavation | White / pink (temp) |

Pick the type when you create the entity; it drives the color and groups the item
in the inventory. Structure types (manhole, valve, hydrant, vault…) render as
solids; linear types render as tubes sized to their diameter.

## Capturing utilities

There are two ways to build a record.

### Digitize in-app

From the **Utilities** tab, use the full-width button group — **New run**, **New
structure**, or **Import**.

1. **New run** — pick an APWA type, then build the line vertex by vertex. Snap to
   existing survey-point markers in the 3D scene to capture their exact projected
   coordinates (the vertex keeps a soft link to the source point), or type
   northing / easting / elevation directly. A run needs at least two vertices.
2. **New structure** — pick a type and place it by snapping a survey point or
   entering coordinates.
3. Fill in the **attributes** (below) and save.

Because vertices are snapshotted, deleting the source survey point later leaves the
utility geometry intact — the link is simply cleared.

### Import from CAD / GIS

**Import** brings in pre-drawn linework:

1. Upload a **DXF** or **GeoJSON** file.
2. SiteLens parses it and shows every **layer** with a **suggested APWA type**,
   auto-mapped from APWA layer names (structure keywords win over linear ones).
   Confirm or change each layer's type; unmapped layers are skipped and counted.
3. Set the coordinate **space** and **unit** the file is in, then commit. DXF
   polylines become runs and block inserts become structures; GeoJSON
   LineStrings become runs and Points become structures.

Imported entities are attributable exactly like digitized ones.

## Attributes

Runs and structures carry typed attributes plus free-form tags:

- **Diameter** — entered in inches, stored in meters; drives the tube radius in 3D.
- **Inverts** — the up-stream and down-stream invert elevations on a run (and per-pipe
  inverts on a structure).
- **Slope** — derived automatically from the two inverts and the run length; not
  entered by hand.
- **Length** — derived from the vertex geometry (3D where elevations exist, else 2D).
- **Material**, **owner**, **condition**, **install / as-built date**,
  **locate method**, and **source** — provenance for the record.
- **Level** — a tag for interior/floor-based utilities (see below).
- **Tags** and a free-form attribute bag for anything the schema doesn't name.

Every create, edit, and delete is written to a **per-entity audit log**, so the
record is traceable.

## Reading depth in the 3D scene

Utilities render at their true elevation, which means buried runs sit below the
terrain surface. Two Display-menu controls make them legible:

- **Utilities** — toggles the whole network on and off (fades in and out).
- **Underground mode** — fades the terrain surface down to a low opacity so the
  buried network shows through, and fades it back when you turn it off.

Click any run or structure in the scene to select it and see its attribute card
(label · kind · type). Runs are drawn as diameter-sized tubes and structures as
cylinder solids, all in their APWA color, so a glance reads both the network layout
and relative pipe sizes.

## Interior utilities & levels

Utilities aren't only buried. Use the **level** attribute to tag interior or
floor-based runs and structures (e.g. a mechanical-room riser or a roof drain). The
level travels with the entity through the inventory, the scene, and every export,
so an interior network stays distinguishable from the site network.

## Inventory

The inventory is a searchable, server-paginated **table** — modeled on the survey
points table — so a large network stays manageable:

- **Search** by label or tag, and **filter by type**; both run server-side.
- The **Type** column shows an APWA color dot; the **Item** column shows the label
  with a subtitle (run point count, length, and diameter for runs).
- Click a row to focus it; delete from the row's action column.

## Exporting

The export button (top-right of the inventory, icon-only with a tooltip) writes the
current inventory — **honoring the active search and type filters** — to a portable
format:

- **GeoJSON** — geometry plus the full attribute set.
- **DXF** — 3D polylines on APWA-named layers, with structures as nodes.
- **LandXML** — plan features and points (weak support — see caveat below).
- **PDF** — a formatted utility schedule with a branded cover, an architectural
  plan sheet of the network, and dual-unit (meters and US survey feet) tables. See
  [Utility Schedule PDF](/docs/utility-schedule) for how to read it.

**LandXML caveat:** LandXML has no first-class model for arbitrary utility runs, so
the export maps them to plan features / points on a best-effort basis. Use GeoJSON
or DXF when you need full-fidelity geometry and attributes.

Utility runs, structures, and their vertices — along with your as-built comparisons
and any uploaded DXFs — are also included in the **project export/import** archive,
so a whole project round-trips with its utilities intact.
