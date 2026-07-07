'use client';

import {
  IconArrowAutofitHeight,
  IconArrowsHorizontal,
  IconArrowsMaximize,
  IconArrowsVertical,
  IconRotateClockwise,
  IconTrash,
  IconWand,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { CadOverlay, Project } from '@/lib/types';

import { SliderField } from '@/components/projects/cad-overlay/slider-field';
import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { dxfExtent } from '@/lib/dxf';
import { gql } from '@/lib/graphql';

import {
  ELEV_WINDOW,
  OFFSET_WINDOW,
  OVERLAY_DXF,
  SCENE_POINTS,
  SET_GEO,
  SITE_PROJECTED,
} from '../cad-overlay-data';

export function OverlayRow({
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
  const [el, setEl] = useState(overlay.elevation);
  // The offset/elevation sliders nudge ±window around a base that recenters when
  // a value is committed (typed or auto-placed) — fine control over a huge range.
  const [baseE, setBaseE] = useState(overlay.offsetE);
  const [baseN, setBaseN] = useState(overlay.offsetN);
  const [baseEl, setBaseEl] = useState(overlay.elevation);
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
        el,
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
      // far from the floor plan doesn't skew the span. The viewer rotates/scales
      // the overlay about this same center, with the offset placing that center
      // directly — so auto-place just sets the offset to the target.
      const polylines = dxf.cadOverlayGeometry.polylines;
      if (polylines.length === 0) {
        toast.error('The DXF has no geometry to place.');
        return;
      }
      const { spanX, spanY } = dxfExtent(polylines);
      const dSpanX = spanX || 1;
      const dSpanY = spanY || 1;

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

      // Offset places the drawing's center directly, so it lands on the target.
      const newOe = targetE;
      const newOn = targetN;
      setOe(newOe);
      setOn(newOn);
      setBaseE(newOe);
      setBaseN(newOn);
      setRot(0);
      setSc(scale);
      await gql(SET_GEO, {
        el,
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
        <SliderField
          id={`${fid}-el`}
          label="Elevation"
          icon={<IconArrowAutofitHeight className="size-4" />}
          value={el}
          base={baseEl}
          window={ELEV_WINDOW}
          step={0.25}
          suffix="m"
          onChange={setEl}
          onCommit={(v) => setBaseEl(v)}
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
