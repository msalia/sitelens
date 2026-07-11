'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

import type { LengthUnit, PointCategory, SceneData } from '@/lib/types';

import type {
  BuildingFootprint,
  CameraView,
  ComparisonMarker,
  FocusTarget,
  RenderableOverlay,
  TerrainData,
} from './terrain-shared';

import { CameraRig, presetFor, RenderGate, SnapshotBridge } from './terrain-camera';
import { makeFrame, type Sampler, toLocal } from './terrain-frame';
import { buildTerrainGeometry, type TerrainMesh } from './terrain-mesh';
import {
  BUILDING_COLOR,
  Buildings,
  ComparisonOverlay,
  DxfOverlays,
  Fade,
  GridLines,
  Markers,
  TerrainSurface,
  useBounds,
  useMarkers,
} from './terrain-objects';
import { type AlignMarker, AlignPointsOverlay } from './terrain/align-points-overlay';
import { AnalysisOverlay, type AnalysisPath } from './terrain/analysis-overlay';
import { type AnalysisResult, AnalysisResultOverlay } from './terrain/analysis-result-overlay';
import { BoundaryOverlay } from './terrain/boundary-overlay';
import { CompositeTerrain } from './terrain/composite-terrain';
import { type SceneConstraint, SurfaceConstraints } from './terrain/surface-constraints';
import { SurfaceContours } from './terrain/surface-contours';
import {
  buildSurfaceGeometry,
  type SurfaceGeometry,
  SurfaceMesh,
  type SurfaceMode,
} from './terrain/surface-mesh';
import { buildSampler } from './terrain/terrain-sampler';
import { Utilities, type UtilityPick } from './terrain/utilities';
import { VolumeSolid } from './terrain/volume-solid';
import { silenceThreeClockWarning } from './three-clock-warning';

export type { UtilityPick } from './terrain/utilities';

// Re-export the public surface so consumers keep importing from 'terrain-viewer'.
export { CAMERA_VIEWS } from './terrain-shared';
export type {
  BuildingFootprint,
  CameraView,
  ComparisonMarker,
  RenderableOverlay,
  TerrainData,
} from './terrain-shared';

silenceThreeClockWarning();

