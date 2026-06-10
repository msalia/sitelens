'use client';

import { IconUpload } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { gql } from '@/lib/graphql';
import { type LengthUnit, type PointCategory, type Project, UNIT_OPTIONS } from '@/lib/types';

const IMPORT = `
  mutation ($id: UUID!, $format: ImportFormat!, $content: String!, $unit: LengthUnit!,
            $mapping: CsvMappingInput, $filename: String, $categoryId: UUID, $profile: String) {
    importPoints(projectId: $id, format: $format, content: $content, unit: $unit,
      mapping: $mapping, sourceFilename: $filename, categoryId: $categoryId, saveProfileName: $profile) {
      rowCount
    }
  }`;

type Format = 'CSV' | 'LANDXML';
type ColField = 'labelCol' | 'northingCol' | 'eastingCol' | 'elevationCol' | 'descriptionCol';

const NONE = '-1';

export function ImportDialog({
  categories,
  onImported,
  project,
}: {
  project: Project;
  categories: PointCategory[];
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>('CSV');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [unit, setUnit] = useState<LengthUnit>(project.displayUnit);
  const [hasHeader, setHasHeader] = useState(true);
  const [cols, setCols] = useState<Record<ColField, string>>({
    descriptionCol: '4',
    eastingCol: '2',
    elevationCol: '3',
    labelCol: '0',
    northingCol: '1',
  });
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState(false);

  // Parse a small preview of the CSV for column selection.
  const previewRows = useMemo(() => {
    if (format !== 'CSV') {
      return [];
    }
    return content
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 6)
      .map((l) => l.split(','));
  }, [content, format]);

  const columnCount = previewRows.reduce((m, r) => Math.max(m, r.length), 0);
  const headerNames = hasHeader && previewRows[0] ? previewRows[0] : [];
  const colLabel = (i: number) => (headerNames[i] ? `${i}: ${headerNames[i].trim()}` : `Col ${i}`);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setFilename(file.name);
    setContent(await file.text());
    if (file.name.toLowerCase().endsWith('.xml')) {
      setFormat('LANDXML');
    }
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      toast.error('Provide a file or paste content first');
      return;
    }
    setBusy(true);
    try {
      const colNum = (v: string) => (v === NONE ? null : parseInt(v, 10));
      const mapping =
        format === 'CSV'
          ? {
              descriptionCol: colNum(cols.descriptionCol),
              eastingCol: parseInt(cols.eastingCol, 10),
              elevationCol: colNum(cols.elevationCol),
              hasHeader,
              labelCol: colNum(cols.labelCol),
              northingCol: parseInt(cols.northingCol, 10),
            }
          : null;
      const data = await gql<{ importPoints: { rowCount: number } }>(IMPORT, {
        categoryId: categoryId === NONE ? null : categoryId,
        content,
        filename: filename || null,
        format,
        id: project.id,
        mapping,
        profile: profileName.trim() || null,
        unit,
      });
      toast.success(`Imported ${data.importPoints.rowCount} points`);
      setOpen(false);
      setContent('');
      setFilename('');
      setProfileName('');
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <IconUpload className="mr-1 size-4" /> Import
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import points</DialogTitle>
          <DialogDescription>From a survey-machine CSV or LandXML export.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onImport} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="imp-format">Format</Label>
              <NativeSelect
                id="imp-format"
                className="w-full"
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
              >
                <NativeSelectOption value="CSV">CSV</NativeSelectOption>
                <NativeSelectOption value="LANDXML">LandXML</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="imp-unit">Unit</Label>
              <NativeSelect
                id="imp-unit"
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
            <Label htmlFor="imp-file">File</Label>
            <Input id="imp-file" type="file" accept=".csv,.txt,.xml" onChange={onFile} />
            <Textarea
              placeholder="…or paste content here"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-xs"
              rows={5}
            />
          </div>

          {format === 'CSV' && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.target.checked)}
                />
                First row is a header
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MappingSelect
                  label="Label"
                  value={cols.labelCol}
                  onChange={(v) => setCols((c) => ({ ...c, labelCol: v }))}
                  count={columnCount}
                  colLabel={colLabel}
                  optional
                />
                <MappingSelect
                  label="Northing *"
                  value={cols.northingCol}
                  onChange={(v) => setCols((c) => ({ ...c, northingCol: v }))}
                  count={columnCount}
                  colLabel={colLabel}
                />
                <MappingSelect
                  label="Easting *"
                  value={cols.eastingCol}
                  onChange={(v) => setCols((c) => ({ ...c, eastingCol: v }))}
                  count={columnCount}
                  colLabel={colLabel}
                />
                <MappingSelect
                  label="Elevation"
                  value={cols.elevationCol}
                  onChange={(v) => setCols((c) => ({ ...c, elevationCol: v }))}
                  count={columnCount}
                  colLabel={colLabel}
                  optional
                />
                <MappingSelect
                  label="Description"
                  value={cols.descriptionCol}
                  onChange={(v) => setCols((c) => ({ ...c, descriptionCol: v }))}
                  count={columnCount}
                  colLabel={colLabel}
                  optional
                />
              </div>
              <Input
                placeholder="Save as import profile (optional)"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="imp-cat">Assign category (optional)</Label>
            <NativeSelect
              id="imp-cat"
              className="w-full"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <NativeSelectOption value={NONE}>None</NativeSelectOption>
              {categories.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Importing…' : 'Import points'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MappingSelect({
  colLabel,
  count,
  label,
  onChange,
  optional,
  value,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  count: number;
  colLabel: (i: number) => string;
  optional?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <NativeSelect className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {optional && <NativeSelectOption value={NONE}>—</NativeSelectOption>}
        {Array.from({ length: Math.max(count, 5) }, (_, i) => (
          <NativeSelectOption key={i} value={String(i)}>
            {colLabel(i)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
