'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

import type { PointCategory, SceneData } from '@/lib/types';

import type {
  BuildingFootprint,
  CameraView,
  FocusTarget,
  RenderableOverlay,
  TerrainData,
} from './terrain-shared';

import { CameraRig, presetFor, RenderGate, SnapshotBridge } from './terrain-camera';
import { base64ToArrayBuffer, makeFrame, type Sampler } from './terrain-frame';
import { buildTerrainGeometry, type TerrainMesh } from './terrain-mesh';
import {
  BUILDING_COLOR,
  Buildings,
  DxfOverlays,
  Fade,
  GridLines,
  Markers,
  TerrainSurface,
  useBounds,
  useMarkers,
} from './terrain-objects';

// Re-export the public surface so consumers keep importing from 'terrain-viewer'.
export { CAMERA_VIEWS } from './terrain-shared';
export type {
  BuildingFootprint,
  CameraView,
  RenderableOverlay,
  TerrainData,
} from './terrain-shared';

// `@react-three/fiber`'s render loop still constructs a `THREE.Clock`, which
// three r184 deprecated in favor of `THREE.Timer`. Drop just that one warning.
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

// Matte "clay" palette — soft and bright in light mode, a deep neutral with the
// same matte feel in dark mode. Clay sits a touch lighter than the background.
const PALETTE = {
  dark: { bg: '#12151b', clay: '#2c323d' },
  light: { bg: '#eef1f5', clay: '#e7eaee' },
};
export interface TerrainViewerProps {
  /** OSM building footprints to extrude (visual context only). */
  buildings?: BuildingFootprint[];
  /** When set, the viewer assigns a function that downloads the canvas as a PNG. */
  captureRef?: React.MutableRefObject<(() => void) | null>;
  categories: PointCategory[];
  /** Move the camera to a point. `nonce` re-triggers. */
  focus?: FocusTarget;
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
  /** DXF layer names to show (empty/undefined shows none). */
  shownLayers?: Set<string>;
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

export function TerrainViewer(props: TerrainViewerProps) {
  const {
    buildings,
    captureRef,
    categories,
    focus,
    onSelectPoint,
    originProjectedE,
    originProjectedN,
    overlays,
    projectOnTerrain = true,
    scene,
    showBuildings = true,
    showGrid = true,
    shownLayers,
    showOverlays = true,
    showPins = true,
    showTerrain = true,
    terrain,
    view = 'iso',
    viewNonce = 0,
    visibleCategoryIds,
    visibleIds,
  } = props;
  // Keep `frame` referentially stable while the geographic origin is unchanged,
  // so a live scene refetch (same project) doesn't churn frame-derived work — in
  // particular, it stops the terrain geometry from rebuilding (and flashing) on
  // every update. makeFrame is cheap to call each render; we only re-memo when
  // the origin actually moves.
  const computedFrame = makeFrame(scene);
  const frame = useMemo(
    () => computedFrame,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [computedFrame.lat0, computedFrame.lon0],
  );
  const { cx, cz, ext } = useBounds(scene, frame);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const palette = isDark ? PALETTE.dark : PALETTE.light;
  const buildingColor = isDark ? BUILDING_COLOR.dark : BUILDING_COLOR.light;

  const [terrainMesh, setTerrainMesh] = useState<TerrainMesh | null>(null);
  // Legitimate effect: asynchronously build the Three.js terrain geometry from
  // the downloaded heightfield, with cleanup that disposes the GPU resource.
  useEffect(() => {
    let cancelled = false;
    if (!terrain?.contentBase64) {
      // Terrain genuinely removed → clear it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTerrainMesh(null);
      return;
    }
    (async () => {
      try {
        const built = await buildTerrainGeometry(base64ToArrayBuffer(terrain.contentBase64), frame);
        if (cancelled) {
          built.geometry.dispose();
        } else {
          // Swap in place — we keep the previous mesh until the new one is ready
          // (we never null it out first). So on a refresh the sampler never blips
          // to null: points + grid glide straight from the old drape to the new,
          // and the terrain doesn't blink out-then-in. The previous geometry is
          // disposed by the [terrainMesh] cleanup effect when this swap commits.
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

      {/* Each layer stays mounted only while fading; `Fade` unmounts it once
          fully hidden, so a toggled-off layer costs nothing. Grid + pins are
          lightweight and fade in place (grid via its own lerp; pins exit via the
          presence hook when passed an empty list). */}
      {terrainMesh ? (
        // `cull`: terrain is one heavy mesh kept resident in state anyway, so
        // keep it mounted + warm when hidden (no remount shader-recompile hitch
        // on fade-in) and just stop drawing it. TerrainSurface morphs the vertex
        // heights flat↔relief in step with the same toggle, so it grows as it
        // fades in and settles flat as it fades out. `key` remounts only when a
        // genuinely new terrain geometry loads (re-snapshots its base heights).
        <Fade visible={showTerrain} cull>
          <TerrainSurface
            key={terrainMesh.geometry.uuid}
            geometry={terrainMesh.geometry}
            color={palette.clay}
            relief={showTerrain}
          />
        </Fade>
      ) : null}

      {buildings?.length ? (
        <Fade visible={showBuildings}>
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
        </Fade>
      ) : null}

      <GridLines scene={scene} frame={frame} sample={sampler} visible={showGrid} />
      {overlays?.length &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        // No outer Fade — DxfOverlays fades each layer itself, combining the
        // master toggle with per-layer visibility so both animate via one Fade.
        <DxfOverlays
          overlays={overlays}
          originE={originProjectedE}
          originN={originProjectedN}
          shownLayers={shownLayers}
          visible={showOverlays}
        />
      ) : null}
      <Markers markers={showPins ? markers : []} onSelectPoint={onSelectPoint} />

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
      <RenderGate />
    </Canvas>
  );
}
