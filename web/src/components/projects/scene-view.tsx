'use client';

import { IconX } from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
  BuildingFootprint,
  CameraView,
  ComparisonMarker,
  RenderableOverlay,
  TerrainData,
  UtilityPick,
} from '@/components/projects/terrain-viewer';
import type { AlignMarker } from '@/components/projects/terrain/align-points-overlay';
import type { AnalysisPath } from '@/components/projects/terrain/analysis-overlay';
import type { AnalysisResult } from '@/components/projects/terrain/analysis-result-overlay';
import type { SceneConstraint } from '@/components/projects/terrain/surface-constraints';
import type { SurfaceMode } from '@/components/projects/terrain/surface-mesh';
import type { InspectablePoint, PointCategory, Project, SceneData, ScenePoint } from '@/lib/types';

import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { CameraControl } from '@/components/projects/scene-view/camera-control';
import { SceneStats } from '@/components/projects/scene-view/scene-stats';
import { SceneToolbar } from '@/components/projects/scene-view/scene-toolbar';
import { readHeatmapRange } from '@/components/projects/terrain/volume-heatmap';
import { Card } from '@/components/ui/card';
import { assetUrls, fetchAssetBuffer, fetchAssetText } from '@/lib/asset';
import { gql } from '@/lib/graphql';
import { subscribeProjectChanged } from '@/lib/scene-subscription';
import { fromMeters, toMeters } from '@/lib/units';

import {
  FRESH_MS,
  OVERLAY_GEOMETRY,
  REFRESH_BUILDINGS,
  REFRESH_DETAILED_TERRAIN,
  REFRESH_TERRAIN,
  SCENE_QUERY,
  sceneBbox,
  SPAM_COOLDOWN_MS,
} from './scene-view-data';
import {
  BREAKLINES,
  type ContourSettings,
  DEFAULT_CONTOURS,
  SURFACE_CONTOURS,
  SURFACE_MESH,
  VOLUME_EARTHWORK_SOLID,
  VOLUME_GRADED_TERRAIN,
  VOLUME_HEATMAP,
} from './surfaces-data';

// The WebGL viewer is browser-only; load it lazily and never on the server.
const TerrainViewer = dynamic(
  () => import('@/components/projects/terrain-viewer').then((m) => m.TerrainViewer),
  {
    loading: () => <p className="text-muted-foreground p-6 text-sm">Loading 3D engine…</p>,
    ssr: false,
  },
);

