import { fromArrayBuffer } from 'geotiff';

/** Cap the sampled grid so a huge DEM stays a manageable mesh (~this² cells). */
export const MAX_GRID = 160;

/** A DEM grid parsed client-side, ready for `buildDemSurface`. */
export interface ParsedDem {
  /** Raw file bytes (base64) — stored for re-download / GeoTIFF export. */
  contentBase64: string;
  epsg: number;
  height: number;
  nodata: number | null;
  originE: number;
  originN: number;
  pixelX: number;
  pixelY: number;
  valuesBase64: string;
  width: number;
}

/** Base64-encodes bytes in chunks (avoids arg-count limits on large buffers). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Decodes a base64 string to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Parses GeoTIFF bytes into a downsampled elevation grid with its CRS + transform.
 * Pass `contentBase64` when you already have it (e.g. the terrain query result) to
 * skip re-encoding; otherwise it's computed from the buffer.
 */
export async function parseDemArrayBuffer(
  buf: ArrayBuffer,
  contentBase64?: string,
): Promise<ParsedDem> {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();

  const keys = (image.getGeoKeys?.() ?? {}) as {
    GeographicTypeGeoKey?: number;
    ProjectedCSTypeGeoKey?: number;
  };
  const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 0;
  if (!epsg) {
    throw new Error('The GeoTIFF has no CRS (EPSG) — cannot georeference it.');
  }

  // Downsample to at most MAX_GRID on the long axis, preserving aspect.
  const scale = Math.min(1, MAX_GRID / Math.max(w, h));
  const rw = Math.max(2, Math.round(w * scale));
  const rh = Math.max(2, Math.round(h * scale));
  const rasters = await image.readRasters({ height: rh, samples: [0], width: rw });
  const band = (rasters as unknown as ArrayLike<number>[])[0];
  const values = Float32Array.from({ length: rw * rh }, (_, i) => band[i]);

  const nodata = image.getGDALNoData?.() ?? null;
  return {
    contentBase64: contentBase64 ?? bytesToBase64(new Uint8Array(buf)),
    epsg,
    height: rh,
    nodata,
    // Node spacing spans the bbox across (n-1) intervals so the edges line up.
    originE: west,
    originN: north,
    pixelX: (east - west) / (rw - 1),
    pixelY: (north - south) / (rh - 1),
    valuesBase64: bytesToBase64(new Uint8Array(values.buffer)),
    width: rw,
  };
}

/** The `DemGridInput` args slice of a parsed DEM (everything except content). */
export function demGridArgs(dem: ParsedDem) {
  const { epsg, height, nodata, originE, originN, pixelX, pixelY, valuesBase64, width } = dem;
  return { epsg, height, nodata, originE, originN, pixelX, pixelY, valuesBase64, width };
}
