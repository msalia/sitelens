'use client';

import {
  IconAdjustments,
  IconFocusCentered,
  IconMountain,
  IconRefresh,
  IconStack2,
  IconStack3,
  IconUsersGroup,
} from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
  BuildingFootprint,
  CameraView,
  RenderableOverlay,
  TerrainData,
} from '@/components/projects/terrain-viewer';
import type { InspectablePoint, PointCategory, Project, SceneData } from '@/lib/types';

import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { CAMERA_VIEWS } from '@/components/projects/terrain-viewer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { parseDxf } from '@/lib/dxf';
import { gql } from '@/lib/graphql';
import { subscribeProjectChanged } from '@/lib/scene-subscription';

import {
  BUILDINGS_CONTENT,
  FRESH_MS,
  OVERLAY_CONTENT,
  REFRESH_BUILDINGS,
  REFRESH_TERRAIN,
  SCENE_QUERY,
  sceneBbox,
  SPAM_COOLDOWN_MS,
  TERRAIN_CONTENT,
} from './scene-view-data';

// The WebGL viewer is browser-only; load it lazily and never on the server.
const TerrainViewer = dynamic(
  () => import('@/components/projects/terrain-viewer').then((m) => m.TerrainViewer),
  {
    loading: () => <p className="text-muted-foreground p-6 text-sm">Loading 3D engine…</p>,
    ssr: false,
  },
);

