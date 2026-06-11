'use client';

import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import type { SceneData } from '@/lib/types';

import { drapeTo, type Frame, type Sampler, type Vec3 } from '../terrain-frame';
import { FadeHtml } from './fade';
import {
  type DreiLine,
  easeFactor,
  expEase,
  lerpGroupPos,
  lerpPoints,
  segmentIntersectXZ,
  setLinePoints,
} from './lerp';

const GRID_COLOR = '#94a3b8';
// Soft highlight for a selected grid line (blue-500).
const GRID_SELECTED_COLOR = '#3b82f6';
const _gridCol = new THREE.Color(GRID_COLOR);
const _selCol = new THREE.Color(GRID_SELECTED_COLOR);
const _tmpCol = new THREE.Color();

/** Building-grid axes. Each axis is drawn solid across its span and extended a
 * little past both ends with a dashed lead-out, so the labels sit clear of the
 * point pins. When `sample` is set, lines are subdivided + draped onto terrain. */
export function GridLines({
  frame,
  sample,
  scene,
  visible = true,
}: {
  scene: SceneData;
  frame: Frame;
  sample: Sampler;
  /** Soft fade in/out (the Display "Grid lines" toggle). Grid is lightweight, so
   *  it stays mounted and fades rather than unmounting. */
  visible?: boolean;
}) {
  const { intersections, lines } = useMemo(() => {
    // Always subdivide, even when flat, so a line keeps the same point count
    // whether draped or not — that's what lets GridLineMesh lerp point-for-point
    // between the two as "project onto terrain" toggles, instead of snapping.
    const steps = 24;
    const lift = sample ? 0.25 : 0; // avoid z-fighting with the surface
    const ext = 0.28; // extend each end by this fraction of the line length
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const place = (lat: number, lon: number, h: number): Vec3 =>
      drapeTo(frame, sample, lat, lon, h, lift);
    const drape = (
      a: { latitude: number; longitude: number; height: number },
      b: { latitude: number; longitude: number; height: number },
    ): Vec3[] => {
      const out: Vec3[] = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        out.push(
          place(
            lerp(a.latitude, b.latitude, t),
            lerp(a.longitude, b.longitude, t),
            lerp(a.height, b.height, t),
          ),
        );
      }
      return out;
    };

    const lines: GridLineData[] = scene.gridLines
      .filter((l) => l.coordinates.length >= 2)
      .map((line, i) => {
        const a = line.coordinates[0];
        const b = line.coordinates[line.coordinates.length - 1];
        const dLat = b.latitude - a.latitude;
        const dLon = b.longitude - a.longitude;
        const aOut = {
          height: a.height,
          latitude: a.latitude - dLat * ext,
          longitude: a.longitude - dLon * ext,
        };
        const bOut = {
          height: b.height,
          latitude: b.latitude + dLat * ext,
          longitude: b.longitude + dLon * ext,
        };
        return {
          key: `${line.label}-${i}`,
          labelA: place(aOut.latitude, aOut.longitude, aOut.height),
          labelB: place(bOut.latitude, bOut.longitude, bOut.height),
          leadA: drape(aOut, a),
          leadB: drape(b, bOut),
          main: drape(a, b),
          text: line.label,
        };
      });

    // Grid intersections: where two grid lines cross. Snapped + merged so 3+
    // lines meeting at a point share one marker, and each remembers the lines
    // through it (for highlighting on select).
    const byId = new Map<string, GridIntersection>();
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i];
        const b = lines[j];
        const hit = segmentIntersectXZ(
          a.main[0],
          a.main[a.main.length - 1],
          b.main[0],
          b.main[b.main.length - 1],
        );
        if (!hit) {
          continue;
        }
        // Follow line A's (possibly terrain-draped) polyline for the height, so
        // the marker sits on the surface when "project onto terrain" is on.
        const f = hit.t * (a.main.length - 1);
        const i0 = Math.max(0, Math.min(a.main.length - 1, Math.floor(f)));
        const i1 = Math.min(a.main.length - 1, i0 + 1);
        const y = lerp(a.main[i0][1], a.main[i1][1], f - i0) + 0.4;
        const id = `${Math.round(hit.x / 0.5)}:${Math.round(hit.z / 0.5)}`;
        const existing = byId.get(id);
        if (existing) {
          if (!existing.keys.includes(a.key)) {
            existing.keys.push(a.key);
          }
          if (!existing.keys.includes(b.key)) {
            existing.keys.push(b.key);
          }
        } else {
          byId.set(id, { id, keys: [a.key, b.key], p: [hit.x, y, hit.z] });
        }
      }
    }
    return { intersections: [...byId.values()], lines };
  }, [scene.gridLines, frame, sample]);

  // Soft selection: click a line, or an intersection (which highlights every line
  // through it). Click again to toggle off. Local, visual-only state.
  const [sel, setSel] = useState<
    { kind: 'line'; key: string } | { kind: 'intersection'; id: string; keys: string[] } | null
  >(null);
  const highlighted = useMemo(
    () => (sel ? new Set(sel.kind === 'line' ? [sel.key] : sel.keys) : new Set<string>()),
    [sel],
  );

  if (lines.length === 0) {
    return null;
  }
  return (
    <group>
      {lines.map((l) => (
        <GridLineMesh
          key={l.key}
          line={l}
          visible={visible}
          highlighted={highlighted.has(l.key)}
          onSelect={() =>
            setSel((s) =>
              s?.kind === 'line' && s.key === l.key ? null : { key: l.key, kind: 'line' },
            )
          }
        />
      ))}
      {/* Intersection hit targets are only active while the grid is shown. */}
      {visible &&
        intersections.map((it) => (
          <GridIntersectionMarker
            key={it.id}
            p={it.p}
            onSelect={() =>
              setSel((s) =>
                s?.kind === 'intersection' && s.id === it.id
                  ? null
                  : { id: it.id, keys: it.keys, kind: 'intersection' },
              )
            }
          />
        ))}
    </group>
  );
}

