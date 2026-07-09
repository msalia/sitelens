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

/** Draws analysis input geometry as linework + vertex markers in the local frame
 *  via the project's projected origin (matches the DXF/constraint overlays). The
 *  vertex spheres give live feedback as points are snapped while drawing. */
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
  const items = useMemo(
    () =>
      paths.map((p) => ({
        active: p.active ?? false,
        id: p.id,
        points: p.vertices.map((v) => [v.e - originE, 0.1, -(v.n - originN)] as Vec3),
      })),
    [paths, originE, originN],
  );

  if (!visible) {
    return null;
  }
  return (
    <>
      {items.map((l) => (
        <group key={l.id}>
          {/* Polyline (needs 2+ points). */}
          {l.points.length >= 2 ? (
            <Line
              points={l.points}
              color={l.active ? '#7c3aed' : '#a78bfa'}
              lineWidth={l.active ? 3 : 2}
              transparent
              opacity={l.active ? 1 : 0.7}
            />
          ) : null}
          {/* A marker at every vertex — live feedback for the point being snapped. */}
          {l.points.map((pt, i) => (
            <mesh key={i} position={pt}>
              <sphereGeometry args={[l.active ? 0.7 : 0.5, 14, 14]} />
              <meshBasicMaterial color={l.active ? '#7c3aed' : '#a78bfa'} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}
