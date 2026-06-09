import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-desc`}>Description</Label>
        <Input
          id={`${idPrefix}-desc`}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-epsg`}>EPSG code</Label>
          <Input
            id={`${idPrefix}-epsg`}
            type="number"
            value={values.epsgCode}
            onChange={(e) => onChange({ epsgCode: e.target.value })}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-unit`}>Display unit</Label>
          <NativeSelect
            id={`${idPrefix}-unit`}
            className="w-full"
            value={values.displayUnit}
            onChange={(e) => onChange({ displayUnit: e.target.value as LengthUnit })}
          >
            {UNIT_OPTIONS.map((u) => (
              <NativeSelectOption key={u.value} value={u.value}>
                {u.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-scale`}>Scale factor</Label>
          <Input
            id={`${idPrefix}-scale`}
            value={values.scale}
            onChange={(e) => onChange({ scale: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-lat`}>Site lat</Label>
          <Input
            id={`${idPrefix}-lat`}
            value={values.lat}
            onChange={(e) => onChange({ lat: e.target.value })}
            placeholder="opt."
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-lon`}>Site lon</Label>
          <Input
            id={`${idPrefix}-lon`}
            value={values.lon}
            onChange={(e) => onChange({ lon: e.target.value })}
            placeholder="opt."
          />
        </div>
      </div>
    </>
  );
}
