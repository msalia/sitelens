'use client';

import type * as THREE from 'three';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type ComponentProps, type ComponentRef, useRef, useState } from 'react';

import type { Vec3 } from '../terrain-frame';

import {
  type DreiLine,
  easeFactor,
  expEase,
  lerpGroupPos,
  lerpPoints,
  setLinePoints,
} from './lerp';

type LineExtras = Omit<ComponentProps<typeof Line>, 'points' | 'opacity' | 'dashed' | 'ref'>;

/** A drei <Line> that eases its geometry toward the latest `points` (so the
 *  terrain-projection drape glides instead of snapping) and fades its opacity
 *  toward `visible` (so it animates on/off) — the same treatment grid lines get.
 *  The initial geometry is built once; all later changes go through setPositions
 *  in the frame loop. */
export function AnimatedLine({
  dashed = false,
  opacity = 1,
  points,
  visible = true,
  ...rest
}: { points: Vec3[]; opacity?: number; visible?: boolean; dashed?: boolean } & LineExtras) {
  const ref = useRef<ComponentRef<typeof Line>>(null);
  const [init] = useState(() => points);
  const cur = useRef<number[]>(points.flat());
  const vis = useRef(visible ? 1 : 0);

  // `useFrame` closes over the latest render, so `points`/`visible` here are
  // always current — no target ref needed (refs must not be touched in render).
  useFrame((_, dt) => {
    // Snap the working buffer if the polyline's structure changed (e.g. a
    // different analysis selected) — no morph makes sense across shapes.
    if (cur.current.length !== points.length * 3) {
      cur.current = points.flat();
      setLinePoints(ref.current as unknown as DreiLine | null, cur.current, dashed);
    } else if (lerpPoints(cur.current, points, easeFactor(dt, 6))) {
      setLinePoints(ref.current as unknown as DreiLine | null, cur.current, dashed);
    }
    const vt = visible ? 1 : 0;
    if (vis.current !== vt) {
      vis.current = expEase(vis.current, vt, dt, 9);
      if (Math.abs(vt - vis.current) < 0.004) {
        vis.current = vt;
      }
    }
    const obj = ref.current as unknown as THREE.Object3D | null;
    if (obj) {
      obj.visible = vis.current > 0.002;
    }
    const m = ref.current?.material;
    if (m) {
      m.opacity = opacity * vis.current;
    }
  });

  return <Line ref={ref} points={init} dashed={dashed} transparent opacity={opacity} {...rest} />;
}

/** A sphere marker whose position eases toward `position` (drape morph) and whose
 *  opacity fades toward `visible`. Matches AnimatedLine so points animate too. */
export function AnimatedMarker({
  color,
  opacity = 1,
  position,
  radius = 0.5,
  visible = true,
  wireframe = false,
}: {
  position: Vec3;
  color: string;
  radius?: number;
  opacity?: number;
  visible?: boolean;
  wireframe?: boolean;
}) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const [init] = useState(() => position);
  const vis = useRef(visible ? 1 : 0);

  useFrame((_, dt) => {
    lerpGroupPos(g.current, position, easeFactor(dt, 6));
    const vt = visible ? 1 : 0;
    if (vis.current !== vt) {
      vis.current = expEase(vis.current, vt, dt, 9);
      if (Math.abs(vt - vis.current) < 0.004) {
        vis.current = vt;
      }
    }
    if (g.current) {
      g.current.visible = vis.current > 0.002;
    }
    if (mat.current) {
      mat.current.opacity = opacity * vis.current;
    }
  });

  return (
    <group ref={g} position={init}>
      <mesh>
        <sphereGeometry args={[radius, 14, 14]} />
        <meshBasicMaterial
          ref={mat}
          color={color}
          transparent
          opacity={opacity}
          wireframe={wireframe}
        />
      </mesh>
    </group>
  );
}
