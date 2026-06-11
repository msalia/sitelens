# Getting Started

This guide walks through creating a project and configuring it correctly before
you enter any survey data.

## Create a project

A **project** represents one building site. When you create it you set:

- **Name** — usually the site or job name.
- **Coordinate reference system (CRS)** — the projected system your control
  points are published in, selected from the EPSG library. US sites typically use
  a State Plane zone.
- **Display unit** — US survey foot, international foot, or meter. This is how
  coordinates are shown and exported; internally everything is meters.
- **Scale factor** — the combined grid-to-ground scale factor (usually very close
  to 1.0). See [Coordinate Systems](/docs/coordinate-systems) for grid vs. ground.
- **Site origin** — an approximate latitude/longitude so the 3D scene can fetch
  terrain and center the view.
- **Site rotation** — leave at **0** for a properly-tied survey. For an
  assumed-datum survey (a local grid with no real-world tie), it rotates the site
  to true-north orientation about the points' centroid.

You can revisit all of these later: the project's **Edit** dialog changes the same
fields, and the **Georeference** card in the Overlays tab lets you fine-tune the
scale, origin, and rotation, then save to refresh the scene.

## Choosing the right CRS

The CRS must match what the city used to publish your control points. If you pick
the wrong zone, the tie will still solve but every real-world coordinate will be
wrong. When in doubt, confirm the zone on the control datasheet.

## Choosing units

The **US survey foot** and the **international foot** differ by about 2 parts per
million. Over a large site that is enough to matter, so SiteLens keeps them
distinct. Pick the one your jurisdiction and datasheet use — don't assume.

## Invite your team

SiteLens is multi-tenant. Your organization's projects are private to your org.
Within the org, users have a role:

- **Admin** — manages the org, users, and all projects.
- **Surveyor** — full project work: grid, control, imports, transforms, exports.
- **Viewer** — read-only, for sharing a project with a GC or architect.

Next: [Coordinate Systems](/docs/coordinate-systems).
