'use client';

import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { type GridAxis, type GridFamily, type Project, UNIT_OPTIONS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const SET_GRID_AXES = graphql(`
  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {
      id
    }
  }
`);

type AxisDraft = { family: GridFamily; label: string; position: string };

export function GridEditor({
  axes,
  onSaved,
  project,
}: {
  project: Project;
  axes: GridAxis[];
  onSaved: () => void;
}) {
  const unitLabel = UNIT_OPTIONS.find((u) => u.value === project.displayUnit)?.label ?? '';
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

  async function save() {
    setBusy(true);
    try {
      await gql(SET_GRID_AXES, {
        axes: draft.map((r) => ({
          family: r.family,
          label: r.label,
          position: parseFloat(r.position) || 0,
        })),
        id: project.id,
        unit: project.displayUnit,
      });
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
        <CardDescription>
          Lettered and numbered axes with their offsets, in {unitLabel}.
        </CardDescription>
      </CardHeader>
      {/* `-mb` collapses the gap so the table sits flush against the footer. */}
      <CardContent className="-mb-(--card-spacing) flex flex-col gap-4">
        {/* Full-bleed table: the top border frames it; the footer's border-t
            closes the bottom. First/last cells keep the card padding. */}
        <div className="-mx-(--card-spacing) border-t [&_[data-slot=table-container]]:overscroll-x-none [&_td:first-child]:pl-(--card-spacing) [&_td:last-child]:pr-(--card-spacing) [&_th:first-child]:pl-(--card-spacing) [&_th:last-child]:pr-(--card-spacing)">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Family</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Position</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.map((row, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Select
                      value={row.family}
                      onValueChange={(v) => update(i, { family: v as GridFamily })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Axis type</SelectLabel>
                          <SelectItem value="LETTERED">Lettered</SelectItem>
                          <SelectItem value="NUMBERED">Numbered</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={row.label}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
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
                      onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}
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
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <Button
          variant="outline"
          onClick={() => setDraft((d) => [...d, { family: 'LETTERED', label: '', position: '0' }])}
        >
          <IconPlus className="mr-1 size-4" /> Add axis
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save grid'}
        </Button>
      </CardFooter>
    </Card>
  );
}
