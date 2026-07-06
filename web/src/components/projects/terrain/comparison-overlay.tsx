'use client';

import { Line } from '@react-three/drei';

import { drapeTo, type Frame, type Sampler } from '../terrain-frame';
import { type ComparisonMarker, type ComparisonStatus } from '../terrain-shared';

/** Status → colour, matching the results-table chips. */
const COLOR: Record<ComparisonStatus, string> = {
  FAIL: '#ef4444',
  NO_VERTICAL: '#0ea5e9',
  PASS: '#10b981',
  UNMATCHED: '#94a3b8',
  WARN: '#f59e0b',
};

const R = 1.0; // marker sphere radius (meters)
const LIFT = 0.4; // small lift so markers don't z-fight the surface

/** As-built QC overlay: a status-coloured leader line from each design point to
 * its as-built position, with a filled marker at each end. Unmatched as-builts
 * render as a lone wireframe marker (no line). */
export function ComparisonOverlay({
  comparison,
  frame,
  sample,
}: {
  comparison: ComparisonMarker[];
  frame: Frame;
  sample: Sampler;
}) {
  return (
    <group>
      {comparison.map((m) => {
        const color = COLOR[m.status];
        const ab = drapeTo(frame, sample, m.asBuilt[0], m.asBuilt[1], m.asBuilt[2], LIFT);
        const de = m.design
          ? drapeTo(frame, sample, m.design[0], m.design[1], m.design[2], LIFT)
          : null;
        return (
          <group key={m.key}>
            {de ? (
              <>
                <mesh position={de}>
                  <sphereGeometry args={[R, 12, 12]} />
                  <meshStandardMaterial color={color} />
                </mesh>
                <Line points={[de, ab]} color={color} lineWidth={2} />
              </>
            ) : null}
            <mesh position={ab}>
              <sphereGeometry args={[R, 12, 12]} />
              <meshStandardMaterial color={color} wireframe={m.status === 'UNMATCHED'} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
