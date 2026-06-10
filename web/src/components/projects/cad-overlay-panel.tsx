'use client';

import {
  IconArrowsHorizontal,
  IconArrowsMaximize,
  IconArrowsVertical,
  IconRotateClockwise,
  IconTrash,
  IconUpload,
  IconVector,
  IconWand,
} from '@tabler/icons-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { CadOverlay, GeorefPreview, Project } from '@/lib/types';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
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
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { parseDxf } from '@/lib/dxf';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const UPLOAD = graphql(`
  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {
    uploadDxf(projectId: $id, filename: $f, content: $c) {
      id
    }
  }
`);

const SET_GEO = graphql(`
  mutation SetCadGeoreference(
    $id: UUID!
    $oe: Float
    $on: Float
    $rot: Float
    $sc: Float
    $vis: Boolean
  ) {
    setCadGeoreference(
      id: $id
      offsetE: $oe
      offsetN: $on
      rotationDeg: $rot
      scale: $sc
      visible: $vis
    ) {
      id
    }
  }
`);

const DELETE_CAD_OVERLAY = graphql(`
  mutation DeleteCadOverlay($id: UUID!) {
    deleteCadOverlay(id: $id)
  }
`);

const SITE_PROJECTED = graphql(`
  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {
    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {
      projectedGridE
      projectedGridN
    }
  }
`);

// Mirror of the API's `MAX_DXF_BYTES` so oversized files fail fast client-side.
const MAX_DXF_BYTES = 10 * 1024 * 1024;

const OVERLAY_DXF = graphql(`
  query CadOverlayDxf($id: UUID!) {
    cadOverlayContent(id: $id)
  }
`);

const SCENE_POINTS = graphql(`
  query OverlayScenePoints($id: UUID!) {
    sceneData(projectId: $id) {
      controlPoints {
        easting
        northing
      }
      surveyPoints {
        easting
        northing
      }
    }
  }
`);

