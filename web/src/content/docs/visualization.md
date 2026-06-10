# 3D Visualization

SiteLens renders your site in an interactive 3D scene so you can see the building
grid, control points, and surveyed points in context — over real terrain. The
viewport is always present in the project workspace and updates live as you edit.

## The scene

The viewer is a lightweight WebGL scene (react-three-fiber) drawn in a soft,
matte **"clay"** style — bright in light mode, a deep neutral in dark mode. It
shows:

- The **terrain** for your site, fetched from open elevation data.
- The **building grid** lines, with axis labels.
- **Control points** as red pins.
- All **surveyed points** as pins colored by category.

Drag to orbit, scroll to zoom, right-drag to pan. Zoom is clamped to a sensible
range so you can't fly inside the ground or so far out that the site disappears.

When you select a point in the table, the camera glides to it; selecting a point
in 3D opens its coordinate inspector.

### Idle orbit

After about ten seconds without interaction the camera begins a slow, continuous
orbit around the site — a gentle "attract" motion for dashboards and screens. Any
interaction stops it immediately, and it resumes after you're idle again. It is
disabled automatically if your system is set to _reduce motion_.

## Terrain

Terrain is fetched server-side from **OpenTopography** (SRTM global DEM) for the
area covering your points, then cached with your project so it loads instantly and
isn't re-fetched on every visit.

- Click **Load terrain** to fetch it the first time.
- **Refresh terrain** re-fetches it. Because OpenTopography is rate-limited, a
  refresh is blocked for **7 days** after the last fetch (the button shows why),
  plus a short client-side cooldown to prevent accidental repeats.

The fetched area is derived automatically from your control and survey points, so
there's nothing to configure. The terrain tile fades out at its edges so it blends
seamlessly into the background rather than reading as a floating slab.

> Terrain is a **backdrop for context only — it is not survey-grade.** The Z on
> your imported points is always the source of truth and is never replaced by
> terrain.

## Project onto terrain

Survey data often comes in with a local or zero elevation. With **Project onto
terrain** enabled, any point whose elevation is exactly `0` is draped onto the
terrain surface so it sits on the ground instead of floating below it, and grid
lines follow the terrain contour. A point that carries a real Z always keeps it —
its own elevation takes precedence.

Turning **Terrain** off also turns projection off (you can re-enable it
independently). The camera's pivot tracks the terrain height at the grid centre,
so toggling projection smoothly re-aims the view.

## Display options

The **Display** menu (top-left) toggles what's drawn:

- **Point pins** — show/hide the point markers.
- **Grid lines** — show/hide the building grid and its labels. Grid lines extend
  past their ends with a dashed lead-out so the labels stay clear of the pins.
- **Terrain** — show/hide the terrain mesh.
- **Project onto terrain** — drape zero-elevation features onto the surface.

## Camera views

The selector (bottom-right) jumps the camera to a preset — **Top, Front, Back,
Left, Right,** or **Isometric** — with a smooth glide. The focus button beside it
resets to the default isometric framing. Grabbing the camera mid-glide cancels the
transition and hands control straight back to you.

## Point categories

Every point has a **category** — Control/Reference, Station, Column, Corner,
Spot/Elevation, Utility, or a custom one your org defines. Categories drive the
marker color and icon in the scene.

Use the **Categories** menu (top-left) to show or hide categories, with a
**Select all / none** shortcut to declutter quickly. Points can also carry
free-text **tags** for ad-hoc grouping.

## Finding points

The point sidebar lists every point and lets you search and filter by category,
label, description, and tags. Selecting a point in the list flies the camera to it
in 3D. Save a **group** to name a selection you return to often.

Next: [DXF Overlay](/docs/dxf-overlay).
