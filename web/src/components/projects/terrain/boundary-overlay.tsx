'use client';

import { useMemo } from 'react';

import { drapeLocalY, type Frame, type Sampler, type Vec3 } from '../terrain-frame';
import { AnimatedLine, AnimatedMarker } from './animated-line';

const COLOR = '#10b981'; // emerald — the property boundary
const LIFT = 0.25; // float just above the surface to avoid z-fighting
// Subdivisions per edge so a draped edge follows the terrain (as grid lines do).
const SEG = 24;

/** Draws the project's property boundary as a closed emerald ring draped on the
 *  terrain, with a marker at each vertex. `draft` styles the in-progress edit
 *  (dashed, slightly heavier) distinctly from the saved boundary. */
export function BoundaryOverlay({
  draft = false,
  frame,
  originE,
  originN,
  points,
  sample = null,
  visible = true,
}: {
  points: { e: number; n: number }[];
  originE: number;
  originN: number;
  frame?: Frame;
  sample?: Sampler;
  visible?: boolean;
  draft?: boolean;
}) {
  // Drape a projected E/N point onto the terrain in the local frame.
  const drape = useMemo(() => {
    return (e: number, n: number): Vec3 => {
      const x = e - originE;
      const z = -(n - originN);
      const y = frame ? drapeLocalY(frame, sample, x, z, 0, LIFT) : LIFT;
      return [x, y, z];
    };
  }, [originE, originN, frame, sample]);

  // Draped vertex positions (for the markers).
  const vertexPts = useMemo(() => points.map((p) => drape(p.e, p.n)), [points, drape]);

  // Densified + draped ring: subdivide each edge so the line hugs the terrain
  // between vertices instead of cutting straight through it (like grid lines).
  const ring = useMemo(() => {
    if (points.length < 2) {
      return [];
    }
    const closed = points.length >= 3;
    const seq = closed ? [...points, points[0]] : points;
    const out: Vec3[] = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      for (let s = 0; s < SEG; s++) {
        const t = s / SEG;
        out.push(drape(a.e + (b.e - a.e) * t, a.n + (b.n - a.n) * t));
      }
    }
    const last = seq[seq.length - 1];
    out.push(drape(last.e, last.n));
    return out;
  }, [points, drape]);

  if (points.length === 0) {
    return null;
  }
  return (
    <>
      {ring.length >= 2 ? (
        <AnimatedLine
          points={ring}
          color={COLOR}
          lineWidth={draft ? 2.5 : 2}
          dashed={draft}
          dashSize={1}
          gapSize={0.6}
          visible={visible}
        />
      ) : null}
      {vertexPts.map((p, i) => (
        <AnimatedMarker
          key={i}
          position={p}
          color={COLOR}
          radius={draft ? 0.6 : 0.45}
          visible={visible}
        />
      ))}
    </>
  );
}
