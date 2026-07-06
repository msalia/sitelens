# Field Exchange — Real-Device Acceptance Checklist

"Supported" means a file **opens/round-trips in the real collector**, not just that
it conforms to a spec. This checklist is run once on physical devices; each
verified file is then locked as a golden fixture and a decode test is added.

Until a format's row is checked here, treat its status as **pending device
verification** (the codecs pass unit/round-trip tests, but haven't been confirmed
on-device).

## How to run each format

For each app below:

1. **Export** — in a project's **Field** tab → *Export to device*, pick the preset,
   keep the default projected-ground / US-survey-foot (or match the device job),
   and download.
2. **Load on device** — transfer the file to the collector and import it into the
   field app. Confirm points land at the right coordinates with labels + codes.
3. **Export back** — collect/copy a few points in the app and export a file in the
   same format.
4. **Import** — in *Import as-built*, upload that file, auto-detect the format,
   pick the baseline, and confirm the comparison matches by number with sane
   deltas.
5. **Lock the fixture** — save the exact device-produced file to
   `api/tests/fixtures/field/<app>-<format>.<ext>` and add a decode test in
   `api/src/field/<codec>.rs` (or an integration test) asserting the parsed points.
6. Tick the row + set its status to **Supported**.

## Status

| App | Format | Export opens on device | Import round-trips | Golden fixture locked | Status |
| --- | --- | :---: | :---: | :---: | --- |
| Trimble Access | JobXML `.jxl` | ☐ | ☐ | ☐ | Pending |
| Trimble Access | CSV (P,E,N,Z,Code) | ☐ | ☐ | ☐ | Pending |
| Carlson / MicroSurvey | PNEZD CSV | ☐ | ☐ | ☐ | Pending |
| Carlson / MicroSurvey | LandXML | ☐ | ☐ | ☐ | Pending |
| Topcon / Sokkia Magnet | PNEZD CSV | ☐ | ☐ | ☐ | Pending |

## Notes to capture during the pass

- Exact column order / delimiter / header each app actually expects (adjust the
  preset in `api/src/field/preset.rs` if a device disagrees).
- JobXML: confirm Trimble Access reads `JOBFile > Reductions > Point > Grid`
  (North/East/Elevation) and the Name/Code fields; note any required
  `<Environment>` unit metadata.
- Whether the device wrote coordinates in grid or ground, and the unit — this sets
  the correct import space/unit defaults to document.
