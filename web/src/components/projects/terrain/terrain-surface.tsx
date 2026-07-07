'use client';

import { useFrame } from '@react-three/fiber';
import { useCallback, useRef } from 'react';
import * as THREE from 'three';

import { expEase } from './lerp';

/** Morphs a terrain mesh between flat (`factor` 0 — every vertex height → 0) and
 *  full DEM relief (`factor` 1), writing both the height and a lerped normal in a
 *  single in-place pass. Normals interpolate between straight-up (flat) and the
 *  precomputed relief normals, so shading stays correct without a per-frame
 *  `computeVertexNormals` (the expensive call we deliberately avoid). */
function applyMorph(
  geo: THREE.BufferGeometry,
  baseY: Float32Array,
  baseN: Float32Array,
  factor: number,
) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const p = pos.array as Float32Array;
  const na = nrm.array as Float32Array;
  const inv = 1 - factor;
  for (let k = 0; k < baseY.length; k++) {
    const i = k * 3;
    p[i + 1] = baseY[k] * factor;
    // Lerp normal: flat → (0,1,0), relief → baseN. Then normalize.
    const nx = baseN[i] * factor;
    const ny = inv + baseN[i + 1] * factor;
    const nz = baseN[i + 2] * factor;
    const len = Math.hypot(nx, ny, nz) || 1;
    na[i] = nx / len;
    na[i + 1] = ny / len;
    na[i + 2] = nz / len;
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}

/** The terrain surface mesh. Beyond the opacity fade (handled by the wrapping
 *  {@link Fade}), it lerps every vertex's height between flat and full relief in
 *  step with its own toggle: `relief` true → grows up to the DEM, false → settles
 *  flat. The morph runs only while transitioning and early-returns once settled,
 *  so it costs nothing at rest. Listens to `relief` alone — the link to other
 *  toggles (e.g. "project onto terrain") is made by driving the toggles together,
 *  not by reading their state here. */
export function TerrainSurface({
  color,
  geometry,
  opacity = 1,
  relief,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  /** Target shape: true → full DEM relief, false → flat plane. */
  relief: boolean;
  /** Steady-state opacity — underground mode drops it so buried utilities show
   *  through. `key`ed onto the material so `Fade` re-captures the new base. */
  opacity?: number;
}) {
  const baseY = useRef<Float32Array | null>(null);
  const baseN = useRef<Float32Array | null>(null);
  const factor = useRef(relief ? 1 : 0);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);

  // Snapshot the pristine heights/normals and apply the initial factor the moment
  // the mesh attaches (ref callbacks run pre-paint) — so terrain that loads while
  // its toggle is off starts flat instead of flashing full relief for one frame.
  // `geometry` identity drives a remount via `key`, so no deps are needed.
  const setMesh = useCallback((mesh: THREE.Mesh | null) => {
    if (!mesh) {
      return;
    }
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const n = pos.count;
    const by = new Float32Array(n);
    const bn = new Float32Array(n * 3);
    const p = pos.array as Float32Array;
    const na = nrm.array as Float32Array;
    for (let k = 0; k < n; k++) {
      by[k] = p[k * 3 + 1];
      bn[k * 3] = na[k * 3];
      bn[k * 3 + 1] = na[k * 3 + 1];
      bn[k * 3 + 2] = na[k * 3 + 2];
    }
    baseY.current = by;
    baseN.current = bn;
    matRef.current = mesh.material as THREE.MeshStandardMaterial;
    applyMorph(geo, by, bn, factor.current);
  }, []);

  useFrame((_, dt) => {
    // Ease the terrain opacity toward its target (underground mode). Owned here,
    // not via a material `key` (which would snap); `Fade` only writes opacity
    // during show/hide transitions, so at rest this lerp controls it.
    const m = matRef.current;
    if (m && Math.abs(m.opacity - opacity) > 0.002) {
      m.transparent = true;
      m.opacity = expEase(m.opacity, opacity, dt, 6);
    }

    const target = relief ? 1 : 0;
    if (factor.current === target || !baseY.current || !baseN.current) {
      return;
    }
    factor.current = expEase(factor.current, target, dt, 9);
    if (Math.abs(target - factor.current) < 0.002) {
      factor.current = target;
    }
    applyMorph(geometry, baseY.current, baseN.current, factor.current);
  });

  return (
    <mesh ref={setMesh} geometry={geometry}>
      {/* No declarative `opacity` — binding it would snap on change; the
          useFrame lerp above eases material.opacity toward the target instead. */}
      <meshStandardMaterial
        color={color}
        vertexColors
        transparent
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
