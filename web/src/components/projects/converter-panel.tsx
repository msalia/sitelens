'use client';

import { IconArrowsExchange } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
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
import { Field, FieldLabel } from '@/components/ui/field';
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
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import {
  type CoordinateSet,
  type LengthUnit,
  type Project,
  UNIT_LABELS,
  UNIT_OPTIONS,
} from '@/lib/types';
import { fromMeters } from '@/lib/units';
import { cn } from '@/lib/utils';

const CONVERT = graphql(`
  query StandaloneConvert(
    $id: UUID!
    $space: CoordinateSpace!
    $x: Float!
    $y: Float!
    $unit: LengthUnit!
  ) {
    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {
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

type InputSpace = 'GRID' | 'PROJECTED';

/** A self-contained converter: type any coordinate, see every representation. */
export function ConverterPanel({ project }: { project: Project }) {
  const [space, setSpace] = useState<InputSpace>('PROJECTED');
  const [unit, setUnit] = useState<LengthUnit>(project.displayUnit);
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [set, setSet] = useState<CoordinateSet | null>(null);
  const [busy, setBusy] = useState(false);

  const displayLabel = UNIT_LABELS[project.displayUnit];
  const xLabel = space === 'GRID' ? 'Grid X' : 'Easting';
  const yLabel = space === 'GRID' ? 'Grid Y' : 'Northing';

  async function onConvert(e: React.FormEvent) {
    e.preventDefault();
    const xn = parseFloat(x);
    const yn = parseFloat(y);
    if (Number.isNaN(xn) || Number.isNaN(yn)) {
      toast.error('Enter numeric X and Y values');
      return;
    }
    setBusy(true);
    try {
      const data = await gql(CONVERT, { id: project.id, space, unit, x: xn, y: yn });
      setSet(data.convertCoordinate);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Convert failed');
    } finally {
      setBusy(false);
    }
  }

  const u = (m: number | null) =>
    m === null ? '—' : `${fromMeters(m, project.displayUnit).toFixed(4)} ${displayLabel}`;
  const deg = (d: number | null) => (d === null ? '—' : `${d.toFixed(7)}°`);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coordinate converter</CardTitle>
        <CardDescription>Convert any coordinate across systems and units.</CardDescription>
      </CardHeader>

      <form onSubmit={onConvert} className="contents">
        {/* `-mb` collapses the gap so the results table sits flush to the footer. */}
        <CardContent className={cn('flex flex-col gap-4', set && '-mb-(--card-spacing)')}>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="cv-space">Input space</FieldLabel>
              <Select value={space} onValueChange={(v) => setSpace(v as InputSpace)}>
                <SelectTrigger id="cv-space" className="w-full">
                  <SelectValue placeholder="Select a space" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Input space</SelectLabel>
                    <SelectItem value="PROJECTED">Projected (grid)</SelectItem>
                    <SelectItem value="GRID">Building grid</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="cv-unit">Input unit</FieldLabel>
              <Select value={unit} onValueChange={(v) => setUnit(v as LengthUnit)}>
                <SelectTrigger id="cv-unit" className="w-full">
                  <SelectValue placeholder="Select a unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Input unit</SelectLabel>
                    {UNIT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="cv-x">{xLabel}</FieldLabel>
              <Input
                id="cv-x"
                inputMode="decimal"
                value={x}
                onChange={(e) => setX(e.target.value)}
                placeholder="0.000"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cv-y">{yLabel}</FieldLabel>
              <Input
                id="cv-y"
                inputMode="decimal"
                value={y}
                onChange={(e) => setY(e.target.value)}
                placeholder="0.000"
              />
            </Field>
          </div>

          {set && (
            <div className="-mx-(--card-spacing) border-t [&_td:first-child]:pl-(--card-spacing) [&_td:last-child]:pr-(--card-spacing)">
              <Table>
                <TableBody>
                  <ResultRow
                    label="Building grid"
                    value={pair('X', u(set.gridX), 'Y', u(set.gridY))}
                  />
                  <ResultRow
                    label="Projected (grid)"
                    value={pair('E', u(set.projectedGridE), 'N', u(set.projectedGridN))}
                  />
                  <ResultRow
                    label="Projected (ground)"
                    value={pair('E', u(set.projectedGroundE), 'N', u(set.projectedGroundN))}
                  />
                  <ResultRow label="Latitude" value={deg(set.latitude)} />
                  <ResultRow label="Longitude" value={deg(set.longitude)} />
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        <CardFooter>
          <Button type="submit" className="w-full" disabled={busy}>
            <IconArrowsExchange className="mr-1 size-4" />
            {busy ? 'Converting…' : 'Convert'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function pair(aLabel: string, a: string, bLabel: string, b: string): ReactNode {
  return (
    <div className="flex flex-col items-end">
      <span>
        {aLabel} {a}
      </span>
      <span>
        {bLabel} {b}
      </span>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground align-top whitespace-nowrap">{label}</TableCell>
      <TableCell className="text-right font-mono">{value}</TableCell>
    </TableRow>
  );
}
