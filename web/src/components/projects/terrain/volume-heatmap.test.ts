import { describe, expect, it } from 'vitest';

import type { Frame } from '../terrain-frame';

import { buildHeatmapGeometry, readHeatmapRange } from './volume-heatmap';

const FRAME: Frame = {
  lat0: 40,
  lon0: -74,
  mPerLat: 111_320,
  mPerLon: 111_320 * Math.cos((40 * Math.PI) / 180),
};

type V = [number, number, number];
const VERTS: V[] = [
  [40, -74, 12.5],
  [40.01, -74.01, 9],
  [40, -74.01, 11],
];
const DZ = [-3, 2.5, 0.5];
const TRIS: V[] = [[0, 1, 2]];
const MIN_DZ = -3;
const MAX_DZ = 2.5;

function bbox(verts: V[]): { max: number[]; min: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  }
  return { max, min };
}

/** Builds a v3 (u16-quantized) SVOL blob, mirroring `serialize_volume_heatmap`. */
function svolV3(): ArrayBuffer {
  const { max, min } = bbox(VERTS);
  const q = (v: number, mn: number, mx: number) =>
    mx <= mn ? 0 : Math.round(((v - mn) / (mx - mn)) * 65535);
  const buf = new ArrayBuffer(80 + VERTS.length * 8 + TRIS.length * 12);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(i, 'SVOL'.charCodeAt(i));
  }
  dv.setUint32(4, 3, true);
  dv.setFloat64(8, MIN_DZ, true);
  dv.setFloat64(16, MAX_DZ, true);
  dv.setUint32(24, VERTS.length, true);
  dv.setUint32(28, TRIS.length, true);
  [min[0], min[1], min[2], max[0], max[1], max[2]].forEach((v, i) =>
    dv.setFloat64(32 + i * 8, v, true),
  );
  let off = 80;
  VERTS.forEach((v, i) => {
    for (let k = 0; k < 3; k++) {
      dv.setUint16(off, q(v[k], min[k], max[k]), true);
      off += 2;
    }
    dv.setUint16(off, q(DZ[i], MIN_DZ, MAX_DZ), true);
    off += 2;
  });
  for (const t of TRIS) {
    for (const i of t) {
      dv.setUint32(off, i, true);
      off += 4;
    }
  }
  return buf;
}

/** Builds a legacy v2 (f64) SVOL blob. */
function svolV2(): ArrayBuffer {
  const buf = new ArrayBuffer(32 + VERTS.length * 32 + TRIS.length * 12);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(i, 'SVOL'.charCodeAt(i));
  }
  dv.setUint32(4, 2, true);
  dv.setFloat64(8, MIN_DZ, true);
  dv.setFloat64(16, MAX_DZ, true);
  dv.setUint32(24, VERTS.length, true);
  dv.setUint32(28, TRIS.length, true);
  let off = 32;
  VERTS.forEach((v, i) => {
    dv.setFloat64(off, v[0], true);
    dv.setFloat64(off + 8, v[1], true);
    dv.setFloat64(off + 16, v[2], true);
    dv.setFloat64(off + 24, DZ[i], true);
    off += 32;
  });
  for (const t of TRIS) {
    for (const i of t) {
      dv.setUint32(off, i, true);
      off += 4;
    }
  }
  return buf;
}

describe('readHeatmapRange', () => {
  it('reads the Δz range from a v3 header', () => {
    expect(readHeatmapRange(svolV3())).toEqual({ maxDz: MAX_DZ, minDz: MIN_DZ });
  });

  it('reads the Δz range from a legacy v2 header', () => {
    expect(readHeatmapRange(svolV2())).toEqual({ maxDz: MAX_DZ, minDz: MIN_DZ });
  });

  it('rejects a short/invalid blob', () => {
    expect(readHeatmapRange(new ArrayBuffer(8))).toBeNull();
  });
});

describe('buildHeatmapGeometry', () => {
  it('decodes v3 (quantized) and v2 (f64) to equivalent geometry', () => {
    const g3 = buildHeatmapGeometry(svolV3(), FRAME, false);
    const g2 = buildHeatmapGeometry(svolV2(), FRAME, false);
    expect(g3).not.toBeNull();
    expect(g2).not.toBeNull();
    expect(g3!.attributes.position.count).toBe(3);
    expect(g3!.getIndex()!.count).toBe(3);
    // v3 dequant matches v2 within a quantization step across positions.
    const p3 = g3!.attributes.position.array as Float32Array;
    const p2 = g2!.attributes.position.array as Float32Array;
    for (let i = 0; i < p2.length; i++) {
      expect(Math.abs(p3[i] - p2[i])).toBeLessThan(0.05);
    }
  });

  it('rejects an unknown version', () => {
    const bad = svolV3();
    new DataView(bad).setUint32(4, 99, true);
    expect(buildHeatmapGeometry(bad, FRAME, false)).toBeNull();
  });
});
