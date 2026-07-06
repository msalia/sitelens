'use client';

import {
  IconDownload,
  IconFileText,
  IconFileTypePdf,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { ComparisonMarker } from '@/components/projects/terrain-viewer';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { type CompRow, ResultsTable } from '@/components/projects/field/results-table';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { gql } from '@/lib/graphql';
import {
  EXPORT_SPACE_OPTIONS,
  type ExportSpace,
  type LengthUnit,
  type PointCategory,
  type Project,
  UNIT_OPTIONS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

import {
  AS_BUILT_BATCHES,
  COMPARISON,
  COMPARISON_REPORT_CSV,
  COMPARISON_REPORT_PDF,
  DELETE_AS_BUILT_BATCH,
  DESIGN_POINTS,
  EXPORT_FIELD,
  FIELD_EXPORT_PRESETS,
  IMPORT_AS_BUILT,
  REPAIR_COMPARISON,
} from './field-data';

const ALL = 'all';

type Preset = {
  id: string;
  app: string;
  format: string;
  defaultSpace: ExportSpace;
  defaultUnit: LengthUnit;
  description: string;
};
type Batch = {
  id: string;
  sourceFilename: string;
  format: string;
  baselineScope: string;
  reportUnit: LengthUnit;
  createdAt: string;
};

/** Reads a file into standard base64 (binary-safe via a data URL). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.slice(r.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function downloadBase64(filename: string, mime: string, b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FieldPanel({
  categories,
  onOverlay,
  project,
}: {
  project: Project;
  categories: PointCategory[];
  /** Publishes the selected comparison's markers to the 3D scene (null clears). */
  onOverlay?: (markers: ComparisonMarker[] | null) => void;
}) {
  // Keep the latest callback in a ref so the unmount cleanup can clear the
  // overlay without re-running when the parent passes a new function identity.
  const onOverlayRef = useRef(onOverlay);
  useEffect(() => {
    onOverlayRef.current = onOverlay;
  }, [onOverlay]);
  // Clear the scene overlay when the panel unmounts (e.g. leaving the Field tab).
  useEffect(() => () => onOverlayRef.current?.(null), []);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [designPoints, setDesignPoints] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // Export form.
  const [exPreset, setExPreset] = useState<string>('');
  const [exSpace, setExSpace] = useState<ExportSpace>('PROJECTED_GROUND');
  const [exUnit, setExUnit] = useState<LengthUnit>('US_SURVEY_FOOT');
  const [exCategory, setExCategory] = useState<string>(ALL);

  // Import form.
  const [imPreset, setImPreset] = useState<string>('generic_csv');
  const [imSpace, setImSpace] = useState<ExportSpace>('PROJECTED_GROUND');
  const [imUnit, setImUnit] = useState<LengthUnit>('US_SURVEY_FOOT');
  const [imScope, setImScope] = useState<string>(ALL);
  const [imCategory, setImCategory] = useState<string>('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Selected comparison.
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [rows, setRows] = useState<CompRow[]>([]);
  const [summary, setSummary] = useState<{
    pass: number;
    warn: number;
    fail: number;
    unmatched: number;
    noVertical: number;
    maxMiss: number | null;
    rmsMiss: number | null;
  } | null>(null);
  const [reportUnit, setReportUnit] = useState<LengthUnit>(project.displayUnit);
  const [pendingDelete, setPendingDelete] = useState<Batch | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      const { asBuiltBatches } = await gql(AS_BUILT_BATCHES, { id: project.id });
      setBatches(asBuiltBatches);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load comparisons');
    }
  }, [project.id]);

  // Load presets, batches, and design points on mount.
  useEffect(() => {
    void (async () => {
      try {
        const [{ fieldExportPresets }, { surveyPoints }] = await Promise.all([
          gql(FIELD_EXPORT_PRESETS),
          gql(DESIGN_POINTS, { id: project.id }),
        ]);

        setPresets(fieldExportPresets);

        setDesignPoints(surveyPoints);
        if (fieldExportPresets[0]) {
          setExPreset(fieldExportPresets[0].id);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load field presets');
      }
      void loadBatches();
    })();
  }, [project.id, loadBatches]);

  function onPickPreset(id: string) {
    setExPreset(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      setExSpace(p.defaultSpace);
      setExUnit(p.defaultUnit);
    }
  }

  async function onExport() {
    if (!exPreset) {
      return;
    }
    setBusy(true);
    try {
      const { exportField } = await gql(EXPORT_FIELD, {
        categoryId: exCategory === ALL ? null : exCategory,
        codeField: null,
        id: project.id,
        presetId: exPreset,
        space: exSpace,
        unit: exUnit,
      });
      downloadBase64(exportField.filename, exportField.mimeType, exportField.contentBase64);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!pendingFile) {
      return;
    }
    if (imScope === 'category' && !imCategory) {
      toast.error('Pick a category for the baseline.');
      return;
    }
    setBusy(true);
    try {
      const content = await fileToBase64(pendingFile);
      const { importAsBuilt } = await gql(IMPORT_AS_BUILT, {
        baselineRefId: imScope === 'category' ? imCategory : null,
        baselineScope: imScope === 'category' ? 'CATEGORY' : 'ALL',
        content,
        filename: pendingFile.name,
        format: null, // auto-detect server-side
        id: project.id,
        presetId: imPreset,
        space: imSpace,
        unit: imUnit,
      });
      toast.success('As-built imported');
      setPendingFile(null);
      await loadBatches();
      void openComparison(importAsBuilt.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const openComparison = useCallback(async (batchId: string) => {
    setSelectedBatch(batchId);
    try {
      const { comparison } = await gql(COMPARISON, { batchId });
      setRows(comparison.rows);
      setSummary(comparison.summary);
      setReportUnit(comparison.batch.reportUnit);
      // Publish markers to the 3D scene overlay (rows carry geographic coords).
      const markers: ComparisonMarker[] = comparison.rows
        .filter((r) => r.asBuiltLatitude !== null && r.asBuiltLongitude !== null)
        .map((r) => ({
          asBuilt: [r.asBuiltLatitude!, r.asBuiltLongitude!, r.asBuiltHeight ?? 0],
          design:
            r.designLatitude !== null && r.designLongitude !== null
              ? [r.designLatitude, r.designLongitude, r.designHeight ?? 0]
              : null,
          key: r.id,
          status: r.status as ComparisonMarker['status'],
        }));
      onOverlayRef.current?.(markers);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load comparison');
    }
  }, []);

  async function onRepair(compId: string, designPointId: string) {
    setBusy(true);
    try {
      await gql(REPAIR_COMPARISON, {
        batchId: selectedBatch!,
        compId,
        designPointId,
      });
      toast.success('Point paired');
      await openComparison(selectedBatch!);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadReport(kind: 'csv' | 'pdf') {
    if (!selectedBatch) {
      return;
    }
    setBusy(true);
    try {
      const blob =
        kind === 'csv'
          ? (await gql(COMPARISON_REPORT_CSV, { batchId: selectedBatch })).comparisonReportCsv
          : (await gql(COMPARISON_REPORT_PDF, { batchId: selectedBatch })).comparisonReportPdf;
      downloadBase64(blob.filename, blob.mimeType, blob.contentBase64);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Report download failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteBatch(batch: Batch) {
    setBusy(true);
    try {
      await gql(DELETE_AS_BUILT_BATCH, { batchId: batch.id });
      if (selectedBatch === batch.id) {
        setSelectedBatch(null);
        setRows([]);
        setSummary(null);
        onOverlayRef.current?.(null);
      }
      await loadBatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Export to device */}
      <Card>
        <CardHeader>
          <CardTitle>Export to device</CardTitle>
          <CardDescription>Download design points in your field app’s format.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <LabeledSelect
            id="fx-preset"
            label="App / format"
            value={exPreset}
            onChange={onPickPreset}
          >
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.app}
              </SelectItem>
            ))}
          </LabeledSelect>
          <div className="grid grid-cols-2 gap-3">
            <LabeledSelect
              id="fx-space"
              label="Space"
              value={exSpace}
              onChange={(v) => setExSpace(v as ExportSpace)}
            >
              {EXPORT_SPACE_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </LabeledSelect>
            <LabeledSelect
              id="fx-unit"
              label="Unit"
              value={exUnit}
              onChange={(v) => setExUnit(v as LengthUnit)}
            >
              {UNIT_OPTIONS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </LabeledSelect>
          </div>
          <LabeledSelect
            id="fx-category"
            label="Points"
            value={exCategory}
            onChange={(v) => setExCategory(v ?? ALL)}
          >
            <SelectItem value={ALL}>All design points</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </LabeledSelect>
          <Button disabled={busy || !exPreset} onClick={onExport}>
            <IconDownload className="mr-1 size-4" /> Download
          </Button>
        </CardContent>
      </Card>

      {/* Import as-built */}
      <Card>
        <CardHeader>
          <CardTitle>Import as-built</CardTitle>
          <CardDescription>
            Upload field-collected points and compare them against the design.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label
            htmlFor="asbuilt-file"
            className="border-input hover:bg-accent/40 flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-4 text-center text-sm transition-colors"
          >
            <IconUpload className="text-muted-foreground size-5" />
            <span className="font-medium">
              {pendingFile ? pendingFile.name : 'Click to choose a file'}
            </span>
            <span className="text-muted-foreground text-xs">
              CSV, LandXML, or Trimble JobXML — format auto-detected
            </span>
          </label>
          <input
            id="asbuilt-file"
            type="file"
            accept=".csv,.xml,.jxl,.txt"
            className="hidden"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-3">
            <LabeledSelect
              id="fx-im-preset"
              label="CSV preset"
              value={imPreset}
              onChange={setImPreset}
              hint="Used only when the file is CSV."
            >
              {presets
                .filter((p) => p.format === 'CSV')
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.app}
                  </SelectItem>
                ))}
            </LabeledSelect>
            <LabeledSelect
              id="fx-im-space"
              label="Space"
              value={imSpace}
              onChange={(v) => setImSpace(v as ExportSpace)}
            >
              {EXPORT_SPACE_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </LabeledSelect>
            <LabeledSelect
              id="fx-im-unit"
              label="Unit"
              value={imUnit}
              onChange={(v) => setImUnit(v as LengthUnit)}
            >
              {UNIT_OPTIONS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </LabeledSelect>
            <LabeledSelect
              id="fx-im-scope"
              label="Baseline"
              value={imScope}
              onChange={(v) => setImScope(v ?? ALL)}
            >
              <SelectItem value={ALL}>All design points</SelectItem>
              <SelectItem value="category">By category</SelectItem>
            </LabeledSelect>
          </div>
          {imScope === 'category' && (
            <LabeledSelect
              label="Category"
              value={imCategory}
              onChange={(v) => setImCategory(v ?? '')}
            >
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </LabeledSelect>
          )}
          <Button disabled={busy || !pendingFile} onClick={onImport}>
            <IconUpload className="mr-1 size-4" /> Import &amp; compare
          </Button>
        </CardContent>
      </Card>

      {/* Comparisons */}
      <Card>
        <CardHeader>
          <CardTitle>Comparisons</CardTitle>
          <CardDescription>As-built QC runs for this project.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {batches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No comparisons yet.</p>
          ) : (
            batches.map((b) => (
              <div
                key={b.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-2 text-sm',
                  selectedBatch === b.id && 'border-primary bg-primary/5',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openComparison(b.id)}
                >
                  <div className="truncate font-medium">
                    {b.sourceFilename || 'As-built import'}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {b.format} · {new Date(b.createdAt).toLocaleDateString()}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete comparison"
                  disabled={busy}
                  onClick={() => setPendingDelete(b)}
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Selected comparison results */}
      {selectedBatch && summary && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {summary.pass} pass · {summary.warn} warn · {summary.fail} fail · {summary.unmatched}{' '}
              unmatched
              {summary.noVertical > 0 ? ` · ${summary.noVertical} no-Z` : ''}
            </CardDescription>
            <CardAction>
              <ButtonGroup>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDownloadReport('csv')}
                >
                  <IconFileText className="mr-1 size-4" /> CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDownloadReport('pdf')}
                >
                  <IconFileTypePdf className="mr-1 size-4" /> PDF
                </Button>
              </ButtonGroup>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ResultsTable
              rows={rows}
              reportUnit={reportUnit}
              designPoints={designPoints}
              busy={busy}
              onRepair={onRepair}
            />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete this comparison?"
        description="The as-built comparison and its results will be removed. This can’t be undone."
        onConfirm={() => {
          if (pendingDelete) {
            void onDeleteBatch(pendingDelete);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

/** A labeled shadcn Select row used across the export/import forms. */
function LabeledSelect({
  children,
  hint,
  id,
  label,
  onChange,
  value,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  id?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Field>
      <FieldContent>
        <FieldLabel>{label}</FieldLabel>
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </FieldContent>
      <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{label}</SelectLabel>
            {children}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
