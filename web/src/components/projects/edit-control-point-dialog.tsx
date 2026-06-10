'use client';

import { useEffect, useState } from 'react';
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
import { type ControlPoint, type Project, UNIT_OPTIONS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

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

const optional = (
  <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>
);

export function EditControlPointDialog({
  onClose,
  onSaved,
  point,
  project,
}: {
  project: Project;
  point: ControlPoint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const unitName = UNIT_OPTIONS.find((u) => u.value === project.displayUnit)?.label ?? '';
  const [label, setLabel] = useState('');
  const [northing, setNorthing] = useState('');
  const [easting, setEasting] = useState('');
  const [elevation, setElevation] = useState('');
  const [gridX, setGridX] = useState('');
  const [gridY, setGridY] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!point) {
      return;
    }
    const unit = project.displayUnit;
    const fmt = (m: number | null) => (m === null ? '' : fromMeters(m, unit).toFixed(4));
    setLabel(point.label);
    setNorthing(fromMeters(point.northing, unit).toFixed(4));
    setEasting(fromMeters(point.easting, unit).toFixed(4));
    setElevation(fmt(point.elevation));
    setGridX(fmt(point.gridX));
    setGridY(fmt(point.gridY));
    setSource(point.source);
  }, [point, project.displayUnit]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!point) {
      return;
    }
    setBusy(true);
    try {
      await gql(UPDATE_CONTROL_POINT, {
        e: parseFloat(easting),
        gx: gridX ? parseFloat(gridX) : null,
        gy: gridY ? parseFloat(gridY) : null,
        id: point.id,
        label,
        n: parseFloat(northing),
        src: source,
        unit: project.displayUnit,
        z: elevation ? parseFloat(elevation) : null,
      });
      toast.success('Control point updated');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={point !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit control point</DialogTitle>
          <DialogDescription>N, E, Z and grid offsets are in {unitName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
          <Field className="col-span-2">
            <FieldLabel htmlFor="ecp-label">Label</FieldLabel>
            <Input
              id="ecp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ecp-northing">Northing</FieldLabel>
            <Input
              id="ecp-northing"
              type="number"
              value={northing}
              onChange={(e) => setNorthing(e.target.value)}
              required
            />
            <FieldDescription>{unitName}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ecp-easting">Easting</FieldLabel>
            <Input
              id="ecp-easting"
              type="number"
              value={easting}
              onChange={(e) => setEasting(e.target.value)}
              required
            />
            <FieldDescription>{unitName}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ecp-gridx" className="w-full">
              Grid X{optional}
            </FieldLabel>
            <Input
              id="ecp-gridx"
              type="number"
              value={gridX}
              onChange={(e) => setGridX(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ecp-gridy" className="w-full">
              Grid Y{optional}
            </FieldLabel>
            <Input
              id="ecp-gridy"
              type="number"
              value={gridY}
              onChange={(e) => setGridY(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ecp-elevation" className="w-full">
              Elevation
              {optional}
            </FieldLabel>
            <Input
              id="ecp-elevation"
              type="number"
              value={elevation}
              onChange={(e) => setElevation(e.target.value)}
            />
            <FieldDescription>{unitName}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ecp-source" className="w-full">
              Source
              {optional}
            </FieldLabel>
            <Input id="ecp-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <DialogFooter className="col-span-2">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
