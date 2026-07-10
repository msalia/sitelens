export type Role = 'ADMIN' | 'SURVEYOR' | 'VIEWER';
export type LengthUnit = 'US_SURVEY_FOOT' | 'INTERNATIONAL_FOOT' | 'METER';
export type GridFamily = 'LETTERED' | 'NUMBERED';
export type ExportFormat = 'CSV' | 'LANDXML';
export type ExportSpace = 'PROJECTED_GRID' | 'PROJECTED_GROUND' | 'GRID' | 'GEOGRAPHIC';
export type ExportColumn =
  | 'POINT'
  | 'NORTHING'
  | 'EASTING'
  | 'ELEVATION'
  | 'DESCRIPTION'
  | 'LATITUDE'
  | 'LONGITUDE';

export interface Me {
  email: string;
  emailVerified: boolean;
  id: string;
  orgId: string;
  role: Role;
}

export interface Project {
  /** Property boundary polygon as a JSON `[[e,n],…]` string (projected meters); null when unset. */
  boundary: string | null;
  combinedScaleFactor: number;
  createdAt: string;
  description: string;
  displayUnit: LengthUnit;
  epsgCode: number;
  id: string;
  name: string;
  siteOriginLat: number | null;
  siteOriginLon: number | null;
  siteOriginRotationDeg: number;
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

export interface PointCategory {
  color: string;
  icon: string;
  id: string;
  isDefault: boolean;
  name: string;
  orgId: string;
}

export interface SurveyPoint {
  categoryId: string | null;
  description: string;
  easting: number;
  elevation: number | null;
  id: string;
  importBatchId: string | null;
  label: string;
  northing: number;
  projectId: string;
  tags: string[];
}

export interface PointGroup {
  id: string;
  memberIds: string[];
  name: string;
  projectId: string;
}

export interface LatLng {
  height: number;
  latitude: number;
  longitude: number;
}

export interface ScenePoint {
  categoryId: string | null;
  easting: number;
  height: number;
  id: string | null;
  label: string;
  latitude: number;
  longitude: number;
  northing: number;
}

export interface SceneLine {
  coordinates: LatLng[];
  label: string;
}

export interface SceneUtilityRun {
  apwaColor: string;
  diameter: number | null;
  id: string;
  label: string;
  typeKey: string;
  vertices: LatLng[];
}

export interface SceneUtilityStructure {
  apwaColor: string;
  easting: number;
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  northing: number;
  rimElev: number | null;
  typeKey: string;
}

export interface SceneData {
  controlPoints: ScenePoint[];
  gridLines: SceneLine[];
  origin: LatLng | null;
  originProjectedE: number | null;
  originProjectedN: number | null;
  surveyPoints: ScenePoint[];
  utilityRuns: SceneUtilityRun[];
  utilityStructures: SceneUtilityStructure[];
}

export interface EpsgEntry {
  code: number;
  name: string;
}

export interface CadOverlay {
  assumeRealWorld: boolean;
  elevation: number;
  id: string;
  offsetE: number;
  offsetN: number;
  originalFilename: string;
  projectId: string;
  rotationDeg: number;
  scale: number;
  visible: boolean;
}

/** Minimal shape the coordinate inspector needs. */
export interface InspectablePoint {
  easting: number;
  label: string;
  northing: number;
}

export interface CoordinateSet {
  gridX: number | null;
  gridY: number | null;
  latitude: number | null;
  longitude: number | null;
  projectedGridE: number | null;
  projectedGridN: number | null;
  projectedGroundE: number | null;
  projectedGroundN: number | null;
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

export const EXPORT_SPACE_OPTIONS: { value: ExportSpace; label: string }[] = [
  { label: 'Projected (grid)', value: 'PROJECTED_GRID' },
  { label: 'Projected (ground)', value: 'PROJECTED_GROUND' },
  { label: 'Building grid', value: 'GRID' },
  { label: 'Geographic (lat/long)', value: 'GEOGRAPHIC' },
];

export const EXPORT_COLUMN_OPTIONS: { value: ExportColumn; label: string }[] = [
  { label: 'Point', value: 'POINT' },
  { label: 'Northing', value: 'NORTHING' },
  { label: 'Easting', value: 'EASTING' },
  { label: 'Elevation', value: 'ELEVATION' },
  { label: 'Description', value: 'DESCRIPTION' },
  { label: 'Latitude', value: 'LATITUDE' },
  { label: 'Longitude', value: 'LONGITUDE' },
];
