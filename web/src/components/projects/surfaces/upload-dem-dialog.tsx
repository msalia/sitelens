'use client';

import { IconFileUpload } from '@tabler/icons-react';
import { fromArrayBuffer } from 'geotiff';
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

/** Cap the sampled grid so a huge DEM stays a manageable mesh (~this² cells). */
const MAX_GRID = 160;

/** A DEM grid parsed client-side, ready for `buildDemSurface`. */
interface ParsedDem {
  /** Raw file bytes (base64) — stored for re-download / GeoTIFF export. */
  contentBase64: string;
  epsg: number;
  height: number;
  nodata: number | null;
  originE: number;
  originN: number;
  pixelX: number;
  pixelY: number;
  valuesBase64: string;
  width: number;
}

/** Base64-encodes bytes in chunks (avoids arg-count limits on large buffers). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Parses a GeoTIFF into a downsampled elevation grid with its CRS + transform. */
async function parseDem(file: File): Promise<ParsedDem> {
  const buf = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();

  const keys = (image.getGeoKeys?.() ?? {}) as {
    ProjectedCSTypeGeoKey?: number;
    GeographicTypeGeoKey?: number;
  };
  const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 0;
  if (!epsg) {
    throw new Error('The GeoTIFF has no CRS (EPSG) — cannot georeference it.');
  }

  // Downsample to at most MAX_GRID on the long axis, preserving aspect.
  const scale = Math.min(1, MAX_GRID / Math.max(w, h));
  const rw = Math.max(2, Math.round(w * scale));
  const rh = Math.max(2, Math.round(h * scale));
  const rasters = await image.readRasters({ height: rh, samples: [0], width: rw });
  const band = (rasters as unknown as ArrayLike<number>[])[0];
  const values = Float32Array.from({ length: rw * rh }, (_, i) => band[i]);

  const nodata = image.getGDALNoData?.() ?? null;
  return {
    contentBase64: bytesToBase64(new Uint8Array(buf)),
    epsg,
    height: rh,
    nodata,
    // Node spacing spans the bbox across (n-1) intervals so the edges line up.
    originE: west,
    originN: north,
    pixelX: (east - west) / (rw - 1),
    pixelY: (north - south) / (rh - 1),
    valuesBase64: bytesToBase64(new Uint8Array(values.buffer)),
    width: rw,
  };
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
      const { epsg, height, nodata, originE, originN, pixelX, pixelY, valuesBase64, width } = dem;
      const { buildDemSurface } = await gql(BUILD_DEM_SURFACE, {
        contentBase64: dem.contentBase64,
        filename,
        grid: { epsg, height, nodata, originE, originN, pixelX, pixelY, valuesBase64, width },
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
