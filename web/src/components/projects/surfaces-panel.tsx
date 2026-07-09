'use client';

import {
  IconEye,
  IconEyeOff,
  IconMountain,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconVectorTriangle,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { PointCategory, Project, ScenePoint } from '@/lib/types';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { ImportBreaklinesDialog } from '@/components/projects/surfaces/import-breaklines-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { gql, useMutation } from '@/lib/graphql';
import { UNIT_LABELS } from '@/lib/types';

import {
  AUTO_BOUNDARY,
  BREAKLINES,
  BUILD_SURFACE,
  type ContourSettings,
  CREATE_BREAKLINE,
  DELETE_BREAKLINE,
  DELETE_SURFACE,
  REBUILD_SURFACE,
  SURFACES,
} from './surfaces-data';
import { POINT_GROUPS } from './survey-points-data';

type Scope = 'ALL' | 'CATEGORY' | 'GROUP';
type BreaklineKind = 'HARD' | 'BOUNDARY' | 'HOLE';

interface SurfaceRow {
  createdAt: string;
  failureReason: string | null;
  id: string;
  kind: string;
  name: string;
  status: string;
  triangleCount: number;
  version: number;
  vertexCount: number;
}

interface BreaklineRow {
  closed: boolean;
  id: string;
  kind: BreaklineKind;
  source: string;
  sourceLayer: string | null;
  vertices: string;
}

const KIND_LABEL: Record<BreaklineKind, string> = {
  BOUNDARY: 'Boundary',
  HARD: 'Breakline',
  HOLE: 'Hole',
};

/** Minimum vertices for a usable constraint of the given kind. */
function minVerts(kind: BreaklineKind): number {
  return kind === 'HARD' ? 2 : 3;
}

/**
 * The Surfaces panel: build a survey-grade TIN from a scoped point selection with
 * optional breaklines / boundary / holes (digitized in-scene or imported from
 * DXF), view it in 3D, rebuild (→ new version), and delete.
 */
export function SurfacesPanel({
  activeSurfaceId,
  categories,
  contours,
  onChanged,
  onContoursChange,
  onDigitizingChange,
  onSelect,
  pickRef,
  project,
}: {
  project: Project;
  categories: PointCategory[];
  /** The surface currently shown in the scene (null = none). */
  activeSurfaceId: string | null;
  /** Selects (or clears) the scene's active surface. */
  onSelect: (id: string | null) => void;
  /** Bumped after a build/rebuild/constraint change so the scene refetches. */
  onChanged: () => void;
  /** Current contour-generation settings (rendered live in the scene). */
  contours: ContourSettings;
  /** Updates the contour settings. */
  onContoursChange: (next: ContourSettings) => void;
  /** Scene digitize bridge: snapped survey points feed the active capture. */
  pickRef: React.MutableRefObject<((point: ScenePoint) => void) | null>;
  /** Toggles the scene's "click points to snap" hint. */
  onDigitizingChange: (on: boolean) => void;
}) {
  const [surfaces, setSurfaces] = useState<SurfaceRow[]>([]);
  const [breaklines, setBreaklines] = useState<BreaklineRow[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('Surface 1');
  const [scope, setScope] = useState<Scope>('ALL');
  const [scopeRef, setScopeRef] = useState<string>('');
  const [maxEdge, setMaxEdge] = useState('');
  // Breakline capture state.
  const [captureKind, setCaptureKind] = useState<BreaklineKind>('HARD');
  const [capturing, setCapturing] = useState(false);
  const [captureVerts, setCaptureVerts] = useState<{ e: number; n: number; z: number }[]>([]);
  const { busy, run } = useMutation();

  const load = useCallback(async () => {
    try {
      const { surfaces: rows } = await gql(SURFACES, { projectId: project.id });
      setSurfaces(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load surfaces');
    }
  }, [project.id]);

  const loadBreaklines = useCallback(async () => {
    try {
      const { breaklines: rows } = await gql(BREAKLINES, { projectId: project.id });
      setBreaklines(rows as BreaklineRow[]);
    } catch {
      setBreaklines([]);
    }
  }, [project.id]);

  const loadGroups = useCallback(async () => {
    try {
      const { pointGroups } = await gql(POINT_GROUPS, { id: project.id });
      setGroups(pointGroups.map((g) => ({ id: g.id, name: g.name })));
    } catch {
      setGroups([]);
    }
  }, [project.id]);

  // Loading surfaces + breaklines + groups on mount is a data-fetching effect;
  // the setState inside each loader runs after its await.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadBreaklines();
    void loadGroups();
  }, [load, loadBreaklines, loadGroups]);

  // Route snapped survey points into the active capture while digitizing.
  useEffect(() => {
    if (capturing) {
      pickRef.current = (p) =>
        setCaptureVerts((v) => [...v, { e: p.easting, n: p.northing, z: p.height }]);
      onDigitizingChange(true);
    } else {
      pickRef.current = null;
      onDigitizingChange(false);
    }
    return () => {
      pickRef.current = null;
    };
  }, [capturing, pickRef, onDigitizingChange]);

  // Clear the scene hint if the panel unmounts mid-capture.
  useEffect(() => () => onDigitizingChange(false), [onDigitizingChange]);

  // Build input includes all defined constraints (all breaklines + the first
  // boundary + all holes) so a surface honors everything the user has drawn.
  const currentInput = useMemo(
    () => ({
      boundaryId: breaklines.find((b) => b.kind === 'BOUNDARY')?.id ?? null,
      breaklineIds: breaklines.filter((b) => b.kind === 'HARD').map((b) => b.id),
      holeIds: breaklines.filter((b) => b.kind === 'HOLE').map((b) => b.id),
      maxEdgeLength: maxEdge ? Number(maxEdge) : null,
      name: name.trim() || 'Untitled surface',
      scope,
      scopeRef: scope === 'ALL' ? null : scopeRef || null,
    }),
    [breaklines, maxEdge, name, scope, scopeRef],
  );

  const scopeValid = scope === 'ALL' || scopeRef !== '';

  const build = () =>
    run(() => gql(BUILD_SURFACE, { input: currentInput, projectId: project.id }), {
      error: 'Could not build the surface',
      onDone: async (res) => {
        await load();
        if (res?.buildSurface.id) {
          onSelect(res.buildSurface.id);
        }
        onChanged();
      },
      success: 'Surface built',
    });

  const rebuild = (id: string) =>
    run(() => gql(REBUILD_SURFACE, { id, input: currentInput }), {
      error: 'Could not rebuild the surface',
      onDone: async () => {
        await load();
        onSelect(id);
        onChanged();
      },
      success: 'Surface rebuilt',
    });

  const remove = (id: string) =>
    run(() => gql(DELETE_SURFACE, { id }), {
      error: 'Could not delete the surface',
      onDone: async () => {
        if (activeSurfaceId === id) {
          onSelect(null);
        }
        await load();
        onChanged();
      },
      success: 'Surface deleted',
    });

  const saveBreakline = () =>
    run(
      () =>
        gql(CREATE_BREAKLINE, {
          input: { closed: captureKind !== 'HARD', kind: captureKind, vertices: captureVerts },
          projectId: project.id,
        }),
      {
        error: 'Could not save the breakline',
        onDone: async () => {
          setCapturing(false);
          setCaptureVerts([]);
          await loadBreaklines();
          onChanged();
        },
        success: 'Constraint saved',
      },
    );

  const autoBoundary = () =>
    run(() => gql(AUTO_BOUNDARY, { projectId: project.id, scope: 'ALL', scopeRef: null }), {
      error: 'Could not derive a boundary',
      onDone: async () => {
        await loadBreaklines();
        onChanged();
      },
      success: 'Boundary generated',
    });

  const removeBreakline = (id: string) =>
    run(() => gql(DELETE_BREAKLINE, { id }), {
      error: 'Could not delete the constraint',
      onDone: async () => {
        await loadBreaklines();
        onChanged();
      },
      success: 'Constraint deleted',
    });

  const vertCount = (b: BreaklineRow): number => {
    try {
      return (JSON.parse(b.vertices) as unknown[]).length;
    } catch {
      return 0;
    }
  };

  const unit = UNIT_LABELS[project.displayUnit];
  const setContour = <K extends keyof ContourSettings>(key: K, value: ContourSettings[K]) =>
    onContoursChange({ ...contours, [key]: value });
  // Number field → non-negative number (blank/invalid ⇒ 0).
  const numField = (key: 'interval' | 'majorInterval') => (raw: string) => {
    const n = Number(raw);
    setContour(key, Number.isFinite(n) && n >= 0 ? n : 0);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Build a surface</CardTitle>
          <CardDescription>
            Triangulate selected survey points into a TIN, honoring any constraints below. Rendered
            in the 3D scene.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="surf-name">Name</FieldLabel>
            <Input
              id="surf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Existing grade"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="surf-scope">Points</FieldLabel>
            <Select
              value={scope}
              onValueChange={(v) => {
                if (!v) {
                  return;
                }
                setScope(v as Scope);
                setScopeRef('');
              }}
            >
              <SelectTrigger id="surf-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Point selection</SelectLabel>
                  <SelectItem value="ALL">All design points</SelectItem>
                  <SelectItem value="CATEGORY">By category</SelectItem>
                  <SelectItem value="GROUP">By group</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {scope === 'CATEGORY' ? (
            <Field>
              <FieldLabel htmlFor="surf-cat">Category</FieldLabel>
              <Select value={scopeRef} onValueChange={(v) => v && setScopeRef(v)}>
                <SelectTrigger id="surf-cat" className="w-full">
                  <SelectValue placeholder="Choose a category…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Category</SelectLabel>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {scope === 'GROUP' ? (
            <Field>
              <FieldLabel htmlFor="surf-group">Group</FieldLabel>
              <Select value={scopeRef} onValueChange={(v) => v && setScopeRef(v)}>
                <SelectTrigger id="surf-group" className="w-full">
                  <SelectValue placeholder="Choose a group…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Group</SelectLabel>
                    {groups.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No groups yet
                      </SelectItem>
                    ) : (
                      groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="surf-maxedge">Max edge length (m, optional)</FieldLabel>
            <Input
              id="surf-maxedge"
              type="number"
              min="0"
              value={maxEdge}
              onChange={(e) => setMaxEdge(e.target.value)}
              placeholder="Drop slivers longer than…"
            />
          </Field>

          <Button type="button" onClick={build} disabled={busy || !scopeValid}>
            <IconMountain className="mr-1 size-4" />
            {busy ? 'Building…' : 'Build surface'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Constraints
            <span className="text-muted-foreground ml-2 font-normal">{breaklines.length}</span>
          </CardTitle>
          <CardDescription>
            Breaklines force triangle edges; a boundary clips the surface; holes cut voids. Digitize
            by clicking survey points in the scene, auto-generate a boundary, or import from DXF.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {capturing ? (
            <div className="border-primary bg-primary/5 flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Capturing {KIND_LABEL[captureKind].toLowerCase()} — {captureVerts.length} point(s)
                </span>
                <span className="text-muted-foreground text-xs">Click points in the scene</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={saveBreakline}
                  disabled={busy || captureVerts.length < minVerts(captureKind)}
                >
                  <IconPlus className="mr-1 size-4" /> Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCaptureVerts((v) => v.slice(0, -1))}
                  disabled={captureVerts.length === 0}
                >
                  Undo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCapturing(false);
                    setCaptureVerts([]);
                  }}
                >
                  <IconX className="mr-1 size-4" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={captureKind}
                onValueChange={(v) => v && setCaptureKind(v as BreaklineKind)}
              >
                <SelectTrigger className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Constraint kind</SelectLabel>
                    <SelectItem value="HARD">Hard breakline</SelectItem>
                    <SelectItem value="BOUNDARY">Boundary</SelectItem>
                    <SelectItem value="HOLE">Hole</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button type="button" size="sm" onClick={() => setCapturing(true)}>
                <IconPencil className="mr-1 size-4" /> Digitize
              </Button>
              <ButtonGroup>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={autoBoundary}
                  disabled={busy}
                >
                  <IconVectorTriangle className="mr-1 size-4" /> Auto boundary
                </Button>
                <ImportBreaklinesDialog project={project} onImported={loadBreaklines} />
              </ButtonGroup>
            </div>
          )}

          {breaklines.length > 0 ? (
            <div className="flex flex-col gap-2">
              {breaklines.map((b) => (
                <div key={b.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Badge variant="outline" className="shrink-0">
                    {KIND_LABEL[b.kind]}
                  </Badge>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {vertCount(b)} pts
                    {b.sourceLayer ? ` · ${b.sourceLayer}` : ''}
                    {b.source === 'dxf' ? ' · DXF' : ''}
                  </span>
                  <ConfirmDialog
                    title={`Delete this ${KIND_LABEL[b.kind].toLowerCase()}?`}
                    description="Rebuild any surface that used it to apply the change."
                    onConfirm={() => removeBreakline(b.id)}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete constraint"
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Surfaces
            <span className="text-muted-foreground ml-2 font-normal">{surfaces.length}</span>
          </CardTitle>
          <CardDescription>Click a surface to show it in the 3D scene.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {surfaces.length === 0 ? (
            <p className="text-muted-foreground text-sm">No surfaces yet — build one above.</p>
          ) : (
            surfaces.map((s) => {
              const active = s.id === activeSurfaceId;
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
                    active ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(active ? null : s.id)}
                  >
                    <div className="flex items-center gap-2">
                      {active ? (
                        <IconEye className="text-primary size-4 shrink-0" />
                      ) : (
                        <IconEyeOff className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      <span className="text-muted-foreground text-xs">v{s.version}</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {s.kind.toUpperCase()} · {s.triangleCount.toLocaleString()} triangles ·{' '}
                      {s.vertexCount.toLocaleString()} pts
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Rebuild ${s.name}`}
                    disabled={busy || !scopeValid}
                    onClick={() => rebuild(s.id)}
                  >
                    <IconRefresh className="size-4" />
                  </Button>
                  <ConfirmDialog
                    title={`Delete “${s.name}”?`}
                    description="This removes the surface and its computed mesh."
                    onConfirm={() => remove(s.id)}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${s.name}`}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    }
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Contours</CardTitle>
          <CardDescription>
            Iso-lines generated from the active surface, drawn live in the 3D scene. Intervals are
            in {unit}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {activeSurfaceId ? (
            <>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="ctr-show" className="cursor-pointer">
                  Show contours
                </FieldLabel>
                <Switch
                  id="ctr-show"
                  checked={contours.enabled}
                  onCheckedChange={(v) => setContour('enabled', v)}
                />
              </div>

              {contours.enabled ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="ctr-interval">Interval ({unit})</FieldLabel>
                      <Input
                        id="ctr-interval"
                        type="number"
                        min="0"
                        step="any"
                        value={contours.interval}
                        onChange={(e) => numField('interval')(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ctr-major">Major every ({unit})</FieldLabel>
                      <Input
                        id="ctr-major"
                        type="number"
                        min="0"
                        step="any"
                        value={contours.majorInterval}
                        onChange={(e) => numField('majorInterval')(e.target.value)}
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="ctr-smooth">Smoothing</FieldLabel>
                    <Select
                      value={String(contours.smoothing)}
                      onValueChange={(v) => v && setContour('smoothing', Number(v))}
                    >
                      <SelectTrigger id="ctr-smooth" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Smoothing passes</SelectLabel>
                          <SelectItem value="0">None (follow triangles)</SelectItem>
                          <SelectItem value="1">Light</SelectItem>
                          <SelectItem value="2">Medium</SelectItem>
                          <SelectItem value="3">Heavy</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="ctr-labels" className="cursor-pointer">
                      Elevation labels on majors
                    </FieldLabel>
                    <Switch
                      id="ctr-labels"
                      checked={contours.labels}
                      onCheckedChange={(v) => setContour('labels', v)}
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Select a surface above to generate contours.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
