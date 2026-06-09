# Importing Points

Field data comes from your survey machine as an export file. SiteLens imports
those points and stores them in the project's canonical coordinates.

## Supported formats

- **CSV** — the universal total-station / GNSS export. Column order varies by
  brand, so SiteLens lets you map columns on import.
- **LandXML** — a richer XML format that can carry points and metadata.

## CSV column mapping

When you upload a CSV, SiteLens previews the rows and asks you to map each column
to a field:

- **Point number / name**
- **Northing**
- **Easting**
- **Elevation**
- **Description**

You also pick the **unit** of the file (US survey foot, international foot, or
meter). SiteLens converts to meters on the way in.

Save the mapping as an **import profile** so the next export from the same machine
imports in one click.

## Import batches

Every import is recorded as a **batch** — the source filename, format, and row
count — so you can trace where any point came from and re-import cleanly.

## Safety

Uploads are parsed with size and time limits to guard against malformed or
oversized files. Files are stored separately from the database.

Next: [3D Visualization](/docs/visualization).
