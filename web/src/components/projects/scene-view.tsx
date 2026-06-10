'use client';

import {
  IconAdjustments,
  IconFocusCentered,
  IconMountain,
  IconRefresh,
  IconStack2,
} from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { CameraView, TerrainData } from '@/components/projects/terrain-viewer';
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
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

// The server enforces a 7-day cooldown on re-fetching terrain (OpenTopography is
// rate-limited). On top of that we add a short client-side anti-spam window so a
// failed/initial fetch can't be hammered before the server guard kicks in.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const SPAM_COOLDOWN_MS = 30 * 60 * 1000;

// The WebGL viewer is browser-only; load it lazily and never on the server.
const TerrainViewer = dynamic(
  () => import('@/components/projects/terrain-viewer').then((m) => m.TerrainViewer),
  {
    loading: () => <p className="text-muted-foreground p-6 text-sm">Loading 3D engine…</p>,
    ssr: false,
  },
);

const SCENE_QUERY = graphql(`
  query Scene($id: UUID!) {
    sceneData(projectId: $id) {
      origin {
        latitude
        longitude
        height
      }
      originProjectedE
      originProjectedN
      controlPoints {
        id
        label
        latitude
        longitude
        height
        easting
        northing
        categoryId
      }
      surveyPoints {
        id
        label
        latitude
        longitude
        height
        easting
        northing
        categoryId
      }
      gridLines {
        label
        coordinates {
          latitude
          longitude
          height
        }
      }
    }
    projectTerrain(projectId: $id) {
      demtype
      fetchedAt
    }
  }
`);

const TERRAIN_CONTENT = graphql(`
  query TerrainContent($id: UUID!) {
    projectTerrainContent(projectId: $id)
  }
`);

const REFRESH_TERRAIN = graphql(`
  mutation RefreshTerrain(
    $id: UUID!
    $south: Float!
    $north: Float!
    $west: Float!
    $east: Float!
    $force: Boolean
  ) {
    refreshTerrain(
      projectId: $id
      south: $south
      north: $north
      west: $west
      east: $east
      force: $force
    ) {
      demtype
      fetchedAt
    }
  }
`);

/** Bounding box (degrees) covering all scene geometry, padded so the terrain
 * extends a little past the survey. Returns null when there's nothing sited. */
function sceneBbox(
  scene: SceneData,
): { south: number; north: number; west: number; east: number } | null {
  const pts = [...scene.controlPoints, ...scene.surveyPoints];
  const lats = pts.map((p) => p.latitude);
  const lons = pts.map((p) => p.longitude);
  // Drive the bbox off the actual points; only fall back to the site origin when
  // there are none. (A misconfigured origin far from the points would otherwise
  // stretch the bbox into a useless sliver of terrain.)
  if (pts.length === 0 && scene.origin) {
    lats.push(scene.origin.latitude);
    lons.push(scene.origin.longitude);
  }
  if (lats.length === 0) {
    return null;
  }
  let south = Math.min(...lats);
  let north = Math.max(...lats);
  let west = Math.min(...lons);
  let east = Math.max(...lons);
  // Pad by ~10% of the span, with a small floor so a single point still fetches
  // a usable tile. Kept modest to minimize the OpenTopography request size.
  const padLat = Math.max((north - south) * 0.1, 0.0025);
  const padLon = Math.max((east - west) * 0.1, 0.0025);
  south -= padLat;
  north += padLat;
  west -= padLon;
  east += padLon;
  return { east, north, south, west };
}

export function SceneView({
  categories,
  focus,
  project,
  stats,
}: {
  project: Project;
  categories: PointCategory[];
  /** Request from the table to fly to a point; `nonce` re-triggers. */
  focus?: { id: string; nonce: number } | null;
  /** Live stats overlaid on the viewer (bottom-left), as a label: value list. */
  stats?: { label: string; value: ReactNode }[];
}) {
  const [scene, setScene] = useState<SceneData | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [terrainMeta, setTerrainMeta] = useState<{ fetchedAt: string; demtype: string } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<InspectablePoint | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [showTerrain, setShowTerrain] = useState(true);
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load scene');
    }
  }, [project.id, loadTerrainContent]);

  // The 3D view is always present — load as soon as the panel mounts.
  useEffect(() => {
    void load();
  }, [load]);

  // Fetch (or refresh) the DEM server-side. The Rust API enforces the 7-day
  // cooldown and owns the OpenTopography call, so we just surface the result.
  const refreshTerrain = useCallback(
    async (force: boolean) => {
      if (!scene) {
        return;
      }
      const bbox = sceneBbox(scene);
      if (!bbox) {
        toast.error('Add control or survey points before fetching terrain.');
        return;
      }
      setRefreshing(true);
      try {
        const { refreshTerrain: meta } = await gql(REFRESH_TERRAIN, {
          east: bbox.east,
          force,
          id: project.id,
          north: bbox.north,
          south: bbox.south,
          west: bbox.west,
        });
        setTerrainMeta({ demtype: meta.demtype, fetchedAt: meta.fetchedAt });
        await loadTerrainContent();
        toast.success(force ? 'Terrain refreshed.' : 'Terrain loaded.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to fetch terrain');
      } finally {
        setRefreshing(false);
        // Anti-spam: any attempt (success or failure) holds the button for 30 min.
        setCooldownUntil(Date.now() + SPAM_COOLDOWN_MS);
        setNow(Date.now());
      }
    },
    [scene, project.id, loadTerrainContent],
  );

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

  // Terrain button state: disabled while in flight, while the cached DEM is still
  // fresh (server's 7-day rule), or during the client anti-spam window.
  const fetchedAtMs = terrainMeta ? new Date(terrainMeta.fetchedAt).getTime() : null;
  const freshUntil = fetchedAtMs !== null ? fetchedAtMs + FRESH_MS : null;
  const isFresh = freshUntil !== null && now < freshUntil;
  const inSpamCooldown = cooldownUntil !== null && now < cooldownUntil;
  const terrainDisabled = refreshing || isFresh || inSpamCooldown;
  const terrainReason = refreshing
    ? 'Fetching terrain from OpenTopography…'
    : isFresh
      ? `Terrain is up to date (fetched ${new Date(fetchedAtMs!).toLocaleDateString()}). ` +
        `It can be refreshed again on ${new Date(freshUntil!).toLocaleDateString()} — ` +
        `OpenTopography limits how often we can re-fetch.`
      : inSpamCooldown
        ? `Just fetched — please wait about ${Math.max(
            1,
            Math.ceil((cooldownUntil! - now) / 60_000),
          )} min before fetching again.`
        : terrainMeta
          ? 'Re-fetch terrain elevation from OpenTopography.'
          : 'Fetch terrain elevation from OpenTopography for this site.';

  const hiddenCount = categories.filter((c) => hidden.has(c.id)).length;
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
            categories={categories}
            visibleCategoryIds={visibleCategoryIds}
            onSelectPoint={onSelectPoint}
            focus={viewerFocus}
            captureRef={captureRef}
            showGrid={showGrid}
            showPins={showPins}
            showTerrain={showTerrain}
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
                <DropdownMenuCheckboxItem
                  checked={projectOnTerrain}
                  onCheckedChange={(v) => setProjectOnTerrain(Boolean(v))}
                >
                  Project onto terrain
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                size="sm"
                variant="outline"
                disabled={terrainDisabled}
                onClick={() => refreshTerrain(Boolean(terrainMeta))}
              >
                <IconMountain className="mr-1 size-4" />
                {refreshing ? 'Fetching…' : terrainMeta ? 'Refresh terrain' : 'Load terrain'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{terrainReason}</TooltipContent>
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
