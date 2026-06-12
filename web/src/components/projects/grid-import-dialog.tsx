'use client';

import { IconUpload } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { gql, useMutation } from '@/lib/graphql';
import { parseGridCsv, partitionGridRows } from '@/lib/grid-import';
import { type GridAxis, type LengthUnit, type Project, UNIT_OPTIONS } from '@/lib/types';
import { fromMeters } from '@/lib/units';

const SET_GRID_AXES = graphql(`
  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {
      id
    }
  }
`);

export function GridImportDialog({
  axes,
  onImported,
  project,
  trigger,
}: {
  project: Project;
  /** Currently saved axes (needed to append, and to rebuild the bulk payload). */
  axes: GridAxis[];
  onImported: () => void;
  /** Optional custom trigger element; falls back to a default button. */
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  // Debounced copy of `content` so the preview parse runs ~250ms after typing
  // settles, not on every keystroke (keeps large pastes from re-parsing live).
  const [debouncedContent, setDebouncedContent] = useState('');
  const [unit, setUnit] = useState<LengthUnit>(project.displayUnit);
  const [hasHeader, setHasHeader] = useState(false);
  const [replace, setReplace] = useState(false);
  const { busy, run } = useMutation();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 250);
    return () => clearTimeout(t);
  }, [content]);

  // Parse + partition for the preview, off the debounced text — not on every
  // render (e.g. toggling replace), and not in two separate filter passes.
  const { errors, valid } = useMemo(
    () => partitionGridRows(parseGridCsv(debouncedContent, hasHeader)),
    [debouncedContent, hasHeader],
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setContent(await file.text());
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    // Parse the live text here (not the debounced preview) so a quick submit
    // right after pasting doesn't act on stale or empty parse results.
    const { errors, valid } = partitionGridRows(parseGridCsv(content, hasHeader));
    if (valid.length === 0) {
      toast.error('No valid axes to import');
      return;
    }
    if (errors.length > 0) {
      toast.error(`Fix ${errors.length} invalid ${errors.length === 1 ? 'line' : 'lines'} first`);
      return;
    }
    // The API replaces the whole grid, so build the full payload: existing axes
    // (converted into the import unit) plus the parsed ones, or just the parsed
    // ones when replacing.
    const existing = replace
      ? []
      : axes.map((a) => ({
          family: a.family,
          label: a.label,
          position: fromMeters(a.position, unit),
        }));
    const next = [
      ...existing,
      ...valid.map((r) => ({ family: r.family, label: r.label, position: r.position })),
    ];
    await run(() => gql(SET_GRID_AXES, { axes: next, id: project.id, unit }), {
      error: 'Import failed',
      onDone: () => {
        setOpen(false);
        setContent('');
        setReplace(false);
        onImported();
      },
      success: `Imported ${valid.length} ${valid.length === 1 ? 'axis' : 'axes'}`,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button variant="outline">
              <IconUpload className="mr-1 size-4" /> Import
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import grid</DialogTitle>
          <DialogDescription>
            One axis per line as <code>family,label,position</code> — family is{' '}
            <code>LETTERED</code> or <code>NUMBERED</code>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onImport} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="gim-unit">Position unit</FieldLabel>
            <Select value={unit} onValueChange={(v) => setUnit(v as LengthUnit)}>
              <SelectTrigger id="gim-unit" className="w-full">
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
            <FieldLabel htmlFor="gim-file">File</FieldLabel>
            <Input id="gim-file" type="file" accept=".csv,.txt" onChange={onFile} />
            <Textarea
              placeholder={'…or paste here, e.g.\nLETTERED,A,0\nNUMBERED,1,12.5'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-xs"
              rows={6}
            />
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="gim-header" className="text-sm font-medium">
                First row is a header
              </Label>
              <p className="text-muted-foreground text-sm">Skip the first non-empty line.</p>
            </div>
            <Switch id="gim-header" checked={hasHeader} onCheckedChange={setHasHeader} />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="gim-replace" className="text-sm font-medium">
                Replace existing grid
              </Label>
              <p className="text-muted-foreground text-sm">
                {replace
                  ? 'The current grid will be cleared and replaced.'
                  : 'Imported axes are added to the current grid.'}
              </p>
            </div>
            <Switch id="gim-replace" checked={replace} onCheckedChange={setReplace} />
          </div>

          {content.trim() && (
            <FieldDescription>
              {valid.length} valid {valid.length === 1 ? 'axis' : 'axes'}
              {errors.length > 0 && (
                <span className="text-destructive">
                  {' '}
                  · {errors.length} invalid (line{errors.length === 1 ? '' : 's'}{' '}
                  {errors.map((e) => e.line).join(', ')})
                </span>
              )}
            </FieldDescription>
          )}

          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy || valid.length === 0}>
              {busy ? 'Importing…' : 'Import grid'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
