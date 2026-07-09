# Field Exchange

Field Exchange moves points between SiteLens and your data collector, then checks
what got built against what was designed. It has three parts — **Export to
device**, **Import as-built**, and **Comparisons** — all in the **Field** tab of a
project. It's a Crew feature.

## Supported apps & formats

| App                    | Export                            | Import       |
| ---------------------- | --------------------------------- | ------------ |
| Trimble Access         | Native JobXML (`.jxl`) + CSV      | JobXML, CSV  |
| Carlson / MicroSurvey  | PNEZD CSV + LandXML               | CSV, LandXML |
| Topcon / Sokkia Magnet | PNEZD CSV                         | CSV          |
| Generic / other        | PNEZD CSV (with header) + LandXML | CSV, LandXML |

Files are **natively openable** — no reformatting on the device. Carlson and
MicroSurvey are served by the PNEZD CSV preset and LandXML (both import cleanly);
native Carlson `.crd` is not needed.

## Export to device

1. Open the **Field** tab and the **Export to device** card.
2. Pick your **app / format**. The coordinate **space** and **unit** default to the
   preset's recommendation — **projected-ground** in **US survey feet**, which is
   what a collector expects for stakeout.
3. Optionally limit to one **category**; otherwise all design points export.
4. Click **Download** and copy the file to your collector.

**Per-app notes**

- **Trimble Access** — use the JobXML (`.jxl`) preset for a native job import;
  the CSV preset (P,E,N,Z,Code) also works.
- **Carlson / Topcon** — PNEZD CSV (Point, Northing, Easting, Elevation, Code).
- Points export as **design** points; as-builts you import back are kept separate.

## Getting the file onto the device

Copy the downloaded file to the collector however you normally transfer files
(USB, cloud drive, email to the device), then import it in the field app. SiteLens
is file-based — nothing is synced to a vendor cloud.

## Import as-built & compare

1. In **Import as-built**, choose the field file. The **format is auto-detected**
   (CSV / LandXML / JobXML); for CSV, pick the matching **CSV preset**.
2. Set the **space** and **unit** the file is in (match how the collector wrote
   it), and the **baseline** to compare against — **all** design points or a
   single **category**.
3. Tolerances come from the project defaults (set them in the project, in survey
   units). Click **Import & compare**.

Each as-built is matched to a design point **by point number**. Anything that
doesn't match a number lands in the results as **unmatched** — never snapped by
proximity.

## Reading the results

The results table shows, per point, the miss in the **projected-ground** frame
(ΔN, ΔE, ΔH radial, ΔZ) plus the secondary **building-grid** deltas, and a status
chip:

- **Pass** — within the warn tolerance.
- **Warn** — between warn and fail.
- **Fail** — beyond the fail tolerance.
- **No Z** — horizontal passed but the point had no elevation to check.
- **Unmatched** — no design point with that number. Use the **Pair…** dropdown on
  the row to assign the right design point; the deltas recompute against the
  snapshotted design coordinates.

Filter by status, and view the misses in 3D — each pair draws a status-coloured
leader line from design to as-built in the scene (toggle **As-built comparison**
in the scene's Display menu).

A comparison is a **frozen record**: it snapshots both sides, so a delivered
report reproduces even if the design points are later edited.

## Downloading the stakeout report

From a selected comparison, download the deliverable for the GC:

- **CSV** — point, design and as-built coordinates, deltas, radial, and status.
- **PDF** — a formatted stakeout report with the project header, the tolerance
  spec, summary stats (pass/warn/fail counts, max and RMS miss), and the per-point
  table.

Both are in the comparison's report unit.
