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

/** The Δz range from an SVOL blob header, for the legend. */
export interface HeatmapRange {
  maxDz: number;
  minDz: number;
}

/** Reads just the SVOL header (Δz range), for a legend without decoding the whole
 *  mesh. Returns null for an empty/invalid blob. */
export function readHeatmapRange(contentBase64: string): HeatmapRange | null {
  try {
    const bin = atob(contentBase64);
    if (bin.length < 24) {
      return null;
    }
    const bytes = new Uint8Array(24);
    for (let i = 0; i < 24; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    const dv = new DataView(bytes.buffer);
    if (
      String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SVOL'
    ) {
      return null;
    }
    return {
      maxDz: dv.getFloat64(16, true),
      minDz: dv.getFloat64(8, true),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes the server's SVOL heatmap blob (the base surface mesh + a per-vertex
 * Δz) into a colored `BufferGeometry`. Because it *is* the surface mesh, it
 * follows the surface outline exactly and shades smoothly (red cut → blue fill),
 * lifted slightly so it reads over the surface. Layout: see `api/src/surface/mod.rs`.
 */
function buildHeatmapGeometry(buf: ArrayBuffer, frame: Frame): THREE.BufferGeometry | null {
  if (buf.byteLength < 32) {
    return null;
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SVOL') {
    return null;
  }
  const minDz = dv.getFloat64(8, true);
  const maxDz = dv.getFloat64(16, true);
  const vCount = dv.getUint32(24, true);
  const tCount = dv.getUint32(28, true);
  if (vCount === 0 || tCount === 0) {
    return null;
  }
  const scale = Math.max(Math.abs(minDz), Math.abs(maxDz)) || 1;

  const positions = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  let off = 32;
  for (let i = 0; i < vCount; i++) {
    const lat = dv.getFloat64(off, true);
    const lon = dv.getFloat64(off + 8, true);
    const h = dv.getFloat64(off + 16, true);
    const dz = dv.getFloat64(off + 24, true);
    off += 32;
    const [x, y, z] = toLocal(frame, lat, lon, h + LIFT);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const [r, g, b] = divergingColor(dz, scale);
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
