import { describe, expect, it } from 'vitest';

import { buildSampler } from './terrain-sampler';

/** Builds a SAMP blob mirroring `serialize_sampler`. `heights` row-major, N→S. */
function samp(
  w: number,
  h: number,
  bbox: { maxLat: number; maxLon: number; minLat: number; minLon: number },
  heights: (number | null)[],
): ArrayBuffer {
  const finite = heights.filter((z): z is number => z !== null);
  const minH = Math.min(...finite);
  const maxH = Math.max(...finite);
  const buf = new ArrayBuffer(64 + w * h * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(i, 'SAMP'.charCodeAt(i));
  }
  dv.setUint32(4, 1, true);
  dv.setUint32(8, w, true);
  dv.setUint32(12, h, true);
  dv.setFloat64(16, minH, true);
  dv.setFloat64(24, maxH, true);
  dv.setFloat64(32, bbox.minLat, true);
  dv.setFloat64(40, bbox.minLon, true);
  dv.setFloat64(48, bbox.maxLat, true);
  dv.setFloat64(56, bbox.maxLon, true);
  heights.forEach((z, i) => {
    const q = z === null ? 0xffff : maxH <= minH ? 0 : Math.round(((z - minH) / (maxH - minH)) * 65534);
    dv.setUint16(64 + i * 2, q, true);
  });
  return buf;
}

const BBOX = { maxLat: 41, maxLon: -73, minLat: 40, minLon: -74 };

describe('buildSampler', () => {
  it('bilinear-samples the grid at nodes and midpoints', () => {
    // 2×2 grid; row 0 = north (lat 41), row 1 = south (lat 40).
    // heights: NW=10, NE=20, SW=30, SE=40.
    const s = buildSampler(samp(2, 2, BBOX, [10, 20, 30, 40]))!;
    expect(s).not.toBeNull();
    expect(s(41, -74)!).toBeCloseTo(10, 3); // NW corner
    expect(s(41, -73)!).toBeCloseTo(20, 3); // NE corner
    expect(s(40, -74)!).toBeCloseTo(30, 3); // SW corner
    expect(s(40.5, -73.5)!).toBeCloseTo(25, 3); // centre → mean
  });

  it('returns null outside the grid extent', () => {
    const s = buildSampler(samp(2, 2, BBOX, [10, 20, 30, 40]))!;
    expect(s(42, -73.5)).toBeNull(); // north of extent
    expect(s(40.5, -72)).toBeNull(); // east of extent
  });

  it('returns null over a nodata corner and rejects bad magic', () => {
    const s = buildSampler(samp(2, 2, BBOX, [10, null, 30, 40]))!;
    expect(s(40.5, -73.5)).toBeNull(); // a corner is nodata
    expect(buildSampler(new ArrayBuffer(64))).toBeNull();
  });
});
