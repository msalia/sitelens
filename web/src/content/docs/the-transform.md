# The Transform

The transform is the heart of SiteLens: it computes the relationship between your
building grid and real-world projected coordinates.

## What it solves

SiteLens fits a **4-parameter Helmert (similarity) transform**:

- **Translation** — a shift in easting and northing.
- **Rotation** — how the grid is rotated relative to the projection.
- **Scale** — a single uniform scale factor.

This is the right model for tying a rigid building grid to ground control: it
moves, rotates, and scales the grid as a whole without distorting its shape.

## Exact vs. least-squares

- With **two** control points, the four parameters are solved exactly.
- With **three or more**, the system is over-determined and SiteLens fits the
  parameters by **least squares** — the best compromise across all points.

## Reading the residuals

After solving, SiteLens shows a **residual** at each control point: how far the
fitted grid lands from the published coordinate, in easting and northing plus a
magnitude. It also reports the overall **RMS error**.

Use these to judge the tie:

- Small, evenly distributed residuals mean a clean fit.
- One large residual usually means a bad control point or a transcription error —
  check that point's coordinates.
- A high RMS across the board can indicate a wrong CRS or grid spacing.

## Scale as a sanity check

The solved scale should be close to 1.0. A scale far from 1 is a red flag — often
a units mismatch between the grid and the control points. SiteLens surfaces the
scale prominently so you can catch this immediately.

Next: [Importing Points](/docs/importing-points).
