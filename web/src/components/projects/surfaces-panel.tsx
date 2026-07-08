'use client';

import { IconEye, IconEyeOff, IconMountain, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { PointCategory, Project } from '@/lib/types';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { Button } from '@/components/ui/button';
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
import { gql, useMutation } from '@/lib/graphql';

import { BUILD_SURFACE, DELETE_SURFACE, REBUILD_SURFACE, SURFACES } from './surfaces-data';
import { POINT_GROUPS } from './survey-points-data';

type Scope = 'ALL' | 'CATEGORY' | 'GROUP';

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

/**
 * The Surfaces panel (Phase 1): build a TIN from a scoped point selection, view
 * it in the 3D scene, rebuild (→ new version), and delete. Contours, volumes,
 * DEM upload, and export arrive in later phases.
 */
export function SurfacesPanel({
  activeSurfaceId,
  categories,
  onChanged,
  onSelect,
  project,
}: {
  project: Project;
  categories: PointCategory[];
  /** The surface currently shown in the scene (null = none). */
  activeSurfaceId: string | null;
  /** Selects (or clears) the scene's active surface. */
  onSelect: (id: string | null) => void;
  /** Bumped after a build/rebuild so the scene refetches the mesh. */
  onChanged: () => void;
}) {
  const [surfaces, setSurfaces] = useState<SurfaceRow[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('Surface 1');
  const [scope, setScope] = useState<Scope>('ALL');
  const [scopeRef, setScopeRef] = useState<string>('');
  const { busy, run } = useMutation();

  const load = useCallback(async () => {
    try {
      const { surfaces: rows } = await gql(SURFACES, { projectId: project.id });
      setSurfaces(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load surfaces');
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

  // Loading surfaces + groups on mount is a legitimate data-fetching effect;
  // the setState inside each loader runs after its await.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadGroups();
  }, [load, loadGroups]);

  // The build/rebuild input from the current form state.
  const currentInput = useMemo(
    () => ({
      name: name.trim() || 'Untitled surface',
      scope,
      scopeRef: scope === 'ALL' ? null : scopeRef || null,
    }),
    [name, scope, scopeRef],
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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Build a surface</CardTitle>
          <CardDescription>
            Triangulate selected survey points into a TIN, rendered in the 3D scene. Choose which
            points to include, then build.
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

          <Button type="button" onClick={build} disabled={busy || !scopeValid}>
            <IconMountain className="mr-1 size-4" />
            {busy ? 'Building…' : 'Build surface'}
          </Button>
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
    </>
  );
}
