'use client';

import { Line } from '@react-three/drei';
import { useMemo } from 'react';

import type { Vec3 } from '../terrain-frame';

/** A surface constraint for the scene: projected-meter vertices + its kind. */
export interface SceneConstraint {
  id: string;
  kind: 'HARD' | 'BOUNDARY' | 'HOLE';
  vertices: { e: number; n: number; z: number | null }[];
}

const COLOR: Record<SceneConstraint['kind'], string> = {
  BOUNDARY: '#2563eb',
  HARD: '#f59e0b',
  HOLE: '#dc2626',
};

/** Draws surface constraints as linework, placed in the local frame via the
 *  project's projected origin (matches the DXF-overlay mapping). Boundary/hole
 *  rings are closed; holes are dashed. */
export function SurfaceConstraints({
  constraints,
  originE,
  originN,
  visible = true,
}: {
  constraints: SceneConstraint[];
  originE: number;
  originN: number;
  visible?: boolean;
}) {
  const lines = useMemo(
    () =>
      constraints
        .map((c) => {
          const pts: Vec3[] = c.vertices.map((v) => [
            v.e - originE,
            (v.z ?? 0) + 0.05,
            -(v.n - originN),
          ]);
          if (c.kind !== 'HARD' && pts.length > 2) {
            pts.push(pts[0]); // close the ring
          }
          return { id: c.id, kind: c.kind, points: pts };
        })
        .filter((l) => l.points.length >= 2),
    [constraints, originE, originN],
  );

  if (!visible) {
    return null;
  }
  return (
    <>
      {lines.map((l) => (
        <Line
          key={l.id}
          points={l.points}
          color={COLOR[l.kind]}
          lineWidth={2}
          dashed={l.kind === 'HOLE'}
          dashSize={1}
          gapSize={0.5}
          transparent
          opacity={0.95}
        />
      ))}
    </>
  );
}
