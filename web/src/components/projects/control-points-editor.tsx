'use client';

import { IconMapPin, IconPencil, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { EditControlPointDialog } from '@/components/projects/edit-control-point-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { gql } from '@/lib/graphql';
import { type ControlPoint, type Project, UNIT_LABELS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const ADD_CONTROL_POINT = `
  mutation ($id: UUID!, $label: String!, $n: Float!, $e: Float!, $z: Float, $gx: Float, $gy: Float, $unit: LengthUnit!, $src: String) {
    addControlPoint(projectId: $id, label: $label, northing: $n, easting: $e, elevation: $z, gridX: $gx, gridY: $gy, unit: $unit, source: $src) { id }
  }`;

export function ControlPointsEditor({
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
  const [gridX, setGridX] = useState('');
  const [gridY, setGridY] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ControlPoint | null>(null);
  const [inspecting, setInspecting] = useState<ControlPoint | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(ADD_CONTROL_POINT, {
        e: parseFloat(easting),
        gx: gridX ? parseFloat(gridX) : null,
        gy: gridY ? parseFloat(gridY) : null,
        id: project.id,
        label,
        n: parseFloat(northing),
        src: source || null,
        unit: project.displayUnit,
        z: elevation ? parseFloat(elevation) : null,
      });
      toast.success('Control point added');
      setLabel('');
      setNorthing('');
      setEasting('');
      setElevation('');
      setGridX('');
      setGridY('');
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
              <TableHead>Grid X</TableHead>
              <TableHead>Grid Y</TableHead>
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
                  {p.gridX === null ? '—' : fromMeters(p.gridX, project.displayUnit).toFixed(3)}
                </TableCell>
                <TableCell>
                  {p.gridY === null ? '—' : fromMeters(p.gridY, project.displayUnit).toFixed(3)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Inspect coordinate"
                      onClick={() => setInspecting(p)}
                    >
                      <IconMapPin className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit point"
                      onClick={() => setEditing(p)}
                    >
                      <IconPencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete point"
                      onClick={() => remove(p.id)}
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {points.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center text-sm">
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
            placeholder={`Grid X (${unitLabel})`}
            type="number"
            value={gridX}
            onChange={(e) => setGridX(e.target.value)}
          />
          <Input
            placeholder={`Grid Y (${unitLabel})`}
            type="number"
            value={gridY}
            onChange={(e) => setGridY(e.target.value)}
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

        <EditControlPointDialog
          project={project}
          point={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />

        <CoordinateInspectorDialog
          project={project}
          point={inspecting}
          onClose={() => setInspecting(null)}
        />
      </CardContent>
    </Card>
  );
}
