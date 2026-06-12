'use client';

import { IconDotsVertical, IconPencil, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { GridAxisDialog } from '@/components/projects/grid-axis-dialog';
import { GridImportDialog } from '@/components/projects/grid-import-dialog';
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
import { gql, useMutation } from '@/lib/graphql';
import { type GridAxis, type Project } from '@/lib/types';
import { fromMeters, unitName } from '@/lib/units';

const SET_GRID_AXES = graphql(`
  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {
      id
    }
  }
`);

const FAMILY_LABELS: Record<GridAxis['family'], string> = {
  LETTERED: 'Lettered',
  NUMBERED: 'Numbered',
};

export function GridEditor({
  axes,
  onSaved,
  project,
}: {
  project: Project;
  axes: GridAxis[];
  onSaved: () => void;
}) {
  const unitLabel = unitName(project.displayUnit);
  // The same dialog handles add (axis === null) and edit (axis set).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GridAxis | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GridAxis | null>(null);
  const { run } = useMutation();

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(a: GridAxis) {
    setEditing(a);
    setDialogOpen(true);
  }

  // The API only exposes the bulk `setGridAxes` mutation, so deleting rebuilds
  // the full list (in display units) without the removed axis.
  async function remove(id: string) {
    const unit = project.displayUnit;
    await run(
      () =>
        gql(SET_GRID_AXES, {
          axes: axes
            .filter((a) => a.id !== id)
            .map((a) => ({
              family: a.family,
              label: a.label,
              position: fromMeters(a.position, unit),
            })),
          id: project.id,
          unit,
        }),
      { error: 'Delete failed', onDone: onSaved, success: 'Axis deleted' },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Building grid</CardTitle>
        <CardDescription>
          Lettered and numbered axes with their offsets, in {unitLabel}.
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
                <TableHead>Family</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {axes.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="w-12">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label="Axis actions">
                            <IconDotsVertical className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => openEdit(a)}>
                          <IconPencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(a)}>
                          <IconTrash className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell>{FAMILY_LABELS[a.family]}</TableCell>
                  <TableCell className="font-medium">{a.label}</TableCell>
                  <TableCell>{fromMeters(a.position, project.displayUnit).toFixed(3)}</TableCell>
                </TableRow>
              ))}
              {axes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-center text-sm">
                    No axes yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <GridImportDialog
          project={project}
          axes={axes}
          onImported={onSaved}
          trigger={
            <Button variant="outline">
              <IconUpload className="mr-1 size-4" /> Import
            </Button>
          }
        />
        <Button className="flex-1" onClick={openAdd}>
          <IconPlus className="mr-1 size-4" /> Add axis
        </Button>
      </CardFooter>

      <GridAxisDialog
        project={project}
        axes={axes}
        axis={editing}
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
          onSaved();
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete ? `Delete axis ${pendingDelete.label}?` : 'Delete axis?'}
        description="This grid axis will be removed. This can’t be undone."
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
