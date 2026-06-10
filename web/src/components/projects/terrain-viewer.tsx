'use client';

import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  IconCurrentLocation,
  IconHammer,
  IconMapPin,
  IconPin,
  IconPointFilled,
  IconTriangle,
  IconUser,
} from '@tabler/icons-react';
import { fromArrayBuffer } from 'geotiff';
import { useTheme } from 'next-themes';
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { PointCategory, SceneData } from '@/lib/types';

import { drapedHeight, isValidElevation, sampleElevation } from '@/lib/terrain';

// `@react-three/fiber`'s render loop still constructs a `THREE.Clock`, which
// three r184 deprecated in favor of `THREE.Timer`. It's an upstream-only fix, so
// until fiber updates we drop just that one (harmless) deprecation line.
if (typeof window !== 'undefined') {
  const w = window as unknown as { __slClockWarnPatched?: boolean };
  if (!w.__slClockWarnPatched) {
    w.__slClockWarnPatched = true;
    /* eslint-disable no-console */
    const original = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('THREE.Clock')) {
        return;
      }
      original(...(args as []));
    };
    /* eslint-enable no-console */
  }
}

const CONTROL_COLOR = '#ef4444';
// Uncategorized survey points: a neutral slate that doesn't collide with the
// default category palette (red / blue / green / amber / …).
const DEFAULT_POINT_COLOR = '#475569';
const GRID_COLOR = '#94a3b8';
// Idle "attract" orbit: after IDLE_DELAY seconds without interaction the camera
// continuously rotates around the target, very slowly (radians/second).
const IDLE_DELAY = 10;
const ORBIT_SPEED = 0.04; // ~2.6 min per full revolution
// Matte "clay" palette — soft and bright in light mode, a deep neutral with the
// same matte feel in dark mode. Clay sits a touch lighter than the background so
// relief reads under the soft lighting.
const PALETTE = {
  dark: { bg: '#12151b', clay: '#2c323d' },
  light: { bg: '#eef1f5', clay: '#e7eaee' },
};
// Radial alpha falloff for the terrain tile, as fractions of the tile's
// half-diagonal: fully opaque within FADE_START, fully transparent beyond
// FADE_END. Buildings reuse these so they dissolve in step with the terrain edge.
const TERRAIN_FADE_START = 0.12;
const TERRAIN_FADE_END = 0.62;

/** Predefined camera viewpoints offered by the view selector. */
export type CameraView = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso';
export const CAMERA_VIEWS: { value: CameraView; label: string }[] = [
  { label: 'Top', value: 'top' },
  { label: 'Front', value: 'front' },
  { label: 'Back', value: 'back' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
  { label: 'Isometric', value: 'iso' },
];

// Tabler icons we map category `icon` strings onto (falls back to a filled dot).
const CAT_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  hammer: IconHammer,
  'map-pin': IconMapPin,
  pin: IconPin,
  triangle: IconTriangle,
  user: IconUser,
};

/** The cached DEM, ready to mesh. */
export interface TerrainData {
  /** Base64-encoded GeoTIFF bytes (from `projectTerrainContent`). */
  contentBase64: string;
}

/** An OSM building footprint (from `projectBuildingsContent`): a lat/lon ring
 * plus an estimated height in meters. Visual context only. */
export interface BuildingFootprint {
  /** Estimated height in meters. */
  height: number;
  /** Outer ring as [lat, lon] pairs. */
  poly: [number, number][];
}

/** A parsed + georeferenced DXF overlay, ready to draw. */
export interface RenderableOverlay {
  id: string;
  offsetE: number;
  offsetN: number;
  polylines: { layer: string; points: { x: number; y: number }[] }[];
  rotationDeg: number;
  scale: number;
}

