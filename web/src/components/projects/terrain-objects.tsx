'use client';

import { Html, Line } from '@react-three/drei';
import {
  IconCurrentLocation,
  IconHammer,
  IconMapPin,
  IconPin,
  IconPointFilled,
  IconTriangle,
  IconUser,
} from '@tabler/icons-react';
import { type ComponentType, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { PointCategory, SceneData } from '@/lib/types';

import { dxfExtent } from '@/lib/dxf';
import { drapedHeight } from '@/lib/terrain';

import type { BuildingFootprint, RenderableOverlay } from './terrain-shared';

import { type Frame, type Sampler, toLocal, type Vec3 } from './terrain-frame';
import { TERRAIN_FADE_END, TERRAIN_FADE_START } from './terrain-mesh';

const CONTROL_COLOR = '#ef4444';
// Uncategorized survey points: a neutral slate that doesn't collide with the
// default category palette (red / blue / green / amber / …).
const DEFAULT_POINT_COLOR = '#475569';
const GRID_COLOR = '#94a3b8';

// Tabler icons we map category `icon` strings onto (falls back to a filled dot).
const CAT_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  hammer: IconHammer,
  'map-pin': IconMapPin,
  pin: IconPin,
  triangle: IconTriangle,
  user: IconUser,
};
/** Building-grid axes. Each axis is drawn solid across its span and extended a
 * little past both ends with a dashed lead-out, so the labels sit clear of the
 * point pins. When `sample` is set, lines are subdivided + draped onto terrain. */
export function GridLines({
  frame,
  sample,
  scene,
}: {
  scene: SceneData;
  frame: Frame;
  sample: Sampler;
}) {
  const lines = useMemo(() => {
    const steps = sample ? 24 : 1; // subdivide for a smooth drape
    const lift = sample ? 0.25 : 0; // avoid z-fighting with the surface
    const ext = 0.28; // extend each end by this fraction of the line length
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const place = (lat: number, lon: number, h: number): Vec3 =>
      toLocal(frame, lat, lon, drapedHeight(sample, lat, lon, h) + lift);
    // Draped polyline between two lat/lon/height endpoints.
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

    return scene.gridLines
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
  }, [scene.gridLines, frame, sample]);

  if (lines.length === 0) {
    return null;
  }
  return (
    <group>
      {lines.map((l) => (
        <group key={l.key}>
          <Line points={l.main} color={GRID_COLOR} lineWidth={1.2} transparent opacity={0.8} />
          <Line
            points={l.leadA}
            color={GRID_COLOR}
            lineWidth={1}
            dashed
            dashSize={1.5}
            gapSize={1.5}
            transparent
            opacity={0.55}
          />
          <Line
            points={l.leadB}
            color={GRID_COLOR}
            lineWidth={1}
            dashed
            dashSize={1.5}
            gapSize={1.5}
            transparent
            opacity={0.55}
          />
          {[l.labelA, l.labelB].map((p, j) => (
            <Html
              key={j}
              position={p}
              center
              zIndexRange={[5, 0]}
              style={{ pointerEvents: 'none' }}
            >
              <span className="bg-background/85 text-muted-foreground rounded border px-1 text-[10px] leading-none font-semibold shadow-sm">
                {l.text}
              </span>
            </Html>
          ))}
        </group>
      ))}
    </group>
  );
}

const OVERLAY_COLOR = '#f59e0b';

/** Georeferenced DXF overlays as amber linework. Each polyline's drawing (x, y)
 * is placed by its offset/rotation/scale into projected E/N, then mapped to the
 * local frame via the project's projected origin. The drawing renders FLAT at the
 * overlay's elevation (a reference plane at any Z), not draped onto terrain.
 * Hidden layers are skipped. */
export function DxfOverlays({
  originE,
  originN,
  overlays,
  shownLayers,
}: {
  overlays: RenderableOverlay[];
  originE: number;
  originN: number;
  shownLayers?: Set<string>;
}) {
  const lines = useMemo(() => {
    const out: { key: string; points: Vec3[] }[] = [];
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
        // Only render layers the user has opted in (none by default).
        if (!shownLayers?.has(pl.layer)) {
          return;
        }
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
        out.push({ key: `${ov.id}-${i}`, points });
      });
    }
    return out;
  }, [overlays, originE, originN, shownLayers]);

  if (lines.length === 0) {
    return null;
  }
  return (
    <group>
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
    </group>
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
    const smooth = (t: number) => {
      const c = Math.min(Math.max(t, 0), 1);
      return c * c * (3 - 2 * c);
    };
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
        alpha = 1 - smooth((frac - TERRAIN_FADE_START) / (TERRAIN_FADE_END - TERRAIN_FADE_START));
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

export function Markers({
  markers,
  onSelectPoint,
}: {
  markers: Marker[];
  onSelectPoint?: (id: string) => void;
}) {
  return (
    <>
      {markers.map((m) => (
        <Html key={m.key} position={m.p} center zIndexRange={[20, 0]}>
          <button
            type="button"
            title={m.label}
            disabled={!m.id}
            onClick={() => m.id && onSelectPoint?.(m.id)}
            className="flex -translate-y-1/2 flex-col items-center"
            style={{ pointerEvents: m.id ? 'auto' : 'none' }}
          >
            <span
              className="flex size-7 items-center justify-center rounded-full border-2 border-white shadow-md"
              style={{ backgroundColor: m.color }}
            >
              <m.Icon className="size-4 text-white" />
            </span>
            <span
              className="-mt-1 size-2 rotate-45 border-r-2 border-b-2 border-white"
              style={{ backgroundColor: m.color }}
            />
          </button>
        </Html>
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
