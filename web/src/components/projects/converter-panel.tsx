'use client';

import { IconArrowsExchange } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onConvert} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cv-space">Input space</Label>
              <NativeSelect
                id="cv-space"
                className="w-full"
                value={space}
                onChange={(e) => setSpace(e.target.value as InputSpace)}
              >
                <NativeSelectOption value="PROJECTED">Projected (grid)</NativeSelectOption>
                <NativeSelectOption value="GRID">Building grid</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cv-unit">Input unit</Label>
              <NativeSelect
                id="cv-unit"
                className="w-full"
                value={unit}
                onChange={(e) => setUnit(e.target.value as LengthUnit)}
              >
                {UNIT_OPTIONS.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cv-x">{xLabel}</Label>
              <Input
                id="cv-x"
                inputMode="decimal"
                value={x}
                onChange={(e) => setX(e.target.value)}
                placeholder="0.000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cv-y">{yLabel}</Label>
              <Input
                id="cv-y"
                inputMode="decimal"
                value={y}
                onChange={(e) => setY(e.target.value)}
                placeholder="0.000"
              />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="self-start">
            <IconArrowsExchange className="mr-1 size-4" />
            {busy ? 'Converting…' : 'Convert'}
          </Button>
        </form>

        {set && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t pt-4 text-sm">
            <Row label="Building grid" value={`X ${u(set.gridX)} · Y ${u(set.gridY)}`} />
            <Row
              label="Projected (grid)"
              value={`E ${u(set.projectedGridE)} · N ${u(set.projectedGridN)}`}
            />
            <Row
              label="Projected (ground)"
              value={`E ${u(set.projectedGroundE)} · N ${u(set.projectedGroundN)}`}
            />
            <Row label="Latitude" value={deg(set.latitude)} />
            <Row label="Longitude" value={deg(set.longitude)} />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </>
  );
}
