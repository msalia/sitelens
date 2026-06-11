'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import type { Frame, Sampler } from '@/components/projects/terrain-frame';
import type { BuildingFootprint } from '@/components/projects/terrain-shared';

import { RenderGate } from '@/components/projects/terrain-camera';
import { buildTerrainGeometry } from '@/components/projects/terrain-mesh';
import {
  BUILDING_COLOR,
  Buildings,
  Fade,
  TerrainSurface,
} from '@/components/projects/terrain-objects';
import { silenceThreeClockWarning } from '@/components/projects/three-clock-warning';

import type { ShowcasePlace } from './login-showcase';

silenceThreeClockWarning();

// Same matte clay palette as the main 3D viewer.
const PALETTE = {
  dark: { bg: '#12151b', clay: '#2c323d' },
  light: { bg: '#eef1f5', clay: '#e7eaee' },
};

const DWELL_MS = 30_000; // time a city is shown before advancing
const EXIT_MS = 750; // flatten + fade-out before the swap
const MOUNT_MS = 60; // let the new city mount flat before it rises
// Fixed camera distance (cities are normalized to a similar scale) so the orbit
// is one continuous motion — it never re-frames or jumps when the city swaps.
const CAM_DIST = 1200;

/** Local ENU frame at a lat/lon (mirrors terrain-frame `makeFrame`). */
function frameAt(lat0: number, lon0: number): Frame {
  return {
    lat0,
    lon0,
    mPerLat: 111_320,
    mPerLon: 111_320 * Math.cos((lat0 * Math.PI) / 180),
  };
}

interface Loaded {
  buildings: BuildingFootprint[];
  frame: Frame;
  geometry: THREE.BufferGeometry;
  place: ShowcasePlace;
  radius: number;
  /** Terrain sampler, already normalized so the surface centres on y = 0. */
  sample: Sampler;
}

/** A self-contained 3D showcase: orbits one cached iconic place, then every 30s
 *  transitions to the next using the viewer's own animations — the terrain
 *  flattens and the buildings fade out, the data swaps, then the new terrain
 *  rises and its buildings fade in. The RenderGate pauses it while the tab is
 *  hidden. Each city's elevation is normalized to y = 0 so the camera holds. */
export function LoginShowcaseScene({ places }: { places: ShowcasePlace[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const palette = isDark ? PALETTE.dark : PALETTE.light;
  const buildingColor = isDark ? BUILDING_COLOR.dark : BUILDING_COLOR.light;

  const [shown, setShown] = useState<Loaded | null>(null);
  const [up, setUp] = useState(false); // terrain risen + buildings visible

  const cache = useRef<Map<string, Loaded>>(new Map());

  // The dwell → exit → swap → enter cycle, driven imperatively so the steps stay
  // in order. Meshes are cached (and the next one prefetched) so swaps are instant.
  useEffect(() => {
    if (places.length === 0) {
      return;
    }
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const store = cache.current;

    async function load(place: ShowcasePlace): Promise<Loaded | null> {
      const hit = store.get(place.id);
      if (hit) {
        return hit;
      }
      try {
        const frame = frameAt(place.lat, place.lon);
        const base = `/showcase/${place.id}`;
        const [tif, b] = await Promise.all([
          fetch(`${base}/terrain.tif`).then((r) => r.arrayBuffer()),
          fetch(`${base}/buildings.json`).then((r) => (r.ok ? r.json() : [])),
        ]);
        const mesh = await buildTerrainGeometry(tif, frame);
        // Centre the surface on y = 0 by subtracting the mean elevation (a uniform
        // Y shift, so normals are unaffected) — keeps the camera framing identical
        // across cities of very different absolute elevation.
        const pos = mesh.geometry.attributes.position;
        const arr = pos.array as Float32Array;
        for (let i = 1; i < arr.length; i += 3) {
          arr[i] -= mesh.meanHeight;
        }
        pos.needsUpdate = true;
        const mean = mesh.meanHeight;
        const sample: Sampler = (lat, lon) => {
          const e = mesh.sample(lat, lon);
          return e === null ? null : e - mean;
        };
        const loaded: Loaded = {
          buildings: b as BuildingFootprint[],
          frame,
          geometry: mesh.geometry,
          place,
          radius: mesh.radius,
          sample,
        };
        store.set(place.id, loaded);
        return loaded;
      } catch {
        return null;
      }
    }

    (async () => {
      let i = 0;
      for (;;) {
        const cur = await load(places[i]);
        if (cancelled) {
          return;
        }
        if (cur) {
          setShown(cur); // mounts flat (up === false)
          setUp(false);
          void load(places[(i + 1) % places.length]); // prefetch next
          await sleep(MOUNT_MS);
          if (cancelled) {
            return;
          }
          setUp(true); // terrain rises + buildings fade in
        }
        await sleep(DWELL_MS);
        if (cancelled) {
          return;
        }
        setUp(false); // terrain flattens + buildings fade out
        await sleep(EXIT_MS);
        if (cancelled) {
          return;
        }
        i = (i + 1) % places.length;
      }
    })();

    return () => {
      cancelled = true;
      for (const l of store.values()) {
        l.geometry.dispose();
      }
      store.clear();
    };
  }, [places]);

  const d = CAM_DIST;

  return (
    <>
      <Canvas
        camera={{ far: d * 16, fov: 40, near: 1, position: [d * 0.62, d * 0.5, d * 0.62] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ height: '100%', width: '100%' }}
      >
        <color attach="background" args={[palette.bg]} />
        <hemisphereLight args={['#ffffff', '#cfd4db', 1.0]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[d, d * 1.6, d * 0.6]} intensity={1.25} />
        <directionalLight position={[-d, d * 0.8, -d]} intensity={0.35} />

        {shown ? (
          <>
            <TerrainSurface
              key={shown.place.id}
              geometry={shown.geometry}
              color={palette.clay}
              relief={up}
            />
            <Fade visible={up}>
              <Buildings
                buildings={shown.buildings}
                color={buildingColor}
                frame={shown.frame}
                sample={shown.sample}
                center={{ x: 0, z: 0 }}
                radius={shown.radius}
              />
            </Fade>
          </>
        ) : null}

        {/* One continuous auto-orbit; user drag/zoom overrides and it resumes.
            Rendered once (never keyed/re-created) so a city swap never resets it. */}
        <OrbitControls
          makeDefault
          autoRotate
          autoRotateSpeed={0.45}
          enablePan={false}
          enableDamping
          minDistance={d * 0.4}
          maxDistance={d * 2}
          target={[0, 0, 0]}
          maxPolarAngle={Math.PI / 2.2}
        />
        <RenderGate />
      </Canvas>

      {/* City caption + progress dots. */}
      {shown ? (
        <div className="pointer-events-none absolute bottom-5 left-6 flex items-center gap-3">
          <span className="text-foreground text-sm font-medium tracking-tight">
            {shown.place.label}
          </span>
          <span className="flex gap-1.5">
            {places.map((p) => (
              <span
                key={p.id}
                className={`size-1.5 rounded-full transition-colors ${
                  p.id === shown.place.id ? 'bg-foreground' : 'bg-foreground/30'
                }`}
              />
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}
