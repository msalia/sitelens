'use client';

import { useState } from 'react';
import { toast } from 'sonner';

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
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { type ControlPoint, type Project } from '@/lib/types';
import { fromMeters, unitName } from '@/lib/units';

import { OptionalBadge } from './field-extras';

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

const UPDATE_CONTROL_POINT = graphql(`
  mutation UpdateControlPoint(
    $id: UUID!
    $label: String
    $n: Float
    $e: Float
    $z: Float
    $gx: Float
    $gy: Float
    $unit: LengthUnit!
    $src: String
  ) {
    updateControlPoint(
      id: $id
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

/** Add/edit a control point. `point === null` while `open` is add mode; passing
 * a `point` switches it to edit mode and seeds the form from that point. */
export function ControlPointDialog({
  onOpenChange,
  onSaved,
  open,
  point,
  project,
}: {
  project: Project;
  /** The point being edited, or null for add mode. */
  point: ControlPoint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = point !== null;
  const unitLabel = unitName(project.displayUnit);
  const [label, setLabel] = useState('');
  const [northing, setNorthing] = useState('');
  const [easting, setEasting] = useState('');
  const [elevation, setElevation] = useState('');
  const [gridX, setGridX] = useState('');
  const [gridY, setGridY] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed the form when the dialog opens: from the point in edit mode, blank for
  // add. Done during render (not an effect) and keyed on open/point/unit so
  // reopening add mode always starts clean.
  const seedSig = `${open}|${point?.id ?? ''}|${project.displayUnit}`;
  const [seededSig, setSeededSig] = useState(seedSig);
  if (seededSig !== seedSig) {
    setSeededSig(seedSig);
    if (open) {
      if (point) {
        const unit = project.displayUnit;
        const fmt = (m: number | null) => (m === null ? '' : fromMeters(m, unit).toFixed(4));
        setLabel(point.label);
        setNorthing(fromMeters(point.northing, unit).toFixed(4));
        setEasting(fromMeters(point.easting, unit).toFixed(4));
        setElevation(fmt(point.elevation));
        setGridX(fmt(point.gridX));
        setGridY(fmt(point.gridY));
        setSource(point.source);
      } else {
        setLabel('');
        setNorthing('');
        setEasting('');
        setElevation('');
        setGridX('');
        setGridY('');
        setSource('');
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const common = {
        e: parseFloat(easting),
        gx: gridX ? parseFloat(gridX) : null,
        gy: gridY ? parseFloat(gridY) : null,
        label,
        n: parseFloat(northing),
        unit: project.displayUnit,
        z: elevation ? parseFloat(elevation) : null,
      };
      if (point) {
        await gql(UPDATE_CONTROL_POINT, { ...common, id: point.id, src: source });
        toast.success('Control point updated');
      } else {
        await gql(ADD_CONTROL_POINT, { ...common, id: project.id, src: source || null });
        toast.success('Control point added');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isEdit ? 'Update failed' : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit control point' : 'Add control point'}</DialogTitle>
          <DialogDescription>N, E, Z and grid offsets are in {unitLabel}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
          <Field className="col-span-2">
            <FieldLabel htmlFor="cpd-label">Label</FieldLabel>
            <Input
              id="cpd-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cpd-northing">Northing</FieldLabel>
            <Input
              id="cpd-northing"
              type="number"
              value={northing}
              onChange={(e) => setNorthing(e.target.value)}
              required
            />
            <FieldDescription>{unitLabel}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="cpd-easting">Easting</FieldLabel>
            <Input
              id="cpd-easting"
              type="number"
              value={easting}
              onChange={(e) => setEasting(e.target.value)}
              required
            />
            <FieldDescription>{unitLabel}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="cpd-gridx" className="w-full">
              Grid X<OptionalBadge />
            </FieldLabel>
            <Input
              id="cpd-gridx"
              type="number"
              value={gridX}
              onChange={(e) => setGridX(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cpd-gridy" className="w-full">
              Grid Y<OptionalBadge />
            </FieldLabel>
            <Input
              id="cpd-gridy"
              type="number"
              value={gridY}
              onChange={(e) => setGridY(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cpd-elevation" className="w-full">
              Elevation
              <OptionalBadge />
            </FieldLabel>
            <Input
              id="cpd-elevation"
              type="number"
              value={elevation}
              onChange={(e) => setElevation(e.target.value)}
            />
            <FieldDescription>{unitLabel}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="cpd-source" className="w-full">
              Source
              <OptionalBadge />
            </FieldLabel>
            <Input id="cpd-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <DialogFooter className="col-span-2">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? isEdit
                  ? 'Saving…'
                  : 'Adding…'
                : isEdit
                  ? 'Save changes'
                  : 'Add control point'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