// Matte "clay" palette — soft and bright in light mode, a deep neutral with the
// same matte feel in dark mode. Clay sits a touch lighter than the background.
const PALETTE = {
  dark: { bg: '#12151b', clay: '#2c323d' },
  light: { bg: '#eef1f5', clay: '#e7eaee' },
};
export interface TerrainViewerProps {
  /** DXF align-to-grid picks to highlight (numbered + coloured). */
  alignPoints?: AlignMarker[];
  /** Analysis input paths (site-analysis plan geometry) to overlay. */
  analysisPaths?: AnalysisPath[];
  /** A turning analysis's computed result geometry (envelope/tracks/clips). */
  analysisResult?: AnalysisResult | null;
  /** Property boundary ring to draw (saved or in-progress). */
  boundary?: { e: number; n: number }[];
  /** Whether `boundary` is an in-progress edit (styled distinctly). */
  boundaryDraft?: boolean;
  /** OSM building footprints to extrude (visual context only). */
  buildings?: BuildingFootprint[];
  /** When set, the viewer assigns a function that downloads the canvas as a PNG. */
  captureRef?: React.MutableRefObject<(() => void) | null>;
  categories: PointCategory[];
  /** As-built QC comparison markers + leader lines (null/empty draws nothing). */
  comparison?: ComparisonMarker[] | null;
  /** Boundary-split composite terrain (CTER bytes): coarse outside + 1m detail
   *  inside, one seamless mesh. When present it replaces the plain terrain. */
  composite?: ArrayBuffer | null;
  /** Surface constraints (breaklines / boundary / holes) to overlay. */
  constraints?: SceneConstraint[];
  /** Draw elevation labels on major contours. */
  contourLabels?: boolean;
  /** Active surface's contour blob (SCTR base64), or null when none is loaded. */
  contours?: { contentBase64: string } | null;
  /** True while a tool is collecting points — enables grid/DXF snap targets. */
  digitizing?: boolean;
  /** Unit for contour elevation labels (the project's display unit). */
  displayUnit: LengthUnit;
  /** Move the camera to a point. `nonce` re-triggers. */
  focus?: FocusTarget;
  /** Graded composite (CTER bytes): the composite with the active volume's
   *  earthwork applied. When present it renders in place of `composite`. */
  gradedComposite?: ArrayBuffer | null;
  /** Generic snap sink: grid intersections + DXF vertices call this with
   *  projected coords so ANY digitizing tool (analysis, utilities, surfaces)
   *  snaps to them via the shared pick bridge. */
  onDigitizePick?: (easting: number, northing: number, height: number, label: string) => void;
  /** Called with a survey point id when picked in 3D. */
  onSelectPoint?: (id: string) => void;
  /** Called with a run/structure when picked in 3D. */
  onSelectUtility?: (pick: UtilityPick) => void;
  originProjectedE?: number | null;
  originProjectedN?: number | null;
  /** Georeferenced DXF overlays to draw, with the project's projected origin. */
  overlays?: RenderableOverlay[];
  /** Drape zero-elevation points + grid lines onto the terrain surface. */
  projectOnTerrain?: boolean;
  /** Compact draping heightfield (SAMP bytes): detail inside the boundary, coarse
   *  outside. Drives draping without a client GeoTIFF decode. */
  samplerBlob?: ArrayBuffer | null;
  scene: SceneData;
  /** Whether to render the extruded OSM buildings. */
  showBuildings?: boolean;
  /** Whether to draw the as-built QC comparison overlay (fades when off). */
  showComparison?: boolean;
  /** Whether to draw the constraint overlay. */
  showConstraints?: boolean;
  /** Whether to draw the surface contours. */
  showContours?: boolean;
  /** Whether to draw the building-grid lines + labels. */
  showGrid?: boolean;
  /** DXF layer names to show (empty/undefined shows none). */
  shownLayers?: Set<string>;
  /** Master toggle for drawing the DXF overlays. */
  showOverlays?: boolean;
  /** Whether to show the point pins (control + survey markers). */
  showPins?: boolean;
  /** Whether to render the TIN surface mesh. */
  showSurface?: boolean;
  /** Whether to render the terrain mesh. */
  showTerrain?: boolean;
  /** Whether to draw the buried utility runs + structures. */
  showUtilities?: boolean;
  /** Whether to draw the volume cut/fill heatmap. */
  showVolume?: boolean;
  /** Active surface's STIN mesh bytes (from `/asset`), or null when none is selected. */
  surface?: ArrayBuffer | null;
  /** How to shade the TIN surface: elevation ramp, slope, or QC wireframe. */
  surfaceMode?: SurfaceMode;
  terrain?: TerrainData | null;
  /** Underground mode: fade the terrain so buried utilities show through. */
  underground?: boolean;
  /** Active camera preset; `viewNonce` re-applies it even if unchanged. */
  view?: CameraView;
  viewNonce?: number;
  /** Category ids to show; null shows all. Points without a category always show. */
  visibleCategoryIds: Set<string> | null;
  /** Survey-point ids to show (group filter); null shows all. */
  visibleIds?: Set<string> | null;
  /** Utility type keys to show; null shows all. */
  visibleUtilityTypes?: Set<string> | null;
  /** Volume view: true carves the terrain to the finished grade; false shows the
   *  cut/fill as a solid 3D mass. */
  volumeGraded?: boolean;
  /** Active volume's clean graded-terrain surface (ESOL base64), or null. */
  volumeGradedMesh?: string | null;
  /** Active volume's cut/fill grid (SVOL bytes from `/asset`), or null when none selected. */
  volumeHeatmap?: ArrayBuffer | null;
  /** Active volume's clean earthwork solid (ESOL base64), or null. */
  volumeSolid?: string | null;
}

