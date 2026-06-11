'use client';

import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
  IconCurrentLocation,
  IconHammer,
  IconMapPin,
  IconPin,
  IconPointFilled,
  IconTriangle,
  IconUser,
} from '@tabler/icons-react';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { PointCategory, SceneData } from '@/lib/types';

import { dxfExtent } from '@/lib/dxf';
import { drapedHeight, smoothstep } from '@/lib/terrain';

import type { BuildingFootprint, RenderableOverlay } from './terrain-shared';

import { type Frame, type Sampler, toLocal, type Vec3 } from './terrain-frame';
import { TERRAIN_FADE_END, TERRAIN_FADE_START } from './terrain-mesh';

const CONTROL_COLOR = '#ef4444';
// Uncategorized survey points: a neutral slate that doesn't collide with the
// default category palette (red / blue / green / amber / …).
const DEFAULT_POINT_COLOR = '#475569';
const GRID_COLOR = '#94a3b8';
// Soft highlight for a selected grid line (blue-500).
const GRID_SELECTED_COLOR = '#3b82f6';
const _gridCol = new THREE.Color(GRID_COLOR);
const _selCol = new THREE.Color(GRID_SELECTED_COLOR);
const _tmpCol = new THREE.Color();

/** 2D segment intersection in the X/Z plane. Returns the point + the parameter
 *  `t` along segment A, or null if parallel or outside either segment. */
function segmentIntersectXZ(
  a1: Vec3,
  a2: Vec3,
  b1: Vec3,
  b2: Vec3,
): { x: number; z: number; t: number } | null {
  const d1x = a2[0] - a1[0];
  const d1z = a2[2] - a1[2];
  const d2x = b2[0] - b1[0];
  const d2z = b2[2] - b1[2];
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-6) {
    return null;
  }
  const ox = b1[0] - a1[0];
  const oz = b1[2] - a1[2];
  const t = (ox * d2z - oz * d2x) / denom;
  const u = (ox * d1z - oz * d1x) / denom;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) {
    return null;
  }
  return { t, x: a1[0] + t * d1x, z: a1[2] + t * d1z };
}

// Tabler icons we map category `icon` strings onto (falls back to a filled dot).
const CAT_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  hammer: IconHammer,
  'map-pin': IconMapPin,
  pin: IconPin,
  triangle: IconTriangle,
  user: IconUser,
};

/** Applies fade level `tv` (0..1) to a subtree: culls it (`visible = false`) once
 *  effectively invisible, otherwise lerps the opacity of every material under it,
 *  capturing each material's original opacity/transparency/depth-write on first
 *  touch. While fading it renders transparent with depth-write off (no self-
 *  overlap / double-side dark patches on solid geometry); fully visible it
 *  restores the original opaque rendering (so nothing looks washed-out at rest).
 *  Both the on-attach apply and the per-frame ramp call this, so visibility and
 *  opacity stay in lockstep from a single place. */
function applyFade(g: THREE.Object3D, tv: number) {
  g.visible = tv > 0.001;
  g.traverse((o) => {
    const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (!mat) {
      return;
    }
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const ud = m.userData;
      if (ud.baseOpacity === undefined) {
        ud.baseOpacity = m.opacity;
        ud.baseTransparent = m.transparent;
        ud.baseDepthWrite = m.depthWrite;
      }
      if (tv >= 0.999) {
        m.opacity = ud.baseOpacity as number;
        m.transparent = ud.baseTransparent as boolean;
        m.depthWrite = ud.baseDepthWrite as boolean;
      } else {
        m.transparent = true;
        m.depthWrite = false;
        m.opacity = (ud.baseOpacity as number) * tv;
      }
    }
  });
}

/** Smoothly fades a 3D subtree in/out by lerping the opacity of every material
 *  it contains. Once fully hidden it either **unmounts** the subtree (default —
 *  a toggled-off layer then costs nothing: no draw calls, raycasts, or geometry)
 *  or, with `cull`, keeps it mounted but `visible = false` (zero draw/raycast,
 *  geometry stays resident). Use `cull` for one heavy mesh you re-toggle often
 *  (e.g. terrain): it avoids the remount shader-recompile hitch on fade-in. The
 *  per-frame work early-returns once settled. */
