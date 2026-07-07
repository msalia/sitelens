'use client';

import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { Project, ScenePoint } from '@/lib/types';

import { ConfirmDialog } from '@/components/projects/confirm-dialog';
import { ListRow } from '@/components/projects/list-row';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { fromMeters, toMeters, unitName } from '@/lib/units';

import {
  CREATE_UTILITY_RUN,
  CREATE_UTILITY_STRUCTURE,
  DELETE_UTILITY_RUN,
  DELETE_UTILITY_STRUCTURE,
  UTILITIES,
  UTILITY_TYPES,
} from './utilities-data';

/** One captured node — canonical meters. `label` is display-only provenance. */
type Capture = {
  northing: number;
  easting: number;
  elevation: number | null;
  sourcePointId: string | null;
  label: string;
};

type UtilityType = {
  key: string;
  label: string;
  apwaColor: string;
  defaultGeometry: string;
};
type RunRow = {
  id: string;
  typeKey: string;
  label: string;
  level: string | null;
  diameter: number | null;
  material: string | null;
  length: number | null;
  slope: number | null;
  source: string;
  tags: string[];
  vertices: { seq: number }[];
};
type StructRow = {
  id: string;
  typeKey: string;
  label: string;
  level: string | null;
  rimElev: number | null;
  material: string | null;
  source: string;
  tags: string[];
};

const SOURCE_OPTIONS = [
  ['field_survey', 'Field survey'],
  ['dxf', 'DXF'],
  ['geojson', 'GeoJSON'],
  ['locate_company', 'Locate company'],
  ['other', 'Other'],
] as const;

/** Snap a survey point straight to a canonical-meter capture (no conversion). */
function fromScenePoint(p: ScenePoint): Capture {
  return {
    easting: p.easting,
    elevation: p.height,
    label: p.label,
    northing: p.northing,
    sourcePointId: p.id,
  };
}

