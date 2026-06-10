import { EpsgPicker } from '@/components/projects/epsg-picker';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { type LengthUnit, type Project, UNIT_OPTIONS } from '@/lib/types';

/** Controlled form state shared by the create and edit project dialogs. */
export interface ProjectFormValues {
  description: string;
  displayUnit: LengthUnit;
  epsgCode: string;
  lat: string;
  lon: string;
  name: string;
  scale: string;
}

export function emptyProjectForm(): ProjectFormValues {
  return {
    description: '',
    displayUnit: 'US_SURVEY_FOOT',
    epsgCode: '2229',
    lat: '',
    lon: '',
    name: '',
    scale: '1.0',
  };
}

export function projectToForm(p: Project): ProjectFormValues {
  return {
    description: p.description,
    displayUnit: p.displayUnit,
    epsgCode: String(p.epsgCode),
    lat: p.siteOriginLat?.toString() ?? '',
    lon: p.siteOriginLon?.toString() ?? '',
    name: p.name,
    scale: String(p.combinedScaleFactor),
  };
}

/** GraphQL variables derived from the form (numbers parsed, blanks → null). */
export function projectFormVariables(v: ProjectFormValues) {
  return {
    desc: v.description || null,
    epsg: parseInt(v.epsgCode, 10),
    lat: v.lat ? parseFloat(v.lat) : null,
    lon: v.lon ? parseFloat(v.lon) : null,
    name: v.name,
    scale: v.scale ? parseFloat(v.scale) : null,
    unit: v.displayUnit,
  };
}

interface ProjectFormFieldsProps {
  idPrefix: string;
  onChange: (patch: Partial<ProjectFormValues>) => void;
  values: ProjectFormValues;
}

/** The shared field set. Callers own the surrounding <form> and submit button. */
export function ProjectFormFields({ idPrefix, onChange, values }: ProjectFormFieldsProps) {
  const optional = (
    <span className="text-muted-foreground ml-auto text-xs font-normal">Optional</span>
  );
  const scaleNum = parseFloat(values.scale) || 1;
  const scaleClamped = Math.min(1.1, Math.max(0.9, scaleNum));
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {/* Column 1 — identity + unit */}
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
          <Input
            id={`${idPrefix}-name`}
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-desc`} className="w-full">
            Description
            {optional}
          </FieldLabel>
          <Textarea
            id={`${idPrefix}-desc`}
            rows={4}
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-unit`}>Display unit</FieldLabel>
          <Select
            value={values.displayUnit}
            onValueChange={(v) => onChange({ displayUnit: v as LengthUnit })}
          >
            <SelectTrigger id={`${idPrefix}-unit`} className="w-full">
              <SelectValue placeholder="Select a unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Display unit</SelectLabel>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Columns 2–3 — coordinate reference + location */}
      <div className="flex flex-col gap-4 sm:col-span-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-epsg`}>Coordinate reference system</FieldLabel>
          <EpsgPicker
            idPrefix={idPrefix}
            value={values.epsgCode}
            onChange={(code) => onChange({ epsgCode: code })}
          />
          <FieldDescription>EPSG (European Petroleum Survey Group) code.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel className="w-full">
            Scale factor
            <span className="text-muted-foreground ml-auto text-sm tabular-nums">
              {scaleNum.toFixed(6)}
            </span>
          </FieldLabel>
          <Slider
            className="py-2"
            min={0.9}
            max={1.1}
            step={0.000001}
            value={[scaleClamped]}
            onValueChange={(v) => onChange({ scale: String(Array.isArray(v) ? v[0] : v) })}
          />
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>0.900000 (min)</span>
            <span>1.100000 (max)</span>
          </div>
          <FieldDescription>Combined grid-to-ground scale factor.</FieldDescription>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-lat`} className="w-full">
              Site latitude
              {optional}
            </FieldLabel>
            <Input
              id={`${idPrefix}-lat`}
              value={values.lat}
              onChange={(e) => onChange({ lat: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-lon`} className="w-full">
              Site longitude
              {optional}
            </FieldLabel>
            <Input
              id={`${idPrefix}-lon`}
              value={values.lon}
              onChange={(e) => onChange({ lon: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
