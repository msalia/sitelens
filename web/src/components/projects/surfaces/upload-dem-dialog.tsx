'use client';

import { IconFileUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { Project } from '@/lib/types';

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
import { gql } from '@/lib/graphql';

import { BUILD_DEM_SURFACE } from '../surfaces-data';
import { demGridArgs, type ParsedDem, parseDemArrayBuffer } from '../surfaces/parse-dem';

/** Parses a GeoTIFF file into a downsampled elevation grid with its CRS. */
async function parseDem(file: File): Promise<ParsedDem> {
  return parseDemArrayBuffer(await file.arrayBuffer());
}

/** Upload a GeoTIFF DEM → parse it client-side → build a `dem` surface. */
export function UploadDemDialog({
  onUploaded,
  project,
}: {
  project: Project;
  onUploaded: (surfaceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('DEM surface');
  const [filename, setFilename] = useState<string | null>(null);
  const [dem, setDem] = useState<ParsedDem | null>(null);

  function reset() {
    setDem(null);
    setFilename(null);
    setName('DEM surface');
  }

  async function onFile(file: File) {
    if (!/\.(tif|tiff)$/i.test(file.name)) {
      toast.error('Choose a GeoTIFF (.tif / .tiff) file.');
      return;
    }
    setBusy(true);
    try {
      const parsed = await parseDem(file);
      setDem(parsed);
      setFilename(file.name);
      setName(file.name.replace(/\.(tif|tiff)$/i, ''));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the GeoTIFF');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!dem || !filename) {
      return;
    }
    setBusy(true);
    try {
      const { buildDemSurface } = await gql(BUILD_DEM_SURFACE, {
        contentBase64: dem.contentBase64,
        filename,
        grid: demGridArgs(dem),
        name: name.trim() || 'DEM surface',
        projectId: project.id,
      });
      toast.success(
        `Built DEM surface — ${buildDemSurface.triangleCount.toLocaleString()} triangles`,
      );
      onUploaded(buildDemSurface.id);
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the DEM surface');
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
          <Button type="button" variant="outline">
            <IconFileUpload className="mr-1 size-4" /> Upload DEM
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a DEM (GeoTIFF)</DialogTitle>
          <DialogDescription>
            Import a drone/LiDAR elevation raster as a surface. It’s parsed in the browser,
            downsampled, and reprojected to the site — then behaves like any TIN (contours, volumes,
            export).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="dem-file">GeoTIFF file</FieldLabel>
            <Input
              id="dem-file"
              type="file"
              accept=".tif,.tiff,image/tiff"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void onFile(f);
                }
              }}
            />
          </Field>

          {dem ? (
            <>
              <Field>
                <FieldLabel htmlFor="dem-name">Name</FieldLabel>
                <Input id="dem-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <p className="text-muted-foreground text-xs">
                {dem.width}×{dem.height} grid · EPSG:{dem.epsg}
              </p>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={commit} disabled={busy || !dem}>
            {busy ? 'Building…' : 'Build surface'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
