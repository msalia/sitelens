'use client';

import type * as THREE from 'three';

import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { type ComponentProps, type ComponentRef, useLayoutEffect, useRef, useState } from 'react';

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

/** Applies fade level `tv` (0..1) to a material: eases opacity, and while fading
 *  renders transparent with depth-write off (so overlapping/self-covering lines
 *  and markers don't leave dark depth-overlap patches), restoring the material's
 *  original depth-write once fully shown. The base depth-write is captured on the
 *  first touch. Mirrors the terrain `Fade` component so overlays fade the same way
 *  whether they use `Fade` or these self-fading primitives. */
function applyFadeMat(m: THREE.Material, baseOpacity: number, tv: number) {
  const ud = m.userData;
  if (ud.baseDepthWrite === undefined) {
    ud.baseDepthWrite = m.depthWrite;
  }
  if (tv >= 0.999) {
    m.depthWrite = ud.baseDepthWrite as boolean;
  } else {
    m.depthWrite = false;
  }
  m.opacity = baseOpacity * tv;
}

/** A drei <Line> that eases its geometry toward the latest `points` (so the
 *  terrain-projection drape glides instead of snapping) and fades its opacity
 *  toward `visible` (so it animates on/off) — the same treatment grid lines get.
 *  The initial geometry is built once; all later changes go through setPositions
 *  in the frame loop. Opacity/visibility (and geometry on a structural change) are
 *  also applied at commit time, so the first painted frame after a (re)mount or
 *  prop change is already correct even when the render loop is idle (`demand`
 *  frameloop) — otherwise a reused line can stay stuck transparent until a full
 *  remount. */
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
  const invalidate = useThree((s) => s.invalidate);

  // Commit-time apply: snap the geometry if the polyline's structure changed and
  // push the current fade level to the material now, so the next painted frame is
  // correct without waiting on the frame loop. Then invalidate so the ease runs
  // to completion even under the `demand` frameloop (idle/unfocused).
  useLayoutEffect(() => {
    const obj = ref.current as unknown as THREE.Object3D | null;
    if (!obj) {
      return;
    }
    if (cur.current.length !== points.length * 3) {
      cur.current = points.flat();
      setLinePoints(ref.current as unknown as DreiLine | null, cur.current, dashed);
    }
    obj.visible = vis.current > 0.002;
    const m = ref.current?.material;
    if (m) {
      applyFadeMat(m, opacity, vis.current);
    }
    invalidate();
  }, [points, visible, opacity, dashed, invalidate]);

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
      invalidate(); // keep frames coming until the fade settles (demand loop)
    }
    const obj = ref.current as unknown as THREE.Object3D | null;
    if (obj) {
      obj.visible = vis.current > 0.002;
    }
    const m = ref.current?.material;
    if (m) {
      applyFadeMat(m, opacity, vis.current);
    }
  });

  return <Line ref={ref} points={init} dashed={dashed} transparent opacity={opacity} {...rest} />;
}

/** A sphere marker whose position eases toward `position` (drape morph) and whose
 *  opacity fades toward `visible`. Matches AnimatedLine so points animate too —
 *  including the commit-time apply so a reused marker is correct on its first
 *  painted frame under the `demand` frameloop. */
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
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    if (g.current) {
      g.current.visible = vis.current > 0.002;
    }
    if (mat.current) {
      applyFadeMat(mat.current, opacity, vis.current);
    }
    invalidate();
  }, [position, visible, opacity, invalidate]);

  useFrame((_, dt) => {
    lerpGroupPos(g.current, position, easeFactor(dt, 6));
    const vt = visible ? 1 : 0;
    if (vis.current !== vt) {
      vis.current = expEase(vis.current, vt, dt, 9);
      if (Math.abs(vt - vis.current) < 0.004) {
        vis.current = vt;
      }
      invalidate(); // keep frames coming until the fade settles (demand loop)
    }
    if (g.current) {
      g.current.visible = vis.current > 0.002;
    }
    if (mat.current) {
      applyFadeMat(mat.current, opacity, vis.current);
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