export function Fade({
  children,
  cull = false,
  speed = 9,
  visible,
}: {
  visible: boolean;
  children: React.ReactNode;
  /** Keep mounted (cull via `visible=false`) instead of unmounting when hidden. */
  cull?: boolean;
  speed?: number;
}) {
  const [mounted, setMounted] = useState(visible);
  const group = useRef<THREE.Group | null>(null);
  const t = useRef(visible ? 1 : 0);

  // Mount immediately when becoming visible (render-phase adjust — no effect).
  if (visible && !mounted) {
    setMounted(true);
  }

  // Apply the current fade level the instant the group attaches (ref callbacks
  // run during commit, before paint) — so a re-shown layer's first painted frame
  // is already at the right (near-zero) opacity instead of flashing full, which
  // is what caused the fade-in "chop".
  const setGroup = useCallback((g: THREE.Group | null) => {
    group.current = g;
    if (g) {
      applyFade(g, t.current);
    }
  }, []);

  useFrame((_, dt) => {
    const target = visible ? 1 : 0;
    if (t.current === target || !group.current) {
      return;
    }
    t.current += (target - t.current) * (1 - Math.exp(-dt * speed));
    if (Math.abs(target - t.current) < 0.004) {
      t.current = target;
    }
    // applyFade re-shows the subtree (visible=true) as soon as tv climbs, and
    // culls it (visible=false) once tv hits ~0 — so cull mode needs no extra work.
    applyFade(group.current, t.current);
    if (target === 0 && t.current === 0 && !cull) {
      // Not culling → unmount so the hidden layer costs nothing at all.
      setMounted(false);
    }
  });

  if (!mounted) {
    return null;
  }
  return <group ref={setGroup}>{children}</group>;
}

/** DOM counterpart to {@link Fade}: fades an HTML overlay in/out with the same
 *  animate-in/out idiom the markers use, then **unmounts** it once hidden. The
 *  lone effect is a legitimate deferred-unmount timer (not derived state). Use
 *  inside a drei `<Html>` for labels/badges that should fade with their layer. */
export function FadeHtml({
  children,
  className,
  durationMs = 250,
  visible,
}: {
  visible: boolean;
  children: React.ReactNode;
  className?: string;
  durationMs?: number;
}) {
  const [mounted, setMounted] = useState(visible);
  // Mount immediately when shown (render-phase adjust — no effect needed).
  if (visible && !mounted) {
    setMounted(true);
  }
  // Keep the node for one fade-out, then drop it so hidden overlays cost nothing.
  useEffect(() => {
    if (visible) {
      return;
    }
    const t = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(t);
  }, [visible, durationMs]);

  if (!mounted) {
    return null;
  }
  return (
    <div
      className={`fill-mode-forwards ${visible ? 'animate-in fade-in' : 'animate-out fade-out'} ${className ?? ''}`}
      style={{ animationDuration: `${durationMs}ms` }}
    >
      {children}
    </div>
  );
}

/** Morphs a terrain mesh between flat (`factor` 0 — every vertex height → 0) and
 *  full DEM relief (`factor` 1), writing both the height and a lerped normal in a
 *  single in-place pass. Normals interpolate between straight-up (flat) and the
 *  precomputed relief normals, so shading stays correct without a per-frame
 *  `computeVertexNormals` (the expensive call we deliberately avoid). */
function applyMorph(
  geo: THREE.BufferGeometry,
  baseY: Float32Array,
  baseN: Float32Array,
  factor: number,
) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const p = pos.array as Float32Array;
  const na = nrm.array as Float32Array;
  const inv = 1 - factor;
  for (let k = 0; k < baseY.length; k++) {
    const i = k * 3;
    p[i + 1] = baseY[k] * factor;
    // Lerp normal: flat → (0,1,0), relief → baseN. Then normalize.
    const nx = baseN[i] * factor;
    const ny = inv + baseN[i + 1] * factor;
    const nz = baseN[i + 2] * factor;
    const len = Math.hypot(nx, ny, nz) || 1;
    na[i] = nx / len;
    na[i + 1] = ny / len;
    na[i + 2] = nz / len;
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}

