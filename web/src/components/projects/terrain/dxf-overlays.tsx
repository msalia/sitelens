'use client';

import { Line } from '@react-three/drei';
import { useMemo } from 'react';

import { dxfExtent } from '@/lib/dxf';

import type { RenderableOverlay } from '../terrain-shared';

import { type Vec3 } from '../terrain-frame';
import { Fade } from './fade';

const OVERLAY_COLOR = '#f59e0b';

/** Georeferenced DXF overlays as amber linework. Each polyline's drawing (x, y)
 * is placed by its offset/rotation/scale into projected E/N, then mapped to the
 * local frame via the project's projected origin. The drawing renders FLAT at the
 * overlay's elevation (a reference plane at any Z), not draped onto terrain.
 *
 * Geometry is built for **every** layer and grouped by layer name; each group is
 * wrapped in its own `<Fade>` driven by `visible && shownLayers.has(layer)`. So
 * the master toggle and per-layer toggles both fade smoothly (and unmount when
 * hidden) through the one shared primitive — no nesting, no instant pop. */
export function DxfOverlays({
  digitizing = false,
  onPick,
  originE,
  originN,
  overlays,
  shownLayers,
  visible = true,
}: {
  overlays: RenderableOverlay[];
  originE: number;
  originN: number;
  shownLayers?: Set<string>;
  /** Master toggle for the whole overlay set; combines with per-layer visibility. */
  visible?: boolean;
  /** While digitizing, clicking a DXF line snaps to its nearest vertex via `onPick`. */
  digitizing?: boolean;
  onPick?: (easting: number, northing: number, height: number, label: string) => void;
}) {
  const byLayer = useMemo(() => {
    const map = new Map<string, { key: string; points: Vec3[] }[]>();
    for (const ov of overlays) {
      const theta = (ov.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      // Rotate AND scale about the drawing's robust center, with the offset
      // placing that center in projected E/N. So offset = where the drawing's
      // center sits, rotation spins about it, and scale grows/shrinks about it —
      // each control independent. DXF geometry often sits far from the file's
      // (0, 0) origin, so anchoring on the center keeps it from sliding away when
      // scaled or rotated. The percentile center ignores stray title blocks.
      const { cx, cy } = dxfExtent(ov.polylines);
      ov.polylines.forEach((pl, i) => {
        const points = pl.points.map((p): Vec3 => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const worldE = ov.offsetE + ov.scale * (dx * cos - dy * sin);
          const worldN = ov.offsetN + ov.scale * (dx * sin + dy * cos);
          const lx = worldE - originE;
          const lz = -(worldN - originN);
          // Flat reference plane at the overlay's elevation — no terrain drape,
          // so it stays level on the x/y plane.
          return [lx, ov.elevation, lz];
        });
        const arr = map.get(pl.layer);
        const entry = { key: `${ov.id}-${i}`, points };
        if (arr) {
          arr.push(entry);
        } else {
          map.set(pl.layer, [entry]);
        }
      });
    }
    return map;
  }, [overlays, originE, originN]);

  return (
    <>
      {[...byLayer.entries()].map(([layer, lines]) => (
        <Fade key={layer} visible={visible && !!shownLayers?.has(layer)}>
          {lines.map((l) => (
            <group key={l.key}>
              <Line
                points={l.points}
                color={OVERLAY_COLOR}
                lineWidth={1.2}
                transparent
                opacity={0.9}
              />
              {/* While digitizing, a wide invisible hit line snaps to the closest
                  point ON this polyline via the shared pick bridge — so clicking a
                  line intersection lands the pick right at the crossing (grid
                  intersections aren't vertices), not at a distant endpoint. */}
              {digitizing && onPick ? (
                <Line
                  points={l.points}
                  color={OVERLAY_COLOR}
                  lineWidth={14}
                  transparent
                  opacity={0}
                  depthWrite={false}
                  material-depthWrite={false}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    document.body.style.cursor = 'pointer';
                  }}
                  onPointerOut={() => {
                    document.body.style.cursor = '';
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Closest point on the polyline (per segment, in the XZ plane)
                    // to the click — clamped to each segment, so it lands exactly
                    // where the click meets the line (the intersection), and snaps
                    // to an endpoint only when the click is nearest one.
                    const cx = e.point.x;
                    const cz = e.point.z;
                    let best = l.points[0];
                    let bd = Infinity;
                    for (let i = 0; i < l.points.length - 1; i++) {
                      const a = l.points[i];
                      const b = l.points[i + 1];
                      const abx = b[0] - a[0];
                      const abz = b[2] - a[2];
                      const len2 = abx * abx + abz * abz;
                      const t =
                        len2 > 0
                          ? Math.max(0, Math.min(1, ((cx - a[0]) * abx + (cz - a[2]) * abz) / len2))
                          : 0;
                      const px = a[0] + t * abx;
                      const pz = a[2] + t * abz;
                      const d = (px - cx) ** 2 + (pz - cz) ** 2;
                      if (d < bd) {
                        bd = d;
                        best = [px, a[1] + t * (b[1] - a[1]), pz];
                      }
                    }
                    onPick(best[0] + originE, originN - best[2], best[1], 'DXF vertex');
                  }}
                />
              ) : null}
            </group>
          ))}
        </Fade>
      ))}
    </>
  );
}
