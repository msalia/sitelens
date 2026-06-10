# Converting & Exporting

Once your points are tied and visualized, SiteLens converts between coordinate
systems and gets data back out to your machine or your team.

## Per-point conversion

Click any point to open its inspector. It shows that point in **every**
representation at once, in the project's units:

- Building grid (axis + offset)
- Projected northing/easting — both grid and ground
- Latitude / longitude
- Elevation

No manual math; the conversions are always live and consistent.

## The standalone converter

For ad-hoc work not tied to a stored point, the standalone converter takes a
coordinate in any system and unit and returns all the others at once. Useful for
a quick check against a datasheet or a stakeout value.

## Exporting

From the survey-points panel, export your current selection, the active category
filter, or every point to:

- **CSV** — choose the coordinate space (projected grid/ground, building grid, or
  lat/long), the unit, and exactly which columns to include — point, northing,
  easting, elevation, description, latitude, longitude.
- **LandXML** — for richer round-tripping with other survey tools.

You can also capture an **image snapshot** — a PNG of the 3D view — from the 3D
panel for reports.

Because conversions are exact and round-trip cleanly, you can export in whatever
system the next tool in your pipeline expects.

Next: [Architecture](/docs/architecture).
