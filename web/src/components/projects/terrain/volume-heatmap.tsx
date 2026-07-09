'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

/** Lift (m) so the heatmap floats just above the base surface (no z-fighting). */
const LIFT = 0.03;

const CUT: [number, number, number] = [0.86, 0.15, 0.15]; // red — material removed
const FILL: [number, number, number] = [0.15, 0.4, 0.86]; // blue — material added
const NEUTRAL: [number, number, number] = [0.96, 0.96, 0.96];

/** Diverging cut→fill color for a signed Δz, normalized by `scale` (max |Δz|). */
function divergingColor(dz: number, scale: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, scale > 0 ? dz / scale : 0));
  const end = t < 0 ? CUT : FILL;
  const k = Math.abs(t);
  return [
    NEUTRAL[0] + (end[0] - NEUTRAL[0]) * k,
    NEUTRAL[1] + (end[1] - NEUTRAL[1]) * k,
    NEUTRAL[2] + (end[2] - NEUTRAL[2]) * k,
  ];
}

/** The Δz range + cell size from an SVOL blob header, for the legend. */
export interface HeatmapRange {
  cellSize: number;
  maxDz: number;
  minDz: number;
}

/** Reads just the SVOL header (Δz range + cell size), for a legend without
 *  decoding every cell. Returns null for an empty/invalid blob. */
export function readHeatmapRange(contentBase64: string): HeatmapRange | null {
  try {
    const bin = atob(contentBase64);
    if (bin.length < 36) {
      return null;
    }
    const bytes = new Uint8Array(36);
    for (let i = 0; i < 36; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    const dv = new DataView(bytes.buffer);
    if (
      String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SVOL'
    ) {
      return null;
    }
    return {
      cellSize: dv.getFloat64(8, true),
      maxDz: dv.getFloat64(24, true),
      minDz: dv.getFloat64(16, true),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes the server's SVOL heatmap blob into a colored quad grid. Each cell is a
 * `cell_size` square placed at its geographic center + base elevation (via the
 * shared {@link toLocal}), colored by signed Δz (red cut → blue fill).
 * Layout (little-endian): see `api/src/surface/mod.rs`.
 */
function buildHeatmapGeometry(buf: ArrayBuffer, frame: Frame): THREE.BufferGeometry | null {
  if (buf.byteLength < 36) {
    return null;
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SVOL') {
    return null;
  }
  const cellSize = dv.getFloat64(8, true);
  const minDz = dv.getFloat64(16, true);
  const maxDz = dv.getFloat64(24, true);
  const count = dv.getUint32(32, true);
  if (count === 0) {
    return null;
  }
  const scale = Math.max(Math.abs(minDz), Math.abs(maxDz)) || 1;
  const half = cellSize / 2;

  const positions = new Float32Array(count * 4 * 3);
  const colors = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  let off = 36;
  for (let c = 0; c < count; c++) {
    const lat = dv.getFloat64(off, true);
    const lon = dv.getFloat64(off + 8, true);
    const baseZ = dv.getFloat64(off + 16, true);
    const dz = dv.getFloat64(off + 24, true);
    off += 32;
    const [x, y, z] = toLocal(frame, lat, lon, baseZ + LIFT);
    // Four corners of the cell (axis-aligned in the local ENU frame).
    const corners = [
      [x - half, y, z - half],
      [x + half, y, z - half],
      [x + half, y, z + half],
      [x - half, y, z + half],
    ];
    const [r, g, b] = divergingColor(dz, scale);
    const v0 = c * 4;
    for (let k = 0; k < 4; k++) {
      const p = (v0 + k) * 3;
      positions[p] = corners[k][0];
      positions[p + 1] = corners[k][1];
      positions[p + 2] = corners[k][2];
      colors[p] = r;
      colors[p + 1] = g;
      colors[p + 2] = b;
    }
    const i0 = c * 6;
    indices[i0] = v0;
    indices[i0 + 1] = v0 + 1;
    indices[i0 + 2] = v0 + 2;
    indices[i0 + 3] = v0;
    indices[i0 + 4] = v0 + 2;
    indices[i0 + 5] = v0 + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Renders a volume's cut/fill heatmap as a colored quad grid over the base surface. */
export function VolumeHeatmap({
  contentBase64,
  frame,
  visible = true,
}: {
  contentBase64: string | null;
  frame: Frame;
  visible?: boolean;
}) {
  const geometry = useMemo(() => {
    if (!contentBase64) {
      return null;
    }
    try {
      const bin = atob(contentBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return buildHeatmapGeometry(bytes.buffer, frame);
    } catch {
      return null;
    }
  }, [contentBase64, frame]);

  if (!visible || !geometry) {
    return null;
  }
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={1}
        metalness={0}
        transparent
        opacity={0.92}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
