'use client';

import { IconCopy, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { AnalysisPath } from '@/components/projects/terrain/analysis-overlay';
import type { Project, ScenePoint } from '@/lib/types';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { ListRow, TooltipIconButton } from '@/components/projects/list-row';
import {
  type AnalysisResult,
  parseAnalysisResult,
} from '@/components/projects/terrain/analysis-result-overlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { gql, useMutation } from '@/lib/graphql';

import {
  ANALYSES,
  CREATE_ANALYSIS,
  DELETE_ANALYSIS,
  DUPLICATE_ANALYSIS,
  RUN_PARKING_ANALYSIS,
  RUN_TURNING_ANALYSIS,
  VEHICLE_TEMPLATES,
} from './analysis-data';

type AnalysisType = 'TURNING' | 'PARKING' | 'HYDROLOGY' | 'TRAFFIC';

interface AnalysisRow {
  id: string;
  inputGeometry: string | null;
  name: string;
  result: string | null;
  resultGeometry: string | null;
  status: string;
  type: AnalysisType;
}

interface Vehicle {
  id: string;
  isPreset: boolean;
  name: string;
}

/** Reads the pass/fail verdict from a turning analysis's `result` JSON. */
function verdict(result: string | null): 'pass' | 'fail' | null {
  if (!result) {
    return null;
  }
  try {
    const r = JSON.parse(result) as { pass?: boolean };
    return r.pass === undefined ? null : r.pass ? 'pass' : 'fail';
  } catch {
    return null;
  }
}

/** Reads the stall count + (configured) verdict from a parking `result` JSON. */
function parkingInfo(
  result: string | null,
): { checked: boolean; count: number; pass: boolean } | null {
  if (!result) {
    return null;
  }
  try {
    const r = JSON.parse(result) as {
      accessibleProvided?: number | null;
      pass?: boolean;
      requiredCount?: number | null;
      stallCount?: number;
    };
    if (r.stallCount === undefined) {
      return null;
    }
    return {
      checked: typeof r.requiredCount === 'number' || typeof r.accessibleProvided === 'number',
      count: r.stallCount,
      pass: r.pass ?? true,
    };
  } catch {
    return null;
  }
}

const TYPE_LABEL: Record<AnalysisType, string> = {
  HYDROLOGY: 'Hydrology',
  PARKING: 'Parking',
  TRAFFIC: 'Traffic',
  TURNING: 'Turning',
};

/** Parses a stored `[[e,n],…]` geometry string into projected vertices. */
function parsePath(geometry: string | null): { e: number; n: number }[] {
  if (!geometry) {
    return [];
  }
  try {
    const arr = JSON.parse(geometry) as [number, number][];
    return arr.map(([e, n]) => ({ e, n }));
  } catch {
    return [];
  }
}

/**
 * The Analysis panel (site-analysis Phase 1): create/list/duplicate/delete
 * analyses and draw their plan geometry on the survey — snap to survey points in
 * the 3D scene or enter coordinates numerically. Compute lands in later phases.
 */
export function AnalysisPanel({
  activeAnalysisId,
  onChanged,
  onDigitizingChange,
  onPathsChange,
  onResult,
  onSelect,
  pickRef,
  project,
}: {
  project: Project;
  /** The analysis whose path is highlighted in the scene (null = none). */
  activeAnalysisId: string | null;
  /** Selects (or clears) the active analysis. */
  onSelect: (id: string | null) => void;
  /** Bumped after a create/duplicate/delete so consumers can refresh. */
  onChanged: () => void;
  /** Publishes the paths to overlay in the scene (drawing + selected). */
  onPathsChange: (paths: AnalysisPath[]) => void;
  /** Publishes the selected analysis's computed result geometry (null = none). */
  onResult: (result: AnalysisResult | null) => void;
  /** Scene digitize bridge: snapped survey points feed the active drawing. */
  pickRef: React.MutableRefObject<((point: ScenePoint) => void) | null>;
  /** Toggles the scene's "click points to snap" hint. */
  onDigitizingChange: (on: boolean) => void;
}) {
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [name, setName] = useState('Analysis 1');
  const [type, setType] = useState<AnalysisType>('TURNING');
  const [vehicleId, setVehicleId] = useState('');
  const [step, setStep] = useState('0.5');
  // Parking module params (meters; angle in degrees).
  const [stallLength, setStallLength] = useState('5.5');
  const [stallWidth, setStallWidth] = useState('2.7');
  const [angle, setAngle] = useState('90');
  const [aisleWidth, setAisleWidth] = useState('7.3');
  const [oneWay, setOneWay] = useState(false);
  const [requiredCount, setRequiredCount] = useState('');
  const [accessibleProvided, setAccessibleProvided] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [verts, setVerts] = useState<{ e: number; n: number }[]>([]);
  const [eIn, setEIn] = useState('');
  const [nIn, setNIn] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AnalysisRow | null>(null);
  const { busy, run } = useMutation();

  const load = useCallback(async () => {
    try {
      const { analyses: rows } = await gql(ANALYSES, { projectId: project.id });
      setAnalyses(rows as AnalysisRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load analyses');
    }
  }, [project.id]);

  const loadVehicles = useCallback(async () => {
    try {
      const { vehicleTemplates } = await gql(VEHICLE_TEMPLATES);
      setVehicles(vehicleTemplates as Vehicle[]);
      setVehicleId((cur) => cur || vehicleTemplates[0]?.id || '');
    } catch {
      setVehicles([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadVehicles();
  }, [load, loadVehicles]);

  // Route snapped survey points into the active drawing while capturing.
  useEffect(() => {
    if (capturing) {
      pickRef.current = (p) => setVerts((v) => [...v, { e: p.easting, n: p.northing }]);
      onDigitizingChange(true);
    } else {
      pickRef.current = null;
      onDigitizingChange(false);
    }
    return () => {
      pickRef.current = null;
    };
  }, [capturing, pickRef, onDigitizingChange]);

  useEffect(() => () => onDigitizingChange(false), [onDigitizingChange]);

  // Publish the paths to draw: the in-progress drawing (active) + the selected
  // saved analysis's path.
  const paths = useMemo(() => {
    const out: AnalysisPath[] = [];
    // Emit from the first point so its marker shows immediately as it's snapped.
    if (capturing && verts.length >= 1) {
      out.push({ active: true, id: 'drawing', vertices: verts });
    }
    const sel = analyses.find((a) => a.id === activeAnalysisId);
    if (sel) {
      const pv = parsePath(sel.inputGeometry);
      if (pv.length >= 2) {
        // Once computed, drop the connecting polyline (the result visualization
        // is the linework) and keep just the point markers to declutter.
        out.push({
          active: !capturing,
          id: sel.id,
          markersOnly: !!sel.resultGeometry,
          vertices: pv,
        });
      }
    }
    return out;
  }, [capturing, verts, analyses, activeAnalysisId]);

  useEffect(() => {
    onPathsChange(paths);
  }, [paths, onPathsChange]);

  // Publish the selected analysis's computed result geometry (turning envelope).
  useEffect(() => {
    const sel = analyses.find((a) => a.id === activeAnalysisId);
    onResult(sel ? parseAnalysisResult(sel.resultGeometry) : null);
  }, [analyses, activeAnalysisId, onResult]);

  const addNumeric = () => {
    const e = Number(eIn);
    const n = Number(nIn);
    if (!Number.isFinite(e) || !Number.isFinite(n) || eIn === '' || nIn === '') {
      toast.error('Enter both easting and northing.');
      return;
    }
    setVerts((v) => [...v, { e, n }]);
    setEIn('');
    setNIn('');
  };

  const save = () =>
    run(
      () =>
        gql(CREATE_ANALYSIS, {
          input: {
            inputGeometry: verts.length ? JSON.stringify(verts.map((v) => [v.e, v.n])) : null,
            name: name.trim() || 'Untitled analysis',
            params: '{}',
            type,
          },
          projectId: project.id,
        }),
      {
        error: 'Could not create the analysis',
        onDone: async (res) => {
          setCapturing(false);
          setVerts([]);
          await load();
          if (res?.createAnalysis.id) {
            onSelect(res.createAnalysis.id);
          }
          onChanged();
        },
        success: 'Analysis created',
      },
    );

  const runTurning = () =>
    run(
      () =>
        gql(RUN_TURNING_ANALYSIS, {
          input: {
            name: name.trim() || 'Turning analysis',
            path: JSON.stringify(verts.map((v) => [v.e, v.n])),
            stepResolution: Number(step) || 0.5,
            vehicleTemplateId: vehicleId,
          },
          projectId: project.id,
        }),
      {
        error: 'Could not run the turning analysis',
        onDone: async (res) => {
          setCapturing(false);
          setVerts([]);
          await load();
          if (res?.runTurningAnalysis.id) {
            onSelect(res.runTurningAnalysis.id);
          }
          onChanged();
          const v = verdict(res?.runTurningAnalysis.result ?? null);
          if (v) {
            (v === 'pass' ? toast.success : toast.error)(
              v === 'pass' ? 'Clears all obstacles' : 'Clips an obstacle',
            );
          }
        },
        success: 'Turning analysis complete',
      },
    );

  const runParking = () => {
    const num = (s: string) => (s === '' ? null : Math.trunc(Number(s)));
    return run(
      () =>
        gql(RUN_PARKING_ANALYSIS, {
          input: {
            accessibleProvided: num(accessibleProvided),
            aisleWidth: Number(aisleWidth) || 7.3,
            angle: Number(angle) || 90,
            bays: JSON.stringify([verts.map((v) => [v.e, v.n])]),
            name: name.trim() || 'Parking analysis',
            oneWay,
            requiredCount: num(requiredCount),
            stallLength: Number(stallLength) || 5.5,
            stallWidth: Number(stallWidth) || 2.7,
          },
          projectId: project.id,
        }),
      {
        error: 'Could not run the parking analysis',
        onDone: async (res) => {
          setCapturing(false);
          setVerts([]);
          await load();
          if (res?.runParkingAnalysis.id) {
            onSelect(res.runParkingAnalysis.id);
          }
          onChanged();
          const info = parkingInfo(res?.runParkingAnalysis.result ?? null);
          if (info) {
            const msg = `${info.count} stall${info.count === 1 ? '' : 's'} tiled`;
            if (info.checked && !info.pass) {
              toast.warning(`${msg} — below code requirement`);
            } else {
              toast.success(msg);
            }
          }
        },
        success: 'Parking analysis complete',
      },
    );
  };

  const duplicate = (id: string) =>
    run(() => gql(DUPLICATE_ANALYSIS, { id }), {
      error: 'Could not duplicate',
      onDone: async (res) => {
        await load();
        if (res?.duplicateAnalysis.id) {
          onSelect(res.duplicateAnalysis.id);
        }
        onChanged();
      },
      success: 'Analysis duplicated',
    });

  const remove = (id: string) =>
    run(() => gql(DELETE_ANALYSIS, { id }), {
      error: 'Could not delete',
      onDone: async () => {
        if (activeAnalysisId === id) {
          onSelect(null);
        }
        await load();
        onChanged();
      },
      success: 'Analysis deleted',
    });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">New analysis</CardTitle>
          <CardDescription>
            Draw plan geometry on the survey — snap to survey points in the scene or type
            coordinates. Turning radius and parking compute now; hydrology and traffic land in
            upcoming releases.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="an-name">Name</FieldLabel>
            <Input id="an-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field>
            <FieldLabel htmlFor="an-type">Type</FieldLabel>
            <Select value={type} onValueChange={(v) => v && setType(v as AnalysisType)}>
              <SelectTrigger id="an-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Analysis type</SelectLabel>
                  <SelectItem value="TURNING">Turning radius</SelectItem>
                  <SelectItem value="PARKING">Parking</SelectItem>
                  <SelectItem value="HYDROLOGY">Hydrology</SelectItem>
                  <SelectItem value="TRAFFIC">Traffic</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {capturing ? (
            <div className="border-primary bg-primary/5 flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Drawing — {verts.length} point(s)</span>
                <span className="text-muted-foreground text-xs">Click survey points to snap</span>
              </div>

              {/* Selected points — numbered, removable (mirrors the utility-run list). */}
              <div className="flex flex-col gap-1">
                {verts.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No points yet — click points in the 3D scene or add by coordinates below.
                  </p>
                ) : (
                  verts.map((v, i) => (
                    <div
                      key={i}
                      className="bg-muted/40 flex items-center gap-2 rounded px-2 py-1 text-xs"
                    >
                      <span className="text-muted-foreground w-5 tabular-nums">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">
                        E {v.e.toFixed(2)} · N {v.n.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove point ${i + 1}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setVerts((vs) => vs.filter((_, j) => j !== i))}
                      >
                        <IconX className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Numeric coordinate entry — Add aligned with the inputs. */}
              <div className="flex items-end gap-1.5">
                <Field className="flex-1">
                  <FieldLabel htmlFor="an-easting">Easting (m)</FieldLabel>
                  <Input
                    id="an-easting"
                    title="Easting (projected meters)"
                    type="number"
                    step="any"
                    placeholder="Easting"
                    value={eIn}
                    onChange={(e) => setEIn(e.target.value)}
                  />
                </Field>
                <Field className="flex-1">
                  <FieldLabel htmlFor="an-northing">Northing (m)</FieldLabel>
                  <Input
                    id="an-northing"
                    title="Northing (projected meters)"
                    type="number"
                    step="any"
                    placeholder="Northing"
                    value={nIn}
                    onChange={(e) => setNIn(e.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addNumeric}
                  title="Add the typed Easting/Northing as a point"
                >
                  Add
                </Button>
              </div>

              {/* Turning: pick a vehicle + step, then compute the swept path. */}
              {type === 'TURNING' ? (
                <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                  <Field>
                    <FieldLabel htmlFor="an-vehicle">Vehicle</FieldLabel>
                    <Select value={vehicleId} onValueChange={(v) => v && setVehicleId(v)}>
                      <SelectTrigger id="an-vehicle" className="w-full" title="Design vehicle">
                        <SelectValue placeholder="Vehicle…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Vehicle</SelectLabel>
                          {vehicles.map((veh) => (
                            <SelectItem key={veh.id} value={veh.id}>
                              {veh.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="an-step">Step (m)</FieldLabel>
                    <Input
                      id="an-step"
                      title="Swept-path sample spacing in meters — smaller is more precise"
                      type="number"
                      min="0"
                      step="any"
                      className="w-24"
                      value={step}
                      onChange={(e) => setStep(e.target.value)}
                    />
                  </Field>
                </div>
              ) : null}

              {/* Parking: the stall module (size, angle, aisle) + code checks. */}
              {type === 'PARKING' ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel htmlFor="an-stall-w">Stall width (m)</FieldLabel>
                      <Input
                        id="an-stall-w"
                        title="Stall width along the aisle, in meters"
                        type="number"
                        min="0"
                        step="any"
                        value={stallWidth}
                        onChange={(e) => setStallWidth(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="an-stall-l">Stall length (m)</FieldLabel>
                      <Input
                        id="an-stall-l"
                        title="Stall depth into the lot, in meters"
                        type="number"
                        min="0"
                        step="any"
                        value={stallLength}
                        onChange={(e) => setStallLength(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel htmlFor="an-angle">Angle</FieldLabel>
                      <Select value={angle} onValueChange={(v) => v && setAngle(v)}>
                        <SelectTrigger id="an-angle" className="w-full" title="Stall angle">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Stall angle</SelectLabel>
                            <SelectItem value="90">90° (perpendicular)</SelectItem>
                            <SelectItem value="60">60°</SelectItem>
                            <SelectItem value="45">45°</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="an-aisle">Aisle width (m)</FieldLabel>
                      <Input
                        id="an-aisle"
                        title="Drive-aisle width, in meters"
                        type="number"
                        min="0"
                        step="any"
                        value={aisleWidth}
                        onChange={(e) => setAisleWidth(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel htmlFor="an-required">Required stalls</FieldLabel>
                      <Input
                        id="an-required"
                        title="Minimum stalls the site must provide (optional)"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="optional"
                        value={requiredCount}
                        onChange={(e) => setRequiredCount(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="an-accessible">Accessible provided</FieldLabel>
                      <Input
                        id="an-accessible"
                        title="Accessible stalls the design provides — checked against ADA §208 (optional)"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="optional"
                        value={accessibleProvided}
                        onChange={(e) => setAccessibleProvided(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="an-oneway" checked={oneWay} onCheckedChange={setOneWay} />
                    <FieldLabel htmlFor="an-oneway" className="!mb-0">
                      One-way aisle
                    </FieldLabel>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCapturing(false);
                    setVerts([]);
                  }}
                >
                  <IconX className="mr-1 size-4" /> Cancel
                </Button>
                {type === 'TURNING' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={runTurning}
                    disabled={busy || verts.length < 2 || !vehicleId}
                  >
                    <IconPlus className="mr-1 size-4" /> Run
                  </Button>
                ) : type === 'PARKING' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={runParking}
                    disabled={busy || verts.length < 2}
                  >
                    <IconPlus className="mr-1 size-4" /> Run
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={save} disabled={busy}>
                    <IconPlus className="mr-1 size-4" /> Save
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button type="button" onClick={() => setCapturing(true)}>
              <IconPencil className="mr-1 size-4" /> Draw geometry
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Analyses
            <span className="text-muted-foreground ml-2 font-normal">{analyses.length}</span>
          </CardTitle>
          <CardDescription>Click an analysis to highlight its plan geometry.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {analyses.length === 0 ? (
            <p className="text-muted-foreground text-sm">No analyses yet — create one above.</p>
          ) : (
            analyses.map((a) => {
              const active = a.id === activeAnalysisId;
              const count = parsePath(a.inputGeometry).length;
              const v = a.type === 'PARKING' ? null : verdict(a.result);
              const pk = a.type === 'PARKING' ? parkingInfo(a.result) : null;
              return (
                <ListRow
                  key={a.id}
                  selected={active}
                  onClick={() => onSelect(active ? null : a.id)}
                  leading={
                    <Badge variant="outline" className="shrink-0">
                      {TYPE_LABEL[a.type]}
                    </Badge>
                  }
                  title={
                    <span className="flex items-center gap-2">
                      <span className="truncate">{a.name}</span>
                      {v ? (
                        <Badge
                          variant={v === 'pass' ? 'default' : 'destructive'}
                          className="shrink-0"
                        >
                          {v === 'pass' ? 'Pass' : 'Fail'}
                        </Badge>
                      ) : null}
                      {pk ? (
                        <>
                          <Badge variant="secondary" className="shrink-0">
                            {pk.count} stall{pk.count === 1 ? '' : 's'}
                          </Badge>
                          {pk.checked ? (
                            <Badge
                              variant={pk.pass ? 'default' : 'destructive'}
                              className="shrink-0"
                            >
                              {pk.pass ? 'Pass' : 'Fail'}
                            </Badge>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  }
                  subtitle={`${a.status.toLowerCase()} · ${count} pt${count === 1 ? '' : 's'}`}
                  actions={
                    <ButtonGroup>
                      <TooltipIconButton
                        label="Duplicate analysis"
                        disabled={busy}
                        onClick={() => duplicate(a.id)}
                      >
                        <IconCopy className="size-4" />
                      </TooltipIconButton>
                      <TooltipIconButton
                        label="Delete analysis"
                        onClick={() => setPendingDelete(a)}
                      >
                        <IconTrash className="size-4" />
                      </TooltipIconButton>
                    </ButtonGroup>
                  }
                />
              );
            })
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : ''}
        description="This removes the analysis and its drawn geometry."
        onConfirm={() => {
          if (pendingDelete) {
            remove(pendingDelete.id);
          }
        }}
      />
    </div>
  );
}
