'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

/** Lift (m) so the heatmap floats just above the base surface (no z-fighting). */
const LIFT = 0.03;

const CUT: [number, number, number] = [0.86, 0.15, 0.15]; // red — material removed
const FILL: [number, number, number] = [0.15, 0.4, 0.86]; // blue — material added
const NEUTRAL: [number, number, number] = [0.96, 0.96, 0.96];

// Alpha ramp for the "boolean" overlay: |Δz|/range below MIN_FRAC is fully
// transparent (terrain shows through); it reaches MAX_ALPHA by FULL_FRAC.
const MIN_FRAC = 0.06;
const FULL_FRAC = 0.35;
const MAX_ALPHA = 0.9;

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
export function readHeatmapRange(buffer: ArrayBuffer): HeatmapRange | null {
  try {
    if (buffer.byteLength < 24) {
      return null;
    }
    const dv = new DataView(buffer, 0, 24);
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
function buildHeatmapGeometry(
  buf: ArrayBuffer,
  frame: Frame,
  graded: boolean,
): THREE.BufferGeometry | null {
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
  // RGBA: alpha fades out near-zero Δz so only the actual cut/fill regions paint
  // over the terrain (a "boolean" overlay) — untouched ground shows through.
  const colors = new Float32Array(vCount * 4);
  let off = 32;
  for (let i = 0; i < vCount; i++) {
    const lat = dv.getFloat64(off, true);
    const lon = dv.getFloat64(off + 8, true);
    const h = dv.getFloat64(off + 16, true);
    const dz = dv.getFloat64(off + 24, true);
    off += 32;
    // `graded` lifts each vertex by Δz to the finished (post-earthwork) grade, so
    // the mesh shows what the cut/fill would actually look like on the ground.
    const [x, y, z] = toLocal(frame, lat, lon, h + (graded ? dz : 0) + LIFT);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const [r, g, b] = divergingColor(dz, scale);
    // |Δz| as a fraction of the range → transparent below MIN_FRAC, ramping to
    // MAX_ALPHA by FULL_FRAC. Graded mode stays fully opaque (it's a solid grade).
    const m = scale > 0 ? Math.abs(dz) / scale : 0;
    const a = graded
      ? 0.95
      : Math.min(MAX_ALPHA, Math.max(0, (m - MIN_FRAC) / (FULL_FRAC - MIN_FRAC)) * MAX_ALPHA);
    colors[i * 4] = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = a;
  }

  const indices = new Uint32Array(tCount * 3);
  for (let i = 0; i < tCount * 3; i++) {
    indices[i] = dv.getUint32(off, true);
    off += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Renders a volume's cut/fill heatmap over the base surface. With `graded`, each
 *  vertex is lifted to the finished grade (base + Δz) so it reads as the shaped
 *  ground; otherwise it drapes on the base surface as a flat-position heatmap. */
export function VolumeHeatmap({
  buffer,
  frame,
  graded = false,
}: {
  buffer: ArrayBuffer | null;
  frame: Frame;
  graded?: boolean;
}) {
  const geometry = useMemo(() => {
    if (!buffer) {
      return null;
    }
    try {
      return buildHeatmapGeometry(buffer, frame, graded);
    } catch {
      return null;
    }
  }, [buffer, frame, graded]);

  if (!geometry) {
    return null;
  }
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={1}
        metalness={0}
        transparent
        opacity={1}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
