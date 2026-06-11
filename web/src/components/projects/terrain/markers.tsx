'use client';

import { Html } from '@react-three/drei';
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
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import type { PointCategory, SceneData } from '@/lib/types';

import { drapeTo, type Frame, type Sampler } from '../terrain-frame';
import { easeFactor } from './lerp';

const CONTROL_COLOR = '#ef4444';
// Uncategorized survey points: a neutral slate that doesn't collide with the
// default category palette (red / blue / green / amber / …).
const DEFAULT_POINT_COLOR = '#475569';

// Tabler icons we map category `icon` strings onto (falls back to a filled dot).
const CAT_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  hammer: IconHammer,
  'map-pin': IconMapPin,
  pin: IconPin,
  triangle: IconTriangle,
  user: IconUser,
};

interface Marker {
  color: string;
  Icon: ComponentType<{ className?: string }>;
  id?: string;
  key: string;
  label: string;
  p: [number, number, number];
}

/** One floating pin per point — control points first (always shown), then the
 * visible survey points. No clustering: every point gets its own marker.
 *
 * Split in two stages so toggling a category/group doesn't re-sample the DEM:
 * stage 1 drapes every point (re-runs only when points/frame/terrain change),
 * stage 2 filters + colorizes against the precomputed positions. */
export function useMarkers(
  scene: SceneData,
  frame: Frame,
  categories: PointCategory[],
  visibleCategoryIds: Set<string> | null,
  visibleIds: Set<string> | null,
  sample: Sampler,
): Marker[] {
  // Stage 1 — drape positions. A point with no Z (height 0) sits on the terrain
  // surface; a point with a real Z keeps it. We don't assume points lie on the DEM.
  const positions = useMemo(
    () => ({
      control: scene.controlPoints.map((p) =>
        drapeTo(frame, sample, p.latitude, p.longitude, p.height),
      ),
      survey: scene.surveyPoints.map((p) =>
        drapeTo(frame, sample, p.latitude, p.longitude, p.height),
      ),
    }),
    [scene.controlPoints, scene.surveyPoints, frame, sample],
  );

  // Stage 2 — filter + colorize (cheap; no DEM sampling).
  return useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]));
    const out: Marker[] = [];

    scene.controlPoints.forEach((cp, i) => {
      out.push({
        color: CONTROL_COLOR,
        Icon: IconCurrentLocation,
        key: `c-${cp.label}-${cp.easting}`,
        label: cp.label,
        p: positions.control[i],
      });
    });

    scene.surveyPoints.forEach((sp, i) => {
      if (visibleCategoryIds && sp.categoryId && !visibleCategoryIds.has(sp.categoryId)) {
        return;
      }
      // Group filter: when active, show only points that belong to the group.
      if (visibleIds && (!sp.id || !visibleIds.has(sp.id))) {
        return;
      }
      const cat = sp.categoryId ? catById.get(sp.categoryId) : undefined;
      out.push({
        color: cat?.color ?? DEFAULT_POINT_COLOR,
        Icon: (cat && CAT_ICONS[cat.icon]) ?? IconPointFilled,
        id: sp.id ?? undefined,
        key: `s-${sp.id ?? `${sp.easting},${sp.northing}`}`,
        label: sp.label,
        p: positions.survey[i],
      });
    });
    return out;
  }, [
    scene.controlPoints,
    scene.surveyPoints,
    positions,
    categories,
    visibleCategoryIds,
    visibleIds,
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
    const k = easeFactor(dt, 6);
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