export function SceneView({
  activeSurfaceId,
  activeVolumeId,
  alignPoints,
  analysisPaths,
  analysisResult,
  boundary,
  boundaryDraft,
  categories,
  comparison,
  contours = DEFAULT_CONTOURS,
  digitizing,
  focus,
  onCancelDigitize,
  pickRef,
  project,
  reloadNonce,
  stats,
  surfaceReload,
}: {
  project: Project;
  /** The surface whose TIN mesh is rendered (from the Surfaces panel). */
  activeSurfaceId?: string | null;
  /** The volume whose cut/fill heatmap is rendered (from the Surfaces panel). */
  activeVolumeId?: string | null;
  /** DXF align-to-grid picks to highlight (from the Overlays panel). */
  alignPoints?: AlignMarker[];
  /** Analysis plan paths to overlay (from the Analysis panel). */
  analysisPaths?: AnalysisPath[];
  /** Property boundary ring to draw (saved or in-progress). */
  boundary?: { e: number; n: number }[];
  /** Whether `boundary` is an in-progress edit (styled distinctly). */
  boundaryDraft?: boolean;
  /** A turning analysis's computed result geometry to overlay. */
  analysisResult?: AnalysisResult | null;
  /** Bumped by the Surfaces panel after a build/rebuild to refetch the mesh. */
  surfaceReload?: number;
  categories: PointCategory[];
  /** As-built QC comparison markers to overlay (from the Field panel). */
  comparison?: ComparisonMarker[] | null;
  /** Contour-generation settings (from the Surfaces panel). */
  contours?: ContourSettings;
  /** When true, the scene is in "digitize" mode: clicking a survey-point marker
   *  feeds it to `pickRef` (snapping a utility vertex/structure) instead of
   *  opening the coordinate inspector. Drives the on-scene hint banner. */
  digitizing?: boolean;
  /** Request from the table to fly to a point; `nonce` re-triggers. */
  focus?: { id: string; nonce: number } | null;
  /** Called when the user dismisses the digitize hint banner. */
  onCancelDigitize?: () => void;
  /** Sink for snapped survey points while digitizing (set by the Utilities
   *  panel). A ref so toggling it never re-renders the whole scene. */
  pickRef?: React.MutableRefObject<((point: ScenePoint) => void) | null>;
  /** Bumped by the parent to force a scene reload (e.g. after a DXF upload or
   * a georeference save). */
  reloadNonce?: number;
  /** Live stats overlaid on the viewer (bottom-left), as a label: value list. */
  stats?: { label: string; value: ReactNode }[];
}) {
  const [scene, setScene] = useState<SceneData | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [terrainMeta, setTerrainMeta] = useState<{ fetchedAt: string; demtype: string } | null>(
    null,
  );
  const [buildings, setBuildings] = useState<BuildingFootprint[]>([]);
  const [buildingsMeta, setBuildingsMeta] = useState<{ count: number; fetchedAt: string } | null>(
    null,
  );
  const [overlays, setOverlays] = useState<RenderableOverlay[]>([]);
  const [overlayLayers, setOverlayLayers] = useState<string[]>([]);
  // Which DXF layers to show in the 3D view. Empty by default, so nothing shows
  // until the user opts layers in; the selection persists across scene reloads.
  const [shownLayers, setShownLayers] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<{ id: string; name: string; memberIds: string[] }[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<InspectablePoint | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [showTerrain, setShowTerrain] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showOverlays, setShowOverlays] = useState(true);
  const [showComparison, setShowComparison] = useState(true);
  const [showUtilities, setShowUtilities] = useState(true);
  const [showSurface, setShowSurface] = useState(true);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('ramp');
  const [surface, setSurface] = useState<{ contentBase64: string } | null>(null);
  const [contourBlob, setContourBlob] = useState<{ contentBase64: string } | null>(null);
  const [volumeBlob, setVolumeBlob] = useState<{ contentBase64: string } | null>(null);
  const [volumeSolid, setVolumeSolid] = useState<string | null>(null);
  const [volumeGradedBlob, setVolumeGradedBlob] = useState<string | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  // Show the cut/fill heatmap lifted to the finished grade (post-earthwork).
  const [gradedVolume, setGradedVolume] = useState(false);
  const [constraints, setConstraints] = useState<SceneConstraint[]>([]);
  const [showConstraints, setShowConstraints] = useState(true);
  const [underground, setUnderground] = useState(false);
  const [selectedUtility, setSelectedUtility] = useState<UtilityPick | null>(null);
  const [projectOnTerrain, setProjectOnTerrain] = useState(true);
  const [view, setView] = useState<CameraView>('iso');
  const [viewNonce, setViewNonce] = useState(0);
  const captureRef = useRef<(() => void) | null>(null);

  // Tick once a minute so the cooldown re-enables the button (and its tooltip
  // countdown stays roughly current) without a page reload.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const visibleCategoryIds = useMemo(
    () => new Set(categories.filter((c) => !hidden.has(c.id)).map((c) => c.id)),
    [categories, hidden],
  );

  // Group filter: when a group is chosen, only its members render.
  const visibleIds = useMemo(() => {
    if (groupFilter === 'all') {
      return null;
    }
    const g = groups.find((x) => x.id === groupFilter);
    return g ? new Set(g.memberIds) : null;
  }, [groupFilter, groups]);

  // Translate a table "locate" request into a viewer focus (lon/lat/height).
  const viewerFocus = useMemo(() => {
    if (!focus || !scene) {
      return undefined;
    }
    const p =
      scene.surveyPoints.find((s) => s.id === focus.id) ??
      scene.controlPoints.find((s) => s.id === focus.id);
    if (!p) {
      return undefined;
    }
    return {
      height: p.height,
      id: focus.id,
      lat: p.latitude,
      lon: p.longitude,
      nonce: focus.nonce,
    };
  }, [focus, scene]);

  // Loads the active surface's TIN mesh blob (null when none is selected). Bumped
  // via `surfaceReload` after a build/rebuild so a same-id rebuild re-fetches.
  const loadSurfaceMesh = useCallback(async () => {
    if (!activeSurfaceId) {
      setSurface(null);
      return;
    }
    try {
      const { surfaceMesh } = await gql(SURFACE_MESH, { id: activeSurfaceId });
      setSurface({ contentBase64: surfaceMesh.contentBase64 });
    } catch {
      setSurface(null);
    }
  }, [activeSurfaceId]);

  // Fetching the mesh when the active surface (or reload nonce) changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSurfaceMesh();
  }, [loadSurfaceMesh, surfaceReload]);

  // Loads contours for the active surface at the panel's settings. Intervals are
  // entered in the display unit, converted to canonical meters for the API.
  const { enabled: contoursOn, interval, majorInterval, smoothing } = contours;
  const loadContours = useCallback(async () => {
    if (!activeSurfaceId || !contoursOn || !(interval > 0)) {
      setContourBlob(null);
      return;
    }
    try {
      const { surfaceContours } = await gql(SURFACE_CONTOURS, {
        id: activeSurfaceId,
        interval: toMeters(interval, project.displayUnit),
        majorInterval: majorInterval > 0 ? toMeters(majorInterval, project.displayUnit) : null,
        smoothing,
      });
      setContourBlob({ contentBase64: surfaceContours.contentBase64 });
    } catch {
      setContourBlob(null);
    }
  }, [activeSurfaceId, contoursOn, interval, majorInterval, smoothing, project.displayUnit]);

  // Refetch contours when the surface, settings, or reload nonce change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadContours();
  }, [loadContours, surfaceReload]);

  // Loads the active volume's cut/fill heatmap grid + clean earthwork solid (null
  // when none selected).
  const loadVolumeHeatmap = useCallback(async () => {
    if (!activeVolumeId) {
      setVolumeBlob(null);
      setVolumeSolid(null);
      setVolumeGradedBlob(null);
      return;
    }
    try {
      const { volumeHeatmap } = await gql(VOLUME_HEATMAP, { id: activeVolumeId });
      setVolumeBlob({ contentBase64: volumeHeatmap.contentBase64 });
    } catch {
      setVolumeBlob(null);
    }
    try {
      const { volumeEarthworkSolid } = await gql(VOLUME_EARTHWORK_SOLID, { id: activeVolumeId });
      setVolumeSolid(volumeEarthworkSolid ?? null);
    } catch {
      setVolumeSolid(null);
    }
    try {
      const { volumeGradedTerrain } = await gql(VOLUME_GRADED_TERRAIN, { id: activeVolumeId });
      setVolumeGradedBlob(volumeGradedTerrain ?? null);
    } catch {
      setVolumeGradedBlob(null);
    }
  }, [activeVolumeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVolumeHeatmap();
  }, [loadVolumeHeatmap, surfaceReload]);

  // Δz range (for the legend), read cheaply from the heatmap blob header.
  const volumeRange = useMemo(
    () => (volumeBlob ? readHeatmapRange(volumeBlob.contentBase64) : null),
    [volumeBlob],
  );

  // Loads the project's surface constraints for the overlay (parsing the stored
  // `[{n,e,z}]` JSON into projected-meter vertices).
  const loadConstraints = useCallback(async () => {
    try {
      const { breaklines } = await gql(BREAKLINES, { projectId: project.id });
      setConstraints(
        breaklines.map((b) => ({
          id: b.id,
          kind: b.kind as SceneConstraint['kind'],
          vertices: (JSON.parse(b.vertices) as { n: number; e: number; z: number | null }[]).map(
            (v) => ({ e: v.e, n: v.n, z: v.z ?? null }),
          ),
        })),
      );
    } catch {
      setConstraints([]);
    }
  }, [project.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConstraints();
  }, [loadConstraints, surfaceReload]);

  // Loads the cached DEM bytes over the binary /asset route (no-op if there's no
  // terrain row yet → 404 → null).
  const loadTerrainContent = useCallback(async () => {
    try {
      const buffer = await fetchAssetBuffer(assetUrls.projectTerrain(project.id));
      setTerrain(buffer ? { buffer } : null);
    } catch {
      setTerrain(null);
    }
  }, [project.id]);

  // Loads + parses the cached OSM building footprints over the /asset route
  // (no-op if none cached → 404 → null).
  const loadBuildingsContent = useCallback(async () => {
    try {
      const text = await fetchAssetText(assetUrls.projectBuildings(project.id));
      const parsed = text ? (JSON.parse(text) as BuildingFootprint[]) : [];
      setBuildings(Array.isArray(parsed) ? parsed : []);
    } catch {
      setBuildings([]);
    }
  }, [project.id]);

  // Fetches + parses the visible DXF overlays into renderable linework, and
  // collects the union of their layer names for the layer selector.
  const loadOverlays = useCallback(
    async (
      metas: {
        id: string;
        offsetE: number;
        offsetN: number;
        rotationDeg: number;
        scale: number;
        elevation: number;
        visible: boolean;
      }[],
    ) => {
      const visible = metas.filter((o) => o.visible);
      const layers = new Set<string>();
      const parsed = await Promise.all(
        visible.map(async (o): Promise<RenderableOverlay | null> => {
          try {
            const { cadOverlayGeometry } = await gql(OVERLAY_GEOMETRY, { id: o.id });
            cadOverlayGeometry.layers.forEach((l) => layers.add(l));
            return {
              elevation: o.elevation,
              id: o.id,
              offsetE: o.offsetE,
              offsetN: o.offsetN,
              polylines: cadOverlayGeometry.polylines,
              rotationDeg: o.rotationDeg,
              scale: o.scale,
            };
          } catch {
            return null;
          }
        }),
      );
      setOverlays(parsed.filter((o): o is RenderableOverlay => o !== null));
      setOverlayLayers([...layers].sort());
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const data = await gql(SCENE_QUERY, { id: project.id });
      setScene(data.sceneData);
      setTerrainMeta(
        data.projectTerrain
          ? { demtype: data.projectTerrain.demtype, fetchedAt: data.projectTerrain.fetchedAt }
          : null,
      );
      if (data.projectTerrain) {
        void loadTerrainContent();
      } else {
        setTerrain(null);
      }
      setBuildingsMeta(
        data.projectBuildings
          ? { count: data.projectBuildings.count, fetchedAt: data.projectBuildings.fetchedAt }
          : null,
      );
      if (data.projectBuildings) {
        void loadBuildingsContent();
      } else {
        setBuildings([]);
      }
      void loadOverlays(data.cadOverlays);
      setGroups(data.pointGroups);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load scene');
    }
  }, [project.id, loadTerrainContent, loadBuildingsContent, loadOverlays]);

  // The 3D view is always present — load on mount and when the parent bumps
  // `reloadNonce` (e.g. after a DXF overlay is uploaded, or a georeference save).
  // Loading scene data from the server is a legitimate data-fetching effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, reloadNonce]);

  // Live updates: subscribe to projectChanged and refetch (debounced) on each
  // push, so edits from this or another session appear without a manual reload.
  // The camera is decoupled from data bounds (see CameraRig), so refetching never
  // moves the view.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeProjectChanged(project.id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [project.id, load]);

  // Fetch (or refresh) both the DEM and the OSM buildings server-side, in one
  // action. The Rust API owns the OpenTopography / Overpass calls and enforces a
  // 7-day per-source cooldown; here we just skip whichever source is still fresh
  // (so a fresh resource isn't needlessly re-fetched) and surface the result.
  const refreshSite = useCallback(async () => {
    if (!scene) {
      return;
    }
    const bbox = sceneBbox(scene);
    if (!bbox) {
      toast.error('Add control or survey points before fetching site data.');
      return;
    }
    const t = Date.now();
    const terrainFresh = !!terrainMeta && t < new Date(terrainMeta.fetchedAt).getTime() + FRESH_MS;
    const buildingsFresh =
      !!buildingsMeta && t < new Date(buildingsMeta.fetchedAt).getTime() + FRESH_MS;
    const args = {
      east: bbox.east,
      id: project.id,
      north: bbox.north,
      south: bbox.south,
      west: bbox.west,
    };
    setRefreshing(true);
    const done: string[] = [];
    const failed: string[] = [];
    // For each source: fetch when missing (force=false) or stale (force=true);
    // skip when fresh. `force = !!meta` because if we got here with a row present
    // it must be stale (fresh ones are filtered out above).
    if (!terrainFresh) {
      try {
        const { refreshTerrain: meta } = await gql(REFRESH_TERRAIN, {
          ...args,
          force: !!terrainMeta,
        });
        setTerrainMeta({ demtype: meta.demtype, fetchedAt: meta.fetchedAt });
        await loadTerrainContent();
        done.push('terrain');
      } catch {
        failed.push('terrain');
      }
    }
    if (!buildingsFresh) {
      try {
        const { refreshBuildings: meta } = await gql(REFRESH_BUILDINGS, {
          ...args,
          force: !!buildingsMeta,
        });
        setBuildingsMeta({ count: meta.count, fetchedAt: meta.fetchedAt });
        await loadBuildingsContent();
        done.push('buildings');
      } catch {
        failed.push('buildings');
      }
    }
    // Detailed 1 m terrain — only when a boundary bounds the AOI. Best-effort:
    // 1 m 3DEP coverage is patchy, so a miss isn't a hard failure.
    if (project.boundary) {
      try {
        await gql(REFRESH_DETAILED_TERRAIN, { force: false, id: project.id });
        done.push('detailed terrain');
      } catch {
        failed.push('detailed terrain');
      }
    }
    setRefreshing(false);
    // Anti-spam: any attempt (success or failure) holds the button for 30 min.
    setCooldownUntil(Date.now() + SPAM_COOLDOWN_MS);
    setNow(Date.now());
    if (done.length > 0) {
      toast.success(`Updated ${done.join(' & ')}.`);
    }
    if (failed.length > 0) {
      toast.error(`Couldn't fetch ${failed.join(' & ')}.`);
    }
  }, [
    scene,
    project.id,
    project.boundary,
    terrainMeta,
    buildingsMeta,
    loadTerrainContent,
    loadBuildingsContent,
  ]);

  const onSelectPoint = useCallback(
    (id: string) => {
      const p = scene?.surveyPoints.find((s) => s.id === id);
      if (!p) {
        return;
      }
      // While digitizing, a marker click snaps a utility vertex/structure to the
      // point's exact projected coordinates (survey-grade) instead of inspecting.
      if (pickRef?.current) {
        pickRef.current(p);
        return;
      }
      setInspecting({ easting: p.easting, label: p.label, northing: p.northing });
    },
    [scene, pickRef],
  );

  // Generic snap sink for non-survey-point targets (grid intersections, DXF
  // vertices). Routes through the same pick bridge, so every digitizing tool
  // (analysis, utilities, surfaces) can snap to them with no extra wiring.
  const onDigitizePick = useCallback(
    (easting: number, northing: number, height: number, label: string) => {
      pickRef?.current?.({
        categoryId: null,
        easting,
        height,
        id: null,
        label,
        latitude: 0,
        longitude: 0,
        northing,
      });
    },
    [pickRef],
  );

  function setView2(v: CameraView) {
    setView(v);
    setViewNonce((n) => n + 1);
  }

  // Combined "site data" button state: disabled while in flight, while BOTH the
  // DEM and buildings are still fresh (server's 7-day rule), or during the client
  // anti-spam window. Enabled as soon as either source is missing or stale.
  const terrainFreshUntil = terrainMeta
    ? new Date(terrainMeta.fetchedAt).getTime() + FRESH_MS
    : null;
  const buildingsFreshUntil = buildingsMeta
    ? new Date(buildingsMeta.fetchedAt).getTime() + FRESH_MS
    : null;
  const terrainFresh = terrainFreshUntil !== null && now < terrainFreshUntil;
  const buildingsFresh = buildingsFreshUntil !== null && now < buildingsFreshUntil;
  const bothFresh = terrainFresh && buildingsFresh;
  // When both are fresh, the button re-enables when the earlier one goes stale.
  const earliestFreshUntil = Math.min(
    terrainFreshUntil ?? Infinity,
    buildingsFreshUntil ?? Infinity,
  );
  const hasSiteData = !!terrainMeta || !!buildingsMeta;
  const inSpamCooldown = cooldownUntil !== null && now < cooldownUntil;
  const siteDisabled = refreshing || bothFresh || inSpamCooldown;
  const siteReason = refreshing
    ? 'Fetching terrain & buildings…'
    : bothFresh
      ? `Site data is up to date. It can be refreshed again on ` +
        `${new Date(earliestFreshUntil).toLocaleDateString()} — refreshes are ` +
        `limited to keep things efficient.`
      : inSpamCooldown
        ? `Just fetched — please wait about ${Math.max(
            1,
            Math.ceil((cooldownUntil! - now) / 60_000),
          )} min before fetching again.`
        : hasSiteData
          ? 'Re-fetch terrain and buildings for this site.'
          : 'Fetch terrain and buildings for this site.';

  const noPoints = !!scene && scene.controlPoints.length === 0 && scene.surveyPoints.length === 0;

  return (
    <Card className="relative h-full min-h-0 gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none select-none">
      {!scene ? (
        <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
          Loading scene…
        </div>
      ) : (
        <div className="absolute inset-0">
          <TerrainViewer
            scene={scene}
            surface={surface}
            showSurface={showSurface}
            surfaceMode={surfaceMode}
            contours={contourBlob}
            showContours={contours.enabled}
            contourLabels={contours.labels}
            volumeHeatmap={volumeBlob}
            volumeSolid={volumeSolid}
            volumeGradedMesh={volumeGradedBlob}
            showVolume={showVolume}
            volumeGraded={gradedVolume}
            displayUnit={project.displayUnit}
            constraints={constraints}
            showConstraints={showConstraints}
            alignPoints={alignPoints}
            analysisPaths={analysisPaths}
            analysisResult={analysisResult}
            boundary={boundary}
            boundaryDraft={boundaryDraft}
            terrain={terrain}
            buildings={buildings}
            showBuildings={showBuildings}
            categories={categories}
            visibleCategoryIds={visibleCategoryIds}
            visibleIds={visibleIds}
            onSelectPoint={onSelectPoint}
            digitizing={scene ? digitizing : false}
            onDigitizePick={onDigitizePick}
            focus={viewerFocus}
            captureRef={captureRef}
            showGrid={showGrid}
            showPins={showPins}
            showTerrain={showTerrain}
            showOverlays={showOverlays}
            overlays={overlays}
            comparison={comparison}
            showComparison={showComparison}
            originProjectedE={scene.originProjectedE}
            originProjectedN={scene.originProjectedN}
            shownLayers={shownLayers}
            projectOnTerrain={projectOnTerrain}
            showUtilities={showUtilities}
            underground={underground}
            onSelectUtility={setSelectedUtility}
            view={view}
            viewNonce={viewNonce}
          />
        </div>
      )}

      <SceneToolbar
        hasScene={!!scene}
        digitizing={scene ? digitizing : false}
        onCancelDigitize={onCancelDigitize}
        hint={scene && analysisResult ? 'Click a swept-path line to show its label' : undefined}
        categories={categories}
        hidden={hidden}
        setHidden={setHidden}
        groups={groups}
        groupFilter={groupFilter}
        setGroupFilter={setGroupFilter}
        overlayLayers={overlayLayers}
        shownLayers={shownLayers}
        setShownLayers={setShownLayers}
        showPins={showPins}
        setShowPins={setShowPins}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showTerrain={showTerrain}
        setShowTerrain={setShowTerrain}
        showBuildings={showBuildings}
        setShowBuildings={setShowBuildings}
        showOverlays={showOverlays}
        setShowOverlays={setShowOverlays}
        showComparison={showComparison}
        setShowComparison={setShowComparison}
        comparisonCount={comparison?.length ?? 0}
        showUtilities={showUtilities}
        setShowUtilities={setShowUtilities}
        hasSurface={!!surface}
        showSurface={showSurface}
        setShowSurface={setShowSurface}
        surfaceMode={surfaceMode}
        setSurfaceMode={setSurfaceMode}
        hasConstraints={constraints.length > 0}
        showConstraints={showConstraints}
        setShowConstraints={setShowConstraints}
        hasVolume={!!volumeBlob}
        showVolume={showVolume}
        setShowVolume={setShowVolume}
        underground={underground}
        setUnderground={setUnderground}
        utilitiesCount={scene ? scene.utilityRuns.length + scene.utilityStructures.length : 0}
        projectOnTerrain={projectOnTerrain}
        setProjectOnTerrain={setProjectOnTerrain}
        buildingsCount={buildings.length}
        overlaysCount={overlays.length}
        refreshing={refreshing}
        hasSiteData={hasSiteData}
        siteDisabled={siteDisabled}
        siteReason={siteReason}
        onRefreshSite={refreshSite}
        onReload={load}
      />

      {scene ? (
        <SceneStats stats={stats} terrainMeta={terrainMeta} buildingsMeta={buildingsMeta} />
      ) : null}

      {scene ? <CameraControl view={view} onViewChange={setView2} /> : null}

      {/* Cut/fill legend — shown when a volume heatmap is active. */}
      {scene && volumeBlob && showVolume && volumeRange ? (
        <div className="bg-background/90 pointer-events-none absolute right-3 bottom-3 z-20 rounded-lg border px-3 py-2 text-xs shadow-sm backdrop-blur">
          <div className="mb-1 font-semibold">
            Cut / fill (Δz, {project.displayUnit === 'METER' ? 'm' : 'ft'})
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#dc2626] tabular-nums">
              −{Math.abs(fromMeters(volumeRange.minDz, project.displayUnit)).toFixed(1)}
            </span>
            <span
              className="h-2 w-24 rounded"
              style={{
                background: 'linear-gradient(to right, #dc2626 0%, #f5f5f5 50%, #2563eb 100%)',
              }}
            />
            <span className="text-[#2563eb] tabular-nums">
              +{Math.abs(fromMeters(volumeRange.maxDz, project.displayUnit)).toFixed(1)}
            </span>
          </div>
          {/* View mode: cut/fill as solid masses, or the terrain carved to grade. */}
          <div className="text-muted-foreground mt-1.5 mb-1 text-[10px] font-medium tracking-wide uppercase">
            View
          </div>
          <div className="pointer-events-auto grid grid-cols-2 gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setGradedVolume(false)}
              aria-pressed={!gradedVolume}
              className={`rounded border px-2 py-1 transition-colors ${
                gradedVolume
                  ? 'text-muted-foreground hover:bg-accent'
                  : 'border-primary bg-primary/15 text-primary font-semibold'
              }`}
              title="Show the cut/fill as solid 3D masses"
            >
              Cut / fill solids
            </button>
            <button
              type="button"
              onClick={() => setGradedVolume(true)}
              aria-pressed={gradedVolume}
              className={`rounded border px-2 py-1 transition-colors ${
                gradedVolume
                  ? 'border-primary bg-primary/15 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              title="Carve the terrain to the finished grade"
            >
              Graded terrain
            </button>
          </div>
        </div>
      ) : null}

      {/* Setup prompt when the site has no geometry yet. */}
      {noPoints ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="bg-background/95 pointer-events-auto max-w-sm rounded-xl border p-5 text-center shadow-lg backdrop-blur">
            <h3 className="text-sm font-semibold">Nothing to show yet</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Add control and survey points, set the building grid, and configure the site origin to
              populate the 3D view. Use the tabs on the left to get started.
            </p>
          </div>
        </div>
      ) : null}

      {/* Picked utility — a small attribute card (bottom-right). */}
      {selectedUtility ? (
        <div className="absolute right-3 bottom-3 z-20 max-w-xs">
          <div className="bg-background/95 rounded-lg border p-3 text-sm shadow-lg backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{selectedUtility.label}</div>
                <div className="text-muted-foreground text-xs capitalize">
                  {selectedUtility.kind} · {selectedUtility.typeKey.replace(/_/g, ' ')}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedUtility(null)}
              >
                <IconX className="size-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CoordinateInspectorDialog
        project={project}
        point={inspecting}
        onClose={() => setInspecting(null)}
      />
    </Card>
  );
}
