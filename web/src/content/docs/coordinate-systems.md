# Coordinate Systems

SiteLens moves coordinates between several distinct spaces. Understanding them is
the key to using the tool correctly.

## Building grid

The architect's coordinate space: lettered axes (A, B, C...) crossing numbered
axes (1, 2, 3...), with offsets measured from the gridlines. It has no inherent
relationship to the real world until you tie it to control points.

## Projected (northing / easting)

The real-world planar system the city publishes control in — almost always a
**State Plane** or **UTM** zone, identified by an EPSG code. Coordinates are a
northing (Y) and easting (X) in the project's units.

## Geographic (latitude / longitude)

Angular coordinates on the ellipsoid (WGS84). SiteLens converts to and from
geographic so it can place the site on terrain and so you can cross-check against
mapping tools.

## Grid vs. ground

This distinction trips up many crews. Published northing/easting are **grid**
coordinates — they live on a projection that slightly distorts distance. The tape
or total-station distances you measure on site are **ground** distances. The
**combined scale factor** relates the two.

SiteLens tracks the combined scale factor per project and lets you view or export
coordinates as either grid or ground. Always know which one a number is.

## Units

| Unit               | Definition            | Typical use                                         |
| ------------------ | --------------------- | --------------------------------------------------- |
| Meter              | SI base unit          | Most of the world; SiteLens internal canonical unit |
| US survey foot     | 1200 / 3937 m (exact) | US legacy / State Plane datasheets                  |
| International foot | 0.3048 m (exact)      | Newer US work and elsewhere                         |

Internally every coordinate is stored in meters. Conversion happens only at the
edges — import, display, export — and the unit is always shown.

Next: [Grid & Control Points](/docs/grid-and-control-points).
