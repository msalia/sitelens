'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { type Frame, toLocal } from '../terrain-frame';

/** Coarse + detail geometries decoded from a CTER blob (share position+normal). */
export interface CompositeGeometry {
  coarse: THREE.BufferGeometry;
  detail: THREE.BufferGeometry;
}

/**
 * Decodes the server's **CTER** composite-terrain blob into two geometries that
 * share one position + normal buffer: the coarse (outside-boundary) region and
 * the detail (inside) region, split so the client can toggle detail independently.
 * Normals are computed over the *full* mesh so shading is continuous across the
 * seam. Vertices are geographic (u16-quantized over the header bbox); each is
 * placed into the scene frame with {@link toLocal}. Layout: `api/src/surface/mod.rs`.
 * Returns null for an empty/invalid blob.
 */
export function buildCompositeGeometry(buf: ArrayBuffer, frame: Frame): CompositeGeometry | null {
  if (buf.byteLength < 68) {
    return null;
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'CTER' || dv.getUint32(4, true) !== 1) {
    return null;
  }
  const vCount = dv.getUint32(8, true);
  const cCount = dv.getUint32(12, true);
  const dCount = dv.getUint32(16, true);
  if (vCount === 0 || cCount + dCount === 0) {
    return null;
  }
  const minLat = dv.getFloat64(20, true);
  const minLon = dv.getFloat64(28, true);
  const minH = dv.getFloat64(36, true);
  const maxLat = dv.getFloat64(44, true);
  const maxLon = dv.getFloat64(52, true);
  const maxH = dv.getFloat64(60, true);
  const dq = (q: number, mn: number, mx: number) => (mx <= mn ? mn : mn + (q / 65535) * (mx - mn));

  const positions = new Float32Array(vCount * 3);
  let off = 68;
  for (let i = 0; i < vCount; i++) {
    const lat = dq(dv.getUint16(off, true), minLat, maxLat);
    const lon = dq(dv.getUint16(off + 2, true), minLon, maxLon);
    const h = dq(dv.getUint16(off + 4, true), minH, maxH);
    off += 6;
    const [x, y, z] = toLocal(frame, lat, lon, h);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  // Per-vertex RGBA: white RGB (the material tints it to clay) + the server's
  // boundary-aware fade alpha (u8) — opaque inside the boundary, dissolving across
  // the coarse surround so the context tile has no hard edge.
  const colors = new Float32Array(vCount * 4);
  for (let i = 0; i < vCount; i++) {
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = dv.getUint8(off) / 255;
    off += 1;
  }
  const colorAttr = new THREE.BufferAttribute(colors, 4);

  const readTris = (count: number) => {
    const idx = new Uint32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      idx[i] = dv.getUint32(off, true);
      off += 4;
    }
    return idx;
  };
  const coarseIdx = readTris(cCount);
  const detailIdx = readTris(dCount);

  // Compute normals over the FULL mesh (both regions) for a continuous seam.
  const full = new Uint32Array(coarseIdx.length + detailIdx.length);
  full.set(coarseIdx, 0);
  full.set(detailIdx, coarseIdx.length);
  const base = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  base.setAttribute('position', posAttr);
  base.setIndex(new THREE.BufferAttribute(full, 1));
  base.computeVertexNormals();
  const normalAttr = base.attributes.normal as THREE.BufferAttribute;

  const region = (idx: Uint32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', posAttr); // shared buffers
    g.setAttribute('normal', normalAttr);
    g.setAttribute('color', colorAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  };
  return { coarse: region(coarseIdx), detail: region(detailIdx) };
}

/**
 * Renders the boundary-split composite terrain: coarse context + high-res detail
 * as one seamless ground (flat clay + lighting-driven relief via per-vertex
 * normals). The detail region is a separate mesh so it can be hidden/swapped
 * (cut/fill mode, graded terrain) without touching the coarse backdrop.
 */
export function CompositeTerrain({
  buffer,
  color,
  frame,
  opacity = 1,
  showDetail = true,
  visible = true,
}: {
  buffer: ArrayBuffer;
  frame: Frame;
  color: string;
  /** Master visibility — kept mounted (no re-decode) so toggling is cheap. */
  visible?: boolean;
  /** Hide just the inside-boundary detail region (cut/fill mode / graded swap). */
  showDetail?: boolean;
  opacity?: number;
}) {
  const geo = useMemo(() => buildCompositeGeometry(buffer, frame), [buffer, frame]);

  // Dispose GPU buffers when the geometry is replaced / unmounted.
  useEffect(
    () => () => {
      geo?.coarse.dispose();
      geo?.detail.dispose();
    },
    [geo],
  );

  if (!geo) {
    return null;
  }
  return (
    <>
      <mesh geometry={geo.coarse} visible={visible}>
        <meshStandardMaterial
          color={color}
          vertexColors
          roughness={1}
          metalness={0}
          transparent
          opacity={opacity}
        />
      </mesh>
      <mesh geometry={geo.detail} visible={visible && showDetail}>
        <meshStandardMaterial
          color={color}
          vertexColors
          roughness={1}
          metalness={0}
          transparent
          opacity={opacity}
        />
      </mesh>
    </>
  );
}
