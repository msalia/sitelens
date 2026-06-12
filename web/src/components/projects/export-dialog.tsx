'use client';

import { IconDownload } from '@tabler/icons-react';
import { cloneElement, useState } from 'react';
import { toast } from 'sonner';

import { UpgradeDialog } from '@/components/billing/upgrade-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useBilling } from '@/lib/billing';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import {
  EXPORT_COLUMN_OPTIONS,
  EXPORT_SPACE_OPTIONS,
  type ExportColumn,
  type ExportFormat,
  type ExportSpace,
  type LengthUnit,
  type Project,
  UNIT_OPTIONS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const COLUMN_DESC: Record<ExportColumn, string> = {
  DESCRIPTION: 'Free-text description of the point.',
  EASTING: 'Easting in the chosen coordinate space.',
  ELEVATION: 'Elevation (Z) in the chosen unit.',
  LATITUDE: 'Geographic latitude (degrees).',
  LONGITUDE: 'Geographic longitude (degrees).',
  NORTHING: 'Northing in the chosen coordinate space.',
  POINT: 'Point name / identifier.',
};

const EXPORT_POINTS = graphql(`
  query ExportPoints(
    $id: UUID!
    $format: ExportFormat!
    $space: ExportSpace!
    $unit: LengthUnit!
    $columns: [ExportColumn!]
    $pointIds: [UUID!]
    $categoryId: UUID
  ) {
    exportPoints(
      projectId: $id
      format: $format
      space: $space
      unit: $unit
      columns: $columns
      pointIds: $pointIds
      categoryId: $categoryId
    )
  }
`);

// Sensible default CSV columns and order for a survey export.
const DEFAULT_COLUMNS: ExportColumn[] = [
  'POINT',
  'NORTHING',
  'EASTING',
  'ELEVATION',
  'DESCRIPTION',
];

type Scope = 'all' | 'category' | 'selection';

export function ExportDialog({
  categoryFilter,
  project,
  selectedIds,
  trigger,
}: {
  project: Project;
  /** Currently selected point ids in the table (for scope = selection). */
  selectedIds: string[];
  /** Active category filter id, or null for "all categories". */
  categoryFilter: string | null;
  /** Optional custom trigger element; falls back to a default button. */
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { billing } = useBilling();
  const [format, setFormat] = useState<ExportFormat>('CSV');
  const [space, setSpace] = useState<ExportSpace>('PROJECTED_GRID');
  const [unit, setUnit] = useState<LengthUnit>(project.displayUnit);
  const [columns, setColumns] = useState<ExportColumn[]>(DEFAULT_COLUMNS);
  const [scope, setScope] = useState<Scope>(selectedIds.length > 0 ? 'selection' : 'all');
  const [busy, setBusy] = useState(false);

  // Default the scope each time the dialog opens: if points are selected, export
  // those; otherwise fall back to all. (The component stays mounted, so the
  // initial useState value can't reflect selections made after first render.)
  function onOpenChange(next: boolean) {
    if (next) {
      setScope(selectedIds.length > 0 ? 'selection' : 'all');
    }
    setOpen(next);
  }

  function toggleColumn(col: ExportColumn) {
    setColumns((cols) => (cols.includes(col) ? cols.filter((c) => c !== col) : [...cols, col]));
  }

  async function onExport(e: React.FormEvent) {
    e.preventDefault();
    if (format === 'CSV' && columns.length === 0) {
      toast.error('Select at least one column');
      return;
    }
    setBusy(true);
    try {
      const data = await gql(EXPORT_POINTS, {
        categoryId: scope === 'category' ? categoryFilter : null,
        // Preserve the canonical column order regardless of toggle sequence.
        columns:
          format === 'CSV'
            ? EXPORT_COLUMN_OPTIONS.map((o) => o.value).filter((c) => columns.includes(c))
            : null,
        format,
        id: project.id,
        pointIds: scope === 'selection' ? selectedIds : null,
        space,
        unit,
      });
      const ext = format === 'CSV' ? 'csv' : 'xml';
      const mime = format === 'CSV' ? 'text/csv' : 'application/xml';
      const blob = new Blob([data.exportPoints], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}-points.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  const gated = !!billing && !billing.canExport;
  const triggerEl = trigger ?? (
    <Button size="sm" variant="outline">
      <IconDownload className="mr-1 size-4" /> Export
    </Button>
  );

  // One stable trigger whose click decides what to open — avoids swapping the
  // element while billing loads (which would drop the click). Exporting is a Crew
  // feature, so gated orgs get an upgrade prompt instead of the form.
  return (
    <>
      {cloneElement(triggerEl as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => (gated ? setUpgradeOpen(true) : onOpenChange(true)),
      })}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title="Exporting is a Crew feature"
        description="Upgrade to Crew to export points as CSV or LandXML."
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Export points</DialogTitle>
            <DialogDescription>Download surveyed points as CSV or LandXML.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onExport} className="flex flex-col gap-4">
            <div className={cn('grid gap-4', format === 'CSV' && 'sm:grid-cols-3')}>
              <div className="flex flex-col gap-4">
                <Field>
                  <FieldLabel htmlFor="exp-format">Format</FieldLabel>
                  <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
                    <SelectTrigger id="exp-format" className="w-full">
                      <SelectValue placeholder="Select a format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Format</SelectLabel>
                        <SelectItem value="CSV">CSV</SelectItem>
                        <SelectItem value="LANDXML">LandXML</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="exp-unit">Unit</FieldLabel>
                  <Select value={unit} onValueChange={(v) => setUnit(v as LengthUnit)}>
                    <SelectTrigger id="exp-unit" className="w-full">
                      <SelectValue placeholder="Select a unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Unit</SelectLabel>
                        {UNIT_OPTIONS.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="exp-space">Coordinate space</FieldLabel>
                  <Select value={space} onValueChange={(v) => setSpace(v as ExportSpace)}>
                    <SelectTrigger id="exp-space" className="w-full">
                      <SelectValue placeholder="Select a space" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Coordinate space</SelectLabel>
                        {EXPORT_SPACE_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="exp-scope">Scope</FieldLabel>
                  <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                    <SelectTrigger id="exp-scope" className="w-full">
                      <SelectValue placeholder="Select a scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Scope</SelectLabel>
                        <SelectItem value="all">All points</SelectItem>
                        <SelectItem value="category" disabled={!categoryFilter}>
                          Current category filter
                        </SelectItem>
                        <SelectItem value="selection" disabled={selectedIds.length === 0}>
                          Selected points ({selectedIds.length})
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {format === 'CSV' && (
                <Field className="sm:col-span-2">
                  <FieldLabel>Columns</FieldLabel>
                  <div className="divide-y rounded-lg border">
                    {EXPORT_COLUMN_OPTIONS.map((c) => (
                      <div key={c.value} className="flex items-center justify-between gap-4 p-3">
                        <div className="flex flex-col gap-0.5">
                          <Label htmlFor={`col-${c.value}`} className="text-sm font-medium">
                            {c.label}
                          </Label>
                          <p className="text-muted-foreground text-sm">{COLUMN_DESC[c.value]}</p>
                        </div>
                        <Switch
                          id={`col-${c.value}`}
                          checked={columns.includes(c.value)}
                          onCheckedChange={() => toggleColumn(c.value)}
                        />
                      </div>
                    ))}
                  </div>
                </Field>
              )}
            </div>

            <DialogFooter>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Exporting…' : 'Download'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
