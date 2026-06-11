'use client';

import { IconUpload } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { OptionalBadge } from '@/components/projects/field-extras';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { Textarea } from '@/components/ui/textarea';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { type LengthUnit, type PointCategory, type Project, UNIT_OPTIONS } from '@/lib/types';

const IMPORT = graphql(`
  mutation ImportPoints(
    $id: UUID!
    $format: ImportFormat!
    $content: String!
    $unit: LengthUnit!
    $mapping: CsvMappingInput
    $filename: String
    $categoryId: UUID
    $profile: String
  ) {
    importPoints(
      projectId: $id
      format: $format
      content: $content
      unit: $unit
      mapping: $mapping
      sourceFilename: $filename
      categoryId: $categoryId
      saveProfileName: $profile
    ) {
      rowCount
    }
  }
`);

type Format = 'CSV' | 'LANDXML';
type ColField = 'labelCol' | 'northingCol' | 'eastingCol' | 'elevationCol' | 'descriptionCol';

const NONE = '-1';

export function ImportDialog({
  categories,
  onImported,
  project,
  trigger,
}: {
  project: Project;
  categories: PointCategory[];
  onImported: () => void;
  /** Optional custom trigger element; falls back to a default button. */
  trigger?: React.ReactElement;
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
      const data = await gql(IMPORT, {
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
          trigger ?? (
            <Button size="sm" variant="outline">
              <IconUpload className="mr-1 size-4" /> Import
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import points</DialogTitle>
          <DialogDescription>From a survey-machine CSV or LandXML export.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onImport} className="flex flex-col gap-6">
          <div className="grid gap-6 sm:grid-cols-3">
            {/* Column 1 — source + options */}
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="imp-format">Format</FieldLabel>
                <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
                  <SelectTrigger id="imp-format" className="w-full">
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
                <FieldLabel htmlFor="imp-unit">Unit</FieldLabel>
                <Select value={unit} onValueChange={(v) => setUnit(v as LengthUnit)}>
                  <SelectTrigger id="imp-unit" className="w-full">
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
                <FieldLabel htmlFor="imp-cat" className="w-full">
                  Assign category
                  <OptionalBadge />
                </FieldLabel>
                <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? NONE)}>
                  <SelectTrigger id="imp-cat" className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Category</SelectLabel>
                      <SelectItem value={NONE}>None</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Columns 2–3 — file/paste input + CSV column map */}
            <div className="flex flex-col gap-4 sm:col-span-2">
              <Field>
                <FieldLabel htmlFor="imp-file">File</FieldLabel>
                <Input id="imp-file" type="file" accept=".csv,.txt,.xml" onChange={onFile} />
                <Textarea
                  placeholder="…or paste content here"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="font-mono text-xs"
                  rows={5}
                />
              </Field>
              {format === 'CSV' ? (
                <div className="flex h-full flex-col gap-4 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="imp-header" className="text-sm font-medium">
                        First row is a header
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        Skip the first row and use its values as column names.
                      </p>
                    </div>
                    <Switch id="imp-header" checked={hasHeader} onCheckedChange={setHasHeader} />
                  </div>
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
                      label="Northing"
                      value={cols.northingCol}
                      onChange={(v) => setCols((c) => ({ ...c, northingCol: v }))}
                      count={columnCount}
                      colLabel={colLabel}
                    />
                    <MappingSelect
                      label="Easting"
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
                  <Field>
                    <FieldLabel htmlFor="imp-profile" className="w-full">
                      Save as import profile
                      <OptionalBadge />
                    </FieldLabel>
                    <Input
                      id="imp-profile"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
                  </Field>
                </div>
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
                  LandXML carries its own point definitions — no column mapping needed.
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
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
    <Field>
      <FieldLabel className="w-full">
        {label}
        {optional && <OptionalBadge />}
      </FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v ?? NONE)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Column</SelectLabel>
            {optional && <SelectItem value={NONE}>—</SelectItem>}
            {Array.from({ length: Math.max(count, 5) }, (_, i) => (
              <SelectItem key={i} value={String(i)}>
                {colLabel(i)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
