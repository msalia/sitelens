'use client';

import { IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { gql } from '@/lib/graphql';
import {
  type ControlPoint,
  type GridAxis,
  type GridFamily,
  type Project,
  UNIT_LABELS,
} from '@/lib/types';
import { fromMeters } from '@/lib/units';

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [axes, setAxes] = useState<GridAxis[]>([]);
  const [points, setPoints] = useState<ControlPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await gql<{
        project: Project | null;
        gridAxes: GridAxis[];
        controlPoints: ControlPoint[];
      }>(
        `query ($id: UUID!) {
          project(id: $id) { id name description epsgCode displayUnit combinedScaleFactor siteOriginLat siteOriginLon }
          gridAxes(projectId: $id) { id family label position }
          controlPoints(projectId: $id) { id label northing easting elevation source }
        }`,
        { id },
      );
      setProject(data.project);
      setAxes(data.gridAxes);
      setPoints(data.controlPoints);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }
  if (!project) {
    return (
      <div className="p-6">
        <p className="text-sm">Project not found.</p>
        <Link href="/projects" className="text-sm underline">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href="/projects"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <IconArrowLeft className="size-4" /> Projects
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
        <p className="text-muted-foreground text-sm">
          EPSG {project.epsgCode} · units {UNIT_LABELS[project.displayUnit]} · scale{' '}
          {project.combinedScaleFactor}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GridEditor project={project} axes={axes} onSaved={load} />
        <ControlPointsEditor project={project} points={points} onChanged={load} />
      </div>
    </div>
  );
}

type AxisDraft = { family: GridFamily; label: string; position: string };

function GridEditor({
  axes,
  onSaved,
  project,
}: {
  project: Project;
  axes: GridAxis[];
  onSaved: () => void;
}) {
  const unitLabel = UNIT_LABELS[project.displayUnit];
  const [draft, setDraft] = useState<AxisDraft[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(
      axes.map((a) => ({
        family: a.family,
        label: a.label,
        position: fromMeters(a.position, project.displayUnit).toFixed(4),
      })),
    );
  }, [axes, project.displayUnit]);

  function update(i: number, patch: Partial<AxisDraft>) {
    setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setDraft((d) => [...d, { family: 'LETTERED', label: '', position: '0' }]);
  }
  function removeRow(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    try {
      await gql(
        `mutation ($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
          setGridAxes(projectId: $id, unit: $unit, axes: $axes) { id }
        }`,
        {
          axes: draft.map((r) => ({
            family: r.family,
            label: r.label,
            position: parseFloat(r.position) || 0,
          })),
          id: project.id,
          unit: project.displayUnit,
        },
      );
      toast.success('Grid saved');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Building grid</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Family</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Position ({unitLabel})</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <NativeSelect
                    className="w-full"
                    value={row.family}
                    onChange={(e) => update(i, { family: e.target.value as GridFamily })}
                  >
                    <NativeSelectOption value="LETTERED">Lettered</NativeSelectOption>
                    <NativeSelectOption value="NUMBERED">Numbered</NativeSelectOption>
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <Input value={row.label} onChange={(e) => update(i, { label: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={row.position}
                    onChange={(e) => update(i, { position: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove axis"
                    onClick={() => removeRow(i)}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {draft.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground text-center text-sm">
                  No axes yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>
            <IconPlus className="mr-1 size-4" /> Add axis
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save grid'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ControlPointsEditor({
  onChanged,
  points,
  project,
}: {
  project: Project;
  points: ControlPoint[];
  onChanged: () => void;
}) {
  const unitLabel = UNIT_LABELS[project.displayUnit];
  const [label, setLabel] = useState('');
  const [northing, setNorthing] = useState('');
  const [easting, setEasting] = useState('');
  const [elevation, setElevation] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(
        `mutation ($id: UUID!, $label: String!, $n: Float!, $e: Float!, $z: Float, $unit: LengthUnit!, $src: String) {
          addControlPoint(projectId: $id, label: $label, northing: $n, easting: $e, elevation: $z, unit: $unit, source: $src) { id }
        }`,
        {
          e: parseFloat(easting),
          id: project.id,
          label,
          n: parseFloat(northing),
          src: source || null,
          unit: project.displayUnit,
          z: elevation ? parseFloat(elevation) : null,
        },
      );
      toast.success('Control point added');
      setLabel('');
      setNorthing('');
      setEasting('');
      setElevation('');
      setSource('');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await gql('mutation ($id: UUID!) { deleteControlPoint(id: $id) }', { id });
      toast.success('Control point deleted');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Control points</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>N ({unitLabel})</TableHead>
              <TableHead>E ({unitLabel})</TableHead>
              <TableHead>Z ({unitLabel})</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.label}</TableCell>
                <TableCell>{fromMeters(p.northing, project.displayUnit).toFixed(3)}</TableCell>
                <TableCell>{fromMeters(p.easting, project.displayUnit).toFixed(3)}</TableCell>
                <TableCell>
                  {p.elevation === null
                    ? '—'
                    : fromMeters(p.elevation, project.displayUnit).toFixed(3)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete point"
                    onClick={() => remove(p.id)}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {points.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center text-sm">
                  No control points yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <form onSubmit={add} className="grid grid-cols-2 gap-2 border-t pt-3">
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="cp-label" className="text-xs">
              Label
            </Label>
            <Input
              id="cp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>
          <Input
            placeholder={`Northing (${unitLabel})`}
            type="number"
            value={northing}
            onChange={(e) => setNorthing(e.target.value)}
            required
          />
          <Input
            placeholder={`Easting (${unitLabel})`}
            type="number"
            value={easting}
            onChange={(e) => setEasting(e.target.value)}
            required
          />
          <Input
            placeholder={`Elevation (${unitLabel})`}
            type="number"
            value={elevation}
            onChange={(e) => setElevation(e.target.value)}
          />
          <Input
            placeholder="Source (optional)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Button type="submit" className="col-span-2" disabled={busy}>
            {busy ? 'Adding…' : 'Add control point'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
