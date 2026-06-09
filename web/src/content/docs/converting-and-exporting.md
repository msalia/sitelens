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
coordinate in any system and unit and returns all the others, with copy buttons.
Useful for a quick check against a datasheet or a stakeout value.

## Exporting

Export a selection, a group, or a whole category to:

- **CSV** — choose the target system, unit, and column order, including common
  presets like PNEZD that match survey machines.
- **LandXML** — for richer round-tripping.
- **Image snapshot** — a PNG/PDF of the 3D view for reports.

Because conversions are exact and round-trip cleanly, you can export in whatever
system the next tool in your pipeline expects.

Next: [Architecture](/docs/architecture).
