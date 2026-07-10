'use client';

import { IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { Project, ScenePoint } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';

const SET_PROJECT_BOUNDARY = graphql(`
  mutation SetProjectBoundary($projectId: UUID!, $boundary: String) {
    setProjectBoundary(projectId: $projectId, boundary: $boundary) {
      id
      boundary
    }
  }
`);

/** Parses a stored `[[e,n],…]` boundary string into projected vertices. */
export function parseBoundary(boundary: string | null): { e: number; n: number }[] {
  if (!boundary) {
    return [];
  }
  try {
    const arr = JSON.parse(boundary) as [number, number][];
    return arr.map(([e, n]) => ({ e, n }));
  } catch {
    return [];
  }
}

/**
 * Draw/edit the project's property boundary — the parcel outline used as the
 * area-of-interest for the detailed terrain fetch that hydrology analysis runs
 * on. Vertices snap to survey points / grid intersections / DXF vertices via the
 * scene pick bridge, or can be typed as coordinates. The saved ring is rendered
 * in the scene as persistent site context.
 */
export function BoundaryPanel({
  onChanged,
  onDigitizingChange,
  onDraftChange,
  pickRef,
  project,
}: {
  project: Project;
  onChanged: () => void;
  /** Scene digitize bridge: snapped points feed the active drawing. */
  pickRef: React.MutableRefObject<((point: ScenePoint) => void) | null>;
  /** Toggles the scene's "click points to snap" targets. */
  onDigitizingChange: (on: boolean) => void;
  /** Publishes the in-progress ring for live scene rendering (null when idle). */
  onDraftChange: (points: { e: number; n: number }[] | null) => void;
}) {
  const saved = parseBoundary(project.boundary);
  const [editing, setEditing] = useState(false);
  const [verts, setVerts] = useState<{ e: number; n: number }[]>([]);
  const [eIn, setEIn] = useState('');
  const [nIn, setNIn] = useState('');
  const { busy, run } = useMutation();

  // Route snapped scene points into the drawing while editing.
  useEffect(() => {
    if (editing) {
      pickRef.current = (p) => setVerts((v) => [...v, { e: p.easting, n: p.northing }]);
      onDigitizingChange(true);
    } else {
      pickRef.current = null;
      onDigitizingChange(false);
    }
    return () => {
      pickRef.current = null;
    };
  }, [editing, pickRef, onDigitizingChange]);

  useEffect(() => () => onDigitizingChange(false), [onDigitizingChange]);

  // Publish the in-progress ring (null when not editing → scene shows the saved one).
  useEffect(() => {
    onDraftChange(editing ? verts : null);
    return () => onDraftChange(null);
  }, [editing, verts, onDraftChange]);

  const startEdit = useCallback(() => {
    setVerts(saved);
    setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.boundary]);

  const addNumeric = () => {
    const e = Number(eIn);
    const n = Number(nIn);
    if (!Number.isFinite(e) || !Number.isFinite(n) || eIn === '' || nIn === '') {
      toast.error('Enter both easting and northing.');
      return;
    }
    setVerts((v) => [...v, { e, n }]);
    setEIn('');
    setNIn('');
  };

  const save = () =>
    run(
      () =>
        gql(SET_PROJECT_BOUNDARY, {
          boundary: JSON.stringify(verts.map((v) => [v.e, v.n])),
          projectId: project.id,
        }),
      {
        error: 'Could not save the boundary',
        onDone: () => {
          setEditing(false);
          setVerts([]);
          onChanged();
        },
        success: 'Boundary saved',
      },
    );

  const clear = () =>
    run(() => gql(SET_PROJECT_BOUNDARY, { boundary: null, projectId: project.id }), {
      error: 'Could not clear the boundary',
      onDone: () => {
        setEditing(false);
        setVerts([]);
        onChanged();
      },
      success: 'Boundary cleared',
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Property boundary</CardTitle>
        <CardDescription>
          Draw the parcel outline — snap to survey points, grid intersections, or DXF vertices in
          the scene, or type coordinates. It bounds the detailed terrain fetch used by hydrology
          analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editing ? (
          <div className="border-primary bg-primary/5 flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Drawing — {verts.length} point(s)</span>
              <span className="text-muted-foreground text-xs">click points to snap</span>
            </div>

            <div className="flex flex-col gap-1">
              {verts.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No points yet — click points in the 3D scene or add by coordinates below.
                </p>
              ) : (
                verts.map((v, i) => (
                  <div
                    key={i}
                    className="bg-muted/40 flex items-center gap-2 rounded px-2 py-1 text-xs"
                  >
                    <span className="text-muted-foreground w-5 tabular-nums">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">
                      E {v.e.toFixed(2)} · N {v.n.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove point ${i + 1}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setVerts((vs) => vs.filter((_, j) => j !== i))}
                    >
                      <IconX className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-end gap-1.5">
              <Field className="flex-1">
                <FieldLabel htmlFor="bnd-easting">Easting (m)</FieldLabel>
                <Input
                  id="bnd-easting"
                  type="number"
                  step="any"
                  placeholder="Easting"
                  value={eIn}
                  onChange={(e) => setEIn(e.target.value)}
                />
              </Field>
              <Field className="flex-1">
                <FieldLabel htmlFor="bnd-northing">Northing (m)</FieldLabel>
                <Input
                  id="bnd-northing"
                  type="number"
                  step="any"
                  placeholder="Northing"
                  value={nIn}
                  onChange={(e) => setNIn(e.target.value)}
                />
              </Field>
              <Button type="button" variant="secondary" onClick={addNumeric}>
                Add
              </Button>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setVerts([]);
                }}
              >
                <IconX className="mr-1 size-4" /> Cancel
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={busy || verts.length < 3}>
                Save boundary
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {saved.length >= 3
                ? `Boundary set — ${saved.length} points.`
                : 'No boundary set yet.'}
            </p>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={startEdit}>
                <IconPencil className="mr-1 size-4" />
                {saved.length >= 3 ? 'Edit boundary' : 'Draw boundary'}
              </Button>
              {saved.length >= 3 ? (
                <Button type="button" variant="outline" disabled={busy} onClick={clear}>
                  <IconTrash className="mr-1 size-4" /> Clear
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
