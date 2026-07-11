import { describe, expect, it } from 'vitest';

import type { Frame } from '../terrain-frame';

import { buildSurfaceGeometry } from './surface-mesh';

const FRAME: Frame = {
  lat0: 40,
  lon0: -74,
  mPerLat: 111_320,
  mPerLon: 111_320 * Math.cos((40 * Math.PI) / 180),
};

type V = [number, number, number];

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

function header(dv: DataView, verts: V[], tris: V[], version: number): void {
  for (let i = 0; i < 4; i++) {
    dv.setUint8(i, 'STIN'.charCodeAt(i));
  }
  dv.setUint32(4, version, true);
  dv.setUint32(8, verts.length, true);
  dv.setUint32(12, tris.length, true);
  const { max, min } = bbox(verts);
  [min[0], min[1], min[2], max[0], max[1], max[2]].forEach((v, i) =>
    dv.setFloat64(16 + i * 8, v, true),
  );
}

/** Builds a v2 (u16-quantized) STIN blob, mirroring `serialize_mesh`. */
function stinV2(verts: V[], tris: V[]): ArrayBuffer {
  const { max, min } = bbox(verts);
  const q = (v: number, mn: number, mx: number) =>
    mx <= mn ? 0 : Math.round(((v - mn) / (mx - mn)) * 65535);
  const buf = new ArrayBuffer(64 + verts.length * 6 + tris.length * 12);
  const dv = new DataView(buf);
  header(dv, verts, tris, 2);
  let off = 64;
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      dv.setUint16(off, q(v[k], min[k], max[k]), true);
      off += 2;
    }
  }
  for (const t of tris) {
    for (const i of t) {
      dv.setUint32(off, i, true);
      off += 4;
    }
  }
  return buf;
}

/** Builds a legacy v1 (f64) STIN blob. */
function stinV1(verts: V[], tris: V[]): ArrayBuffer {
  const buf = new ArrayBuffer(64 + verts.length * 24 + tris.length * 12);
  const dv = new DataView(buf);
  header(dv, verts, tris, 1);
  let off = 64;
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      dv.setFloat64(off, v[k], true);
      off += 8;
    }
  }
  for (const t of tris) {
    for (const i of t) {
      dv.setUint32(off, i, true);
      off += 4;
    }
  }
  return buf;
}

describe('buildSurfaceGeometry', () => {
  const verts: V[] = [
    [40, -74, 10],
    [40.01, -74, 20],
    [40, -74.01, 30],
  ];
  const tris: V[] = [[0, 1, 2]];

  it('decodes a v2 (quantized) blob into an indexed geometry', () => {
    const geo = buildSurfaceGeometry(stinV2(verts, tris), FRAME);
    expect(geo).not.toBeNull();
    expect(geo!.vertexCount).toBe(3);
    expect(geo!.triangleCount).toBe(1);
    expect(geo!.minH).toBe(10);
    expect(geo!.maxH).toBe(30);
    expect(geo!.geometry.attributes.position.array).toHaveLength(9);
    expect(Array.from(geo!.geometry.index!.array as Uint32Array)).toEqual([0, 1, 2]);
  });

  it('still decodes a legacy v1 (f64) blob', () => {
    const geo = buildSurfaceGeometry(stinV1(verts, tris), FRAME);
    expect(geo).not.toBeNull();
    expect(geo!.vertexCount).toBe(3);
    expect(Array.from(geo!.geometry.index!.array as Uint32Array)).toEqual([0, 1, 2]);
  });

  it('v2 dequantization keeps bbox endpoints exact', () => {
    // Vertex 0 is at min-lat / max-lon(-74) / min-h → each axis is an endpoint,
    // so it dequantizes exactly to the same local position under both versions.
    const v2 = buildSurfaceGeometry(stinV2(verts, tris), FRAME)!;
    const v1 = buildSurfaceGeometry(stinV1(verts, tris), FRAME)!;
    const p2 = v2.geometry.attributes.position.array;
    const p1 = v1.geometry.attributes.position.array;
    for (let k = 0; k < 3; k++) {
      expect(p2[k]).toBeCloseTo(p1[k], 6);
    }
  });

  it('rejects a bad magic and an unknown version', () => {
    expect(buildSurfaceGeometry(new ArrayBuffer(128), FRAME)).toBeNull(); // zeroed magic
    const bad = stinV2(verts, tris);
    new DataView(bad).setUint32(4, 99, true); // unknown version
    expect(buildSurfaceGeometry(bad, FRAME)).toBeNull();
  });
});
