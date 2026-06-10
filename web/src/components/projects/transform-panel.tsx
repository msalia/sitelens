'use client';

import { IconBolt } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { type Project, type Transform, UNIT_LABELS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const SOLVE_TRANSFORM = graphql(`
  mutation SolveTransform($id: UUID!) {
    solveTransform(projectId: $id) {
      translationE
      translationN
      rotationDegrees
      scale
      rmsError
      pointCount
      residuals {
        label
        deltaEasting
        deltaNorthing
        magnitude
      }
    }
  }
`);

export function TransformPanel({
  initialTransform,
  project,
}: {
  project: Project;
  initialTransform: Transform | null;
}) {
  const unitLabel = UNIT_LABELS[project.displayUnit];
  const [transform, setTransform] = useState<Transform | null>(initialTransform);
  const [busy, setBusy] = useState(false);

  const inUnit = (meters: number) => fromMeters(meters, project.displayUnit).toFixed(4);

  async function solve() {
    setBusy(true);
    try {
      const data = await gql(SOLVE_TRANSFORM, { id: project.id });
      setTransform(data.solveTransform);
      toast.success('Transform solved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Solve failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Transform (grid → projected)</CardTitle>
        <Button size="sm" onClick={solve} disabled={busy}>
          <IconBolt className="mr-1 size-4" />
          {busy ? 'Solving…' : 'Solve transform'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!transform ? (
          <p className="text-muted-foreground text-sm">
            Add at least two control points with grid coordinates, then solve the Helmert tie. The
            scale, rotation, and per-point residuals appear here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Scale" value={transform.scale.toFixed(6)} />
              <Stat label="Rotation" value={`${transform.rotationDegrees.toFixed(4)}°`} />
              <Stat label={`RMS (${unitLabel})`} value={inUnit(transform.rmsError)} />
              <Stat label="Points" value={String(transform.pointCount)} />
            </div>
            <div className="text-muted-foreground text-xs">
              Translation: E {inUnit(transform.translationE)} · N {inUnit(transform.translationN)}{' '}
              {unitLabel}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Residuals ({unitLabel})</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Point</TableHead>
                    <TableHead>ΔE</TableHead>
                    <TableHead>ΔN</TableHead>
                    <TableHead>Magnitude</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transform.residuals.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell>{inUnit(r.deltaEasting)}</TableCell>
                      <TableCell>{inUnit(r.deltaNorthing)}</TableCell>
                      <TableCell>{inUnit(r.magnitude)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