export function UtilitiesPanel({
  onDigitizingChange,
  pickRef,
  project,
}: {
  project: Project;
  /** Registers the panel as the sink for scene-marker picks while digitizing. */
  pickRef: React.MutableRefObject<((point: ScenePoint) => void) | null>;
  /** Tells the scene to show/hide the "click points to snap" hint. */
  onDigitizingChange: (on: boolean) => void;
}) {
  const unit = project.displayUnit;
  const [types, setTypes] = useState<UtilityType[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [structures, setStructures] = useState<StructRow[]>([]);
  const [busy, setBusy] = useState(false);

  // Which capture surface is active. Determines what a scene-marker pick does.
  const [mode, setMode] = useState<'idle' | 'run' | 'structure'>('idle');
  const [typeKey, setTypeKey] = useState<string>('');

  // Run builder.
  const [vertices, setVertices] = useState<Capture[]>([]);
  const [runAttrs, setRunAttrs] = useState({
    diameterInches: '',
    invertDown: '',
    invertUp: '',
    label: '',
    level: '',
    material: '',
    source: 'field_survey',
    tags: '',
  });

  // Structure builder.
  const [structPos, setStructPos] = useState<Capture | null>(null);
  const [structAttrs, setStructAttrs] = useState({
    label: '',
    level: '',
    material: '',
    rimElev: '',
    source: 'field_survey',
    tags: '',
  });

  const byKey = useMemo(() => new Map(types.map((t) => [t.key, t])), [types]);

  const loadInventory = useCallback(async () => {
    try {
      const { utilities } = await gql(UTILITIES, { projectId: project.id });
      setRuns(utilities.runs);
      setStructures(utilities.structures);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load utilities');
    }
  }, [project.id]);

  useEffect(() => {
    void (async () => {
      try {
        const { utilityTypes } = await gql(UTILITY_TYPES);
        setTypes(utilityTypes);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load utility types');
      }
      void loadInventory();
    })();
  }, [loadInventory]);

  // Register the scene-marker pick sink for the active mode. Functional updates
  // keep the handler correct without re-subscribing on every capture.
  useEffect(() => {
    if (mode === 'run') {
      pickRef.current = (p) => setVertices((vs) => [...vs, fromScenePoint(p)]);
      onDigitizingChange(true);
    } else if (mode === 'structure') {
      pickRef.current = (p) => setStructPos(fromScenePoint(p));
      onDigitizingChange(true);
    } else {
      pickRef.current = null;
      onDigitizingChange(false);
    }
    return () => {
      pickRef.current = null;
    };
  }, [mode, pickRef, onDigitizingChange]);

  // Clear the scene hint if the panel unmounts mid-capture (leaving the tab).
  const onDigitizingChangeRef = useRef(onDigitizingChange);
  useEffect(() => {
    onDigitizingChangeRef.current = onDigitizingChange;
  }, [onDigitizingChange]);
  useEffect(() => () => onDigitizingChangeRef.current(false), []);

  function startRun() {
    setVertices([]);
    setRunAttrs({
      diameterInches: '',
      invertDown: '',
      invertUp: '',
      label: '',
      level: '',
      material: '',
      source: 'field_survey',
      tags: '',
    });
    setMode('run');
  }
  function startStructure() {
    setStructPos(null);
    setStructAttrs({
      label: '',
      level: '',
      material: '',
      rimElev: '',
      source: 'field_survey',
      tags: '',
    });
    setMode('structure');
  }
  function cancel() {
    setMode('idle');
  }

  const parseTags = (s: string) =>
    s
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  const numOrNull = (s: string) => {
    const n = Number(s);
    return s.trim() === '' || Number.isNaN(n) ? null : n;
  };

  async function saveRun() {
    if (!typeKey) {
      toast.error('Pick a utility type.');
      return;
    }
    if (vertices.length < 2) {
      toast.error('A run needs at least two vertices.');
      return;
    }
    setBusy(true);
    try {
      const invUp = numOrNull(runAttrs.invertUp);
      const invDown = numOrNull(runAttrs.invertDown);
      const dia = numOrNull(runAttrs.diameterInches);
      await gql(CREATE_UTILITY_RUN, {
        input: {
          diameterInches: dia,
          invertDown: invDown === null ? null : toMeters(invDown, unit),
          invertUp: invUp === null ? null : toMeters(invUp, unit),
          label: runAttrs.label.trim() || byKey.get(typeKey)?.label || 'Run',
          level: runAttrs.level.trim() || null,
          material: runAttrs.material.trim() || null,
          source: runAttrs.source,
          tags: parseTags(runAttrs.tags),
          typeKey,
        },
        projectId: project.id,
        vertices: vertices.map((v) => ({
          easting: v.easting,
          elevation: v.elevation,
          northing: v.northing,
          sourcePointId: v.sourcePointId,
        })),
      });
      toast.success('Run captured.');
      setMode('idle');
      void loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save run');
    } finally {
      setBusy(false);
    }
  }

  async function saveStructure() {
    if (!typeKey) {
      toast.error('Pick a utility type.');
      return;
    }
    if (!structPos) {
      toast.error('Snap or enter a position first.');
      return;
    }
    setBusy(true);
    try {
      const rim = numOrNull(structAttrs.rimElev);
      await gql(CREATE_UTILITY_STRUCTURE, {
        input: {
          easting: structPos.easting,
          label: structAttrs.label.trim() || byKey.get(typeKey)?.label || 'Structure',
          level: structAttrs.level.trim() || null,
          material: structAttrs.material.trim() || null,
          northing: structPos.northing,
          rimElev: rim === null ? structPos.elevation : toMeters(rim, unit),
          source: structAttrs.source,
          sourcePointId: structPos.sourcePointId,
          tags: parseTags(structAttrs.tags),
          typeKey,
        },
        projectId: project.id,
      });
      toast.success('Structure captured.');
      setMode('idle');
      void loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save structure');
    } finally {
      setBusy(false);
    }
  }

  async function removeRun(id: string) {
    try {
      await gql(DELETE_UTILITY_RUN, { id });
      void loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete run');
    }
  }
  async function removeStructure(id: string) {
    try {
      await gql(DELETE_UTILITY_STRUCTURE, { id });
      void loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete structure');
    }
  }

  const selectedType = typeKey ? byKey.get(typeKey) : undefined;
  const canRun = !selectedType || selectedType.defaultGeometry !== 'structure';
  const canStructure = !selectedType || selectedType.defaultGeometry !== 'line';

  return (
    <div className="flex flex-col gap-4">
      {mode === 'idle' ? (
        <Card>
          <CardHeader>
            <CardTitle>Utilities</CardTitle>
            <CardDescription>
              Capture as-built utility runs and structures. Snap to survey points in the 3D
              scene, or enter exact coordinates.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="ut-type">Utility type</FieldLabel>
              <Select value={typeKey} onValueChange={(v) => v && setTypeKey(v)}>
                <SelectTrigger id="ut-type" className="w-full">
                  <SelectValue placeholder="Choose a type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Utility type</SelectLabel>
                    {types.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        <span
                          className="mr-1 inline-block size-2.5 rounded-full align-middle"
                          style={{ backgroundColor: t.apwaColor }}
                        />
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <ButtonGroup>
              <Button
                type="button"
                variant="outline"
                disabled={!typeKey || !canRun}
                onClick={startRun}
              >
                <IconPlus className="size-4" /> New run
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!typeKey || !canStructure}
                onClick={startStructure}
              >
                <IconPlus className="size-4" /> New structure
              </Button>
            </ButtonGroup>
          </CardContent>
        </Card>
      ) : null}

      {mode === 'run' ? (
        <RunBuilder
          typeLabel={selectedType?.label ?? typeKey}
          typeColor={selectedType?.apwaColor}
          unit={unit}
          vertices={vertices}
          setVertices={setVertices}
          attrs={runAttrs}
          setAttrs={setRunAttrs}
          busy={busy}
          onSave={saveRun}
          onCancel={cancel}
        />
      ) : null}

      {mode === 'structure' ? (
        <StructureBuilder
          typeLabel={selectedType?.label ?? typeKey}
          typeColor={selectedType?.apwaColor}
          unit={unit}
          pos={structPos}
          setPos={setStructPos}
          attrs={structAttrs}
          setAttrs={setStructAttrs}
          busy={busy}
          onSave={saveStructure}
          onCancel={cancel}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Inventory
            <span className="text-muted-foreground ml-2 font-normal">
              {runs.length} run{runs.length === 1 ? '' : 's'} · {structures.length} structure
              {structures.length === 1 ? '' : 's'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {runs.length === 0 && structures.length === 0 ? (
            <p className="text-muted-foreground text-xs">No utilities captured yet.</p>
          ) : null}
          {runs.map((r) => (
            <InventoryRow
              key={r.id}
              color={byKey.get(r.typeKey)?.apwaColor}
              title={r.label}
              subtitle={[
                byKey.get(r.typeKey)?.label ?? r.typeKey,
                `${r.vertices.length} pts`,
                r.length !== null ? `${fromMeters(r.length, unit).toFixed(2)} ${unitName(unit)}` : null,
                r.diameter !== null ? `Ø ${(r.diameter / 0.0254).toFixed(1)}"` : null,
                ...r.tags,
              ]
                .filter(Boolean)
                .join(' · ')}
              onDelete={() => removeRun(r.id)}
              kind="run"
            />
          ))}
          {structures.map((s) => (
            <InventoryRow
              key={s.id}
              color={byKey.get(s.typeKey)?.apwaColor}
              title={s.label}
              subtitle={[
                byKey.get(s.typeKey)?.label ?? s.typeKey,
                'structure',
                s.rimElev !== null
                  ? `rim ${fromMeters(s.rimElev, unit).toFixed(2)} ${unitName(unit)}`
                  : null,
                ...s.tags,
              ]
                .filter(Boolean)
                .join(' · ')}
              onDelete={() => removeStructure(s.id)}
              kind="structure"
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryRow({
  color,
  kind,
  onDelete,
  subtitle,
  title,
}: {
  color?: string;
  title: string;
  subtitle: string;
  kind: 'run' | 'structure';
  onDelete: () => void;
}) {
  return (
    <ListRow
      leading={
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: color ?? '#94a3b8' }}
        />
      }
      title={title}
      subtitle={subtitle}
      actions={
        <ConfirmDialog
          title={`Delete this ${kind}?`}
          description="This removes it from the inventory. The audit trail is preserved."
          onConfirm={onDelete}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${title}`}>
              <IconTrash className="size-4" />
            </Button>
          }
        />
      }
    />
  );
}

/** Shared numeric coordinate entry (display unit → the parent converts nothing;
 *  it hands back canonical meters). Used to add a vertex or set a structure. */
function CoordEntry({
  addLabel,
  onAdd,
  unit,
}: {
  unit: Project['displayUnit'];
  onAdd: (c: Capture) => void;
  addLabel: string;
}) {
  const [e, setE] = useState('');
  const [n, setN] = useState('');
  const [z, setZ] = useState('');
  const u = unitName(unit);
  function add() {
    const en = Number(e);
    const nn = Number(n);
    if (Number.isNaN(en) || Number.isNaN(nn) || e.trim() === '' || n.trim() === '') {
      toast.error('Enter easting and northing.');
      return;
    }
    const zn = z.trim() === '' ? null : Number(z);
    onAdd({
      easting: toMeters(en, unit),
      elevation: zn === null || Number.isNaN(zn) ? null : toMeters(zn, unit),
      label: 'Manual',
      northing: toMeters(nn, unit),
      sourcePointId: null,
    });
    setE('');
    setN('');
    setZ('');
  }
  return (
    <div className="flex items-end gap-1.5">
      <Field className="flex-1">
        <FieldLabel className="text-[10px]">Easting ({u})</FieldLabel>
        <Input
          aria-label="Easting"
          value={e}
          onChange={(ev) => setE(ev.target.value)}
          inputMode="decimal"
        />
      </Field>
      <Field className="flex-1">
        <FieldLabel className="text-[10px]">Northing ({u})</FieldLabel>
        <Input
          aria-label="Northing"
          value={n}
          onChange={(ev) => setN(ev.target.value)}
          inputMode="decimal"
        />
      </Field>
      <Field className="flex-1">
        <FieldLabel className="text-[10px]">Elev ({u})</FieldLabel>
        <Input
          aria-label="Elevation"
          value={z}
          onChange={(ev) => setZ(ev.target.value)}
          inputMode="decimal"
        />
      </Field>
      <Button type="button" variant="secondary" size="sm" onClick={add}>
        {addLabel}
      </Button>
    </div>
  );
}

function SourceSelect({
  id,
  onChange,
  value,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Source</FieldLabel>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Source</SelectLabel>
            {SOURCE_OPTIONS.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

type RunAttrs = {
  label: string;
  level: string;
  diameterInches: string;
  material: string;
  invertUp: string;
  invertDown: string;
  tags: string;
  source: string;
};

function RunBuilder({
  attrs,
  busy,
  onCancel,
  onSave,
  setAttrs,
  setVertices,
  typeColor,
  typeLabel,
  unit,
  vertices,
}: {
  typeLabel: string;
  typeColor?: string;
  unit: Project['displayUnit'];
  vertices: Capture[];
  setVertices: React.Dispatch<React.SetStateAction<Capture[]>>;
  attrs: RunAttrs;
  setAttrs: React.Dispatch<React.SetStateAction<RunAttrs>>;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const u = unitName(unit);
  const set = (k: keyof RunAttrs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAttrs((a) => ({ ...a, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: typeColor }} />
          New run · {typeLabel}
        </CardTitle>
        <CardDescription>
          Click survey points in the scene to add vertices, or enter coordinates. A run needs
          at least two.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {vertices.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No vertices yet — click points in the 3D scene or add by coordinates below.
            </p>
          ) : (
            vertices.map((v, i) => (
              <div
                key={i}
                className="bg-muted/40 flex items-center gap-2 rounded px-2 py-1 text-xs"
              >
                <span className="text-muted-foreground w-5 tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">
                  {v.label} · E {fromMeters(v.easting, unit).toFixed(2)} · N{' '}
                  {fromMeters(v.northing, unit).toFixed(2)}
                  {v.elevation !== null ? ` · Z ${fromMeters(v.elevation, unit).toFixed(2)}` : ''}
                </span>
                <button
                  type="button"
                  aria-label={`Remove vertex ${i + 1}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setVertices((vs) => vs.filter((_, j) => j !== i))}
                >
                  <IconX className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
        <CoordEntry unit={unit} onAdd={(c) => setVertices((vs) => [...vs, c])} addLabel="Add" />

        <div className="grid grid-cols-2 gap-2">
          <Field className="col-span-2">
            <FieldLabel htmlFor="ut-run-label">Label</FieldLabel>
            <Input id="ut-run-label" value={attrs.label} onChange={set('label')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-run-dia">Diameter (in)</FieldLabel>
            <Input
              id="ut-run-dia"
              value={attrs.diameterInches}
              onChange={set('diameterInches')}
              inputMode="decimal"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-run-mat">Material</FieldLabel>
            <Input id="ut-run-mat" value={attrs.material} onChange={set('material')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-run-iu">Invert up ({u})</FieldLabel>
            <Input
              id="ut-run-iu"
              value={attrs.invertUp}
              onChange={set('invertUp')}
              inputMode="decimal"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-run-id">Invert down ({u})</FieldLabel>
            <Input
              id="ut-run-id"
              value={attrs.invertDown}
              onChange={set('invertDown')}
              inputMode="decimal"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-run-level">Level</FieldLabel>
            <Input id="ut-run-level" value={attrs.level} onChange={set('level')} />
          </Field>
          <SourceSelect
            id="ut-run-source"
            value={attrs.source}
            onChange={(v) => setAttrs((a) => ({ ...a, source: v }))}
          />
          <Field className="col-span-2">
            <FieldLabel htmlFor="ut-run-tags">Tags (comma-separated)</FieldLabel>
            <Input id="ut-run-tags" value={attrs.tags} onChange={set('tags')} />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={busy || vertices.length < 2}>
            Save run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type StructAttrs = {
  label: string;
  level: string;
  rimElev: string;
  material: string;
  tags: string;
  source: string;
};

function StructureBuilder({
  attrs,
  busy,
  onCancel,
  onSave,
  pos,
  setAttrs,
  setPos,
  typeColor,
  typeLabel,
  unit,
}: {
  typeLabel: string;
  typeColor?: string;
  unit: Project['displayUnit'];
  pos: Capture | null;
  setPos: React.Dispatch<React.SetStateAction<Capture | null>>;
  attrs: StructAttrs;
  setAttrs: React.Dispatch<React.SetStateAction<StructAttrs>>;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const u = unitName(unit);
  const set = (k: keyof StructAttrs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAttrs((a) => ({ ...a, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: typeColor }} />
          New structure · {typeLabel}
        </CardTitle>
        <CardDescription>
          Click a survey point in the scene to set the position, or enter coordinates.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pos ? (
          <div className="bg-muted/40 flex items-center gap-2 rounded px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {pos.label} · E {fromMeters(pos.easting, unit).toFixed(2)} · N{' '}
              {fromMeters(pos.northing, unit).toFixed(2)}
              {pos.elevation !== null ? ` · Z ${fromMeters(pos.elevation, unit).toFixed(2)}` : ''}
            </span>
            <button
              type="button"
              aria-label="Clear position"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setPos(null)}
            >
              <IconX className="size-3.5" />
            </button>
          </div>
        ) : (
          <CoordEntry unit={unit} onAdd={setPos} addLabel="Set" />
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field className="col-span-2">
            <FieldLabel htmlFor="ut-st-label">Label</FieldLabel>
            <Input id="ut-st-label" value={attrs.label} onChange={set('label')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-st-rim">Rim elev ({u})</FieldLabel>
            <Input
              id="ut-st-rim"
              value={attrs.rimElev}
              onChange={set('rimElev')}
              inputMode="decimal"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-st-mat">Material</FieldLabel>
            <Input id="ut-st-mat" value={attrs.material} onChange={set('material')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ut-st-level">Level</FieldLabel>
            <Input id="ut-st-level" value={attrs.level} onChange={set('level')} />
          </Field>
          <SourceSelect
            id="ut-st-source"
            value={attrs.source}
            onChange={(v) => setAttrs((a) => ({ ...a, source: v }))}
          />
          <Field className="col-span-2">
            <FieldLabel htmlFor="ut-st-tags">Tags (comma-separated)</FieldLabel>
            <Input id="ut-st-tags" value={attrs.tags} onChange={set('tags')} />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={busy || !pos}>
            Save structure
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