export function CadOverlayPanel({
  onChanged,
  onPreview,
  overlays,
  project,
}: {
  project: Project;
  overlays: CadOverlay[];
  onChanged: () => void;
  /** Live georeference draft for the 3D scene (from the Georeference card). */
  onPreview: (preview: GeorefPreview | null) => void;
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
      <GeoreferenceCard project={project} onPreview={onPreview} onSaved={onChanged} />

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

const OFFSET_WINDOW = 100; // meters of fine-nudge range on each side of the slider

function OverlayRow({
  onChanged,
  onDelete,
  overlay,
  project,
}: {
  overlay: CadOverlay;
  project: Project;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [oe, setOe] = useState(overlay.offsetE);
  const [on, setOn] = useState(overlay.offsetN);
  const [rot, setRot] = useState(overlay.rotationDeg);
  const [sc, setSc] = useState(overlay.scale);
  // The offset sliders nudge ±OFFSET_WINDOW around a base that recenters when a
  // value is committed (typed or auto-placed) — fine control over a huge range.
  const [baseE, setBaseE] = useState(overlay.offsetE);
  const [baseN, setBaseN] = useState(overlay.offsetN);
  const [saving, setSaving] = useState(false);
  const [placing, setPlacing] = useState(false);
  // Only show the filename tooltip when the title is actually clipped.
  const titleRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) {
      return;
    }
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [overlay.originalFilename]);

  async function apply(vis?: boolean) {
    setSaving(true);
    try {
      await gql(SET_GEO, {
        id: overlay.id,
        oe,
        on,
        rot,
        sc,
        vis: vis ?? overlay.visible,
      });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  // Derive a starting placement from the file. The DXF has no projection, so we
  // FIT its extent to the survey points' footprint: scale so it spans the points
  // box and center it on the points' center. Falls back to the site origin (scale
  // 1) when there are no points. Rotation stays 0 — the user fine-tunes.
  async function autoPlace() {
    setPlacing(true);
    try {
      const hasOrigin = project.siteOriginLat !== null && project.siteOriginLon !== null;
      const [dxf, pts, conv] = await Promise.all([
        gql(OVERLAY_DXF, { id: overlay.id }),
        gql(SCENE_POINTS, { id: project.id }),
        hasOrigin
          ? gql(SITE_PROJECTED, {
              id: project.id,
              lat: project.siteOriginLat!,
              lon: project.siteOriginLon!,
            })
          : Promise.resolve(null),
      ]);

      // DXF extent via 2nd–98th percentiles so a stray title block / leader line
      // far from the floor plan doesn't skew the center or blow up the scale.
      const xs: number[] = [];
      const ys: number[] = [];
      for (const pl of parseDxf(dxf.cadOverlayContent).polylines) {
        for (const p of pl.points) {
          xs.push(p.x);
          ys.push(p.y);
        }
      }
      if (xs.length === 0) {
        toast.error('The DXF has no geometry to place.');
        return;
      }
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const pct = (arr: number[], q: number) =>
        arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];
      const xLo = pct(xs, 0.02);
      const xHi = pct(xs, 0.98);
      const yLo = pct(ys, 0.02);
      const yHi = pct(ys, 0.98);
      const dcx = (xLo + xHi) / 2;
      const dcy = (yLo + yHi) / 2;
      const dSpanX = xHi - xLo || 1;
      const dSpanY = yHi - yLo || 1;

      // Target: the survey points' projected footprint, else the site origin.
      const surveyPts = [...pts.sceneData.controlPoints, ...pts.sceneData.surveyPoints];
      let targetE: number;
      let targetN: number;
      let scale = sc || 1;
      if (surveyPts.length >= 2) {
        const es = surveyPts.map((p) => p.easting);
        const ns = surveyPts.map((p) => p.northing);
        const eMin = Math.min(...es);
        const eMax = Math.max(...es);
        const nMin = Math.min(...ns);
        const nMax = Math.max(...ns);
        targetE = (eMin + eMax) / 2;
        targetN = (nMin + nMax) / 2;
        // Fit within the points box (min so neither axis overshoots).
        const fit = Math.min((eMax - eMin) / dSpanX, (nMax - nMin) / dSpanY);
        scale = Number.isFinite(fit) && fit > 0 ? fit : 1;
      } else if (conv && conv.convertCoordinate.projectedGridE !== null) {
        targetE = conv.convertCoordinate.projectedGridE;
        targetN = conv.convertCoordinate.projectedGridN!;
        scale = 1;
      } else {
        toast.error('Add survey points or a site origin first.');
        return;
      }

      const newOe = targetE - scale * dcx;
      const newOn = targetN - scale * dcy;
      setOe(newOe);
      setOn(newOn);
      setBaseE(newOe);
      setBaseN(newOn);
      setRot(0);
      setSc(scale);
      await gql(SET_GEO, {
        id: overlay.id,
        oe: newOe,
        on: newOn,
        rot: 0,
        sc: scale,
        vis: overlay.visible,
      });
      toast.success('Fitted to the survey points — fine-tune rotation / scale.');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Auto-place failed');
    } finally {
      setPlacing(false);
    }
  }

  const fid = `ov-${overlay.id}`;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-3 pb-0">
        {truncated ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span ref={titleRef} className="min-w-0 flex-1 truncate text-sm font-medium" />
              }
            >
              {overlay.originalFilename}
            </TooltipTrigger>
            <TooltipContent>{overlay.originalFilename}</TooltipContent>
          </Tooltip>
        ) : (
          <span ref={titleRef} className="min-w-0 flex-1 truncate text-sm font-medium">
            {overlay.originalFilename}
          </span>
        )}
        <ConfirmDialog
          title={`Delete ${overlay.originalFilename}?`}
          description="This DXF overlay will be removed from the scene. This can’t be undone."
          onConfirm={onDelete}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Delete overlay">
              <IconTrash className="size-4" />
            </Button>
          }
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-3 p-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`${fid}-vis`}>Visible</FieldLabel>
            <FieldDescription>Show this overlay in the 3D scene.</FieldDescription>
          </FieldContent>
          <Switch
            id={`${fid}-vis`}
            checked={overlay.visible}
            onCheckedChange={(v) => apply(Boolean(v))}
          />
        </Field>

        <div className="-mx-3 border-t" />

        <SliderField
          id={`${fid}-oe`}
          label="Offset E"
          icon={<IconArrowsHorizontal className="size-4" />}
          value={oe}
          base={baseE}
          window={OFFSET_WINDOW}
          step={0.25}
          suffix="m"
          onChange={setOe}
          onCommit={(v) => setBaseE(v)}
        />
        <SliderField
          id={`${fid}-on`}
          label="Offset N"
          icon={<IconArrowsVertical className="size-4" />}
          value={on}
          base={baseN}
          window={OFFSET_WINDOW}
          step={0.25}
          suffix="m"
          onChange={setOn}
          onCommit={(v) => setBaseN(v)}
        />
        <SliderField
          id={`${fid}-rot`}
          label="Rotation"
          icon={<IconRotateClockwise className="size-4" />}
          value={rot}
          min={0}
          max={360}
          step={1}
          suffix="°"
          onChange={setRot}
        />
        <SliderField
          id={`${fid}-sc`}
          label="Scale"
          icon={<IconArrowsMaximize className="size-4" />}
          value={sc}
          min={0.001}
          max={10}
          step={0.001}
          suffix="×"
          onChange={setSc}
        />

        <Button size="sm" variant="outline" disabled={placing} onClick={autoPlace}>
          <IconWand className="mr-1 size-4" /> {placing ? 'Placing…' : 'Auto-place at site'}
        </Button>
      </CardContent>

      <CardFooter className="border-t p-3">
        <Button className="w-full" disabled={saving} onClick={() => apply()}>
          {saving ? 'Applying…' : 'Apply georeference'}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** One control row: icon + label on the left, a slider + a synced number input
 * (with a unit suffix) on the right. For offsets, pass a `base` + `window` to
 * make the slider a fine-nudge jog around the current value over a huge range. */
function SliderField({
  base,
  icon,
  id,
  label,
  max,
  min,
  onChange,
  onCommit,
  step,
  suffix,
  value,
  window: win,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: number;
  onChange: (v: number) => void;
  base?: number;
  window?: number;
  min?: number;
  max?: number;
  step: number;
  suffix?: string;
  onCommit?: (v: number) => void;
}) {
  const lo = win !== undefined ? (base ?? value) - win : (min ?? 0);
  const hi = win !== undefined ? (base ?? value) + win : (max ?? 100);
  return (
    <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <label htmlFor={id} className="w-16 shrink-0 text-sm font-medium">
        {label}
      </label>
      <Slider
        className="min-w-0 flex-1"
        value={[value]}
        min={lo}
        max={hi}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        onValueCommitted={(v) => onCommit?.(Array.isArray(v) ? v[0] : v)}
      />
      <InputGroup className="w-28 shrink-0">
        <InputGroupInput
          id={id}
          type="number"
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!Number.isNaN(n)) {
              onChange(n);
              onCommit?.(n);
            }
          }}
        />
        {suffix ? (
          <InputGroupAddon align="inline-end">
            <InputGroupText>{suffix}</InputGroupText>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}
