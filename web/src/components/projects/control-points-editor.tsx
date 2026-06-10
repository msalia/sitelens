'use client';

import { IconDotsVertical, IconMapPin, IconPencil, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
import { EditControlPointDialog } from '@/components/projects/edit-control-point-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { type ControlPoint, type Project, UNIT_OPTIONS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const ADD_CONTROL_POINT = graphql(`
  mutation AddControlPoint(
    $id: UUID!
    $label: String!
    $n: Float!
    $e: Float!
    $z: Float
    $gx: Float
    $gy: Float
    $unit: LengthUnit!
    $src: String
  ) {
    addControlPoint(
      projectId: $id
      label: $label
      northing: $n
      easting: $e
      elevation: $z
      gridX: $gx
      gridY: $gy
      unit: $unit
      source: $src
    ) {
      id
    }
  }
`);
const DELETE_CONTROL_POINT = graphql(`
  mutation DeleteControlPoint($id: UUID!) {
    deleteControlPoint(id: $id)
  }
`);

export function ControlPointsEditor({
  onChanged,
  points,
  project,
}: {
  project: Project;
  points: ControlPoint[];
  onChanged: () => void;
}) {
  const unitLabel = UNIT_OPTIONS.find((u) => u.value === project.displayUnit)?.label ?? '';
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
  const [pendingDelete, setPendingDelete] = useState<ControlPoint | null>(null);

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
      await gql(DELETE_CONTROL_POINT, { id });
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
        <CardDescription>
          City control tied to the building grid. N, E, Z and grid offsets are in {unitLabel}.
        </CardDescription>
      </CardHeader>

      <form onSubmit={add} className="contents">
        <CardContent className="flex flex-col gap-4">
          {/* Full-bleed table: dividers span the card edges; first/last cells
              keep the card's horizontal padding so text aligns with the header. */}
          <div className="-mx-(--card-spacing) border-y [&_[data-slot=table-container]]:overscroll-x-none [&_td:first-child]:pl-(--card-spacing) [&_td:last-child]:pr-(--card-spacing) [&_th:first-child]:pl-(--card-spacing) [&_th:last-child]:pr-(--card-spacing)">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead className="w-12" />
                  <TableHead>Label</TableHead>
                  <TableHead>N</TableHead>
                  <TableHead>E</TableHead>
                  <TableHead>Z</TableHead>
                  <TableHead>Grid X</TableHead>
                  <TableHead>Grid Y</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="w-12">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Control point actions"
                            >
                              <IconDotsVertical className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => setInspecting(p)}>
                            <IconMapPin className="size-4" /> Inspect
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditing(p)}>
                            <IconPencil className="size-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(p)}
                          >
                            <IconTrash className="size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field className="col-span-2">
              <FieldLabel htmlFor="cp-label">Label</FieldLabel>
              <Input id="cp-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-northing">Northing</FieldLabel>
              <Input
                id="cp-northing"
                type="number"
                value={northing}
                onChange={(e) => setNorthing(e.target.value)}
                required
              />
              <FieldDescription>{unitLabel}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-easting">Easting</FieldLabel>
              <Input
                id="cp-easting"
                type="number"
                value={easting}
                onChange={(e) => setEasting(e.target.value)}
                required
              />
              <FieldDescription>{unitLabel}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-gridx" className="w-full">
                Grid X
                <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>
              </FieldLabel>
              <Input
                id="cp-gridx"
                type="number"
                value={gridX}
                onChange={(e) => setGridX(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-gridy" className="w-full">
                Grid Y
                <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>
              </FieldLabel>
              <Input
                id="cp-gridy"
                type="number"
                value={gridY}
                onChange={(e) => setGridY(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-elevation" className="w-full">
                Elevation
                <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>
              </FieldLabel>
              <Input
                id="cp-elevation"
                type="number"
                value={elevation}
                onChange={(e) => setElevation(e.target.value)}
              />
              <FieldDescription>{unitLabel}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="cp-source" className="w-full">
                Source
                <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>
              </FieldLabel>
              <Input id="cp-source" value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>
          </div>
        </CardContent>

        <CardFooter>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Adding…' : 'Add control point'}
          </Button>
        </CardFooter>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete ? `Delete ${pendingDelete.label}?` : 'Delete control point?'}
        description="This control point will be removed. This can’t be undone."
        onConfirm={() => {
          if (pendingDelete) {
            void remove(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />
    </Card>
  );
}
