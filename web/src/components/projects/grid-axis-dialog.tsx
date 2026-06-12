'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';
import { type GridAxis, type GridFamily, type Project } from '@/lib/types';
import { fromMeters, unitName } from '@/lib/units';

const SET_GRID_AXES = graphql(`
  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {
      id
    }
  }
`);

/** Add/edit a single grid axis. `axis === null` while `open` is add mode; passing
 * an `axis` switches it to edit mode and seeds the form from that axis.
 *
 * The API only exposes the bulk `setGridAxes` mutation, so saving rebuilds the
 * full axis list — keeping the others untouched and applying the one change. */
export function GridAxisDialog({
  axes,
  axis,
  onOpenChange,
  onSaved,
  open,
  project,
}: {
  project: Project;
  /** All currently saved axes (so the full list can be rebuilt on save). */
  axes: GridAxis[];
  /** The axis being edited, or null for add mode. */
  axis: GridAxis | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = axis !== null;
  const unitLabel = unitName(project.displayUnit);
  const [family, setFamily] = useState<GridFamily>('LETTERED');
  const [label, setLabel] = useState('');
  const [position, setPosition] = useState('');
  const { busy, run } = useMutation();

  // Seed the form when the dialog opens: from the axis in edit mode, blank for
  // add. Done during render (not an effect) and keyed on open/axis/unit so
  // reopening add mode always starts clean.
  const seedSig = `${open}|${axis?.id ?? ''}|${project.displayUnit}`;
  const [seededSig, setSeededSig] = useState(seedSig);
  if (seededSig !== seedSig) {
    setSeededSig(seedSig);
    if (open) {
      if (axis) {
        setFamily(axis.family);
        setLabel(axis.label);
        setPosition(fromMeters(axis.position, project.displayUnit).toFixed(4));
      } else {
        setFamily('LETTERED');
        setLabel('');
        setPosition('');
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const unit = project.displayUnit;
    // Rebuild the full list from the saved axes (positions back into display
    // units), then apply this add/edit.
    const rows = axes.map((a) => ({
      family: a.family,
      id: a.id,
      label: a.label,
      position: fromMeters(a.position, unit),
    }));
    const edited = { family, label, position: parseFloat(position) || 0 };
    const next = axis
      ? rows.map((r) => (r.id === axis.id ? { ...r, ...edited } : r))
      : [...rows, { ...edited, id: '' }];
    await run(
      () =>
        gql(SET_GRID_AXES, {
          axes: next.map((r) => ({ family: r.family, label: r.label, position: r.position })),
          id: project.id,
          unit,
        }),
      {
        error: isEdit ? 'Update failed' : 'Add failed',
        onDone: onSaved,
        success: isEdit ? 'Axis updated' : 'Axis added',
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit axis' : 'Add axis'}</DialogTitle>
          <DialogDescription>Position is in {unitLabel}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="gad-family">Family</FieldLabel>
            <Select value={family} onValueChange={(v) => setFamily(v as GridFamily)}>
              <SelectTrigger id="gad-family" className="w-full">
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
          </Field>
          <Field>
            <FieldLabel htmlFor="gad-label">Label</FieldLabel>
            <Input
              id="gad-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="gad-position">Position</FieldLabel>
            <Input
              id="gad-position"
              type="number"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              required
            />
            <FieldDescription>{unitLabel}</FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (isEdit ? 'Saving…' : 'Adding…') : isEdit ? 'Save changes' : 'Add axis'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
