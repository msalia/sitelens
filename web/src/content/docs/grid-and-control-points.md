# Grid & Control Points

These two inputs are what the transform fits together. Enter them carefully —
everything downstream depends on them.

## Defining the building grid

Enter the grid as two families of axes:

- **Lettered axes** running one direction (A, B, C...).
- **Numbered axes** running the other (1, 2, 3...).

Each axis has a position in grid space. A point on the grid is then a pair like
"between A and B" plus offsets, which SiteLens resolves into grid coordinates.

Take the axis spacing directly from the architect's plan. A transcription error
here propagates into every tied coordinate.

## Entering control points

Control points are the city-published monuments with known projected
coordinates. For each one enter:

- **Label** — the monument's name or ID.
- **Northing, Easting** — exactly as published, in the datasheet's units.
- **Elevation** — if published.
- **Source** — a note, e.g. "city datasheet 2024".

You need at least **two** control points to solve a transform. Three or more lets
SiteLens fit by least squares and report how well the points agree.

## A note on accuracy

SiteLens stores what you enter in meters and never silently rounds. Enter the
full published precision. The residuals you get after solving are only as
trustworthy as the coordinates you put in.

Next: [The Transform](/docs/the-transform).
