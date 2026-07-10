'use client';

import {
  IconArrowAutofitHeight,
  IconArrowsHorizontal,
  IconArrowsMaximize,
  IconArrowsVertical,
  IconFocusCentered,
  IconRotateClockwise,
  IconTrash,
  IconWand,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { AlignMarker } from '@/components/projects/terrain/align-points-overlay';
import type { CadOverlay, Project, ScenePoint } from '@/lib/types';

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
  ALIGN_CAD_OVERLAY,
  ELEV_WINDOW,
  OFFSET_WINDOW,
  OVERLAY_DXF,
  SCENE_POINTS,
  SET_GEO,
  SITE_PROJECTED,
} from '../cad-overlay-data';

/** One align pick, in projected meters, tagged by which side it fills. `height`
 *  is the pick's world elevation (a DXF vertex carries its flat layer Z). */
type AlignPick = { e: number; height: number; kind: 'src' | 'dst'; n: number };

// The capture order that defines the pairing: drawing point 1, its grid
// intersection, drawing point 2, its grid intersection. This is why order
// matters — each drawing point pairs with the intersection clicked right after.
const ALIGN_SEQUENCE = ['src', 'dst', 'src', 'dst'] as const;
const ALIGN_STEP_LABEL = [
  'click drawing point 1',
  'click the grid intersection for point 1',
  'click drawing point 2',
  'click the grid intersection for point 2',
];

