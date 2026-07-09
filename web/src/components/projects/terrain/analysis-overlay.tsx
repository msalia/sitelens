'use client';

import { Line } from '@react-three/drei';
import { useMemo } from 'react';

import type { Vec3 } from '../terrain-frame';

/** A drawn analysis path (projected-meter vertices) to overlay in the scene. */
export interface AnalysisPath {
  /** Highlight (the in-progress / selected path) vs. a muted saved one. */
  active?: boolean;
  id: string;
  /** Vertices in projected meters. */
  vertices: { e: number; n: number }[];
}

/** Draws analysis input geometry as linework in the local frame via the project's
 *  projected origin (matches the DXF/constraint overlays). A plan-mode primitive
 *  the analysis features build on. */
export function AnalysisOverlay({
  originE,
  originN,
  paths,
  visible = true,
}: {
  paths: AnalysisPath[];
  originE: number;
  originN: number;
  visible?: boolean;
}) {
  const lines = useMemo(
    () =>
      paths
        .map((p) => ({
          active: p.active ?? false,
          id: p.id,
          points: p.vertices.map((v) => [v.e - originE, 0.1, -(v.n - originN)] as Vec3),
        }))
        .filter((l) => l.points.length >= 2),
    [paths, originE, originN],
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
          color={l.active ? '#7c3aed' : '#a78bfa'}
          lineWidth={l.active ? 3 : 2}
          transparent
          opacity={l.active ? 1 : 0.7}
        />
      ))}
    </>
  );
}
