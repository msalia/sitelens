'use client';

import { drapeTo, type Frame, type Sampler } from '../terrain-frame';
import { type ComparisonMarker, type ComparisonStatus } from '../terrain-shared';
import { AnimatedLine, AnimatedMarker } from './animated-line';

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
 * render as a lone wireframe marker (no line). Uses the animated scene
 * primitives, so it drapes + fades smoothly with the terrain toggle. */
export function ComparisonOverlay({
  comparison,
  frame,
  sample,
  visible = true,
}: {
  comparison: ComparisonMarker[];
  frame: Frame;
  sample: Sampler;
  visible?: boolean;
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
                <AnimatedMarker position={de} color={color} radius={R} visible={visible} />
                <AnimatedLine points={[de, ab]} color={color} lineWidth={2} visible={visible} />
              </>
            ) : null}
            <AnimatedMarker
              position={ab}
              color={color}
              radius={R}
              visible={visible}
              wireframe={m.status === 'UNMATCHED'}
            />
          </group>
        );
      })}
    </group>
  );
}
