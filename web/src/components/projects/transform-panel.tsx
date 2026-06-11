'use client';

import { IconBolt } from '@tabler/icons-react';
import { useState } from 'react';

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { graphql } from '@/lib/gql';
import { gql, useMutation } from '@/lib/graphql';
import { type Project, type Transform, UNIT_LABELS } from '@/lib/types';
import { fromMeters } from '@/lib/units';
import { cn } from '@/lib/utils';

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
  const { busy, run } = useMutation();

  const inUnit = (meters: number) => fromMeters(meters, project.displayUnit).toFixed(4);

  async function solve() {
    await run(() => gql(SOLVE_TRANSFORM, { id: project.id }), {
      error: 'Solve failed',
      onDone: (data) => setTransform(data.solveTransform),
      success: 'Transform solved',
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transform</CardTitle>
        <CardDescription>
          The Helmert tie mapping building-grid coordinates to projected northing/easting.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn('flex flex-col gap-4', transform && '-mb-(--card-spacing)')}>
        {!transform ? (
          <p className="text-muted-foreground text-sm">
            Add at least two control points with grid coordinates, then solve the Helmert tie. The
            scale, rotation, and per-point residuals appear here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Scale" sub="factor" value={transform.scale.toFixed(6)} />
              <Stat
                label="Rotation"
                sub="clockwise"
                value={`${transform.rotationDegrees.toFixed(4)}°`}
              />
              <Stat label="RMS" sub={unitLabel} value={inUnit(transform.rmsError)} />
              <Stat label="Points" sub="fitted" value={String(transform.pointCount)} />
            </div>
            <div className="text-muted-foreground text-xs">
              Translation: E {inUnit(transform.translationE)} · N {inUnit(transform.translationN)}{' '}
              {unitLabel}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Residuals ({unitLabel})</p>
              {/* Full-bleed: dividers span the card edges; first/last cells keep
                  the card's horizontal padding so text still aligns with the title. */}
              <div className="-mx-(--card-spacing) border-t [&_td:first-child]:pl-(--card-spacing) [&_td:last-child]:pr-(--card-spacing) [&_th:first-child]:pl-(--card-spacing) [&_th:last-child]:pr-(--card-spacing)">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
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
            </div>
          </>
        )}
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={solve} disabled={busy}>
          <IconBolt className="mr-1 size-4" />
          {busy ? 'Solving…' : 'Solve transform'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stat({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-xl p-3">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </div>
  );
}