export interface TerrainViewerProps {
  /** OSM building footprints to extrude (visual context only). */
  buildings?: BuildingFootprint[];
  /** When set, the viewer assigns a function that downloads the canvas as a PNG. */
  captureRef?: React.MutableRefObject<(() => void) | null>;
  categories: PointCategory[];
  /** Move the camera to a point. `nonce` re-triggers. */
  focus?: { lon: number; lat: number; height: number; id: string; nonce: number };
  /** DXF layer names to hide. */
  hiddenLayers?: Set<string>;
  /** Called with a survey point id when picked in 3D. */
  onSelectPoint?: (id: string) => void;
  originProjectedE?: number | null;
  originProjectedN?: number | null;
  /** Georeferenced DXF overlays to draw, with the project's projected origin. */
  overlays?: RenderableOverlay[];
  /** Drape zero-elevation points + grid lines onto the terrain surface. */
  projectOnTerrain?: boolean;
  scene: SceneData;
  /** Whether to render the extruded OSM buildings. */
  showBuildings?: boolean;
  /** Whether to draw the building-grid lines + labels. */
  showGrid?: boolean;
  /** Master toggle for drawing the DXF overlays. */
  showOverlays?: boolean;
  /** Whether to show the point pins (control + survey markers). */
  showPins?: boolean;
  /** Whether to render the terrain mesh. */
  showTerrain?: boolean;
  terrain?: TerrainData | null;
  /** Active camera preset; `viewNonce` re-applies it even if unchanged. */
  view?: CameraView;
  viewNonce?: number;
  /** Category ids to show; null shows all. Points without a category always show. */
  visibleCategoryIds: Set<string> | null;
  /** Survey-point ids to show (group filter); null shows all. */
  visibleIds?: Set<string> | null;
}

/** A flat-Earth ENU frame anchored at a reference lat/lon. Good for site-scale. */
interface Frame {
  lat0: number;
  lon0: number;
  mPerLat: number;
  mPerLon: number;
}

function makeFrame(scene: SceneData): Frame {
  const ref =
    scene.origin ??
    scene.controlPoints[0] ??
    scene.surveyPoints[0] ??
    ({ latitude: 0, longitude: 0 } as { latitude: number; longitude: number });
  const lat0 = ref.latitude;
  const lon0 = ref.longitude;
  return {
    lat0,
    lon0,
    mPerLat: 111_320,
    mPerLon: 111_320 * Math.cos((lat0 * Math.PI) / 180),
  };
}

