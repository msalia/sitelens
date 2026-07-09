'use client';

import { useMemo } from 'react';

import { drapeLocalY, type Frame, type Sampler, type Vec3 } from '../terrain-frame';
import { AnimatedLine, AnimatedMarker } from './animated-line';

/** A drawn analysis path (projected-meter vertices) to overlay in the scene. */
export interface AnalysisPath {
  /** Highlight (the in-progress / selected path) vs. a muted saved one. */
  active?: boolean;
  id: string;
  /** Draw only the vertex markers, not the connecting polyline — used once an
   *  analysis is computed so the result visualization is the only linework. */
  markersOnly?: boolean;
  /** Vertices in projected meters. */
  vertices: { e: number; n: number }[];
}

/** Draws analysis input geometry as linework + vertex markers in the local frame
 *  via the project's projected origin. Uses the animated scene primitives, so
 *  vertices drape onto the terrain and fade on/off smoothly (no snapping); the
 *  markers give live feedback as points are snapped while drawing. */
export function AnalysisOverlay({
  frame,
  originE,
  originN,
  paths,
  sample = null,
  visible = true,
}: {
  paths: AnalysisPath[];
  originE: number;
  originN: number;
  /** Frame + sampler to drape vertices onto the terrain (falls back to flat). */
  frame?: Frame;
  sample?: Sampler;
  visible?: boolean;
}) {
  const items = useMemo(
    () =>
      paths.map((p) => ({
        active: p.active ?? false,
        id: p.id,
        markersOnly: p.markersOnly ?? false,
        points: p.vertices.map((vtx) => {
          const x = vtx.e - originE;
          const z = -(vtx.n - originN);
          const y = frame ? drapeLocalY(frame, sample, x, z, 0, 0.15) : 0.15;
          return [x, y, z] as Vec3;
        }),
      })),
    [paths, originE, originN, frame, sample],
  );

  return (
    <>
      {items.map((l) => (
        <group key={l.id}>
          {/* Polyline (needs 2+ points) — hidden once the analysis is computed. */}
          {!l.markersOnly && l.points.length >= 2 ? (
            <AnimatedLine
              points={l.points}
              color={l.active ? '#7c3aed' : '#a78bfa'}
              lineWidth={l.active ? 3 : 2}
              opacity={l.active ? 1 : 0.7}
              visible={visible}
            />
          ) : null}
          {/* A marker at every vertex — live feedback for the point being snapped. */}
          {l.points.map((pt, i) => (
            <AnimatedMarker
              key={i}
              position={pt}
              color={l.active ? '#7c3aed' : '#a78bfa'}
              radius={l.active ? 0.7 : 0.5}
              visible={visible}
            />
          ))}
        </group>
      ))}
    </>
  );
}
