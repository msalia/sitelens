'use client';

import { Line } from '@react-three/drei';
import { useMemo } from 'react';

import type { Vec3 } from '../terrain-frame';

/** Parsed turning-analysis result geometry (projected-meter coordinates). */
export interface AnalysisResult {
  bodies?: [number, number][][];
  clips?: [number, number][];
  envelope?: [number, number][];
  frontTrack?: [number, number][];
  rearTrack?: [number, number][];
}

/** Parses an analysis `resultGeometry` JSON string (null-safe). */
export function parseAnalysisResult(json: string | null | undefined): AnalysisResult | null {
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json) as AnalysisResult;
  } catch {
    return null;
  }
}

const toVec =
  (originE: number, originN: number, lift: number) =>
  (p: [number, number]): Vec3 => [p[0] - originE, lift, -(p[1] - originN)];

/**
 * Renders a turning analysis's swept path in the scene: the envelope (closed
 * band), the front (blue) + rear (amber, off-tracking) axle tracks, per-step
 * vehicle outlines, and red clip markers where an obstacle is caught.
 */
export function AnalysisResultOverlay({
  originE,
  originN,
  result,
  visible = true,
}: {
  result: AnalysisResult;
  originE: number;
  originN: number;
  visible?: boolean;
}) {
  const v = useMemo(() => toVec(originE, originN, 0.12), [originE, originN]);
  const vLow = useMemo(() => toVec(originE, originN, 0.08), [originE, originN]);

  const envelope = useMemo(() => {
    const pts = (result.envelope ?? []).map(v);
    return pts.length >= 2 ? [...pts, pts[0]] : null;
  }, [result.envelope, v]);
  const front = useMemo(() => (result.frontTrack ?? []).map(v), [result.frontTrack, v]);
  const rear = useMemo(() => (result.rearTrack ?? []).map(v), [result.rearTrack, v]);
  const bodies = useMemo(
    () => (result.bodies ?? []).map((b) => [...b, b[0]].map(vLow)),
    [result.bodies, vLow],
  );
  const clips = useMemo(() => (result.clips ?? []).map((c) => v(c)), [result.clips, v]);

  if (!visible) {
    return null;
  }
  return (
    <>
      {envelope ? (
        <Line points={envelope} color="#7c3aed" lineWidth={2} transparent opacity={0.95} />
      ) : null}
      {bodies.map((b, i) => (
        <Line key={`b${i}`} points={b} color="#a78bfa" lineWidth={1} transparent opacity={0.4} />
      ))}
      {rear.length >= 2 ? (
        <Line points={rear} color="#f59e0b" lineWidth={2} dashed dashSize={0.8} gapSize={0.5} />
      ) : null}
      {front.length >= 2 ? (
        <Line points={front} color="#2563eb" lineWidth={1.5} transparent opacity={0.9} />
      ) : null}
      {clips.map((c, i) => (
        <mesh key={`c${i}`} position={c}>
          <sphereGeometry args={[0.6, 12, 12]} />
          <meshBasicMaterial color="#dc2626" />
        </mesh>
      ))}
    </>
  );
}
