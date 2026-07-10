'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

/**
 * Renders the server-built **earthwork solid** (ESOL blob): the cut/fill mass
 * clipped exactly to the design footprint, with straight edges + vertical walls,
 * coloured red (cut) / blue (fill). The clipping + colouring are done server-side
 * (authoritative), so the client just decodes and draws. Blob layout: see
 * `api/src/surface/mod.rs` — `ESOL` magic, vCount u32, tCount u32, then vCount ×
 * (lat, lon, z, r, g, b as f64), then tCount × 3 u32.
 */
export function VolumeSolid({
  frame,
  solidBase64,
  visible = true,
}: {
  solidBase64: string;
  frame: Frame;
  visible?: boolean;
}) {
  const geometry = useMemo(() => {
    let buf: ArrayBuffer;
    try {
      const bin = atob(solidBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      buf = bytes.buffer;
    } catch {
      return null;
    }
    if (buf.byteLength < 12) {
      return null;
    }
    const dv = new DataView(buf);
    const magic = String.fromCharCode(
      dv.getUint8(0),
      dv.getUint8(1),
      dv.getUint8(2),
      dv.getUint8(3),
    );
    if (magic !== 'ESOL') {
      return null;
    }
    const vCount = dv.getUint32(4, true);
    const tCount = dv.getUint32(8, true);
    if (vCount === 0 || tCount === 0) {
      return null;
    }
    const positions = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    let off = 12;
    for (let i = 0; i < vCount; i++) {
      const lat = dv.getFloat64(off, true);
      const lon = dv.getFloat64(off + 8, true);
      const z = dv.getFloat64(off + 16, true);
      const r = dv.getFloat64(off + 24, true);
      const g = dv.getFloat64(off + 32, true);
      const b = dv.getFloat64(off + 40, true);
      off += 48;
      const [x, y, zz] = toLocal(frame, lat, lon, z);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = zz;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
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
  }, [solidBase64, frame]);

  if (!geometry) {
    return null;
  }
  return (
    <mesh geometry={geometry} visible={visible}>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}