/** The terrain surface mesh. Beyond the opacity fade (handled by the wrapping
 *  {@link Fade}), it lerps every vertex's height between flat and full relief in
 *  step with its own toggle: `relief` true → grows up to the DEM, false → settles
 *  flat. The morph runs only while transitioning and early-returns once settled,
 *  so it costs nothing at rest. Listens to `relief` alone — the link to other
 *  toggles (e.g. "project onto terrain") is made by driving the toggles together,
 *  not by reading their state here. */
export function TerrainSurface({
  color,
  geometry,
  relief,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  /** Target shape: true → full DEM relief, false → flat plane. */
  relief: boolean;
}) {
  const baseY = useRef<Float32Array | null>(null);
  const baseN = useRef<Float32Array | null>(null);
  const factor = useRef(relief ? 1 : 0);

  // Snapshot the pristine heights/normals and apply the initial factor the moment
  // the mesh attaches (ref callbacks run pre-paint) — so terrain that loads while
  // its toggle is off starts flat instead of flashing full relief for one frame.
  // `geometry` identity drives a remount via `key`, so no deps are needed.
  const setMesh = useCallback((mesh: THREE.Mesh | null) => {
    if (!mesh) {
      return;
    }
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const n = pos.count;
    const by = new Float32Array(n);
    const bn = new Float32Array(n * 3);
    const p = pos.array as Float32Array;
    const na = nrm.array as Float32Array;
    for (let k = 0; k < n; k++) {
      by[k] = p[k * 3 + 1];
      bn[k * 3] = na[k * 3];
      bn[k * 3 + 1] = na[k * 3 + 1];
      bn[k * 3 + 2] = na[k * 3 + 2];
    }
    baseY.current = by;
    baseN.current = bn;
    applyMorph(geo, by, bn, factor.current);
  }, []);

  useFrame((_, dt) => {
    const target = relief ? 1 : 0;
    if (factor.current === target || !baseY.current || !baseN.current) {
      return;
    }
    factor.current += (target - factor.current) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - factor.current) < 0.002) {
      factor.current = target;
    }
    applyMorph(geometry, baseY.current, baseN.current, factor.current);
  });

  return (
    <mesh ref={setMesh} geometry={geometry}>
      <meshStandardMaterial
        color={color}
        vertexColors
        transparent
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

const LERP_EPS = 1e-4;

/** Eases a flat `[x,y,z,…]` buffer toward a `Vec3[]` target in place; returns
 *  whether anything moved past the epsilon, so callers can skip the (costly)
 *  geometry upload once a polyline has settled. */
function lerpPoints(cur: number[], target: Vec3[], k: number): boolean {
  let moved = false;
  for (let i = 0; i < target.length; i++) {
    const o = i * 3;
    for (let a = 0; a < 3; a++) {
      const d = target[i][a] - cur[o + a];
      if (d > LERP_EPS || d < -LERP_EPS) {
        cur[o + a] += d * k;
        moved = true;
      }
    }
  }
  return moved;
}

/** Eases a group's position toward a `Vec3` target; returns whether it moved. */
function lerpGroupPos(g: THREE.Group | null, target: Vec3, k: number): boolean {
  if (!g) {
    return false;
  }
  const p = g.position;
  let moved = false;
  const dx = target[0] - p.x;
  const dy = target[1] - p.y;
  const dz = target[2] - p.z;
  if (dx > LERP_EPS || dx < -LERP_EPS) {
    p.x += dx * k;
    moved = true;
  }
  if (dy > LERP_EPS || dy < -LERP_EPS) {
    p.y += dy * k;
    moved = true;
  }
  if (dz > LERP_EPS || dz < -LERP_EPS) {
    p.z += dz * k;
    moved = true;
  }
  return moved;
}

/** drei `<Line>` exposes a `LineGeometry` (with `setPositions`) on a `Line2` that
 *  also has `computeLineDistances` (needed for dashes). Pushes new points to it. */
type DreiLine = {
  geometry: { setPositions: (a: number[]) => void };
  computeLineDistances: () => void;
};
function setLinePoints(obj: DreiLine | null, pts: number[], dashed = false) {
  if (!obj) {
    return;
  }
  obj.geometry.setPositions(pts);
  if (dashed) {
    obj.computeLineDistances();
  }
}

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
      toLocal(frame, lat, lon, drapedHeight(sample, lat, lon, h) + lift);
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
    const kp = 1 - Math.exp(-dt * 6);
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
      t.current += (ht - t.current) * (1 - Math.exp(-dt * 9));
      if (Math.abs(ht - t.current) < 0.002) {
        t.current = ht;
      }
      changed = true;
    }
    if (vis.current !== vt) {
      vis.current += (vt - vis.current) * (1 - Math.exp(-dt * 9));
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
    lerpGroupPos(groupRef.current, p, 1 - Math.exp(-dt * 6));
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
            <Line
              key={l.key}
              points={l.points}
              color={OVERLAY_COLOR}
              lineWidth={1.2}
              transparent
              opacity={0.9}
            />
          ))}
        </Fade>
      ))}
    </>
  );
}

