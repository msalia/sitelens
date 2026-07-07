# Utility Records — End-to-End Acceptance Checklist

"Done" means the full **capture → visualize → export** loop works on a real sample
site and the exported files **open in downstream tools** (CAD, GIS), not just that
the codecs pass unit tests. This checklist is run once on the BAPS seed site; each
verified export is then locked as a golden fixture with a decode/round-trip test.

Until a row is checked here, treat that format's on-tool status as **pending
verification** (the codecs pass unit + round-trip tests, but haven't been confirmed
in a downstream tool).

## How to run the pass

Use the BAPS Mandir seed project (it has sample utility runs + structures), on a
Crew plan.

1. **Capture** — in the **Utilities** tab, *New run* (digitize by snapping survey
   points), *New structure*, and *Import* a small DXF or GeoJSON. Confirm each
   lands with the right APWA type, geometry, and attributes.
2. **Visualize** — open the 3D scene, toggle **Utilities** and **Underground
   mode**; confirm buried runs show through the faded terrain and click-to-select
   shows the attribute card.
3. **Inventory** — search + filter by type in the inventory table; confirm
   server-side paging and that the row subtitles (length, diameter, point count)
   are correct.
4. **Export** each format from the inventory (honoring an active filter), then open
   it in a downstream tool.
5. **Archive round-trip** — export the whole project, re-import it, and confirm the
   utilities + as-built comparisons + uploaded DXFs all come back.
6. **Lock the fixture** — save each verified export to
   `api/tests/fixtures/utilities/<format>.<ext>` and add a decode/round-trip test
   in `api/src/utilities/export.rs` (or an integration test).
7. Tick the row + set its status to **Verified**.

## Status

| Step / format | Works on sample site | Opens in downstream tool | Golden fixture locked | Status |
| --- | :---: | :---: | :---: | --- |
| Digitize capture (snap + coord entry) | ☐ | — | — | Pending |
| DXF / GeoJSON import | ☐ | — | — | Pending |
| 3D + underground mode | ☐ | — | — | Pending |
| Export — GeoJSON | ☐ | ☐ (QGIS / ArcGIS) | ☐ | Pending |
| Export — DXF | ☐ | ☐ (AutoCAD / Civil 3D) | ☐ | Pending |
| Export — LandXML | ☐ | ☐ (weak support caveat) | ☐ | Pending |
| Export — PDF schedule | ☐ | ☐ (visual review) | ☐ | Pending |
| Project archive round-trip | ☐ | — | ✅ (integration test) | Automated |

## Notes to capture during the pass

- Whether AutoCAD/Civil 3D reads the DXF layers as the expected APWA layer names,
  and whether structures come in as usable blocks/points.
- Whether GeoJSON validates and the attribute set survives into QGIS/ArcGIS field
  tables.
- Any LandXML consumer that reads the plan-feature/point mapping cleanly, to firm
  up (or further caveat) the weak-support note in the docs.
- Exact coordinate space/unit each downstream tool expected, to confirm the
  export defaults documented in `utilities.md`.
