'use client';

import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { type GridAxis, type GridFamily, type Project, UNIT_LABELS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const SET_GRID_AXES = `
  mutation ($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
    setGridAxes(projectId: $id, unit: $unit, axes: $axes) { id }
  }`;

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
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((d) => [...d, { family: 'LETTERED', label: '', position: '0' }])
            }
          >
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
