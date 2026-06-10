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

For ad-hoc work not tied to a stored point, the standalone converter (the
**Converter** tab) takes a coordinate in any input space and returns all the
others at once. Pick the input space:

- **Projected (grid)** — easting/northing in the chosen unit.
- **Building grid** — grid X/Y in the chosen unit.
- **Geographic (lat/long)** — longitude/latitude in degrees (the unit selector is
  ignored). The defaults shown are your project's own site origin.

It returns the building grid, projected grid/ground, and latitude/longitude
together — useful for a quick check against a datasheet or a stakeout value, or
to find where a known lat/long lands on the site.

## Exporting

From the survey-points panel, export your current selection, the active category
filter, or every point to:

- **CSV** — choose the coordinate space (projected grid/ground, building grid, or
  lat/long), the unit, and exactly which columns to include — point, northing,
  easting, elevation, description, latitude, longitude.
- **LandXML** — for richer round-tripping with other survey tools.

Because conversions are exact and round-trip cleanly, you can export in whatever
system the next tool in your pipeline expects.

Next: [3D Visualization](/docs/visualization).
