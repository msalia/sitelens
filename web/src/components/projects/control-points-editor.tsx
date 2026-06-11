'use client';

import { IconDotsVertical, IconMapPin, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { ControlPointDialog } from '@/components/projects/control-point-dialog';
import { CoordinateInspectorDialog } from '@/components/projects/coordinate-inspector-dialog';
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
import { type ControlPoint, type Project } from '@/lib/types';
import { fromMeters, unitName } from '@/lib/units';

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
  const unitLabel = unitName(project.displayUnit);
  // The same dialog handles add (point === null) and edit (point set).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ControlPoint | null>(null);
  const [inspecting, setInspecting] = useState<ControlPoint | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ControlPoint | null>(null);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(p: ControlPoint) {
    setEditing(p);
    setDialogOpen(true);
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

      <CardContent>
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
                          <Button variant="ghost" size="icon-sm" aria-label="Control point actions">
                            <IconDotsVertical className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setInspecting(p)}>
                          <IconMapPin className="size-4" /> Inspect
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(p)}>
                          <IconPencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(p)}>
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
      </CardContent>

      <CardFooter>
        <Button className="w-full" onClick={openAdd}>
          <IconPlus className="mr-1 size-4" /> Add control point
        </Button>
      </CardFooter>

      <ControlPointDialog
        project={project}
        point={editing}
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setEditing(null);
          }
        }}
        onSaved={() => {
          setDialogOpen(false);
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
