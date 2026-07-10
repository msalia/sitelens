'use client';

import { Html } from '@react-three/drei';
import { useMemo } from 'react';

import { drapeLocalY, type Frame, type Sampler, type Vec3 } from '../terrain-frame';
import { AnimatedMarker } from './animated-line';

/** A captured DXF-align pick to highlight in the scene. `kind` colours it (a
 *  drawing vertex vs a grid intersection); `pair` is the correspondence number
 *  (1 or 2) shown on the marker so the pairing is unambiguous; `height` is the
 *  pick's world elevation (meters) — a DXF vertex carries its flat layer Z. */
export interface AlignMarker {
  e: number;
  height: number;
  kind: 'src' | 'dst';
  n: number;
  pair: number;
}

const SRC_COLOR = '#f59e0b'; // DXF drawing point (amber — matches the overlay)
const DST_COLOR = '#3b82f6'; // grid intersection (blue — matches grid highlight)

/** Highlights the DXF-alignment picks in the 3D scene: a coloured sphere at each
 *  picked drawing vertex (amber) and grid intersection (blue), each labelled with
 *  its correspondence number, so the user can see exactly what they selected and
 *  which point pairs with which intersection. */
export function AlignPointsOverlay({
  frame,
  markers,
  originE,
  originN,
  sample = null,
  visible = true,
}: {
  markers: AlignMarker[];
  originE: number;
  originN: number;
  frame?: Frame;
  sample?: Sampler;
  visible?: boolean;
}) {
  const items = useMemo(
    () =>
      markers.map((m) => {
        const x = m.e - originE;
        const z = -(m.n - originN);
        // A DXF vertex sits on the (flat) overlay plane at its layer elevation —
        // NOT on the terrain — so render it at the picked height, or it drifts
        // under perspective. Grid intersections follow the terrain-draped grid.
        const y =
          m.kind === 'src'
            ? m.height + 0.6
            : frame
              ? drapeLocalY(frame, sample, x, z, 0, 0.6)
              : m.height + 0.6;
        return {
          color: m.kind === 'src' ? SRC_COLOR : DST_COLOR,
          pair: m.pair,
          pos: [x, y, z] as Vec3,
        };
      }),
    [markers, originE, originN, frame, sample],
  );

  return (
    <>
      {items.map((m, i) => (
        <group key={i}>
          <AnimatedMarker position={m.pos} color={m.color} radius={0.9} visible={visible} />
          <Html position={m.pos} center zIndexRange={[12, 0]}>
            <div
              style={{
                alignItems: 'center',
                background: m.color,
                borderRadius: '9999px',
                color: '#fff',
                display: 'flex',
                fontSize: 11,
                fontWeight: 700,
                height: 18,
                justifyContent: 'center',
                opacity: visible ? 1 : 0,
                pointerEvents: 'none',
                transition: 'opacity 150ms ease',
                width: 18,
              }}
            >
              {m.pair}
            </div>
          </Html>
        </group>
      ))}
    </>
  );
}
