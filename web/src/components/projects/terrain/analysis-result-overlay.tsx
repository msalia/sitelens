'use client';

import { Html } from '@react-three/drei';
import { useMemo, useState } from 'react';

import { drapeLocalY, type Frame, type Sampler, type Vec3 } from '../terrain-frame';
import { AnimatedLine, AnimatedMarker } from './animated-line';

type Pt = [number, number];

/** Parsed turning-analysis result geometry (projected-meter coordinates). */
export interface AnalysisResult {
  bodies?: Pt[][];
  clips?: Pt[];
  /** Full-res swept-edge corner curves (smooth). */
  edges?: { fl?: Pt[]; fr?: Pt[]; rl?: Pt[]; rr?: Pt[] };
  frontTrack?: Pt[];
  obstacles?: Pt[][];
  rearTrack?: Pt[];
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
  (originE: number, originN: number, lift: number, frame?: Frame, sample?: Sampler) =>
  (p: Pt): Vec3 => {
    const x = p[0] - originE;
    const z = -(p[1] - originN);
    const y = frame ? drapeLocalY(frame, sample ?? null, x, z, 0, lift) : lift;
    return [x, y, z];
  };

/** An elbow leader from a point on a curve out to a labelled chip (chip fill =
 *  the line colour, white text) — CAD-style callouts drawn right on the path. */
function Leader({
  at,
  color,
  label,
  offset,
  visible,
}: {
  at: Vec3;
  color: string;
  label: string;
  offset: Vec3;
  visible: boolean;
}) {
  const elbow: Vec3 = [at[0], at[1] + offset[1], at[2]];
  const end: Vec3 = [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]];
  return (
    <group>
      <AnimatedLine
        points={[at, elbow, end]}
        color={color}
        lineWidth={2.5}
        opacity={0.9}
        visible={visible}
      />
      <AnimatedMarker position={at} color={color} radius={0.4} visible={visible} />
      <Html position={end} center zIndexRange={[10, 0]}>
        <div
          style={{
            background: color,
            borderRadius: 6,
            boxShadow: '0 1px 3px rgb(0 0 0 / 0.4)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            opacity: visible ? 1 : 0,
            padding: '3px 9px',
            pointerEvents: 'none',
            transition: 'opacity 150ms ease',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

/** A clickable track: the visible line(s) plus a wide invisible "hit" line so
 *  the thin curve is easy to select. Selecting reveals its leader callout. */
function Track({
  color,
  dashed = false,
  lines,
  onSelect,
  selected,
  visible,
  width,
}: {
  lines: Vec3[][];
  color: string;
  width: number;
  dashed?: boolean;
  selected: boolean;
  visible: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      {lines.map((pts, i) => (
        <group key={i}>
          <AnimatedLine
            points={pts}
            color={color}
            lineWidth={selected ? width + 1.75 : width}
            dashed={dashed}
            dashSize={0.6}
            gapSize={0.6}
            opacity={dashed ? 0.9 : 1}
            visible={visible}
          />
          <AnimatedLine
            points={pts}
            color={color}
            lineWidth={16}
            opacity={0}
            visible={visible}
            depthWrite={false}
            material-depthWrite={false}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = '';
            }}
          />
        </group>
      ))}
    </>
  );
}

/**
 * Renders a turning analysis as an AASHTO/AutoTURN-style plan drawing built from
 * the smooth tractrix edge curves (no jagged union): the swept-body edge/wheel
 * tracks for the front (blue) and rear (green) axles, a dashed front-axle
 * centre-line, obstacles, and red clip markers that show where a run fails. All
 * geometry uses the animated scene primitives, so it drapes + fades smoothly.
 */
export function AnalysisResultOverlay({
  frame,
  originE,
  originN,
  result,
  sample = null,
  visible = true,
}: {
  result: AnalysisResult;
  originE: number;
  originN: number;
  /** Frame + sampler to drape the swept path onto the terrain (falls back flat). */
  frame?: Frame;
  sample?: Sampler;
  /** Drives the fade on/off (kept mounted so it can animate out). */
  visible?: boolean;
}) {
  const v = useMemo(
    () => toVec(originE, originN, 0.2, frame, sample),
    [originE, originN, frame, sample],
  );

  // Which track's leader callout is shown (click a line to toggle). Conflict is
  // always shown so a failing run is never silent.
  const [selected, setSelected] = useState<'front' | 'rear' | 'center' | null>(null);
  const toggle = (k: 'front' | 'rear' | 'center') => setSelected((s) => (s === k ? null : k));

  const failed = (result.clips?.length ?? 0) > 0;

  // Smooth swept-edge curves straight from the integration. Front pair = the
  // front axle/overhang edges, rear pair = the rear (off-tracking) edges.
  const edges = useMemo(() => {
    const e = result.edges ?? {};
    const line = (pts?: Pt[]) => (pts && pts.length >= 2 ? pts.map(v) : null);
    return {
      front: [line(e.fl), line(e.fr)].filter(Boolean) as Vec3[][],
      rear: [line(e.rl), line(e.rr)].filter(Boolean) as Vec3[][],
    };
  }, [result.edges, v]);

  const center = useMemo(() => (result.frontTrack ?? []).map(v), [result.frontTrack, v]);

  const obstacles = useMemo(
    () => (result.obstacles ?? []).map((o) => o.map(v)),
    [result.obstacles, v],
  );
  const clips = useMemo(() => (result.clips ?? []).map((c) => v(c)), [result.clips, v]);

  // Elbow leader callouts. Anchors are spread along the curves and each chip is
  // pushed in a distinct 3D direction (height + horizontal) so they fan apart.
  const leaders = useMemo(() => {
    const pick = (arr: Vec3[], frac: number) =>
      arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * frac)))] : null;
    const out: { at: Vec3; color: string; key: string; label: string; offset: Vec3 }[] = [];
    const fl = edges.front[0];
    if (fl?.length) {
      out.push({
        at: pick(fl, 0.16)!,
        color: '#2563eb',
        key: 'front',
        label: 'Front wheel path',
        offset: [-7, 4, -5],
      });
    }
    const rl = edges.rear[0];
    if (rl?.length) {
      out.push({
        at: pick(rl, 0.84)!,
        color: '#16a34a',
        key: 'rear',
        label: 'Rear wheel path',
        offset: [7, 5, 5],
      });
    }
    if (center.length) {
      out.push({
        at: pick(center, 0.5)!,
        color: '#475569',
        key: 'center',
        label: 'Centerline',
        offset: [0, 9, -7],
      });
    }
    if (clips.length) {
      out.push({
        at: clips[0],
        color: '#dc2626',
        key: 'conflict',
        label: 'Conflict',
        offset: [-6, 13, 3],
      });
    }
    return out;
  }, [edges, center, clips]);

  return (
    <>
      {/* Front-axle centre-line (steered path) — click to label. */}
      {center.length >= 2 ? (
        <Track
          lines={[center]}
          color="#cbd5e1"
          width={1.25}
          dashed
          selected={selected === 'center'}
          visible={visible}
          onSelect={() => toggle('center')}
        />
      ) : null}
      {/* Front wheel/edge tracks (blue) — click to label. */}
      <Track
        lines={edges.front}
        color="#3b82f6"
        width={2}
        selected={selected === 'front'}
        visible={visible}
        onSelect={() => toggle('front')}
      />
      {/* Rear wheel/edge tracks (green, off-tracking) — click to label. */}
      <Track
        lines={edges.rear}
        color="#22c55e"
        width={2}
        selected={selected === 'rear'}
        visible={visible}
        onSelect={() => toggle('rear')}
      />
      {/* Obstacles the run was checked against (red when the run clips one). */}
      {obstacles.map((pts, i) =>
        pts.length >= 2 ? (
          <AnimatedLine
            key={`ob${i}`}
            points={pts}
            color={failed ? '#ef4444' : '#94a3b8'}
            lineWidth={2}
            visible={visible}
          />
        ) : pts.length === 1 ? (
          <AnimatedMarker
            key={`ob${i}`}
            position={pts[0]}
            color={failed ? '#ef4444' : '#94a3b8'}
            radius={0.5}
            visible={visible}
          />
        ) : null,
      )}
      {/* Clip markers — exactly where the swept body catches an obstacle. */}
      {clips.map((c, i) => (
        <AnimatedMarker key={`c${i}`} position={c} color="#dc2626" radius={0.7} visible={visible} />
      ))}
      {/* Elbow leader callouts — shown for the selected track (+ always conflict). */}
      {leaders.map((l) => (
        <Leader
          key={l.label}
          at={l.at}
          color={l.color}
          label={l.label}
          offset={l.offset}
          visible={visible && (l.key === 'conflict' || l.key === selected)}
        />
      ))}
    </>
  );
}
