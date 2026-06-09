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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { gql } from '@/lib/graphql';
import { type ControlPoint, type Project, UNIT_LABELS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const UPDATE_CONTROL_POINT = `
  mutation ($id: UUID!, $label: String, $n: Float, $e: Float, $z: Float, $gx: Float, $gy: Float, $unit: LengthUnit!, $src: String) {
    updateControlPoint(id: $id, label: $label, northing: $n, easting: $e, elevation: $z, gridX: $gx, gridY: $gy, unit: $unit, source: $src) { id }
  }`;

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
  const unitLabel = UNIT_LABELS[project.displayUnit];
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit control point</DialogTitle>
          <DialogDescription>Coordinates are in {unitLabel}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ecp-label" className="text-xs">
              Label
            </Label>
            <Input
              id="ecp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder={`Northing (${unitLabel})`}
              value={northing}
              onChange={(e) => setNorthing(e.target.value)}
              required
            />
            <Input
              type="number"
              placeholder={`Easting (${unitLabel})`}
              value={easting}
              onChange={(e) => setEasting(e.target.value)}
              required
            />
            <Input
              type="number"
              placeholder={`Elevation (${unitLabel})`}
              value={elevation}
              onChange={(e) => setElevation(e.target.value)}
            />
            <Input
              type="number"
              placeholder={`Grid X (${unitLabel})`}
              value={gridX}
              onChange={(e) => setGridX(e.target.value)}
            />
            <Input
              type="number"
              placeholder={`Grid Y (${unitLabel})`}
              value={gridY}
              onChange={(e) => setGridY(e.target.value)}
            />
            <Input
              placeholder="Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
