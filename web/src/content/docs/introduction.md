# Introduction

SiteLens is a tool for construction surveyors. It takes an architect's building
grid and the city's published control points, solves the coordinate
transformation that ties them together, and lets you import, visualize, convert,
and export survey points in a 3D scene over real terrain.

## The problem it solves

On a construction site, several coordinate worlds collide:

- The architect designs in a **building grid** — lettered and numbered gridlines
  with offsets, anchored to nothing in the real world.
- The city publishes **control points** in a projected system (northing/easting).
- The survey crew measures **new points** in the field and needs them in
  coordinates the machine and the drawings agree on.

SiteLens is the bridge. It computes the tie between the building grid and
real-world coordinates, then keeps every point consistent across all systems.

## The workflow

1. **Create a project** for the site and choose its coordinate reference system
   and display units.
2. **Define the building grid** and **enter the city control points**.
3. **Solve the transform** — SiteLens fits the grid onto the control points and
   reports the residuals so you can judge the tie.
4. **Import surveyed points** from your machine's CSV or LandXML export.
5. **Visualize** everything in 3D over terrain, with the architect's DXF drawing
   overlaid and points organized by category.
6. **Convert and export** coordinates between systems and units as needed.

## Core principles

- **Your elevations are the source of truth.** Terrain is a visual backdrop, not
  survey-grade data.
- **Everything is stored in meters internally.** Units are converted only when
  you import, view, or export — and feet are always labeled.
- **Precision math is deliberate.** The transform and projections run in a Rust
  geo-core, not in the browser.

Continue to [Getting Started](/docs/getting-started) to set up your first project.
