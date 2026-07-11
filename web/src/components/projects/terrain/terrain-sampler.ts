/**
 * Decodes the server's **SAMP** draping heightfield into a bilinear elevation
 * sampler — `(lat, lon) => meters | null`. Replaces the client-side GeoTIFF
 * decode for draping points / grid lines / buildings onto the ground (detail
 * elevation inside the property boundary, coarse outside — already baked in by
 * the server). Layout: `api/src/surface/mod.rs`.
 */

const SAMP_NODATA = 0xffff;

export type SampleFn = (lat: number, lon: number) => number | null;

/** A decoded draping sampler: the bilinear `sample` plus the grid's geographic
 *  extent (so callers can derive a local cull radius, e.g. for buildings). */
export interface TerrainSampler {
  maxLat: number;
  maxLon: number;
  minLat: number;
  minLon: number;
  sample: SampleFn;
}

/** Builds a sampler from a SAMP blob; returns null for an empty/invalid blob. */
export function buildSampler(buf: ArrayBuffer): TerrainSampler | null {
  if (buf.byteLength < 64) {
    return null;
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SAMP' || dv.getUint32(4, true) !== 1) {
    return null;
  }
  const w = dv.getUint32(8, true);
  const h = dv.getUint32(12, true);
  if (w < 2 || h < 2) {
    return null;
  }
  const minH = dv.getFloat64(16, true);
  const maxH = dv.getFloat64(24, true);
  const minLat = dv.getFloat64(32, true);
  const minLon = dv.getFloat64(40, true);
  const maxLat = dv.getFloat64(48, true);
  const maxLon = dv.getFloat64(56, true);
  const base = 64;

  const deq = (q: number) => (maxH <= minH ? minH : minH + (q / 65534) * (maxH - minH));
  const nodeAt = (r: number, c: number): number | null => {
    const q = dv.getUint16(base + (r * w + c) * 2, true);
    return q === SAMP_NODATA ? null : deq(q);
  };

  const sample: SampleFn = (lat: number, lon: number): number | null => {
    if (maxLon <= minLon || maxLat <= minLat) {
      return null;
    }
    const cf = ((lon - minLon) / (maxLon - minLon)) * (w - 1);
    const rf = ((maxLat - lat) / (maxLat - minLat)) * (h - 1); // row 0 = north
    if (cf < 0 || rf < 0 || cf > w - 1 || rf > h - 1) {
      return null;
    }
    const c0 = Math.floor(cf);
    const r0 = Math.floor(rf);
    const c1 = Math.min(c0 + 1, w - 1);
    const r1 = Math.min(r0 + 1, h - 1);
    const fx = cf - c0;
    const fy = rf - r0;
    const v00 = nodeAt(r0, c0);
    const v01 = nodeAt(r0, c1);
    const v10 = nodeAt(r1, c0);
    const v11 = nodeAt(r1, c1);
    if (v00 === null || v01 === null || v10 === null || v11 === null) {
      return null; // nodata corner → let the caller fall back
    }
    const top = v00 + (v01 - v00) * fx;
    const bot = v10 + (v11 - v10) * fx;
    return top + (bot - top) * fy;
  };

  return { maxLat, maxLon, minLat, minLon, sample };
}