// Matte building shades — a touch darker than the clay terrain in light mode and
// a touch lighter in dark mode, so footprints read as solid massing either way.
export const BUILDING_COLOR = { dark: '#3b424f', light: '#d6dbe3' };
// Minimum extrusion so flat/zero-height OSM footprints still read as buildings.
const MIN_BUILDING_HEIGHT = 3;

/** OSM building footprints, extruded into matte prisms. Each lat/lon ring becomes
 * a `THREE.Shape` in the local frame, extruded by its height, and lifted so its
 * base sits on the sampled ground elevation. To keep buildings within the visible
 * terrain, each footprint is culled past the terrain tile's fade radius and given
 * a per-vertex alpha matching the terrain's radial gradient, so they dissolve into
 * the background in step with the terrain edge instead of floating on white. All
 * footprints merge into one geometry to keep the draw-call count low. */
export function Buildings({
  buildings,
  center,
  color,
  frame,
  radius,
  sample,
}: {
  buildings: BuildingFootprint[];
  /** Terrain tile centre in local meters (null when no terrain is loaded). */
  center: { x: number; z: number } | null;
  color: string;
  frame: Frame;
  /** Terrain tile half-diagonal in meters (null when no terrain is loaded). */
  radius: number | null;
  sample: Sampler;
}) {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const b of buildings) {
      if (!b.poly || b.poly.length < 3) {
        continue;
      }
      const shape = new THREE.Shape();
      let sumX = 0;
      let sumZ = 0;
      let sumLat = 0;
      let sumLon = 0;
      b.poly.forEach(([lat, lon], i) => {
        const [x, , z] = toLocal(frame, lat, lon, 0);
        // Shape is XY; rotateX(-90°) maps shape-X→world-X and shape-(-Y)→world-Z,
        // so negate z here to keep footprints un-mirrored. Extrude depth → world-Y.
        if (i === 0) {
          shape.moveTo(x, -z);
        } else {
          shape.lineTo(x, -z);
        }
        sumX += x;
        sumZ += z;
        sumLat += lat;
        sumLon += lon;
      });
      const n = b.poly.length;
      // Radial alpha from the terrain centre — cull (and fade) to the terrain edge.
      let alpha = 1;
      if (center && radius) {
        const frac = Math.hypot(sumX / n - center.x, sumZ / n - center.z) / radius;
        if (frac >= TERRAIN_FADE_END) {
          continue; // beyond the visible terrain — would float, so drop it
        }
        alpha =
          1 - smoothstep((frac - TERRAIN_FADE_START) / (TERRAIN_FADE_END - TERRAIN_FADE_START));
      }
      const height = Math.max(b.height || 0, MIN_BUILDING_HEIGHT);
      let geo: THREE.ExtrudeGeometry;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { bevelEnabled: false, depth: height });
      } catch {
        continue; // self-intersecting ring earcut can throw — skip it
      }
      geo.rotateX(-Math.PI / 2);
      if (sample) {
        const e = sample(sumLat / n, sumLon / n);
        if (e !== null) {
          geo.translate(0, e, 0);
        }
      }
      // Bake the building's alpha into a per-vertex RGBA color (RGB stays white so
      // the material tint shows through; alpha drives the edge dissolve).
      const vcount = geo.attributes.position.count;
      const colors = new Float32Array(vcount * 4);
      for (let k = 0; k < vcount; k++) {
        colors[k * 4] = 1;
        colors[k * 4 + 1] = 1;
        colors[k * 4 + 2] = 1;
        colors[k * 4 + 3] = alpha;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      parts.push(geo);
    }
    if (parts.length === 0) {
      return null;
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (merged) {
      merged.computeVertexNormals();
    }
    return merged;
  }, [buildings, frame, sample, center, radius]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) {
    return null;
  }
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        vertexColors
        transparent
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