/** lat/lon/height → local meters (x east, y up, z south-negative-north). */
function toLocal(f: Frame, lat: number, lon: number, height: number): [number, number, number] {
  return [(lon - f.lon0) * f.mPerLon, height, -(lat - f.lat0) * f.mPerLat];
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

interface TerrainMesh {
  /** Tile centre in local meters. */
  cx: number;
  cz: number;
  geometry: THREE.BufferGeometry;
  /** Mean elevation — fallback for missing samples. */
  meanHeight: number;
  /** Half-diagonal of the tile in meters. */
  radius: number;
  /** Bilinear elevation sampler (meters). Null outside the tile's bbox. */
  sample: (lat: number, lon: number) => number | null;
}

/** Builds the terrain mesh geometry from a GeoTIFF DEM, decimated for the GPU. */
async function buildTerrainGeometry(buf: ArrayBuffer, frame: Frame): Promise<TerrainMesh> {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const rasters = await image.readRasters({ samples: [0] });
  const band = rasters[0] as unknown as ArrayLike<number>;

  const valid = isValidElevation;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < band.length; i++) {
    if (valid(band[i])) {
      sum += band[i];
      count++;
    }
  }
  const meanHeight = count ? sum / count : 0;

  // Decimate to keep the mesh under ~256×256 vertices regardless of DEM size.
  const target = 256;
  const colIdx: number[] = [];
  const rowIdx: number[] = [];
  const stepX = Math.max(1, Math.ceil(w / target));
  const stepZ = Math.max(1, Math.ceil(h / target));
  for (let c = 0; c < w; c += stepX) {
    colIdx.push(c);
  }
  if (colIdx[colIdx.length - 1] !== w - 1) {
    colIdx.push(w - 1);
  }
  for (let r = 0; r < h; r += stepZ) {
    rowIdx.push(r);
  }
  if (rowIdx[rowIdx.length - 1] !== h - 1) {
    rowIdx.push(h - 1);
  }

  const nCols = colIdx.length;
  const nRows = rowIdx.length;
  const positions = new Float32Array(nRows * nCols * 3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let ri = 0; ri < nRows; ri++) {
    const r = rowIdx[ri];
    const lat = north - (r / (h - 1)) * (north - south);
    for (let ci = 0; ci < nCols; ci++) {
      const c = colIdx[ci];
      const lon = west + (c / (w - 1)) * (east - west);
      const raw = band[r * w + c];
      const elev = valid(raw) ? raw : meanHeight;
      const k = ri * nCols + ci;
      const [x, y, z] = toLocal(frame, lat, lon, elev);
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  // Per-vertex RGBA: RGB stays white (the material tints it to the clay color)
  // while the alpha falls off RADIALLY from the tile centre. A radial dissolve
  // (rather than per-edge) leaves no rectangular silhouette — the terrain reads
  // as a soft patch embedded in the background, clear around the data and fully
  // transparent toward the corners. `smoothstep` keeps the falloff gentle.
  const colors = new Float32Array(nRows * nCols * 4);
  const cxg = (minX + maxX) / 2;
  const czg = (minZ + maxZ) / 2;
  const maxR = Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2) || 1;
  const fadeStart = TERRAIN_FADE_START; // fully opaque within this fraction of the radius
  const fadeEnd = TERRAIN_FADE_END; // fully transparent beyond this fraction
  for (let k = 0; k < nRows * nCols; k++) {
    const x = positions[k * 3];
    const z = positions[k * 3 + 2];
    const r = Math.hypot(x - cxg, z - czg) / maxR;
    const t = Math.min(Math.max((r - fadeStart) / (fadeEnd - fadeStart), 0), 1);
    const alpha = 1 - t * t * (3 - 2 * t);
    colors[k * 4] = 1;
    colors[k * 4 + 1] = 1;
    colors[k * 4 + 2] = 1;
    colors[k * 4 + 3] = alpha;
  }

  const indices: number[] = [];
  for (let ri = 0; ri < nRows - 1; ri++) {
    for (let ci = 0; ci < nCols - 1; ci++) {
      const a = ri * nCols + ci;
      const b = a + 1;
      const cc = a + nCols;
      const d = cc + 1;
      indices.push(a, cc, b, b, cc, d);
    }
  }

  // Bilinear elevation sampler over the full-resolution DEM (for draping points
  // and grid lines onto the surface). Returns null outside the tile's bbox.
  const sample = (lat: number, lon: number): number | null =>
    sampleElevation({ band, east, height: h, meanHeight, north, south, west, width: w }, lat, lon);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { cx: cxg, cz: czg, geometry, meanHeight, radius: maxR, sample };
}

/** Exposes a PNG snapshot via captureRef, reading the WebGL canvas back. */
function SnapshotBridge({
  captureRef,
}: {
  captureRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!captureRef) {
      return;
    }
    captureRef.current = () => {
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sitelens-scene.png';
      a.click();
    };
    return () => {
      captureRef.current = null;
    };
  }, [captureRef, gl, scene, camera]);
  return null;
}