type GridLineData = {
  key: string;
  text: string;
  main: Vec3[];
  leadA: Vec3[];
  leadB: Vec3[];
  labelA: Vec3;
  labelB: Vec3;
};

type GridIntersection = { id: string; p: Vec3; keys: string[] };

/** A single grid line whose highlight (color, width, opacity) eases smoothly
 *  toward the selected state each frame. */
function GridLineMesh({
  highlighted,
  line,
  onSelect,
  visible,
}: {
  line: GridLineData;
  highlighted: boolean;
  visible: boolean;
  onSelect: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const mainRef = useRef<React.ComponentRef<typeof Line>>(null);
  const hitRef = useRef<React.ComponentRef<typeof Line>>(null);
  const leadARef = useRef<React.ComponentRef<typeof Line>>(null);
  const leadBRef = useRef<React.ComponentRef<typeof Line>>(null);
  const labelARef = useRef<THREE.Group>(null);
  const labelBRef = useRef<THREE.Group>(null);
  const t = useRef(highlighted ? 1 : 0); // selection highlight
  const vis = useRef(visible ? 1 : 0); // visibility fade

  // Stable initial geometry: drei builds each <Line> from these exactly once. The
  // per-frame loop then eases the *live* points toward the latest (flat/draped)
  // target via setPositions, so toggling "project onto terrain" glides the drape
  // instead of snapping. `init` is a one-shot value (safe to read in render);
  // `cur` is the moving buffer (mutated only in the frame loop).
  const [init] = useState(() => ({
    labelA: line.labelA,
    labelB: line.labelB,
    leadA: line.leadA,
    leadB: line.leadB,
    main: line.main,
  }));
  const cur = useRef({
    leadA: line.leadA.flat(),
    leadB: line.leadB.flat(),
    main: line.main.flat(),
  });

  // Apply initial visibility on mount so a grid that starts hidden stays hidden
  // until toggled (the per-frame loop only runs during transitions).
  const setGroup = (g: THREE.Group | null) => {
    groupRef.current = g;
    if (g) {
      g.visible = vis.current > 0.002;
    }
  };

  useFrame((_, dt) => {
    // Drape morph — ease each polyline + label toward its current target. Only
    // the (costly) geometry upload is gated on actual movement.
    const kp = easeFactor(dt, 6);
    if (lerpPoints(cur.current.main, line.main, kp)) {
      setLinePoints(mainRef.current as unknown as DreiLine | null, cur.current.main);
      setLinePoints(hitRef.current as unknown as DreiLine | null, cur.current.main);
    }
    if (lerpPoints(cur.current.leadA, line.leadA, kp)) {
      setLinePoints(leadARef.current as unknown as DreiLine | null, cur.current.leadA, true);
    }
    if (lerpPoints(cur.current.leadB, line.leadB, kp)) {
      setLinePoints(leadBRef.current as unknown as DreiLine | null, cur.current.leadB, true);
    }
    lerpGroupPos(labelARef.current, line.labelA, kp);
    lerpGroupPos(labelBRef.current, line.labelB, kp);

    // Highlight + visibility.
    const ht = highlighted ? 1 : 0;
    const vt = visible ? 1 : 0;
    let changed = false;
    if (t.current !== ht) {
      t.current = expEase(t.current, ht, dt, 9);
      if (Math.abs(ht - t.current) < 0.002) {
        t.current = ht;
      }
      changed = true;
    }
    if (vis.current !== vt) {
      vis.current = expEase(vis.current, vt, dt, 9);
      if (Math.abs(vt - vis.current) < 0.004) {
        vis.current = vt;
      }
      changed = true;
    }
    if (!changed) {
      return;
    }
    const tv = t.current;
    const vv = vis.current;
    if (groupRef.current) {
      groupRef.current.visible = vv > 0.002;
    }
    const col = _tmpCol.copy(_gridCol).lerp(_selCol, tv);
    const style = (
      ref: React.RefObject<React.ComponentRef<typeof Line> | null>,
      baseW: number,
      selW: number,
      baseO: number,
      selO: number,
    ) => {
      const m = ref.current?.material;
      if (!m) {
        return;
      }
      m.color.copy(col);
      m.linewidth = baseW + (selW - baseW) * tv;
      m.opacity = (baseO + (selO - baseO) * tv) * vv;
    };
    style(mainRef, 1.2, 2.6, 0.8, 1);
    style(leadARef, 1, 1, 0.55, 0.85);
    style(leadBRef, 1, 1, 0.55, 0.85);
  });

  return (
    <group ref={setGroup}>
      {/* Wide hit target for easy selection — never drawn (colorWrite off), but
          still raycastable, so it can't show up as a "shadow" while the grid
          fades. Tracks the main line so the hit area follows the drape. */}
      <Line
        ref={(o) => {
          hitRef.current = o;
          const m = (o as unknown as { material?: THREE.Material } | null)?.material;
          if (m) {
            m.colorWrite = false;
            m.depthWrite = false;
          }
        }}
        points={init.main}
        transparent
        opacity={0}
        lineWidth={12}
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
      <Line
        ref={mainRef}
        points={init.main}
        color={GRID_COLOR}
        lineWidth={1.2}
        transparent
        opacity={0.8}
      />
      <Line
        ref={leadARef}
        points={init.leadA}
        color={GRID_COLOR}
        lineWidth={1}
        dashed
        dashSize={1.5}
        gapSize={1.5}
        transparent
        opacity={0.55}
      />
      <Line
        ref={leadBRef}
        points={init.leadB}
        color={GRID_COLOR}
        lineWidth={1}
        dashed
        dashSize={1.5}
        gapSize={1.5}
        transparent
        opacity={0.55}
      />
      {[
        { groupRef: labelARef, start: init.labelA },
        { groupRef: labelBRef, start: init.labelB },
      ].map((lbl, j) => (
        // The label rides its own group whose position eases with the drape.
        <group key={j} ref={lbl.groupRef} position={lbl.start}>
          <Html position={[0, 0, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <FadeHtml visible={visible}>
              <span
                className={`rounded border px-1 text-[10px] leading-none font-semibold shadow-sm transition-colors ${
                  highlighted
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'bg-background/85 text-muted-foreground'
                }`}
              >
                {line.text}
              </span>
            </FadeHtml>
          </Html>
        </group>
      ))}
    </group>
  );
}

/** An invisible, clickable hit target at a grid intersection. Selecting it
 *  highlights every line through the point (the lines are the visual feedback).
 *  On hover it previews a smaller version of the survey-point pin head for
 *  discoverability — no permanent dot is drawn. */
function GridIntersectionMarker({ onSelect, p }: { p: Vec3; onSelect: () => void }) {
  const groupRef = useRef<THREE.Group>(null);
  // Seed once; the loop eases toward the live target so the hit point rides the
  // drape (its X/Z are fixed; only the height changes as the grid drapes).
  const [start] = useState(() => p);
  useFrame((_, dt) => {
    lerpGroupPos(groupRef.current, p, easeFactor(dt, 6));
  });
  return (
    <group ref={groupRef} position={start}>
      <Html position={[0, 0, 0]} center zIndexRange={[10, 0]}>
        <button
          type="button"
          aria-label="Grid intersection"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onPointerOver={() => {
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = '';
          }}
          className="group flex size-6 items-center justify-center"
        >
          <span
            className="size-4 rounded-full border-2 border-white opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100"
            style={{ backgroundColor: GRID_SELECTED_COLOR }}
          />
        </button>
      </Html>
    </group>
  );
}
