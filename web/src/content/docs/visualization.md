# 3D Visualization

SiteLens renders your site in a 3D scene so you can see the grid, control points,
and surveyed points in context — with elevation, over real terrain.

## The scene

The workspace viewport is a CesiumJS 3D scene centered on your project's site
origin. You can orbit, pan, and zoom freely. It shows:

- The **building grid** lines.
- The **control points**.
- All **surveyed points**, floating at their measured elevation.
- The **DXF overlay**, if you've added one.

## Terrain is a backdrop

Terrain comes from open elevation tiles and exists only for visual context. It is
**not survey-grade**. The elevations that matter — the Z on your imported points —
are always the source of truth and are never replaced by terrain.

You can optionally supply a Cesium Ion token for higher-quality terrain, but the
default open tiles need no account.

## Point categories

Every point has a **category** — Control/Reference, Station, Column, Corner,
Spot/Elevation, Utility, or a custom one your org defines. Categories drive the
marker color and icon in the scene, and you can toggle whole categories on and off
to declutter.

Points can also carry free-text **tags** for ad-hoc grouping.

## Finding points

The point sidebar lists every point and lets you search and filter by category,
label, description, and tags. Selecting a point in the list highlights it in 3D
and vice versa. Save a **group** to name a selection you return to often.

Next: [DXF Overlay](/docs/dxf-overlay).
