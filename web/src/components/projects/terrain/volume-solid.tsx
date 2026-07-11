'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

/**
 * Renders the server-built **earthwork solid** (ESOL blob): the cut/fill mass
 * clipped exactly to the design footprint, with straight edges + vertical walls,
 * coloured red (cut) / blue (fill). The clipping + colouring are done server-side
 * (authoritative), so the client just decodes and draws. Blob layout: see
 * `api/src/surface/mod.rs` — `ESOL` magic, version u32, vCount u32, tCount u32,
 * bbox (6 × f64), then vCount × (lat, lon, z as 3 × u16 quantized + r, g, b as
 * 3 × u8), then tCount × 3 u32.
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
    if (buf.byteLength < 64) {
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
    if (dv.getUint32(4, true) !== 1) {
      return null;
    }
    const vCount = dv.getUint32(8, true);
    const tCount = dv.getUint32(12, true);
    if (vCount === 0 || tCount === 0) {
      return null;
    }
    // bbox [min_lat, min_lon, min_z, max_lat, max_lon, max_z] (6 × f64 from offset 16).
    const minLat = dv.getFloat64(16, true);
    const minLon = dv.getFloat64(24, true);
    const minZ = dv.getFloat64(32, true);
    const maxLat = dv.getFloat64(40, true);
    const maxLon = dv.getFloat64(48, true);
    const maxZ = dv.getFloat64(56, true);
    const dq = (q: number, mn: number, mx: number) =>
      mx <= mn ? mn : mn + (q / 65535) * (mx - mn);
    const positions = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    let off = 64;
    for (let i = 0; i < vCount; i++) {
      const lat = dq(dv.getUint16(off, true), minLat, maxLat);
      const lon = dq(dv.getUint16(off + 2, true), minLon, maxLon);
      const z = dq(dv.getUint16(off + 4, true), minZ, maxZ);
      const r = dv.getUint8(off + 6) / 255;
      const g = dv.getUint8(off + 7) / 255;
      const b = dv.getUint8(off + 8) / 255;
      off += 9;
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
