# Surfaces & Volumes

Surfaces turn your survey points into a **terrain model** you can measure. From a
surface SiteLens derives the two classic deliverables — **contours** (the topo
map) and **cut/fill volumes** (the earthwork number that prices a job) — and
exports them to CAD/GIS. Everything lives in the **Surfaces** tab of a project.
It's a Crew feature.

A surface is **named and versioned**: its inputs are snapshotted, so a volume you
computed last month never silently changes when you rebuild. All geometry is
computed server-side and rendered in the same 3D scene as your points.

## Building a TIN from points

A **TIN** (triangulated irregular network) is a mesh of triangles through your
survey shots — the digital terrain model everything else is derived from.

1. Open the **Surfaces** tab and the **Build a surface** card.
2. Give it a **name** (e.g. "Existing grade").
3. Choose the **points**: all design points, one **category**, or one **group**.
4. Optionally set a **max edge length** (meters) to drop long sliver triangles
   that reach across gaps in your data.
5. Click **Build surface**. It appears in the **Surfaces** list, reporting its
   triangle and vertex counts. Click a surface to show it in the 3D scene.

Shade the surface from the scene's **Display** menu: an **elevation ramp**
(hypsometric tint), **slope** analysis, or a **wireframe** for QC.

## Constraints: breaklines, boundary, holes

A TIN is only as good as its constraints. Add them in the **Constraints** card,
then **rebuild** the surface (a new version) to apply them.

- **Breaklines** force triangle edges to follow a real linear feature — a curb, a
  swale, a ridge — so the surface doesn't smooth across it.
- A **boundary** clips the surface to a region (nothing is interpolated outside
  it). Use **Auto boundary** to derive a concave hull from your points, then edit.
- **Holes** cut voids out of the surface (a building pad, a pond).

You can capture constraints two ways:

- **Digitize** — pick the kind, click **Digitize**, then click survey points in
  the scene to snap the vertices; **Save**.
- **Import DXF** — map each DXF polyline layer to a kind. DXF has no elevation, so
  vertex heights are filled from the nearest survey point at build time.

## Uploading a DEM

Instead of points, you can build a surface from a **drone/LiDAR DEM**. In the
**Build a surface** card, click **Upload DEM** and choose a GeoTIFF. SiteLens
reads it in your browser, downsamples it to a workable grid, reprojects it to your
site using the GeoTIFF's own CRS, and builds a `DEM` surface. From there it
behaves exactly like a TIN — contours, volumes, and export all work.

> The background OpenTopography terrain (the shaded relief under your site) is
> **context only** — it is never used as a measurement surface. Only point-built
> TINs and uploaded DEMs are real surfaces.

## Contours

With a surface selected, the **Contours** section (in the Surfaces card) draws
iso-lines live in the scene:

- **Interval** — spacing between minor contours, in your display unit.
- **Major every** — heavier, labeled contours at this larger spacing.
- **Smoothing** — rounds the lines (Chaikin) without changing which triangles
  they cross.
- **Elevation labels** — printed on the major contours.

Contours are computed on demand and drape on the surface, so they update as you
change the parameters.

## Cut / fill volumes

The **Volumes** card computes earthwork between a base surface and a target:

1. Pick the **comparison**: **to another surface** (e.g. existing vs proposed) or
   **to a reference elevation** (a flat pad).
2. Choose the **base surface** and either the **compare surface** or the
   **reference elevation**.
3. Set the **cell size** (meters) — the grid resolution; smaller is more precise
   but slower.
4. Click **Compute volume**.

Results show **cut**, **fill**, **net**, and **area**, toggleable between **cubic
yards** and **cubic meters**. Select a volume to shade the surface with its
**cut/fill heatmap** (red = cut, blue = fill) with a legend in the scene. Because
the result snapshots the surface versions, it stays reproducible after a rebuild.

## Exporting

From the download menu on each surface or volume row:

- **Surface** → **LandXML** (TIN faces, opens in Civil 3D), **DXF** (3D faces plus
  contour layers when a contour interval is set), or a **GeoTIFF DEM** raster.
- **Volume** → a **PDF** report or a **CSV** — both carry the method, cell size,
  and the surface versions used, so the numbers are auditable.

Exports are written in your project's projected coordinate system, ready to drop
into CAD or GIS.
