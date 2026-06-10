'use client';

import { IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { PointGroup, Project } from '@/lib/types';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
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

const POINT_GROUPS = graphql(`
  query GroupManagerGroups($id: UUID!) {
    pointGroups(projectId: $id) {
      id
      projectId
      name
      memberIds
    }
  }
`);
const CREATE_POINT_GROUP = graphql(`
  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {
    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {
      id
    }
  }
`);
const DELETE_POINT_GROUP = graphql(`
  mutation GroupManagerDelete($id: UUID!) {
    deletePointGroup(id: $id)
  }
`);

export function GroupManagerDialog({
  onApply,
  onChanged,
  project,
  selectedIds,
  trigger,
}: {
  project: Project;
  /** Current table selection — the members a new group is created from. */
  selectedIds: string[];
  /** Apply a group: select its members in the table. */
  onApply: (memberIds: string[]) => void;
  /** Notifies the parent after a group is created/deleted (e.g. to refresh filters). */
  onChanged?: () => void;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<PointGroup[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { pointGroups } = await gql(POINT_GROUPS, { id: project.id });
      setGroups(pointGroups);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load groups');
    }
  }

  useEffect(() => {
    if (open) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0 || !name.trim()) {
      return;
    }
    setBusy(true);
    try {
      await gql(CREATE_POINT_GROUP, { id: project.id, ids: selectedIds, name: name.trim() });
      toast.success('Group created');
      setName('');
      void load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await gql(DELETE_POINT_GROUP, { id });
      toast.success('Group deleted');
      void load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline">
              Groups
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Point groups</DialogTitle>
          <DialogDescription>
            Saved selections of survey points. Click a group to select its points.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 border-y [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Group</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => {
                        onApply(g.memberIds);
                        setOpen(false);
                      }}
                    >
                      {g.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right">
                    {g.memberIds.length}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${g.name}`}>
                            <IconTrash className="size-4" />
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{g.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The group is removed; the points themselves are not affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => remove(g.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
              {groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center text-sm">
                    No saved groups yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <form onSubmit={create} className="contents">
          <Field>
            <FieldLabel htmlFor="grp-name">New group</FieldLabel>
            <Input
              id="grp-name"
              placeholder="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !name.trim() || selectedIds.length === 0}
            >
              {selectedIds.length === 0
                ? 'Select points in the table first'
                : `Create from ${selectedIds.length} selected point(s)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
