'use client';

import { IconUpload, IconVector } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import type { CadOverlay, Project } from '@/lib/types';

import { OverlayRow } from '@/components/projects/cad-overlay/overlay-row';
import { GeoreferenceCard } from '@/components/projects/georeference-card';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { gql } from '@/lib/graphql';

import { DELETE_CAD_OVERLAY, MAX_DXF_BYTES, UPLOAD } from './cad-overlay-data';

export function CadOverlayPanel({
  onChanged,
  overlays,
  project,
}: {
  project: Project;
  overlays: CadOverlay[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_DXF_BYTES) {
      toast.error('That DXF is larger than 10 MB.');
      e.target.value = '';
      return;
    }
    setBusy(true);
    try {
      await gql(UPLOAD, { c: await file.text(), f: file.name, id: project.id });
      toast.success('DXF uploaded');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function remove(id: string) {
    try {
      await gql(DELETE_CAD_OVERLAY, { id });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <GeoreferenceCard project={project} onSaved={onChanged} />

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="p-4">
          <CardTitle>DXF overlays</CardTitle>
          <CardDescription>Overlay the architect drawing on the 3D scene.</CardDescription>
        </CardHeader>

        <CardContent className="px-4 pb-4">
          {/* Drop zone — clicking the dashed area opens the file picker. */}
          <label
            htmlFor="dxf-file"
            className="border-input hover:bg-accent/40 flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors"
          >
            <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
              <IconVector className="size-5" />
            </span>
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Click to upload a DXF</span>
              <span className="text-muted-foreground block text-xs">
                Vector linework only — export DWG to DXF first · up to 10 MB
              </span>
            </span>
          </label>
          <input
            ref={inputRef}
            id="dxf-file"
            type="file"
            accept=".dxf"
            className="hidden"
            onChange={onFile}
          />
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-2 border-t p-4">
          <Button className="w-full" disabled={busy} onClick={() => inputRef.current?.click()}>
            <IconUpload className="mr-1 size-4" /> {busy ? 'Uploading…' : 'Upload DXF'}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            A DXF carries no map projection. Use “Auto-place” to drop it on the site origin, then
            fine-tune offset / rotation / scale.
          </p>
        </CardFooter>
      </Card>

      {/* Uploaded overlays — listed below the upload card. */}
      {overlays.length > 0 ? (
        <div className="flex flex-col gap-3">
          {overlays.map((o) => (
            <OverlayRow
              key={o.id}
              project={project}
              overlay={o}
              onChanged={onChanged}
              onDelete={() => remove(o.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
