'use client';

import { useMemo } from 'react';

import { drapeLocalY, type Frame, type Sampler, type Vec3 } from '../terrain-frame';
import { AnimatedLine, AnimatedMarker } from './animated-line';

const COLOR = '#10b981'; // emerald — the property boundary

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
  const pts = useMemo(
    () =>
      points.map((p): Vec3 => {
        const x = p.e - originE;
        const z = -(p.n - originN);
        const y = frame ? drapeLocalY(frame, sample, x, z, 0, 0.25) : 0.25;
        return [x, y, z];
      }),
    [points, originE, originN, frame, sample],
  );
  // Close the ring once there are enough vertices to form a polygon.
  const ring = useMemo(() => (pts.length >= 3 ? [...pts, pts[0]] : pts), [pts]);

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
      {pts.map((p, i) => (
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
