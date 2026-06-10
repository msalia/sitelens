# DXF Overlay

Bring the architect's drawing into the 3D scene so survey points sit in the
context of the design.

> **Status:** DXF overlay rendering is being rebuilt for the new 3D engine and is
> temporarily unavailable in the viewer. Uploaded overlays and their
> georeferencing are preserved; this page describes how the feature works and how
> it will behave when it returns.

## DXF, not DWG

SiteLens imports **DXF** — the open, text-based CAD interchange format. It parses
lines, polylines, arcs, text, and layers and renders them as geometry in the
scene.

DWG (Autodesk's closed binary format) is **not** supported directly: there is no
reliable open parser for it. Export your drawing to DXF from your CAD tool first.

## Georeferencing

A DXF lands in the scene one of two ways:

- **Real-world coordinates (default).** Most survey CAD is already drawn in site
  northing/easting, so it drops straight into place.
- **Manual placement.** If the drawing is in arbitrary paper coordinates, adjust
  its **offset, rotation, and scale** with a live preview until it lines up with
  your grid and control points.

The georeference you set is saved with the overlay.

## Working with layers

DXF layers are preserved, so you can toggle the overlay's visibility and keep the
scene readable alongside your survey points.

Next: [Converting & Exporting](/docs/converting-and-exporting).
