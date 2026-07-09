'use client';

import { IconUpload } from '@tabler/icons-react';
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
import { gql } from '@/lib/graphql';
import { type LengthUnit, type Project, UNIT_OPTIONS } from '@/lib/types';

import { IMPORT_BREAKLINES, PREVIEW_BREAKLINE_IMPORT } from '../surfaces-data';

type Layer = { layer: string; count: number; suggestedKind: string };

const SKIP = '__skip__';
const KINDS: [string, string][] = [
  ['HARD', 'Hard breakline'],
  ['BOUNDARY', 'Boundary'],
  ['HOLE', 'Hole'],
];

/** Read a file as standard base64 (binary-safe via a data URL). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Import breaklines from a DXF: upload → map each layer to a kind → commit. */
export function ImportBreaklinesDialog({
  className,
  onImported,
  project,
}: {
  project: Project;
  onImported: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layer[] | null>(null);
  // key = layer name → kind or SKIP.
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<LengthUnit>(project.displayUnit);

  function reset() {
    setContent(null);
    setLayers(null);
    setMapping({});
  }

  async function onFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.dxf')) {
      toast.error('Choose a .dxf file.');
      return;
    }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const { previewBreaklineImport } = await gql(PREVIEW_BREAKLINE_IMPORT, {
        contentBase64: base64,
        projectId: project.id,
      });
      setContent(base64);
      setLayers(previewBreaklineImport.layers);
      setMapping(
        Object.fromEntries(
          previewBreaklineImport.layers.map((l) => [l.layer, l.suggestedKind.toUpperCase()]),
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the DXF');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!content || !layers) {
      return;
    }
    const mappings = layers.map((l) => ({
      kind: mapping[l.layer] === SKIP ? null : mapping[l.layer],
      layer: l.layer,
    }));
    if (mappings.every((m) => m.kind === null)) {
      toast.error('Map at least one layer.');
      return;
    }
    setBusy(true);
    try {
      const { importBreaklines } = await gql(IMPORT_BREAKLINES, {
        contentBase64: content,
        mappings,
        projectId: project.id,
        unit,
      });
      toast.success(
        `Imported ${importBreaklines.created} breakline(s), skipped ${importBreaklines.skipped}.`,
      );
      onImported();
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          reset();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={className}>
            <IconUpload className="mr-1 size-4" /> Import DXF
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import breaklines from DXF</DialogTitle>
          <DialogDescription>
            Map each DXF polyline layer to a constraint kind. DXF has no elevation — vertex heights
            are filled from the nearest survey point when the surface is built.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="brk-file">DXF file</FieldLabel>
            <Input
              id="brk-file"
              type="file"
              accept=".dxf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void onFile(f);
                }
              }}
            />
          </Field>

          {layers ? (
            <>
              <Field>
                <FieldLabel htmlFor="brk-unit">Drawing unit</FieldLabel>
                <Select value={unit} onValueChange={(v) => v && setUnit(v as LengthUnit)}>
                  <SelectTrigger id="brk-unit" className="w-full">
                    <SelectValue />
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

              <div className="flex flex-col gap-2">
                {layers.map((l) => (
                  <div key={l.layer} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.layer}</div>
                      <div className="text-muted-foreground text-xs">{l.count} polyline(s)</div>
                    </div>
                    <Select
                      value={mapping[l.layer] ?? SKIP}
                      onValueChange={(v) => v && setMapping((m) => ({ ...m, [l.layer]: v }))}
                    >
                      <SelectTrigger className="w-40 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Import as</SelectLabel>
                          <SelectItem value={SKIP}>Skip</SelectItem>
                          {KINDS.map(([v, label]) => (
                            <SelectItem key={v} value={v}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={commit} disabled={busy || !layers}>
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
