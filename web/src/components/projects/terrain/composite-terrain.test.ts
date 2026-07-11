import { describe, expect, it } from 'vitest';

import type { Frame } from '../terrain-frame';

import { buildCompositeGeometry } from './composite-terrain';

const FRAME: Frame = {
  lat0: 40,
  lon0: -74,
  mPerLat: 111_320,
  mPerLon: 111_320 * Math.cos((40 * Math.PI) / 180),
};

type V = [number, number, number];

/** Builds a CTER blob, mirroring `serialize_composite`. `alpha` is per-vertex 0..1. */
function cter(verts: V[], coarse: V[], detail: V[], alpha?: number[]): ArrayBuffer {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  }
  const q = (v: number, mn: number, mx: number) =>
    mx <= mn ? 0 : Math.round(((v - mn) / (mx - mn)) * 65535);
  const buf = new ArrayBuffer(68 + verts.length * 7 + (coarse.length + detail.length) * 12);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(i, 'CTER'.charCodeAt(i));
  }
  dv.setUint32(4, 1, true);
  dv.setUint32(8, verts.length, true);
  dv.setUint32(12, coarse.length, true);
  dv.setUint32(16, detail.length, true);
  [min[0], min[1], min[2], max[0], max[1], max[2]].forEach((v, i) =>
    dv.setFloat64(20 + i * 8, v, true),
  );
  let off = 68;
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      dv.setUint16(off, q(v[k], min[k], max[k]), true);
      off += 2;
    }
  }
  for (let i = 0; i < verts.length; i++) {
    dv.setUint8(off, Math.round((alpha?.[i] ?? 1) * 255));
    off += 1;
  }
  for (const t of [...coarse, ...detail]) {
    for (const i of t) {
      dv.setUint32(off, i, true);
      off += 4;
    }
  }
  return buf;
}

describe('buildCompositeGeometry', () => {
  const verts: V[] = [
    [40, -74, 10],
    [40.02, -74, 10],
    [40.02, -73.98, 12],
    [40, -73.98, 12],
    [40.01, -73.99, 12],
  ];
  const coarse: V[] = [[0, 1, 4]];
  const detail: V[] = [
    [1, 2, 4],
    [2, 3, 4],
  ];

  it('splits coarse + detail regions sharing one position buffer', () => {
    const g = buildCompositeGeometry(cter(verts, coarse, detail, [1, 0.5, 0, 0, 1]), FRAME)!;
    expect(g).not.toBeNull();
    expect(g.coarse.getIndex()!.count).toBe(3); // 1 tri
    expect(g.detail.getIndex()!.count).toBe(6); // 2 tris
    expect(g.coarse.attributes.position.count).toBe(5);
    // Watertight: both regions reference the SAME position + normal buffers.
    expect(g.detail.attributes.position).toBe(g.coarse.attributes.position);
    expect(g.detail.attributes.normal).toBe(g.coarse.attributes.normal);
    expect(g.coarse.attributes.normal.count).toBe(5);

    // Fade: RGBA color attribute (shared), alpha read from the blob's per-vertex u8.
    const col = g.coarse.attributes.color;
    expect(col.itemSize).toBe(4);
    expect(g.detail.attributes.color).toBe(col);
    const alpha = (i: number) => (col.array as Float32Array)[i * 4 + 3];
    expect(alpha(0)).toBeGreaterThan(0.99); // alpha 1.0 → opaque
    expect(alpha(2)).toBeLessThan(0.01); // alpha 0.0 → transparent
  });

  it('rejects a bad magic / version', () => {
    expect(buildCompositeGeometry(new ArrayBuffer(128), FRAME)).toBeNull();
    const bad = cter(verts, coarse, detail);
    new DataView(bad).setUint32(4, 9, true);
    expect(buildCompositeGeometry(bad, FRAME)).toBeNull();
  });
});
