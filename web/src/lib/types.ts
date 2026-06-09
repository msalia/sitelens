export type Role = 'ADMIN' | 'SURVEYOR' | 'VIEWER';
export type LengthUnit = 'US_SURVEY_FOOT' | 'INTERNATIONAL_FOOT' | 'METER';
export type GridFamily = 'LETTERED' | 'NUMBERED';

export interface Me {
  email: string;
  emailVerified: boolean;
  id: string;
  orgId: string;
  role: Role;
}

export interface Project {
  combinedScaleFactor: number;
  createdAt: string;
  description: string;
  displayUnit: LengthUnit;
  epsgCode: number;
  id: string;
  name: string;
  siteOriginLat: number | null;
  siteOriginLon: number | null;
  updatedAt: string;
}

export interface GridAxis {
  family: GridFamily;
  id: string;
  label: string;
  position: number;
  projectId: string;
}

export interface ControlPoint {
  easting: number;
  elevation: number | null;
  gridX: number | null;
  gridY: number | null;
  id: string;
  label: string;
  northing: number;
  projectId: string;
  source: string;
}

export interface TransformResidual {
  deltaEasting: number;
  deltaNorthing: number;
  label: string;
  magnitude: number;
}

export interface Transform {
  pointCount: number;
  residuals: TransformResidual[];
  rmsError: number;
  rotationDegrees: number;
  scale: number;
  translationE: number;
  translationN: number;
}

export const UNIT_LABELS: Record<LengthUnit, string> = {
  INTERNATIONAL_FOOT: 'Intl ft',
  METER: 'm',
  US_SURVEY_FOOT: 'US survey ft',
};

export const UNIT_OPTIONS: { value: LengthUnit; label: string }[] = [
  { label: 'US survey foot', value: 'US_SURVEY_FOOT' },
  { label: 'International foot', value: 'INTERNATIONAL_FOOT' },
  { label: 'Meter', value: 'METER' },
];