interface Marker {
  color: string;
  Icon: ComponentType<{ className?: string }>;
  id?: string;
  key: string;
  label: string;
  p: [number, number, number];
}

/** One floating pin per point — control points first (always shown), then the
 * visible survey points. No clustering: every point gets its own marker. */
export function useMarkers(
  scene: SceneData,
  frame: Frame,
  categories: PointCategory[],
  visibleCategoryIds: Set<string> | null,
  visibleIds: Set<string> | null,
  sample: Sampler,
): Marker[] {
  return useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]));
    const out: Marker[] = [];
    // Each point is placed independently: a point with no Z (height 0) is draped
    // onto the terrain surface so it sits on the ground; a point with a real Z
    // keeps it. We do NOT assume control points lie exactly on the DEM.
    const place = (lat: number, lon: number, h: number): [number, number, number] =>
      toLocal(frame, lat, lon, drapedHeight(sample, lat, lon, h));

    for (const cp of scene.controlPoints) {
      out.push({
        color: CONTROL_COLOR,
        Icon: IconCurrentLocation,
        key: `c-${cp.label}-${cp.easting}`,
        label: cp.label,
        p: place(cp.latitude, cp.longitude, cp.height),
      });
    }

    for (const sp of scene.surveyPoints) {
      if (visibleCategoryIds && sp.categoryId && !visibleCategoryIds.has(sp.categoryId)) {
        continue;
      }
      // Group filter: when active, show only points that belong to the group.
      if (visibleIds && (!sp.id || !visibleIds.has(sp.id))) {
        continue;
      }
      const cat = sp.categoryId ? catById.get(sp.categoryId) : undefined;
      out.push({
        color: cat?.color ?? DEFAULT_POINT_COLOR,
        Icon: (cat && CAT_ICONS[cat.icon]) ?? IconPointFilled,
        id: sp.id ?? undefined,
        key: `s-${sp.id ?? `${sp.easting},${sp.northing}`}`,
        label: sp.label,
        p: place(sp.latitude, sp.longitude, sp.height),
      });
    }
    return out;
  }, [
    scene.controlPoints,
    scene.surveyPoints,
    frame,
    categories,
    visibleCategoryIds,
    visibleIds,
    sample,
  ]);
}

const EXIT_MS = 220;

/** Shared enter/exit presence for any keyed list. Live items render immediately;
 *  removed ones linger (flagged `exiting`) for `exitMs` so they can animate out
 *  before unmounting, then are dropped. Keying preserves identity so unchanged
 *  items don't re-animate. Use for markers and any other animated list. */
export function usePresence<T extends { key: string }>(
  items: T[],
  exitMs = EXIT_MS,
): (T & { exiting: boolean })[] {
  type Present = T & { exiting: boolean };
  const [present, setPresent] = useState<Present[]>(() =>
    items.map((m) => ({ ...m, exiting: false })),
  );
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const liveKeys = new Set(items.map((m) => m.key));
    // A returning key cancels its pending exit.
    for (const key of liveKeys) {
      const t = timers.current.get(key);
      if (t) {
        clearTimeout(t);
        timers.current.delete(key);
      }
    }
    setPresent((prev) => {
      const gone = prev.filter((m) => !liveKeys.has(m.key));
      for (const m of gone) {
        if (!timers.current.has(m.key)) {
          const t = setTimeout(() => {
            timers.current.delete(m.key);
            setPresent((cur) => cur.filter((x) => x.key !== m.key));
          }, exitMs);
          timers.current.set(m.key, t);
        }
      }
      return [
        ...items.map((m) => ({ ...m, exiting: false })),
        ...gone.map((m) => ({ ...m, exiting: true })),
      ];
    });
  }, [items, exitMs]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) {
        clearTimeout(t);
      }
    };
  }, []);

  return present;
}

type PresentMarker = Marker & { exiting: boolean };