export function SceneView({
  categories,
  focus,
  project,
  reloadNonce,
  stats,
}: {
  project: Project;
  categories: PointCategory[];
  /** Request from the table to fly to a point; `nonce` re-triggers. */
  focus?: { id: string; nonce: number } | null;
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

  // Loads the cached DEM bytes (no-op if there's no terrain row yet).
  const loadTerrainContent = useCallback(async () => {
    try {
      const { projectTerrainContent } = await gql(TERRAIN_CONTENT, { id: project.id });
      setTerrain(projectTerrainContent ? { contentBase64: projectTerrainContent } : null);
    } catch {
      setTerrain(null);
    }
  }, [project.id]);

  // Loads + parses the cached OSM building footprints (no-op if none cached).
  const loadBuildingsContent = useCallback(async () => {
    try {
      const { projectBuildingsContent } = await gql(BUILDINGS_CONTENT, { id: project.id });
      const parsed = JSON.parse(projectBuildingsContent) as BuildingFootprint[];
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
            const { cadOverlayContent } = await gql(OVERLAY_CONTENT, { id: o.id });
            const dxf = parseDxf(cadOverlayContent);
            dxf.layers.forEach((l) => layers.add(l));
            return {
              elevation: o.elevation,
              id: o.id,
              offsetE: o.offsetE,
              offsetN: o.offsetN,
              polylines: dxf.polylines,
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

  function toggleLayer(layer: string) {
    setShownLayers((s) => {
      const next = new Set(s);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }

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
  }, [scene, project.id, terrainMeta, buildingsMeta, loadTerrainContent, loadBuildingsContent]);

  const onSelectPoint = useCallback(
    (id: string) => {
      const p = scene?.surveyPoints.find((s) => s.id === id);
      if (p) {
        setInspecting({ easting: p.easting, label: p.label, northing: p.northing });
      }
    },
    [scene],
  );

  function toggleCategory(id: string) {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

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

  const hiddenCount = categories.filter((c) => hidden.has(c.id)).length;
  const hiddenLayerCount = overlayLayers.filter((l) => !shownLayers.has(l)).length;
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
            terrain={terrain}
            buildings={buildings}
            showBuildings={showBuildings}
            categories={categories}
            visibleCategoryIds={visibleCategoryIds}
            visibleIds={visibleIds}
            onSelectPoint={onSelectPoint}
            focus={viewerFocus}
            captureRef={captureRef}
            showGrid={showGrid}
            showPins={showPins}
            showTerrain={showTerrain}
            showOverlays={showOverlays}
            overlays={overlays}
            originProjectedE={scene.originProjectedE}
            originProjectedN={scene.originProjectedN}
            shownLayers={shownLayers}
            projectOnTerrain={projectOnTerrain}
            view={view}
            viewNonce={viewNonce}
          />
        </div>
      )}

      {/* Top bar — categories + display toggles (left), data actions (right). The
          container ignores pointer events so the canvas stays draggable between. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {scene && categories.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline">
                    <IconStack2 className="mr-1 size-4" />
                    Categories
                    {hiddenCount > 0 ? (
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({hiddenCount} hidden)
                      </span>
                    ) : null}
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Show categories</DropdownMenuLabel>
                  <DropdownMenuItem
                    closeOnClick={false}
                    onClick={() =>
                      setHidden(
                        hiddenCount === 0 ? new Set(categories.map((c) => c.id)) : new Set(),
                      )
                    }
                  >
                    {hiddenCount === 0 ? 'Select none' : 'Select all'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {categories.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={!hidden.has(c.id)}
                      onCheckedChange={() => toggleCategory(c.id)}
                    >
                      <span
                        className="mr-2 inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {scene && groups.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline">
                    <IconUsersGroup className="mr-1 size-4" />
                    {groupFilter === 'all'
                      ? 'All groups'
                      : (groups.find((g) => g.id === groupFilter)?.name ?? 'Group')}
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Filter by group</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={groupFilter} onValueChange={setGroupFilter}>
                    <DropdownMenuRadioItem value="all">All groups</DropdownMenuRadioItem>
                    {groups.map((g) => (
                      <DropdownMenuRadioItem key={g.id} value={g.id}>
                        {g.name}
                        <span className="text-muted-foreground ml-auto text-xs">
                          {g.memberIds.length}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {overlayLayers.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline">
                    <IconStack3 className="mr-1 size-4" />
                    Layers
                    {hiddenLayerCount > 0 ? (
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({hiddenLayerCount} hidden)
                      </span>
                    ) : null}
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>DXF layers</DropdownMenuLabel>
                  <DropdownMenuItem
                    closeOnClick={false}
                    onClick={() =>
                      setShownLayers(hiddenLayerCount === 0 ? new Set() : new Set(overlayLayers))
                    }
                  >
                    {hiddenLayerCount === 0 ? 'Select none' : 'Select all'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {overlayLayers.map((l) => (
                    <DropdownMenuCheckboxItem
                      key={l}
                      checked={shownLayers.has(l)}
                      onCheckedChange={() => toggleLayer(l)}
                    >
                      {l}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="outline">
                  <IconAdjustments className="mr-1 size-4" />
                  Display
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Display</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={showPins}
                  onCheckedChange={(v) => setShowPins(Boolean(v))}
                >
                  Point pins
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showGrid}
                  onCheckedChange={(v) => setShowGrid(Boolean(v))}
                >
                  Grid lines
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showTerrain}
                  onCheckedChange={(v) => {
                    const on = Boolean(v);
                    setShowTerrain(on);
                    // Hiding terrain also stops projecting onto it (still freely
                    // re-enableable on its own).
                    if (!on) {
                      setProjectOnTerrain(false);
                    }
                  }}
                >
                  Terrain
                </DropdownMenuCheckboxItem>
                {buildings.length > 0 ? (
                  <DropdownMenuCheckboxItem
                    checked={showBuildings}
                    onCheckedChange={(v) => setShowBuildings(Boolean(v))}
                  >
                    Buildings
                  </DropdownMenuCheckboxItem>
                ) : null}
                <DropdownMenuCheckboxItem
                  checked={projectOnTerrain}
                  onCheckedChange={(v) => {
                    const on = Boolean(v);
                    setProjectOnTerrain(on);
                    // Projecting onto hidden terrain makes no sense — turn it on
                    // so the surface the points drape onto is actually visible.
                    if (on) {
                      setShowTerrain(true);
                    }
                  }}
                >
                  Project onto terrain
                </DropdownMenuCheckboxItem>
                {overlays.length > 0 ? (
                  <DropdownMenuCheckboxItem
                    checked={showOverlays}
                    onCheckedChange={(v) => setShowOverlays(Boolean(v))}
                  >
                    DXF overlays
                  </DropdownMenuCheckboxItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button size="sm" variant="outline" disabled={siteDisabled} onClick={refreshSite}>
                <IconMountain className="mr-1 size-4" />
                {refreshing ? 'Fetching…' : hasSiteData ? 'Refresh site' : 'Load site data'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{siteReason}</TooltipContent>
          </Tooltip>
          <Button size="sm" variant="outline" onClick={load}>
            <IconRefresh className="mr-1 size-4" />
            Reload
          </Button>
        </div>
      </div>

      {/* Bottom-left — live stats + terrain provenance, plain text. */}
      {scene ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 space-y-0.5 text-xs">
          {stats?.map((s) => (
            <div key={s.label}>
              <span className="text-muted-foreground">{s.label}:</span>{' '}
              <span className="text-foreground font-medium">{s.value}</span>
            </div>
          ))}
          {terrainMeta ? (
            <div>
              <span className="text-muted-foreground">Terrain:</span>{' '}
              <span className="text-foreground font-medium">
                {terrainMeta.demtype ? `${terrainMeta.demtype} · ` : ''}
                {new Date(terrainMeta.fetchedAt).toLocaleDateString()}
              </span>
            </div>
          ) : null}
          {buildingsMeta ? (
            <div>
              <span className="text-muted-foreground">Buildings:</span>{' '}
              <span className="text-foreground font-medium">
                {buildingsMeta.count} · OSM ·{' '}
                {new Date(buildingsMeta.fetchedAt).toLocaleDateString()}
              </span>
            </div>
          ) : null}
          {terrainMeta || buildingsMeta ? (
            <div className="text-muted-foreground pt-1 text-[10px] whitespace-nowrap">
              Terrain &amp; buildings are not survey-grade — for visual reference only.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Bottom-right — camera viewpoint selector + reset camera. */}
      {scene ? (
        <div className="pointer-events-none absolute right-3 bottom-3 z-10 flex items-center gap-2">
          <div className="pointer-events-auto">
            <Select value={view} onValueChange={(v) => setView2(v as CameraView)}>
              <SelectTrigger size="sm" className="bg-background w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Camera</SelectLabel>
                  {CAMERA_VIEWS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                size="icon-sm"
                variant="outline"
                className="bg-background pointer-events-auto"
                aria-label="Reset camera to default view"
                onClick={() => setView2('iso')}
              >
                <IconFocusCentered className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset camera (isometric)</TooltipContent>
          </Tooltip>
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

      <CoordinateInspectorDialog
        project={project}
        point={inspecting}
        onClose={() => setInspecting(null)}
      />
    </Card>
  );
}
