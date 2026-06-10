// Pure terrain/DEM helpers shared by the 3D viewer. Kept framework-free so the
// elevation math (used to drape points + grid lines onto the surface) is unit-
// testable without WebGL or a real GeoTIFF.

/** SRTM/DEM nodata sentinels (e.g. -32768) and absurd values are rejected. */
export function isValidElevation(v: number): boolean {
  return Number.isFinite(v) && v > -1000 && v < 1e6;
}

/** A decoded DEM grid: row-major elevations (row 0 = north edge) + its bbox. */
export interface DemGrid {
  band: ArrayLike<number>;
  east: number;
  height: number;
  /** Fallback used where a sampled cell is nodata. */
  meanHeight: number;
  north: number;
  south: number;
  west: number;
  width: number;
}

/**
 * Bilinear elevation (meters) at a geographic point, or `null` when the point
 * lies outside the grid's bbox. Nodata cells fall back to the grid's mean so a
 * stray hole never produces a spike.
 */
export function sampleElevation(grid: DemGrid, lat: number, lon: number): number | null {
  const { band, east, height: h, meanHeight, north, south, west, width: w } = grid;
  if (lon < west || lon > east || lat < south || lat > north) {
    return null;
  }
  const fx = ((lon - west) / (east - west)) * (w - 1);
  const fy = ((north - lat) / (north - south)) * (h - 1);
  const x0 = Math.floor(fx);
  const x1 = Math.min(x0 + 1, w - 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (xx: number, yy: number) => {
    const v = band[yy * w + xx];
    return isValidElevation(v) ? v : meanHeight;
  };
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bot = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bot * ty;
}

/**
 * The height a feature should sit at when draping onto terrain: a feature's own
 * z always wins; only a zero elevation is replaced by the sampled surface (and
 * only when a sampler is provided).
 */
export function drapedHeight(
  sample: ((lat: number, lon: number) => number | null) | null,
  lat: number,
  lon: number,
  height: number,
): number {
  if (sample && height === 0) {
    return sample(lat, lon) ?? height;
  }
  return height;
}
