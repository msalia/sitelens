'use client';

import { useMemo, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type LengthUnit } from '@/lib/types';
import { fromMeters } from '@/lib/units';
import { cn } from '@/lib/utils';

export type ComparisonStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNMATCHED' | 'NO_VERTICAL';

export type CompRow = {
  id: string;
  asBuiltLabel: string;
  designPointId: string | null;
  deltaN: number | null;
  deltaE: number | null;
  deltaZ: number | null;
  deltaHRadial: number | null;
  deltaGridN: number | null;
  deltaGridE: number | null;
  matchMethod: 'NUMBER' | 'MANUAL' | 'UNMATCHED';
  status: ComparisonStatus;
};

const STATUS_STYLE: Record<ComparisonStatus, { label: string; className: string }> = {
  FAIL: { className: 'bg-red-500/15 text-red-600 dark:text-red-400', label: 'Fail' },
  NO_VERTICAL: { className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', label: 'No Z' },
  PASS: { className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', label: 'Pass' },
  UNMATCHED: { className: 'bg-muted text-muted-foreground', label: 'Unmatched' },
  WARN: { className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', label: 'Warn' },
};

const FILTERS: { value: string; label: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pass', value: 'PASS' },
  { label: 'Warn', value: 'WARN' },
  { label: 'Fail', value: 'FAIL' },
  { label: 'Unmatched', value: 'UNMATCHED' },
];

/** Per-point comparison results: deltas in the report unit, status chips, and a
 * manual-pairing control that assigns a design point to any row. */
export function ResultsTable({
  busy,
  designPoints,
  onRepair,
  reportUnit,
  rows,
}: {
  rows: CompRow[];
  reportUnit: LengthUnit;
  designPoints: { id: string; label: string }[];
  busy: boolean;
  onRepair: (compId: string, designPointId: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const fmt = (m: number | null) => (m === null ? '—' : fromMeters(m, reportUnit).toFixed(3));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {shown.length} of {rows.length} point(s)
        </span>
        <Select value={filter} onValueChange={(v) => setFilter(v ?? 'all')}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="-mx-(--card-spacing) border-t">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted">
              <TableHead className="pl-(--card-spacing)">Point</TableHead>
              <TableHead className="text-right">ΔN</TableHead>
              <TableHead className="text-right">ΔE</TableHead>
              <TableHead className="text-right">ΔH</TableHead>
              <TableHead className="text-right">ΔZ</TableHead>
              <TableHead className="pr-(--card-spacing)">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const s = STATUS_STYLE[r.status];
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-(--card-spacing) font-medium">
                    {r.asBuiltLabel}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.deltaN)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.deltaE)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.deltaHRadial)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.deltaZ)}</TableCell>
                  <TableCell className="pr-(--card-spacing)">
                    {r.status === 'UNMATCHED' ? (
                      <Select disabled={busy} onValueChange={(v) => v && onRepair(r.id, v)}>
                        <SelectTrigger
                          size="sm"
                          className="h-7 w-32"
                          aria-label={`Pair ${r.asBuiltLabel}`}
                        >
                          <SelectValue placeholder="Pair…" />
                        </SelectTrigger>
                        <SelectContent>
                          {designPoints.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span
                        className={cn(
                          'inline-flex rounded px-1.5 py-0.5 text-xs font-medium',
                          s.className,
                        )}
                      >
                        {s.label}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center text-sm">
                  No points match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