export function TerrainViewer(props: TerrainViewerProps) {
  const {
    alignPoints,
    analysisPaths,
    analysisResult,
    boundary,
    boundaryDraft,
    buildings,
    captureRef,
    categories,
    comparison,
    composite,
    constraints,
    contourLabels = true,
    contours,
    digitizing,
    displayUnit,
    focus,
    gradedComposite,
    onDigitizePick,
    onSelectPoint,
    onSelectUtility,
    originProjectedE,
    originProjectedN,
    overlays,
    projectOnTerrain = true,
    samplerBlob,
    scene,
    showBuildings = true,
    showComparison = true,
    showConstraints = true,
    showContours = true,
    showGrid = true,
    shownLayers,
    showOverlays = true,
    showPins = true,
    showSurface = true,
    showTerrain = true,
    showUtilities = true,
    showVolume = true,
    surface,
    surfaceMode = 'ramp',
    terrain,
    underground = false,
    view = 'iso',
    viewNonce = 0,
    visibleCategoryIds,
    visibleIds,
    visibleUtilityTypes = null,
    volumeGraded = false,
    volumeGradedMesh,
    volumeHeatmap,
    volumeSolid,
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
    // Skip the (heavy) GeoTIFF decode when the server composite is driving the
    // render — draping then rides the SAMP sampler instead of this mesh.
    if (composite || !terrain?.buffer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTerrainMesh(null);
      return;
    }
    (async () => {
      try {
        const built = await buildTerrainGeometry(terrain.buffer, frame);
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
  }, [terrain?.buffer, composite, frame]);

  // Dispose the final geometry when the viewer unmounts / is replaced.
  useEffect(() => () => terrainMesh?.geometry.dispose(), [terrainMesh]);

  // Build the TIN surface geometry from the server's STIN blob. Same swap-in-
  // place discipline as the terrain mesh: keep the old geometry until the new one
  // is ready (no flicker on rebuild), dispose the superseded one via cleanup.
  const [surfaceGeom, setSurfaceGeom] = useState<SurfaceGeometry | null>(null);
  useEffect(() => {
    if (!surface) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSurfaceGeom(null);
      return;
    }
    try {
      const built = buildSurfaceGeometry(surface, frame);

      setSurfaceGeom(built);
    } catch {
      /* a bad blob just renders nothing */
    }
  }, [surface, frame]);

  // Dispose the surface geometry when it's replaced / the viewer unmounts.
  useEffect(() => () => surfaceGeom?.geometry.dispose(), [surfaceGeom]);

  // Draping sampler: prefer the compact server SAMP heightfield (detail inside the
  // boundary, coarse outside — no GeoTIFF decode); fall back to the plain terrain
  // mesh's sampler when there's no SAMP blob yet.
  const samp = useMemo(() => (samplerBlob ? buildSampler(samplerBlob) : null), [samplerBlob]);
  const sampleFn = samp?.sample ?? null;
  const sampler: Sampler = projectOnTerrain ? (sampleFn ?? terrainMesh?.sample ?? null) : null;

  // Building drape + cull extent. Prefer the plain terrain mesh's centre/radius;
  // otherwise (composite path, no terrainMesh) derive a local extent from the SAMP
  // grid's geographic bounds so buildings still drape + fade to the tile edge.
  const sampExtent = useMemo(() => {
    if (!samp) {
      return null;
    }
    const corners: [number, number][] = [
      [samp.minLat, samp.minLon],
      [samp.minLat, samp.maxLon],
      [samp.maxLat, samp.minLon],
      [samp.maxLat, samp.maxLon],
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [lat, lon] of corners) {
      const [x, , z] = toLocal(frame, lat, lon, 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      radius: Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2) || 1,
    };
  }, [samp, frame]);
  const buildingSample = sampleFn ?? terrainMesh?.sample ?? null;
  const buildingCenter = terrainMesh
    ? { x: terrainMesh.cx, z: terrainMesh.cz }
    : sampExtent
      ? { x: sampExtent.cx, z: sampExtent.cz }
      : null;
  const buildingRadius = terrainMesh?.radius ?? sampExtent?.radius ?? null;

  // Volume view mode: `volumeGraded` on ⇒ carve the terrain to the finished grade;
  // off ⇒ show the cut/fill as solid 3D masses over a ghosted terrain.
  const volumeCarve = !!volumeHeatmap && !!volumeGraded && !!showVolume;
  const volumeSolidActive = !!volumeHeatmap && !volumeGraded && !!showVolume;

  // Retain the last graded composite so it can fade OUT when graded turns off
  // (kept mounted via `cull`) — the graded layer cross-fades with the plain one.
  const [shownGraded, setShownGraded] = useState<ArrayBuffer | null>(gradedComposite ?? null);
  useEffect(() => {
    if (gradedComposite) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShownGraded(gradedComposite);
    }
  }, [gradedComposite]);

  // Retain the last analysis geometry so the overlays stay mounted and can fade
  // OUT (driven by `visible`) instead of unmounting and snapping away.
  const [shownResult, setShownResult] = useState<AnalysisResult | null>(analysisResult ?? null);
  useEffect(() => {
    if (analysisResult) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShownResult(analysisResult);
    }
  }, [analysisResult]);
  const [shownPaths, setShownPaths] = useState<AnalysisPath[] | undefined>(analysisPaths);
  useEffect(() => {
    if (analysisPaths && analysisPaths.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShownPaths(analysisPaths);
    }
  }, [analysisPaths]);

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
      {composite ? (
        // Boundary present → the server-composited coarse+detail surface replaces
        // the plain terrain mesh. When a volume is graded we cross-fade in the
        // graded composite (detail lifted to the finished grade) as a second layer,
        // fading the plain one out. Both `Fade`+`cull` so toggling terrain / graded
        // dissolves; only hidden for the solid cut/fill view.
        <>
          <Fade visible={showTerrain && !volumeSolidActive && !gradedComposite} cull>
            <CompositeTerrain
              buffer={composite}
              frame={frame}
              color={palette.clay}
              opacity={underground ? 0.18 : 1}
            />
          </Fade>
          {shownGraded ? (
            <Fade visible={showTerrain && !volumeSolidActive && !!gradedComposite} cull>
              <CompositeTerrain
                buffer={shownGraded}
                frame={frame}
                color={palette.clay}
                opacity={underground ? 0.18 : 1}
              />
            </Fade>
          ) : null}
        </>
      ) : terrainMesh ? (
        // `cull`: terrain is one heavy mesh kept resident in state anyway, so
        // keep it mounted + warm when hidden (no remount shader-recompile hitch
        // on fade-in) and just stop drawing it. TerrainSurface morphs the vertex
        // heights flat↔relief in step with the same toggle, so it grows as it
        // fades in and settles flat as it fades out. `key` remounts only when a
        // genuinely new terrain geometry loads (re-snapshots its base heights).
        // Hidden while a volume is shown — carved mode replaces it with the graded
        // surface, solid mode shows just the cut/fill masses — so nothing occludes
        // the earthwork.
        <Fade visible={showTerrain && !volumeCarve && !volumeSolidActive} cull>
          <TerrainSurface
            key={terrainMesh.geometry.uuid}
            geometry={terrainMesh.geometry}
            color={palette.clay}
            relief={showTerrain}
            opacity={underground ? 0.18 : 1}
          />
        </Fade>
      ) : null}

      {/* Graded ON: the clean finished-grade terrain. On the composite path the
          graded surface is shown by swapping the composite buffer above, so the
          legacy ESOL solid only renders on the non-boundary path. */}
      {volumeGradedMesh && volumeCarve && !composite ? (
        <VolumeSolid solidBase64={volumeGradedMesh} frame={frame} visible={showVolume} />
      ) : null}
      {volumeSolid && volumeSolidActive ? (
        <VolumeSolid solidBase64={volumeSolid} frame={frame} visible={showVolume} />
      ) : null}

      {surfaceGeom ? (
        <Fade visible={showSurface} cull>
          <SurfaceMesh geometry={surfaceGeom.geometry} mode={surfaceMode} />
        </Fade>
      ) : null}

      {contours ? (
        <Fade visible={showContours}>
          <SurfaceContours
            contentBase64={contours.contentBase64}
            frame={frame}
            displayUnit={displayUnit}
            showLabels={contourLabels}
          />
        </Fade>
      ) : null}

      {constraints?.length &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        <SurfaceConstraints
          constraints={constraints}
          originE={originProjectedE}
          originN={originProjectedN}
          visible={showConstraints}
        />
      ) : null}

      {shownPaths?.length &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        <AnalysisOverlay
          paths={shownPaths}
          originE={originProjectedE}
          originN={originProjectedN}
          frame={frame}
          sample={sampler}
          visible={!!analysisPaths?.length}
        />
      ) : null}

      {shownResult &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        <AnalysisResultOverlay
          result={shownResult}
          originE={originProjectedE}
          originN={originProjectedN}
          frame={frame}
          sample={sampler}
          visible={!!analysisResult}
        />
      ) : null}

      {alignPoints?.length &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        <AlignPointsOverlay
          markers={alignPoints}
          originE={originProjectedE}
          originN={originProjectedN}
          frame={frame}
          sample={sampler}
        />
      ) : null}

      {boundary?.length &&
      originProjectedE !== null &&
      originProjectedE !== undefined &&
      originProjectedN !== null &&
      originProjectedN !== undefined ? (
        <BoundaryOverlay
          points={boundary}
          draft={boundaryDraft}
          originE={originProjectedE}
          originN={originProjectedN}
          frame={frame}
          sample={sampler}
        />
      ) : null}

      {buildings?.length ? (
        <Fade visible={showBuildings}>
          <Buildings
            buildings={buildings}
            color={buildingColor}
            frame={frame}
            // Buildings always sit on the terrain surface (independent of the
            // point/grid projection toggle) and are culled/faded to its extent —
            // via the SAMP sampler + its bounds on the composite path.
            sample={buildingSample}
            center={buildingCenter}
            radius={buildingRadius}
          />
        </Fade>
      ) : null}

      <GridLines
        scene={scene}
        frame={frame}
        sample={sampler}
        visible={showGrid}
        digitizing={digitizing}
        originE={originProjectedE ?? null}
        originN={originProjectedN ?? null}
        onPick={onDigitizePick}
      />
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
          digitizing={digitizing}
          onPick={onDigitizePick}
        />
      ) : null}
      <Markers markers={showPins ? markers : []} onSelectPoint={onSelectPoint} />
      {comparison?.length ? (
        <ComparisonOverlay
          comparison={comparison}
          frame={frame}
          sample={sampler}
          visible={showComparison}
        />
      ) : null}
      {scene.utilityRuns.length || scene.utilityStructures.length ? (
        <Fade visible={showUtilities}>
          <Utilities
            runs={scene.utilityRuns}
            structures={scene.utilityStructures}
            frame={frame}
            visibleTypes={visibleUtilityTypes}
            onSelect={onSelectUtility}
          />
        </Fade>
      ) : null}

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
