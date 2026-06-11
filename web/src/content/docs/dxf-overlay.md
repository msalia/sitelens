# DXF Overlay

Bring the architect's drawing into the 3D scene so survey points sit in the
context of the design. Overlays live in the **Overlays** tab of the project
workspace.

## DXF, not DWG

SiteLens imports **DXF** — the open, text-based CAD interchange format. It parses
lines, polylines, arcs, circles, and layers and renders them as amber linework in
the scene.

DWG (Autodesk's closed binary format) is **not** supported directly: there is no
reliable open parser for it. Export your drawing to DXF from your CAD tool first.
Uploads are limited to **10 MB**.

## Placing the drawing

A DXF carries no map projection, so you position it on the site with four
controls, each saved with the overlay:

- **Offset E / N** — where the drawing's center sits in projected easting/northing.
- **Rotation** — spins the drawing about its own center.
- **Scale** — grows or shrinks the drawing about its center.
- **Elevation** — the flat height (Z) the drawing is drawn at.

Because rotation and scale both pivot about the drawing's center, changing one
never slides the drawing off — the placement controls stay independent.

The quickest start is **Auto-place at site**: it fits the drawing's extent to your
survey points' footprint and centers it on them, so you only fine-tune rotation,
scale, and elevation from there. Auto-place ignores stray geometry (a title block
or a lone point at the file origin) when sizing the drawing, so it keys off the
actual floor plan.

Adjust the sliders (or type exact values), then click **Apply georeference** to
save. The 3D scene refreshes with the new placement.

## Flat reference plane

The drawing renders **flat at its elevation** — it is _not_ draped onto the
terrain surface, so it stays level on the X/Y plane. Use the **Elevation** control
to lift or drop it to any Z: sit a floor plan at the building's floor level, or
raise it above the terrain so it reads clearly as a reference.

## Working with layers

DXF layers are preserved. In the viewer's **Layers** menu you choose which layers
to show — **none are shown by default**, so you opt in only the layers you want
(with a **Select all / none** shortcut). Your selection persists as you work.

Each overlay also has a **Visible** switch to show or hide the whole drawing at
once.

That's the end of the guide — head back to the [docs home](/docs) for anything
you want to revisit.