/** One marker pin. The group is seeded at its spawn position exactly **once**
 *  (guarded by `seeded`), then only the parent's `useFrame` moves it — gliding it
 *  toward the latest target. The guard must survive ref churn: an inline ref
 *  re-fires null→node on every re-render (and any ancestor re-render re-renders
 *  this), and `null` deletes the group from the map — so a `map.has()` guard would
 *  wrongly re-seed and snap the pin to its spawn on each toggle. A per-instance
 *  `seeded` ref doesn't get cleared by that churn, so seeding stays one-shot. */
function MarkerNode({
  groups,
  m,
  onSelectPoint,
}: {
  m: PresentMarker;
  groups: React.RefObject<Map<string, THREE.Group>>;
  onSelectPoint?: (id: string) => void;
}) {
  // Capture the spawn position once; later target changes flow through the parent
  // loop, never by resetting the group here.
  const spawn = useRef(m.p);
  const seeded = useRef(false);

  return (
    <group
      ref={(g) => {
        if (g) {
          if (!seeded.current) {
            g.position.set(spawn.current[0], spawn.current[1], spawn.current[2]);
            seeded.current = true;
          }
          groups.current.set(m.key, g);
        } else {
          groups.current.delete(m.key);
        }
      }}
    >
      <Html position={[0, 0, 0]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          title={m.label}
          disabled={!m.id || m.exiting}
          onClick={() => m.id && onSelectPoint?.(m.id)}
          className={`flex -translate-y-1/2 flex-col items-center duration-300 ${
            m.exiting
              ? 'animate-out fade-out-0 zoom-out-50 pointer-events-none'
              : 'animate-in fade-in-0 zoom-in-50'
          }`}
          style={{ pointerEvents: m.id && !m.exiting ? 'auto' : 'none' }}
        >
          <span
            className="flex size-7 items-center justify-center rounded-full border-2 border-white shadow-md transition-colors duration-300"
            style={{ backgroundColor: m.color }}
          >
            <m.Icon className="size-4 text-white" />
          </span>
          <span
            className="-mt-1 size-2 rotate-45 border-r-2 border-b-2 border-white transition-colors duration-300"
            style={{ backgroundColor: m.color }}
          />
        </button>
      </Html>
    </group>
  );
}

export function Markers({
  markers,
  onSelectPoint,
}: {
  markers: Marker[];
  onSelectPoint?: (id: string) => void;
}) {
  const present = usePresence(markers);
  const groups = useRef<Map<string, THREE.Group>>(new Map());
  // Per-key target positions, rebuilt only when the marker set/positions change.
  const targets = useMemo(() => new Map(present.map((m) => [m.key, m.p])), [present]);

  // A single loop glides every marker toward its target position, so toggling
  // "project onto terrain" (which re-drapes point heights) animates smoothly.
  // Settled markers early-out, so idle cost is just a cheap distance check each.
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 6);
    for (const [key, g] of groups.current) {
      const tp = targets.get(key);
      if (!tp) {
        continue;
      }
      const dx = tp[0] - g.position.x;
      const dy = tp[1] - g.position.y;
      const dz = tp[2] - g.position.z;
      if (dx * dx + dy * dy + dz * dz < 1e-6) {
        continue;
      }
      g.position.set(g.position.x + dx * k, g.position.y + dy * k, g.position.z + dz * k);
    }
  });

  return (
    <>
      {present.map((m) => (
        <MarkerNode key={m.key} m={m} groups={groups} onSelectPoint={onSelectPoint} />
      ))}
    </>
  );
}

/** Planar scene bounds (centre x/z + extent, meters) for camera framing. Prefers
 * the building-grid extent (the camera orbits the grid centre); falls back to the
 * points when there's no grid. Y is resolved separately so it can track terrain. */
export function useBounds(scene: SceneData, frame: Frame): { cx: number; cz: number; ext: number } {
  return useMemo(() => {
    const coords: { latitude: number; longitude: number }[] = scene.gridLines.length
      ? scene.gridLines.flatMap((l) => l.coordinates)
      : [...scene.controlPoints, ...scene.surveyPoints];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of coords) {
      const [x, , z] = toLocal(frame, p.latitude, p.longitude, 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) {
      return { cx: 0, cz: 0, ext: 120 };
    }
    const ext = Math.max(maxX - minX, maxZ - minZ, 40);
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, ext };
  }, [scene.gridLines, scene.controlPoints, scene.surveyPoints, frame]);
}
