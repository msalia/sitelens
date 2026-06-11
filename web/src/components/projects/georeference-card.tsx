'use client';

import {
  IconArrowsMaximize,
  IconMapPin,
  IconRotateClockwise,
  IconWorldLatitude,
  IconWorldLongitude,
} from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import type { Project } from '@/lib/types';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const UPDATE_GEOREF = graphql(`
  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {
    updateProject(
      id: $id
      combinedScaleFactor: $scale
      siteOriginLat: $lat
      siteOriginLon: $lon
      siteOriginRotationDeg: $rot
    ) {
      id
    }
  }
`);

// Fine-nudge jog ranges, centred on the current value: a tight window of
// latitude/longitude so the sliders give sub-metre control over a value that
// spans the globe. Bases recenter when a value is committed (typed or dragged).
const LATLON_WINDOW = 0.01; // degrees on each side (~1.1 km at the equator)

/** First card in the Overlays tab: fine-tune control of the project's scale,
 * site origin (lat/lon) and rotation. **Save** persists the edits and refreshes
 * the 3D scene. */
export function GeoreferenceCard({
  onSaved,
  project,
}: {
  project: Project;
  /** Called after a successful save so the parent can reload the scene. */
  onSaved: () => void;
}) {
  const [scale, setScale] = useState(project.combinedScaleFactor);
  const [lat, setLat] = useState<number | null>(project.siteOriginLat);
  const [lon, setLon] = useState<number | null>(project.siteOriginLon);
  const [rot, setRot] = useState(project.siteOriginRotationDeg ?? 0);
  const [baseLat, setBaseLat] = useState(project.siteOriginLat ?? 0);
  const [baseLon, setBaseLon] = useState(project.siteOriginLon ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset the draft whenever the saved project changes (e.g. after a save or an
  // edit from the modal) so the card reflects persisted state. Adjusting state
  // during render (vs. an effect) avoids a redundant re-render and is the React-
  // recommended pattern for "reset state when a prop changes".
  const sig = `${project.combinedScaleFactor}|${project.siteOriginLat}|${project.siteOriginLon}|${project.siteOriginRotationDeg}`;
  const [syncedSig, setSyncedSig] = useState(sig);
  if (syncedSig !== sig) {
    setSyncedSig(sig);
    setScale(project.combinedScaleFactor);
    setLat(project.siteOriginLat);
    setLon(project.siteOriginLon);
    setRot(project.siteOriginRotationDeg ?? 0);
    setBaseLat(project.siteOriginLat ?? 0);
    setBaseLon(project.siteOriginLon ?? 0);
    setDirty(false);
  }

  function edit(fn: () => void) {
    fn();
    setDirty(true);
  }

  function reset() {
    setScale(project.combinedScaleFactor);
    setLat(project.siteOriginLat);
    setLon(project.siteOriginLon);
    setRot(project.siteOriginRotationDeg ?? 0);
    setBaseLat(project.siteOriginLat ?? 0);
    setBaseLon(project.siteOriginLon ?? 0);
    setDirty(false);
  }

  async function save() {
    setSaving(true);
    try {
      await gql(UPDATE_GEOREF, { id: project.id, lat, lon, rot, scale });
      toast.success('Georeference saved');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="p-4">
        <CardTitle>Georeference</CardTitle>
        <CardDescription>
          Fine-tune the site scale, origin and rotation. Edits preview in the 3D scene live — save
          to apply them to the project.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <SliderRow
          id="geo-scale"
          label="Scale"
          icon={<IconArrowsMaximize className="size-4" />}
          value={scale}
          min={0.9}
          max={1.1}
          step={0.000001}
          decimals={6}
          suffix="×"
          onChange={(v) => edit(() => setScale(v))}
        />
        <SliderRow
          id="geo-lat"
          label="Latitude"
          icon={<IconWorldLatitude className="size-4" />}
          value={lat}
          base={baseLat}
          window={LATLON_WINDOW}
          step={0.000001}
          decimals={6}
          suffix="°"
          placeholder="Set origin…"
          onChange={(v) => edit(() => setLat(v))}
          onCommit={(v) => setBaseLat(v)}
        />
        <SliderRow
          id="geo-lon"
          label="Longitude"
          icon={<IconWorldLongitude className="size-4" />}
          value={lon}
          base={baseLon}
          window={LATLON_WINDOW}
          step={0.000001}
          decimals={6}
          suffix="°"
          placeholder="Set origin…"
          onChange={(v) => edit(() => setLon(v))}
          onCommit={(v) => setBaseLon(v)}
        />
        <SliderRow
          id="geo-rot"
          label="Rotation"
          icon={<IconRotateClockwise className="size-4" />}
          value={rot}
          min={0}
          max={360}
          step={0.1}
          decimals={1}
          suffix="°"
          onChange={(v) => edit(() => setRot(v))}
        />
        {lat === null || lon === null ? (
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <IconMapPin className="mt-0.5 size-3.5 shrink-0" />
            No site origin yet — type a latitude and longitude to enable the position sliders.
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="gap-2 border-t p-4">
        <Button variant="outline" className="flex-1" disabled={!dirty || saving} onClick={reset}>
          Reset
        </Button>
        <Button className="flex-1" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** One control row: icon + label, a slider, and a synced number input. Pass a
 * `base` + `window` to turn the slider into a fine jog around the current value
 * over an effectively unbounded range (used for latitude/longitude). When
 * `value` is null the slider is disabled until a number is typed. */
function SliderRow({
  base,
  decimals,
  icon,
  id,
  label,
  max,
  min,
  onChange,
  onCommit,
  placeholder,
  step,
  suffix,
  value,
  window: win,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: number | null;
  onChange: (v: number) => void;
  base?: number;
  window?: number;
  min?: number;
  max?: number;
  step: number;
  decimals: number;
  suffix?: string;
  placeholder?: string;
  onCommit?: (v: number) => void;
}) {
  const lo = win !== undefined ? (base ?? 0) - win : (min ?? 0);
  const hi = win !== undefined ? (base ?? 0) + win : (max ?? 100);
  const disabled = value === null;
  // Trim trailing zeros from the readout so 6-dp fields don't look noisy.
  const display = value === null ? '' : Number(value.toFixed(decimals)).toString();
  return (
    <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <label htmlFor={id} className="w-16 shrink-0 text-sm font-medium">
        {label}
      </label>
      <Slider
        className="min-w-0 flex-1"
        value={[value ?? lo]}
        min={lo}
        max={hi}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        onValueCommitted={(v) => onCommit?.(Array.isArray(v) ? v[0] : v)}
      />
      <InputGroup className="w-32 shrink-0">
        <InputGroupInput
          id={id}
          type="number"
          value={display}
          placeholder={placeholder}
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
