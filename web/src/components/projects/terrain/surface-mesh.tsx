'use client';

import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

/** A hypsometric elevation ramp (low → high): green → yellow → tan → white. */
const RAMP: [number, [number, number, number]][] = [
  [0.0, [0.153, 0.392, 0.235]],
  [0.25, [0.498, 0.737, 0.255]],
  [0.5, [0.968, 0.968, 0.69]],
  [0.75, [0.722, 0.525, 0.043]],
  [1.0, [0.98, 0.98, 0.98]],
];

/** Samples the ramp at `t` in [0,1] → linear RGB. */
function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const f = (x - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export interface SurfaceGeometry {
  geometry: THREE.BufferGeometry;
  maxH: number;
  /** Elevation range (meters), for a legend / display. */
  minH: number;
  triangleCount: number;
  vertexCount: number;
}

/**
 * Decodes the server's STIN mesh blob into an indexed `BufferGeometry`. The blob
 * carries geographic vertices (lat, lon, height); each is placed into the scene's
 * local ENU frame with {@link toLocal}, so the TIN registers on the point cloud.
 * Layout (little-endian): see `api/src/surface/mod.rs`.
 * Returns null for an empty/invalid blob.
 */
export function buildSurfaceGeometry(buf: ArrayBuffer, frame: Frame): SurfaceGeometry | null {
  if (buf.byteLength < 64) {
    return null;
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'STIN') {
    return null;
  }
  const vCount = dv.getUint32(8, true);
  const tCount = dv.getUint32(12, true);
  if (vCount === 0 || tCount === 0) {
    return null;
  }
  // bbox height range lives at floats [2] (min) and [5] (max) after the header.
  const minH = dv.getFloat64(16 + 16, true);
  const maxH = dv.getFloat64(16 + 40, true);
  const span = maxH - minH || 1;

  const positions = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  let off = 64;
  for (let i = 0; i < vCount; i++) {
    const lat = dv.getFloat64(off, true);
    const lon = dv.getFloat64(off + 8, true);
    const h = dv.getFloat64(off + 16, true);
    off += 24;
    const [x, y, z] = toLocal(frame, lat, lon, h);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const [r, g, b] = ramp((h - minH) / span);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  const indices = new Uint32Array(tCount * 3);
  for (let i = 0; i < tCount * 3; i++) {
    indices[i] = dv.getUint32(off, true);
    off += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return { geometry, maxH, minH, triangleCount: tCount, vertexCount: vCount };
}

/** How the TIN surface is shaded: an elevation color ramp, or a QC wireframe. */
export type SurfaceMode = 'ramp' | 'wireframe';

/** Renders a computed TIN mesh. `ramp` shows the per-vertex hypsometric tint;
 *  `wireframe` shows the triangle edges (surface QC). */
export function SurfaceMesh({
  geometry,
  mode,
}: {
  geometry: THREE.BufferGeometry;
  mode: SurfaceMode;
}) {
  const wire = mode === 'wireframe';
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors={!wire}
        color={wire ? '#64748b' : '#ffffff'}
        wireframe={wire}
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
