'use client';

import { IconDownload } from '@tabler/icons-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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
}: {
  project: Project;
  /** Currently selected point ids in the table (for scope = selection). */
  selectedIds: string[];
  /** Active category filter id, or null for "all categories". */
  categoryFilter: string | null;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <IconDownload className="mr-1 size-4" /> Export
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export points</DialogTitle>
          <DialogDescription>Download surveyed points as CSV or LandXML.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onExport} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="exp-format">Format</Label>
              <NativeSelect
                id="exp-format"
                className="w-full"
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
              >
                <NativeSelectOption value="CSV">CSV</NativeSelectOption>
                <NativeSelectOption value="LANDXML">LandXML</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="exp-unit">Unit</Label>
              <NativeSelect
                id="exp-unit"
                className="w-full"
                value={unit}
                onChange={(e) => setUnit(e.target.value as LengthUnit)}
              >
                {UNIT_OPTIONS.map((u) => (
                  <NativeSelectOption key={u.value} value={u.value}>
                    {u.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="exp-space">Coordinate space</Label>
            <NativeSelect
              id="exp-space"
              className="w-full"
              value={space}
              onChange={(e) => setSpace(e.target.value as ExportSpace)}
            >
              {EXPORT_SPACE_OPTIONS.map((s) => (
                <NativeSelectOption key={s.value} value={s.value}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="exp-scope">Scope</Label>
            <NativeSelect
              id="exp-scope"
              className="w-full"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
            >
              <NativeSelectOption value="all">All points</NativeSelectOption>
              <NativeSelectOption value="category" disabled={!categoryFilter}>
                Current category filter
              </NativeSelectOption>
              <NativeSelectOption value="selection" disabled={selectedIds.length === 0}>
                Selected points ({selectedIds.length})
              </NativeSelectOption>
            </NativeSelect>
          </div>

          {format === 'CSV' && (
            <div className="flex flex-col gap-2">
              <Label>Columns</Label>
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                {EXPORT_COLUMN_OPTIONS.map((c) => (
                  <label key={c.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={columns.includes(c.value)}
                      onChange={() => toggleColumn(c.value)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Exporting…' : 'Download'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
