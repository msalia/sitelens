'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

const CUT: [number, number, number] = [0.86, 0.15, 0.15]; // red — material removed
const FILL: [number, number, number] = [0.15, 0.4, 0.86]; // blue — material added
// Below this |Δz|/range the vertex keeps the base ground colour (untouched ground).
const MIN_FRAC = 0.04;

/**
 * Renders the **finished grade** for a selected volume as a solid surface: the
 * volume's base surface (the existing detailed terrain) displaced by Δz to the
 * proposed grade, tinted red (cut) / blue (fill). Built from the detailed base
 * mesh, so the cut/fill reads as a crisp hole/mound actually in the ground — not
 * a floating overlay, and not limited by the coarse render resolution. The
 * terrain is a heightfield, so this is an exact min/max, not a CSG boolean.
 * Numbers stay authoritative; this is the visual only. Blob layout: see
 * `api/src/surface/mod.rs` (mirrors `volume-heatmap.tsx`). Assumes the volume's
 * *base* is the existing surface and *compare* the proposed design (Δz = design −
 * existing).
 */
export function EarthworkTerrain({
  baseColor,
  frame,
  heatmapBase64,
  visible = true,
}: {
  heatmapBase64: string;
  frame: Frame;
  baseColor: string;
  visible?: boolean;
}) {
  const geometry = useMemo(() => {
    let buf: ArrayBuffer;
    try {
      const bin = atob(heatmapBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      buf = bytes.buffer;
    } catch {
      return null;
    }
    if (buf.byteLength < 32) {
      return null;
    }
    const dv = new DataView(buf);
    const magic = String.fromCharCode(
      dv.getUint8(0),
      dv.getUint8(1),
      dv.getUint8(2),
      dv.getUint8(3),
    );
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
    const base = new THREE.Color(baseColor);
    let off = 32;
    for (let i = 0; i < vCount; i++) {
      const lat = dv.getFloat64(off, true);
      const lon = dv.getFloat64(off + 8, true);
      const h = dv.getFloat64(off + 16, true);
      const dz = dv.getFloat64(off + 24, true);
      off += 32;
      // Finished grade = existing (h) + Δz.
      const [x, y, z] = toLocal(frame, lat, lon, h + dz);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const m = Math.abs(dz) / scale;
      if (m <= MIN_FRAC) {
        colors[i * 3] = base.r;
        colors[i * 3 + 1] = base.g;
        colors[i * 3 + 2] = base.b;
      } else {
        const end = dz < 0 ? CUT : FILL;
        const k = Math.min(1, (m - MIN_FRAC) / (1 - MIN_FRAC));
        colors[i * 3] = base.r + (end[0] - base.r) * k;
        colors[i * 3 + 1] = base.g + (end[1] - base.g) * k;
        colors[i * 3 + 2] = base.b + (end[2] - base.b) * k;
      }
    }
    const indices = new Uint32Array(tCount * 3);
    for (let i = 0; i < tCount * 3; i++) {
      indices[i] = dv.getUint32(off, true);
      off += 4;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    return g;
  }, [heatmapBase64, frame, baseColor]);

  if (!geometry) {
    return null;
  }
  return (
    <mesh geometry={geometry} visible={visible}>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}