export function OverlayRow({
  aligning = false,
  onAlignChange,
  onAlignPointsChange,
  onChanged,
  onDelete,
  onDigitizingChange,
  overlay,
  pickRef,
  project,
}: {
  overlay: CadOverlay;
  project: Project;
  onChanged: () => void;
  onDelete: () => void;
  /** Scene digitize bridge — snapped DXF vertices + grid intersections feed the
   *  align-to-grid capture. */
  pickRef?: React.MutableRefObject<((point: ScenePoint) => void) | null>;
  onDigitizingChange?: (on: boolean) => void;
  /** Whether this overlay is the one currently capturing align points. */
  aligning?: boolean;
  /** Enter/leave align mode for this overlay (the panel enforces one at a time). */
  onAlignChange?: (on: boolean) => void;
  /** Publishes the captured picks so the scene can highlight them. */
  onAlignPointsChange?: (markers: AlignMarker[]) => void;
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
  // Align-to-grid capture, in strict pairing order (see ALIGN_SEQUENCE): the
  // picks the bridge reports, in projected meters.
  const [picks, setPicks] = useState<AlignPick[]>([]);

  // While this overlay is in align mode, own the shared pick bridge. A click is
  // only accepted if it's the kind the current step expects (a DXF vertex or a
  // grid intersection) — that's what enforces the pairing order.
  useEffect(() => {
    if (!aligning) {
      return;
    }
    onDigitizingChange?.(true);
    if (pickRef) {
      pickRef.current = (p) => {
        setPicks((cur) => {
          if (cur.length >= 4) {
            return cur;
          }
          const expected = ALIGN_SEQUENCE[cur.length];
          const kind =
            p.label === 'DXF vertex' ? 'src' : p.label === 'Grid intersection' ? 'dst' : null;
          if (kind !== expected) {
            return cur; // out-of-step click — ignore (the prompt says what's next)
          }
          return [...cur, { e: p.easting, height: p.height, kind, n: p.northing }];
        });
      };
    }
    return () => {
      if (pickRef) {
        pickRef.current = null;
      }
      onDigitizingChange?.(false);
    };
  }, [aligning, pickRef, onDigitizingChange]);

  // Highlight the captured picks in the 3D scene (numbered by pair, coloured by
  // kind). Only the aligning row publishes; it clears on exit.
  useEffect(() => {
    if (!aligning || !onAlignPointsChange) {
      return;
    }
    onAlignPointsChange(
      picks.map((p, i) => ({
        e: p.e,
        height: p.height,
        kind: p.kind,
        n: p.n,
        pair: Math.floor(i / 2) + 1,
      })),
    );
    return () => onAlignPointsChange([]);
  }, [aligning, picks, onAlignPointsChange]);

  function resetAlign() {
    setPicks([]);
  }

  // Solve + apply on the API — Rust owns the geometry (the same 2-point Helmert
  // fit used for control points). Send the picks, get the new transform back, and
  // reflect it in the row's controls.
  async function applyAlign() {
    if (picks.length < 4) {
      return;
    }
    // Pair by capture order: (point 1 → grid 1), (point 2 → grid 2).
    const src = [picks[0], picks[2]];
    const dst = [picks[1], picks[3]];
    setSaving(true);
    try {
      const { alignCadOverlay: r } = await gql(ALIGN_CAD_OVERLAY, {
        dst: dst.map((p) => ({ e: p.e, n: p.n })),
        id: overlay.id,
        src: src.map((p) => ({ e: p.e, n: p.n })),
      });
      setOe(r.offsetE);
      setOn(r.offsetN);
      setBaseE(r.offsetE);
      setBaseN(r.offsetN);
      setRot(r.rotationDeg);
      setSc(r.scale);
      toast.success('Aligned to grid.');
      resetAlign();
      onAlignChange?.(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Alignment failed');
    } finally {
      setSaving(false);
    }
  }
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

        <div className="flex gap-2">
          <Button
            className="flex-1"
            size="sm"
            variant="outline"
            disabled={placing}
            onClick={autoPlace}
          >
            <IconWand className="mr-1 size-4" /> {placing ? 'Placing…' : 'Auto-place'}
          </Button>
          <Button
            className="flex-1"
            size="sm"
            variant={aligning ? 'secondary' : 'outline'}
            onClick={() => onAlignChange?.(!aligning)}
          >
            <IconFocusCentered className="mr-1 size-4" /> Align to grid
          </Button>
        </div>

        {aligning ? (
          <div className="border-primary bg-primary/5 flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Align to grid</span>
              <span className="text-muted-foreground text-xs">click points in the scene</span>
            </div>
            <p className="text-muted-foreground text-xs">
              Pair two drawing points with two grid intersections. <strong>Order matters</strong> —
              each drawing point pairs with the grid intersection you click right after it.
            </p>
            {!overlay.visible ? (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This overlay is hidden — turn it visible to click its vertices.
              </p>
            ) : null}

            {/* Current step prompt. */}
            <div className="bg-background/60 rounded px-2 py-1.5 text-xs font-medium">
              {picks.length < 4
                ? `Step ${picks.length + 1} of 4 — ${ALIGN_STEP_LABEL[picks.length]}`
                : 'Ready — apply the alignment.'}
            </div>

            {/* Captured picks, numbered + coloured to match the 3D markers. */}
            {picks.length > 0 ? (
              <div className="flex flex-col gap-1 text-xs">
                {picks.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: p.kind === 'src' ? '#f59e0b' : '#3b82f6' }}
                    >
                      {Math.floor(i / 2) + 1}
                    </span>
                    <span className="text-muted-foreground">
                      {p.kind === 'src' ? 'Drawing point' : 'Grid intersection'}
                    </span>
                    <span className="ml-auto tabular-nums">
                      E {p.e.toFixed(2)} · N {p.n.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetAlign();
                  onAlignChange?.(false);
                }}
              >
                <IconX className="mr-1 size-4" /> Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPicks((cur) => cur.slice(0, -1))}
                disabled={picks.length === 0}
              >
                Undo
              </Button>
              <Button size="sm" onClick={applyAlign} disabled={saving || picks.length < 4}>
                Apply
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="border-t p-3">
        <Button className="w-full" disabled={saving} onClick={() => apply()}>
          {saving ? 'Applying…' : 'Apply georeference'}
        </Button>
      </CardFooter>
    </Card>
  );
}
