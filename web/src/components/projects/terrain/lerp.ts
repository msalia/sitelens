import * as THREE from 'three';

import type { Vec3 } from '../terrain-frame';

/** 2D segment intersection in the X/Z plane. Returns the point + the parameter
 *  `t` along segment A, or null if parallel or outside either segment. */
export function segmentIntersectXZ(
  a1: Vec3,
  a2: Vec3,
  b1: Vec3,
  b2: Vec3,
): { x: number; z: number; t: number } | null {
  const d1x = a2[0] - a1[0];
  const d1z = a2[2] - a1[2];
  const d2x = b2[0] - b1[0];
  const d2z = b2[2] - b1[2];
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-6) {
    return null;
  }
  const ox = b1[0] - a1[0];
  const oz = b1[2] - a1[2];
  const t = (ox * d2z - oz * d2x) / denom;
  const u = (ox * d1z - oz * d1x) / denom;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) {
    return null;
  }
  return { t, x: a1[0] + t * d1x, z: a1[2] + t * d1z };
}

const LERP_EPS = 1e-4;

/** Eases a flat `[x,y,z,…]` buffer toward a `Vec3[]` target in place; returns
 *  whether anything moved past the epsilon, so callers can skip the (costly)
 *  geometry upload once a polyline has settled. */
export function lerpPoints(cur: number[], target: Vec3[], k: number): boolean {
  let moved = false;
  for (let i = 0; i < target.length; i++) {
    const o = i * 3;
    for (let a = 0; a < 3; a++) {
      const d = target[i][a] - cur[o + a];
      if (d > LERP_EPS || d < -LERP_EPS) {
        cur[o + a] += d * k;
        moved = true;
      }
    }
  }
  return moved;
}

/** Eases a group's position toward a `Vec3` target; returns whether it moved. */
export function lerpGroupPos(g: THREE.Group | null, target: Vec3, k: number): boolean {
  if (!g) {
    return false;
  }
  const p = g.position;
  let moved = false;
  const dx = target[0] - p.x;
  const dy = target[1] - p.y;
  const dz = target[2] - p.z;
  if (dx > LERP_EPS || dx < -LERP_EPS) {
    p.x += dx * k;
    moved = true;
  }
  if (dy > LERP_EPS || dy < -LERP_EPS) {
    p.y += dy * k;
    moved = true;
  }
  if (dz > LERP_EPS || dz < -LERP_EPS) {
    p.z += dz * k;
    moved = true;
  }
  return moved;
}

/** drei `<Line>` exposes a `LineGeometry` (with `setPositions`) on a `Line2` that
 *  also has `computeLineDistances` (needed for dashes). Pushes new points to it. */
export type DreiLine = {
  geometry: { setPositions: (a: number[]) => void };
  computeLineDistances: () => void;
};
export function setLinePoints(obj: DreiLine | null, pts: number[], dashed = false) {
  if (!obj) {
    return;
  }
  obj.geometry.setPositions(pts);
  if (dashed) {
    obj.computeLineDistances();
  }
}