/** Camera position + target for a given preset, relative to the scene bounds. */
function presetFor(
  view: CameraView,
  center: [number, number, number],
  ext: number,
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const [cx, cy, cz] = center;
  const target = new THREE.Vector3(cx, cy, cz);
  const d = ext * 1.7;
  const pos = {
    back: new THREE.Vector3(cx, cy + d * 0.45, cz - d),
    front: new THREE.Vector3(cx, cy + d * 0.45, cz + d),
    iso: new THREE.Vector3(cx + d * 0.7, cy + d * 0.75, cz + d * 0.7),
    left: new THREE.Vector3(cx - d, cy + d * 0.45, cz),
    right: new THREE.Vector3(cx + d, cy + d * 0.45, cz),
    top: new THREE.Vector3(cx, cy + d * 1.15, cz + 0.001),
  }[view];
  return { pos, target };
}

/** Drives the camera to presets / focused points, with a smooth glide. */
function CameraRig({
  cx,
  cy,
  cz,
  ext,
  focus,
  frame,
  view,
  viewNonce,
}: {
  cx: number;
  cy: number;
  cz: number;
  ext: number;
  view: CameraView;
  viewNonce: number;
  focus?: TerrainViewerProps['focus'];
  frame: Frame;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3;
    update: () => void;
    addEventListener: (type: string, cb: () => void) => void;
    removeEventListener: (type: string, cb: () => void) => void;
  } | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const ready = useRef(false);
  // Idle "attract" orbit state.
  const interacting = useRef(false);
  const idleFor = useRef(0); // seconds since the last interaction / re-aim
  const reduceMotion = useRef(false);

  // Re-aim on a preset change AND when the grid-center moves (e.g. terrain loads
  // or projection is toggled, which shifts the centre's elevation).
  useEffect(() => {
    goal.current = presetFor(view, [cx, cy, cz], ext);
    idleFor.current = 0;
  }, [view, viewNonce, cx, cy, cz, ext]);

  useEffect(() => {
    if (!focus) {
      return;
    }
    const [x, y, z] = toLocal(frame, focus.lat, focus.lon, focus.height);
    const d = Math.max(ext * 0.35, 30);
    goal.current = {
      pos: new THREE.Vector3(x + d, y + d, z + d),
      target: new THREE.Vector3(x, y, z),
    };
    idleFor.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Pause the idle orbit while the user is driving the camera; resume after a beat.
  useEffect(() => {
    reduceMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!controls) {
      return;
    }
    const onStart = () => {
      interacting.current = true;
      idleFor.current = 0;
      // Abandon any in-progress glide so the user's input takes over immediately.
      goal.current = null;
    };
    const onEnd = () => {
      interacting.current = false;
      idleFor.current = 0;
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [controls]);

  useFrame((_, delta) => {
    if (!controls) {
      return;
    }
    const g = goal.current;
    if (g) {
      // First framing snaps into place; every later change glides smoothly.
      if (!ready.current) {
        camera.position.copy(g.pos);
        controls.target.copy(g.target);
        ready.current = true;
        goal.current = null;
      } else {
        // Frame-rate-independent exponential ease — a low rate makes a slow,
        // smooth glide (~1.5s) regardless of display refresh.
        const k = 1 - Math.exp(-delta * 1.8);
        camera.position.lerp(g.pos, k);
        controls.target.lerp(g.target, k);
        if (camera.position.distanceTo(g.pos) < Math.max(ext * 0.004, 0.25)) {
          goal.current = null;
        }
      }
      controls.update();
    } else if (!interacting.current && !reduceMotion.current) {
      // Inactive state: after a short idle delay, slowly orbit around the target.
      idleFor.current += delta;
      if (idleFor.current >= IDLE_DELAY) {
        const dAngle = ORBIT_SPEED * delta;
        const { target } = controls;
        const px = camera.position.x - target.x;
        const pz = camera.position.z - target.z;
        const cos = Math.cos(dAngle);
        const sin = Math.sin(dAngle);
        camera.position.set(
          target.x + px * cos - pz * sin,
          camera.position.y,
          target.z + px * sin + pz * cos,
        );
        controls.update();
      }
    }
  });
  return null;
}

type Sampler = ((lat: number, lon: number) => number | null) | null;

type Vec3 = [number, number, number];

/** Building-grid axes. Each axis is drawn solid across its span and extended a
 * little past both ends with a dashed lead-out, so the labels sit clear of the
 * point pins. When `sample` is set, lines are subdivided + draped onto terrain. */
function GridLines({ frame, sample, scene }: { scene: SceneData; frame: Frame; sample: Sampler }) {
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
 * local frame via the project's projected origin. Hidden layers are skipped, and
 * vertices drape onto terrain when projecting is enabled. */
function DxfOverlays({
  frame,
  hiddenLayers,
  originE,
  originN,
  overlays,
  sample,
}: {
  overlays: RenderableOverlay[];
  originE: number;
  originN: number;
  frame: Frame;
  sample: Sampler;
  hiddenLayers?: Set<string>;
}) {
  const lines = useMemo(() => {
    const out: { key: string; points: Vec3[] }[] = [];
    for (const ov of overlays) {
      const theta = (ov.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      ov.polylines.forEach((pl, i) => {
        if (hiddenLayers?.has(pl.layer)) {
          return;
        }
        const points = pl.points.map((p): Vec3 => {
          const worldE = ov.offsetE + ov.scale * (p.x * cos - p.y * sin);
          const worldN = ov.offsetN + ov.scale * (p.x * sin + p.y * cos);
          const lx = worldE - originE;
          const lz = -(worldN - originN);
          let y = 0.3;
          if (sample) {
            const lat = frame.lat0 - lz / frame.mPerLat;
            const lon = frame.lon0 + lx / frame.mPerLon;
            const e = sample(lat, lon);
            if (e !== null) {
              y = e + 0.3;
            }
          }
          return [lx, y, lz];
        });
        out.push({ key: `${ov.id}-${i}`, points });
      });
    }
    return out;
  }, [overlays, originE, originN, frame, sample, hiddenLayers]);

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
const BUILDING_COLOR = { dark: '#3b424f', light: '#d6dbe3' };
// Minimum extrusion so flat/zero-height OSM footprints still read as buildings.
const MIN_BUILDING_HEIGHT = 3;

/** OSM building footprints, extruded into matte prisms. Each lat/lon ring becomes
 * a `THREE.Shape` in the local frame, extruded by its height, and lifted so its
 * base sits on the sampled ground elevation. To keep buildings within the visible
 * terrain, each footprint is culled past the terrain tile's fade radius and given
 * a per-vertex alpha matching the terrain's radial gradient, so they dissolve into
 * the background in step with the terrain edge instead of floating on white. All
 * footprints merge into one geometry to keep the draw-call count low. */
function Buildings({
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
function useMarkers(
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

function Markers({
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
function useBounds(scene: SceneData, frame: Frame): { cx: number; cz: number; ext: number } {
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

export function TerrainViewer(props: TerrainViewerProps) {
  const {
    buildings,
    captureRef,
    categories,
    focus,
    hiddenLayers,
    onSelectPoint,
    originProjectedE,
    originProjectedN,
    overlays,
    projectOnTerrain = true,
    scene,
    showBuildings = true,
    showGrid = true,
    showOverlays = true,
    showPins = true,
    showTerrain = true,
    terrain,
    view = 'iso',
    viewNonce = 0,
    visibleCategoryIds,
    visibleIds,
  } = props;
  const frame = useMemo(() => makeFrame(scene), [scene]);
  const { cx, cz, ext } = useBounds(scene, frame);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const palette = isDark ? PALETTE.dark : PALETTE.light;
  const buildingColor = isDark ? BUILDING_COLOR.dark : BUILDING_COLOR.light;

  const [terrainMesh, setTerrainMesh] = useState<TerrainMesh | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTerrainMesh(null);
    if (!terrain?.contentBase64) {
      return;
    }
    (async () => {
      try {
        const built = await buildTerrainGeometry(base64ToArrayBuffer(terrain.contentBase64), frame);
        if (cancelled) {
          built.geometry.dispose();
        } else {
          setTerrainMesh(built);
        }
      } catch {
        /* terrain is a backdrop; ignore parse failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terrain?.contentBase64, frame]);

  // Dispose the final geometry when the viewer unmounts / is replaced.
  useEffect(() => () => terrainMesh?.geometry.dispose(), [terrainMesh]);

  // The terrain elevation sampler, only when projecting is enabled + loaded.
  const sampler: Sampler = projectOnTerrain ? (terrainMesh?.sample ?? null) : null;

  const markers = useMarkers(
    scene,
    frame,
    categories,
    visibleCategoryIds,
    visibleIds ?? null,
    sampler,
  );

  // Camera orbits the grid centre; its Y tracks the terrain when projecting so
  // toggling projection re-aims the pivot onto/off the surface.
  const cy = sampler
    ? (sampler(frame.lat0 - cz / frame.mPerLat, frame.lon0 + cx / frame.mPerLon) ?? 0)
    : 0;
  const initial = useMemo(() => presetFor('iso', [cx, cy, cz], ext), [cx, cy, cz, ext]);

  // Zoom bounds keyed to the scene size — close enough to inspect a point, far
  // enough to see the whole site, but never so far/near that the UX breaks. The
  // camera presets sit at ~2× ext, so 4× ext leaves comfortable headroom.
  const minDistance = Math.max(ext * 0.4, 8);
  const maxDistance = ext * 4;

  return (
    <Canvas
      camera={{ far: 2_000_000, fov: 45, near: 0.5, position: initial.pos.toArray() }}
      gl={{ powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        // Letting the browser keep the default action on `webglcontextlost`
        // permanently kills the canvas. Preventing it lets the GPU restore the
        // context; three re-uploads its resources on the following frame.
        gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
      }}
    >
      <color attach="background" args={[palette.bg]} />
      <hemisphereLight args={['#ffffff', '#cfd4db', 1.0]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[ext, ext * 1.6, ext * 0.6]} intensity={1.25} />
      <directionalLight position={[-ext, ext * 0.8, -ext]} intensity={0.35} />

      {showTerrain && terrainMesh ? (
        <mesh geometry={terrainMesh.geometry}>
          <meshStandardMaterial
            color={palette.clay}
            vertexColors
            transparent
            roughness={1}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {showBuildings && buildings?.length ? (
        <Buildings
          buildings={buildings}
          color={buildingColor}
          frame={frame}
          // Buildings always sit on the terrain surface (independent of the
          // point/grid projection toggle) and are culled/faded to its extent.
          sample={terrainMesh?.sample ?? null}
          center={terrainMesh ? { x: terrainMesh.cx, z: terrainMesh.cz } : null}
          radius={terrainMesh?.radius ?? null}
        />
      ) : null}

      {showGrid ? <GridLines scene={scene} frame={frame} sample={sampler} /> : null}
      {showOverlays &&
      overlays?.length &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        <DxfOverlays
          overlays={overlays}
          originE={originProjectedE}
          originN={originProjectedN}
          frame={frame}
          sample={sampler}
          hiddenLayers={hiddenLayers}
        />
      ) : null}
      {showPins ? <Markers markers={markers} onSelectPoint={onSelectPoint} /> : null}

      {/* No `target` prop — CameraRig owns the pivot so it always glides (never
          snaps) when the grid centre / projection changes. */}
      <OrbitControls
        makeDefault
        maxPolarAngle={Math.PI / 2.05}
        minDistance={minDistance}
        maxDistance={maxDistance}
      />
      <CameraRig
        cx={cx}
        cy={cy}
        cz={cz}
        ext={ext}
        view={view}
        viewNonce={viewNonce}
        focus={focus}
        frame={frame}
      />
      <SnapshotBridge captureRef={captureRef} />
    </Canvas>
  );
}
