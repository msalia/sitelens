'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { type CoordinateSet, type InspectablePoint, type Project, UNIT_LABELS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const CONVERT = graphql(`
  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {
    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {
      gridX
      gridY
      projectedGridE
      projectedGridN
      projectedGroundE
      projectedGroundN
      latitude
      longitude
    }
  }
`);

/** Shows every representation of a control point's coordinate, live. */
export function CoordinateInspectorDialog({
  onClose,
  point,
  project,
}: {
  project: Project;
  point: InspectablePoint | null;
  onClose: () => void;
}) {
  const unitLabel = UNIT_LABELS[project.displayUnit];
  const [set, setSet] = useState<CoordinateSet | null>(null);
  const [loading, setLoading] = useState(false);

  // Legitimate data-fetching effect: convert the selected point via the API.
  useEffect(() => {
    if (!point) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSet(null);
    setLoading(true);
    // Pass the stored (meters) projected coordinate; the API derives the rest.
    gql(CONVERT, {
      id: project.id,
      x: point.easting,
      y: point.northing,
    })
      .then((d) => setSet(d.convertCoordinate))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Convert failed'))
      .finally(() => setLoading(false));
  }, [point, project.id]);

  const u = (m: number | null) =>
    m === null ? '—' : `${fromMeters(m, project.displayUnit).toFixed(4)} ${unitLabel}`;
  const deg = (d: number | null) => (d === null ? '—' : `${d.toFixed(7)}°`);

  return (
    <Dialog open={point !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{point ? `Coordinate: ${point.label}` : 'Coordinate'}</DialogTitle>
          <DialogDescription>
            All representations, derived from the projected value.
          </DialogDescription>
        </DialogHeader>
        {loading || !set ? (
          <p className="text-muted-foreground text-sm">Converting…</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <Row label="Building grid" value={pair(u(set.gridX), u(set.gridY), 'X', 'Y')} />
            <Row
              label="Projected (grid)"
              value={pair(u(set.projectedGridE), u(set.projectedGridN), 'E', 'N')}
            />
            <Row
              label="Projected (ground)"
              value={pair(u(set.projectedGroundE), u(set.projectedGroundN), 'E', 'N')}
            />
            <Row label="Latitude" value={deg(set.latitude)} />
            <Row label="Longitude" value={deg(set.longitude)} />
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

function pair(a: string, b: string, aLabel: string, bLabel: string): ReactNode {
  return (
    <div className="flex flex-col">
      <span>
        {aLabel} {a}
      </span>
      <span>
        {bLabel} {b}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </>
  );
}
