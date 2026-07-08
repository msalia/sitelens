'use client';

import {
  IconAdjustments,
  IconMountain,
  IconRefresh,
  IconStack2,
  IconStack3,
  IconUsersGroup,
} from '@tabler/icons-react';
import { type Dispatch, type SetStateAction } from 'react';

import type { SurfaceMode } from '@/components/projects/terrain/surface-mesh';

import { Button } from '@/components/ui/button';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type PointCategory } from '@/lib/types';

type SceneGroup = { id: string; name: string; memberIds: string[] };

/** The overlay toolbar on the 3D scene: category / group / layer / display
 * toggles on the left, site-data + reload actions on the right. Purely a view
 * over state owned by the parent SceneView. */
export function SceneToolbar({
  buildingsCount,
  categories,
  comparisonCount,
  groupFilter,
  groups,
  hasConstraints,
  hasScene,
  hasSiteData,
  hasSurface,
  hidden,
  onRefreshSite,
  onReload,
  overlayLayers,
  overlaysCount,
  projectOnTerrain,
  refreshing,
  setGroupFilter,
  setHidden,
  setProjectOnTerrain,
  setShowBuildings,
  setShowComparison,
  setShowConstraints,
  setShowGrid,
  setShownLayers,
  setShowOverlays,
  setShowPins,
  setShowSurface,
  setShowTerrain,
  setShowUtilities,
  setSurfaceMode,
  setUnderground,
  showBuildings,
  showComparison,
  showConstraints,
  showGrid,
  shownLayers,
  showOverlays,
  showPins,
  showSurface,
  showTerrain,
  showUtilities,
  siteDisabled,
  siteReason,
  surfaceMode,
  underground,
  utilitiesCount,
}: {
  hasScene: boolean;
  categories: PointCategory[];
  hidden: Set<string>;
  setHidden: Dispatch<SetStateAction<Set<string>>>;
  groups: SceneGroup[];
  groupFilter: string;
  setGroupFilter: (v: string) => void;
  overlayLayers: string[];
  shownLayers: Set<string>;
  setShownLayers: Dispatch<SetStateAction<Set<string>>>;
  showPins: boolean;
  setShowPins: (v: boolean) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  showTerrain: boolean;
  setShowTerrain: (v: boolean) => void;
  showBuildings: boolean;
  setShowBuildings: (v: boolean) => void;
  showOverlays: boolean;
  setShowOverlays: (v: boolean) => void;
  showComparison: boolean;
  setShowComparison: (v: boolean) => void;
  comparisonCount: number;
  showUtilities: boolean;
  setShowUtilities: (v: boolean) => void;
  hasSurface: boolean;
  hasConstraints: boolean;
  showConstraints: boolean;
  setShowConstraints: (v: boolean) => void;
  showSurface: boolean;
  setShowSurface: (v: boolean) => void;
  surfaceMode: SurfaceMode;
  setSurfaceMode: (v: SurfaceMode) => void;
  underground: boolean;
  setUnderground: (v: boolean) => void;
  utilitiesCount: number;
  projectOnTerrain: boolean;
  setProjectOnTerrain: (v: boolean) => void;
  buildingsCount: number;
  overlaysCount: number;
  refreshing: boolean;
  hasSiteData: boolean;
  siteDisabled: boolean;
  siteReason: string;
  onRefreshSite: () => void;
  onReload: () => void;
}) {
  const hiddenCount = categories.filter((c) => hidden.has(c.id)).length;
  const hiddenLayerCount = overlayLayers.filter((l) => !shownLayers.has(l)).length;

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

  return (
    // Top bar — categories + display toggles (left), data actions (right). The
    // container ignores pointer events so the canvas stays draggable between.
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        {hasScene && categories.length > 0 ? (
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
                    setHidden(hiddenCount === 0 ? new Set(categories.map((c) => c.id)) : new Set())
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
        {hasScene && groups.length > 0 ? (
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
              {buildingsCount > 0 ? (
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
              {overlaysCount > 0 ? (
                <DropdownMenuCheckboxItem
                  checked={showOverlays}
                  onCheckedChange={(v) => setShowOverlays(Boolean(v))}
                >
                  DXF overlays
                </DropdownMenuCheckboxItem>
              ) : null}
              {comparisonCount > 0 ? (
                <DropdownMenuCheckboxItem
                  checked={showComparison}
                  onCheckedChange={(v) => setShowComparison(Boolean(v))}
                >
                  As-built comparison
                </DropdownMenuCheckboxItem>
              ) : null}
              {hasSurface ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={showSurface}
                    onCheckedChange={(v) => setShowSurface(Boolean(v))}
                  >
                    Surface
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuLabel>Surface shading</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={surfaceMode}
                    onValueChange={(v) => setSurfaceMode(v as SurfaceMode)}
                  >
                    <DropdownMenuRadioItem value="ramp">Elevation ramp</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="slope">Slope</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="wireframe">Wireframe</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {hasConstraints ? (
                <DropdownMenuCheckboxItem
                  checked={showConstraints}
                  onCheckedChange={(v) => setShowConstraints(Boolean(v))}
                >
                  Constraints
                </DropdownMenuCheckboxItem>
              ) : null}
              {utilitiesCount > 0 ? (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showUtilities}
                    onCheckedChange={(v) => setShowUtilities(Boolean(v))}
                  >
                    Utilities
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={underground}
                    onCheckedChange={(v) => setUnderground(Boolean(v))}
                  >
                    Underground mode
                  </DropdownMenuCheckboxItem>
                </>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button size="sm" variant="outline" disabled={siteDisabled} onClick={onRefreshSite}>
              <IconMountain className="mr-1 size-4" />
              {refreshing ? 'Fetching…' : hasSiteData ? 'Refresh site' : 'Load site data'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{siteReason}</TooltipContent>
        </Tooltip>
        <Button size="sm" variant="outline" onClick={onReload}>
          <IconRefresh className="mr-1 size-4" />
          Reload
        </Button>
      </div>
    </div>
  );
}
