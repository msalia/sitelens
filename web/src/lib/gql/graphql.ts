/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** The design-point set an as-built import is compared against. */
export type BaselineScope =
  | 'ALL'
  | 'CATEGORY'
  | 'GROUP';

/** Billing interval for a Crew subscription. */
export type BillingInterval =
  | 'ANNUAL'
  | 'MONTHLY';

/** Which point attribute becomes the exported feature code. */
export type CodeField =
  /** The point's category name. */
  | 'CATEGORY'
  /** The point's free-text description (default). */
  | 'DESCRIPTION';

/** Tolerance classification of a compared point. */
export type ComparisonStatus =
  | 'FAIL'
  | 'NO_VERTICAL'
  | 'PASS'
  | 'UNMATCHED'
  | 'WARN';

/** The space an input coordinate is expressed in (GraphQL enum). */
export type CoordinateSpace =
  /**
   * Geographic input: `x` is longitude, `y` is latitude (degrees); `unit` is
   * ignored. Derives projected/grid/ground via the project's CRS + transform.
   */
  | 'GEOGRAPHIC'
  | 'GRID'
  | 'PROJECTED';

/** CSV column mapping (0-based indices). */
export type CsvMappingInput = {
  descriptionCol?: number | null | undefined;
  eastingCol: number;
  elevationCol?: number | null | undefined;
  hasHeader: boolean;
  labelCol?: number | null | undefined;
  northingCol: number;
};

/** A selectable CSV column (caller chooses inclusion + order). */
export type ExportColumn =
  | 'DESCRIPTION'
  | 'EASTING'
  | 'ELEVATION'
  | 'LATITUDE'
  | 'LONGITUDE'
  | 'NORTHING'
  | 'POINT';

export type ExportFormat =
  | 'CSV'
  | 'LANDXML';

/** Which coordinate space the exported northing/easting are in. */
export type ExportSpace =
  | 'GEOGRAPHIC'
  | 'GRID'
  | 'PROJECTED_GRID'
  | 'PROJECTED_GROUND';

/** The field file formats SiteLens can encode and decode. */
export type FieldFormat =
  | 'CSV'
  | 'JOB_XML'
  | 'LAND_XML';

/** How an as-built row was paired to a design point. */
export type FieldMatchMethod =
  | 'MANUAL'
  | 'NUMBER'
  | 'UNMATCHED';

/** Input for replacing the grid. `position` is expressed in `unit`. */
export type GridAxisInput = {
  family: GridFamily;
  label: string;
  position: number;
};

/** Which family a grid axis belongs to. */
export type GridFamily =
  | 'LETTERED'
  | 'NUMBERED';

/** Import file format. */
export type ImportFormat =
  | 'CSV'
  | 'LANDXML';

/** A length unit used at I/O boundaries. The canonical internal unit is meters. */
export type LengthUnit =
  | 'INTERNATIONAL_FOOT'
  | 'METER'
  | 'US_SURVEY_FOOT';

/** The subscription plans. Binary today: free `Solo` vs paid `Crew`. */
export type Plan =
  /** Paid tier. */
  | 'CREW'
  /** Free tier. */
  | 'SOLO';

/** In-org role. The string values match the `users.role` CHECK constraint. */
export type Role =
  | 'ADMIN'
  | 'SURVEYOR'
  | 'VIEWER';

/**
 * Run attributes on create/update. All optional; on update, omitted fields keep
 * their current value. `diameter_inches` is stored canonical (meters).
 */
export type UtilityRunInput = {
  asBuiltDate?: unknown;
  /** JSON object string. */
  attrsExtra?: string | null | undefined;
  condition?: string | null | undefined;
  diameterInches?: number | null | undefined;
  installDate?: unknown;
  invertDown?: number | null | undefined;
  invertUp?: number | null | undefined;
  label?: string | null | undefined;
  level?: string | null | undefined;
  locateMethod?: string | null | undefined;
  material?: string | null | undefined;
  owner?: string | null | undefined;
  source?: string | null | undefined;
  tags?: Array<string> | null | undefined;
  typeKey?: string | null | undefined;
};

/** Structure attributes on create/update. Position is required on create. */
export type UtilityStructureInput = {
  asBuiltDate?: unknown;
  attrsExtra?: string | null | undefined;
  condition?: string | null | undefined;
  easting?: number | null | undefined;
  /** JSON array string. */
  inverts?: string | null | undefined;
  label?: string | null | undefined;
  level?: string | null | undefined;
  locateMethod?: string | null | undefined;
  material?: string | null | undefined;
  northing?: number | null | undefined;
  owner?: string | null | undefined;
  rimElev?: number | null | undefined;
  source?: string | null | undefined;
  sourcePointId?: string | null | undefined;
  tags?: Array<string> | null | undefined;
  typeKey?: string | null | undefined;
};

/** One vertex on capture. `seq` is the array position; coords are canonical meters. */
export type UtilityVertexInput = {
  easting: number;
  elevation?: number | null | undefined;
  northing: number;
  sourcePointId?: string | null | undefined;
};

export type WorkspaceQueryVariables = Exact<{
  id: string;
}>;


export type WorkspaceQuery = { surveyPointCount: number, project: { id: string, orgId: string, name: string, description: string, epsgCode: number, displayUnit: LengthUnit, combinedScaleFactor: number, siteOriginLat: number | null, siteOriginLon: number | null, siteOriginRotationDeg: number, createdAt: string, updatedAt: string } | null, gridAxes: Array<{ id: string, projectId: string, family: GridFamily, label: string, position: number }>, controlPoints: Array<{ id: string, projectId: string, label: string, northing: number, easting: number, elevation: number | null, gridX: number | null, gridY: number | null, source: string }>, transform: { translationE: number, translationN: number, rotationDegrees: number, scale: number, rmsError: number, pointCount: number, residuals: Array<{ label: string, deltaEasting: number, deltaNorthing: number, magnitude: number }> } | null, categories: Array<{ id: string, orgId: string, name: string, color: string, icon: string, isDefault: boolean }>, cadOverlays: Array<{ id: string, projectId: string, originalFilename: string, offsetE: number, offsetN: number, rotationDeg: number, scale: number, elevation: number, assumeRealWorld: boolean, visible: boolean }> };

export type ProjectsQueryVariables = Exact<{ [key: string]: never; }>;


export type ProjectsQuery = { projects: Array<{ id: string, orgId: string, name: string, description: string, epsgCode: number, displayUnit: LengthUnit, combinedScaleFactor: number, siteOriginLat: number | null, siteOriginLon: number | null, siteOriginRotationDeg: number, createdAt: string, updatedAt: string }> };

export type DeleteProjectMutationVariables = Exact<{
  id: string;
}>;


export type DeleteProjectMutation = { deleteProject: boolean };

export type BillingMeQueryVariables = Exact<{ [key: string]: never; }>;


export type BillingMeQuery = { me: { id: string, orgId: string, email: string, role: Role, emailVerified: boolean } | null };

export type SettingsDataQueryVariables = Exact<{ [key: string]: never; }>;


export type SettingsDataQuery = { me: { id: string, orgId: string, email: string, role: Role, emailVerified: boolean } | null, organization: { id: string, name: string } };

export type DeleteOrganizationMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteOrganizationMutation = { deleteOrganization: boolean };

export type UsersMeQueryVariables = Exact<{ [key: string]: never; }>;


export type UsersMeQuery = { me: { id: string, orgId: string, email: string, role: Role, emailVerified: boolean } | null };

export type OrgMembersQueryVariables = Exact<{ [key: string]: never; }>;


export type OrgMembersQuery = { orgMembers: Array<{ id: string, email: string, role: Role, status: string, createdAt: string }> };

export type InviteUserMutationVariables = Exact<{
  email: string;
  role: Role;
}>;


export type InviteUserMutation = { inviteUser: { user: { id: string } } };

export type UpdateUserRoleMutationVariables = Exact<{
  userId: string;
  role: Role;
}>;


export type UpdateUserRoleMutation = { updateUserRole: { id: string } };

export type AdminResetPasswordMutationVariables = Exact<{
  userId: string;
}>;


export type AdminResetPasswordMutation = { adminResetPassword: boolean };

export type RemoveUserMutationVariables = Exact<{
  userId: string;
}>;


export type RemoveUserMutation = { removeUser: boolean };

export type AcceptInviteMutationVariables = Exact<{
  t: string;
  p: string;
}>;


export type AcceptInviteMutation = { acceptInvite: { id: string } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { id: string, orgId: string, email: string, role: Role, emailVerified: boolean } | null };

export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutMutation = { logout: boolean };

export type RequestPasswordResetMutationVariables = Exact<{
  e: string;
}>;


export type RequestPasswordResetMutation = { requestPasswordReset: boolean };

export type LoginMutationVariables = Exact<{
  e: string;
  p: string;
}>;


export type LoginMutation = { login: { id: string } };

export type ResendVerificationMutationVariables = Exact<{
  e: string;
}>;


export type ResendVerificationMutation = { resendVerification: boolean };

export type AddSurveyPointMutationVariables = Exact<{
  projectId: string;
  label: string;
  space: CoordinateSpace;
  x: number;
  y: number;
  elevation?: number | null | undefined;
  description?: string | null | undefined;
  categoryId?: string | null | undefined;
  unit: LengthUnit;
}>;


export type AddSurveyPointMutation = { addSurveyPoint: { id: string } };

export type UploadDxfMutationVariables = Exact<{
  id: string;
  f: string;
  c: string;
}>;


export type UploadDxfMutation = { uploadDxf: { id: string } };

export type SetCadGeoreferenceMutationVariables = Exact<{
  id: string;
  oe?: number | null | undefined;
  on?: number | null | undefined;
  rot?: number | null | undefined;
  sc?: number | null | undefined;
  el?: number | null | undefined;
  vis?: boolean | null | undefined;
}>;


export type SetCadGeoreferenceMutation = { setCadGeoreference: { id: string } };

export type DeleteCadOverlayMutationVariables = Exact<{
  id: string;
}>;


export type DeleteCadOverlayMutation = { deleteCadOverlay: boolean };

export type SiteProjectedQueryVariables = Exact<{
  id: string;
  lon: number;
  lat: number;
}>;


export type SiteProjectedQuery = { convertCoordinate: { projectedGridE: number | null, projectedGridN: number | null } };

export type CadOverlayGeomQueryVariables = Exact<{
  id: string;
}>;


export type CadOverlayGeomQuery = { cadOverlayGeometry: { polylines: Array<{ layer: string, points: Array<{ x: number, y: number }> }> } };

export type OverlayScenePointsQueryVariables = Exact<{
  id: string;
}>;


export type OverlayScenePointsQuery = { sceneData: { controlPoints: Array<{ easting: number, northing: number }>, surveyPoints: Array<{ easting: number, northing: number }> } };

export type CreateCategoryMutationVariables = Exact<{
  name: string;
  color: string;
  icon: string;
}>;


export type CreateCategoryMutation = { createCategory: { id: string } };

export type DeleteCategoryMutationVariables = Exact<{
  id: string;
}>;


export type DeleteCategoryMutation = { deleteCategory: boolean };

export type AddControlPointMutationVariables = Exact<{
  id: string;
  label: string;
  n: number;
  e: number;
  z?: number | null | undefined;
  gx?: number | null | undefined;
  gy?: number | null | undefined;
  unit: LengthUnit;
  src?: string | null | undefined;
}>;


export type AddControlPointMutation = { addControlPoint: { id: string } };

export type UpdateControlPointMutationVariables = Exact<{
  id: string;
  label?: string | null | undefined;
  n?: number | null | undefined;
  e?: number | null | undefined;
  z?: number | null | undefined;
  gx?: number | null | undefined;
  gy?: number | null | undefined;
  unit: LengthUnit;
  src?: string | null | undefined;
}>;


export type UpdateControlPointMutation = { updateControlPoint: { id: string } };

export type DeleteControlPointMutationVariables = Exact<{
  id: string;
}>;


export type DeleteControlPointMutation = { deleteControlPoint: boolean };

export type StandaloneConvertQueryVariables = Exact<{
  id: string;
  space: CoordinateSpace;
  x: number;
  y: number;
  unit: LengthUnit;
}>;


export type StandaloneConvertQuery = { convertCoordinate: { gridX: number | null, gridY: number | null, projectedGridE: number | null, projectedGridN: number | null, projectedGroundE: number | null, projectedGroundN: number | null, latitude: number | null, longitude: number | null } };

export type ConvertCoordinateQueryVariables = Exact<{
  id: string;
  x: number;
  y: number;
}>;


export type ConvertCoordinateQuery = { convertCoordinate: { gridX: number | null, gridY: number | null, projectedGridE: number | null, projectedGridN: number | null, projectedGroundE: number | null, projectedGroundN: number | null, latitude: number | null, longitude: number | null } };

export type CreateProjectMutationVariables = Exact<{
  name: string;
  desc?: string | null | undefined;
  epsg: number;
  unit: LengthUnit;
  scale?: number | null | undefined;
  lat?: number | null | undefined;
  lon?: number | null | undefined;
  rot?: number | null | undefined;
}>;


export type CreateProjectMutation = { createProject: { id: string } };

export type UpdateProjectMutationVariables = Exact<{
  id: string;
  name?: string | null | undefined;
  desc?: string | null | undefined;
  epsg?: number | null | undefined;
  unit?: LengthUnit | null | undefined;
  scale?: number | null | undefined;
  lat?: number | null | undefined;
  lon?: number | null | undefined;
  rot?: number | null | undefined;
}>;


export type UpdateProjectMutation = { updateProject: { id: string } };

export type UpdateSurveyPointMutationVariables = Exact<{
  id: string;
  label?: string | null | undefined;
  description?: string | null | undefined;
  categoryId?: string | null | undefined;
}>;


export type UpdateSurveyPointMutation = { updateSurveyPoint: { id: string } };

export type SearchEpsgQueryVariables = Exact<{
  q: string;
  limit?: number | null | undefined;
}>;


export type SearchEpsgQuery = { searchEpsg: Array<{ code: number, name: string }> };

export type ExportPointsQueryVariables = Exact<{
  id: string;
  format: ExportFormat;
  space: ExportSpace;
  unit: LengthUnit;
  columns?: Array<ExportColumn> | ExportColumn | null | undefined;
  pointIds?: Array<string> | string | null | undefined;
  categoryId?: string | null | undefined;
}>;


export type ExportPointsQuery = { exportPoints: string };

export type ProjectExportQueryVariables = Exact<{
  id: string;
}>;


export type ProjectExportQuery = { projectExport: string };

export type FieldExportPresetsQueryVariables = Exact<{ [key: string]: never; }>;


export type FieldExportPresetsQuery = { fieldExportPresets: Array<{ id: string, app: string, format: FieldFormat, defaultSpace: ExportSpace, defaultUnit: LengthUnit, description: string }> };

export type ExportFieldQueryVariables = Exact<{
  id: string;
  presetId: string;
  space?: ExportSpace | null | undefined;
  unit?: LengthUnit | null | undefined;
  categoryId?: string | null | undefined;
  codeField?: CodeField | null | undefined;
}>;


export type ExportFieldQuery = { exportField: { filename: string, mimeType: string, contentBase64: string } };

export type DetectFieldFormatMutationVariables = Exact<{
  content: string;
}>;


export type DetectFieldFormatMutation = { detectFieldFormat: { format: FieldFormat, needsMapping: boolean } };

export type ImportAsBuiltMutationVariables = Exact<{
  id: string;
  content: string;
  filename?: string | null | undefined;
  format?: FieldFormat | null | undefined;
  presetId?: string | null | undefined;
  space?: ExportSpace | null | undefined;
  unit?: LengthUnit | null | undefined;
  baselineScope?: BaselineScope | null | undefined;
  baselineRefId?: string | null | undefined;
}>;


export type ImportAsBuiltMutation = { importAsBuilt: { id: string } };

export type AsBuiltBatchesQueryVariables = Exact<{
  id: string;
}>;


export type AsBuiltBatchesQuery = { asBuiltBatches: Array<{ id: string, sourceFilename: string, format: FieldFormat, baselineScope: BaselineScope, reportUnit: LengthUnit, createdAt: string }> };

export type ComparisonQueryVariables = Exact<{
  batchId: string;
}>;


export type ComparisonQuery = { comparison: { batch: { id: string, sourceFilename: string, reportUnit: LengthUnit, createdAt: string }, summary: { pass: number, warn: number, fail: number, unmatched: number, noVertical: number, maxMiss: number | null, rmsMiss: number | null }, rows: Array<{ id: string, asBuiltLabel: string, asBuiltN: number, asBuiltE: number, asBuiltZ: number | null, designPointId: string | null, designN: number | null, designE: number | null, designZ: number | null, matchMethod: FieldMatchMethod, deltaN: number | null, deltaE: number | null, deltaZ: number | null, deltaHRadial: number | null, deltaGridN: number | null, deltaGridE: number | null, status: ComparisonStatus, asBuiltLatitude: number | null, asBuiltLongitude: number | null, asBuiltHeight: number | null, designLatitude: number | null, designLongitude: number | null, designHeight: number | null }> } };

export type ComparisonReportCsvQueryVariables = Exact<{
  batchId: string;
}>;


export type ComparisonReportCsvQuery = { comparisonReportCsv: { filename: string, mimeType: string, contentBase64: string } };

export type ComparisonReportPdfQueryVariables = Exact<{
  batchId: string;
}>;


export type ComparisonReportPdfQuery = { comparisonReportPdf: { filename: string, mimeType: string, contentBase64: string } };

export type RepairComparisonMutationVariables = Exact<{
  batchId: string;
  compId: string;
  designPointId: string;
}>;


export type RepairComparisonMutation = { repairComparison: { id: string } };

export type DeleteAsBuiltBatchMutationVariables = Exact<{
  batchId: string;
}>;


export type DeleteAsBuiltBatchMutation = { deleteAsBuiltBatch: boolean };

export type DesignPointsForPairingQueryVariables = Exact<{
  id: string;
}>;


export type DesignPointsForPairingQuery = { surveyPoints: Array<{ id: string, label: string }> };

export type UpdateGeoreferenceMutationVariables = Exact<{
  id: string;
  scale?: number | null | undefined;
  lat?: number | null | undefined;
  lon?: number | null | undefined;
  rot?: number | null | undefined;
}>;


export type UpdateGeoreferenceMutation = { updateProject: { id: string } };

export type SetGridAxesMutationVariables = Exact<{
  id: string;
  unit: LengthUnit;
  axes: Array<GridAxisInput> | GridAxisInput;
}>;


export type SetGridAxesMutation = { setGridAxes: Array<{ id: string }> };

export type GroupManagerGroupsQueryVariables = Exact<{
  id: string;
}>;


export type GroupManagerGroupsQuery = { pointGroups: Array<{ id: string, projectId: string, name: string, memberIds: Array<string> }> };

export type GroupManagerCreateMutationVariables = Exact<{
  id: string;
  name: string;
  ids: Array<string> | string;
}>;


export type GroupManagerCreateMutation = { createPointGroup: { id: string } };

export type GroupManagerDeleteMutationVariables = Exact<{
  id: string;
}>;


export type GroupManagerDeleteMutation = { deletePointGroup: boolean };

export type ImportPointsMutationVariables = Exact<{
  id: string;
  format: ImportFormat;
  content: string;
  unit: LengthUnit;
  mapping?: CsvMappingInput | null | undefined;
  filename?: string | null | undefined;
  categoryId?: string | null | undefined;
  profile?: string | null | undefined;
}>;


export type ImportPointsMutation = { importPoints: { rowCount: number } };

export type ImportProjectMutationVariables = Exact<{
  content: string;
}>;


export type ImportProjectMutation = { importProject: { id: string, name: string } };

export type SceneQueryVariables = Exact<{
  id: string;
}>;


export type SceneQuery = { sceneData: { originProjectedE: number | null, originProjectedN: number | null, origin: { latitude: number, longitude: number, height: number } | null, controlPoints: Array<{ id: string | null, label: string, latitude: number, longitude: number, height: number, easting: number, northing: number, categoryId: string | null }>, surveyPoints: Array<{ id: string | null, label: string, latitude: number, longitude: number, height: number, easting: number, northing: number, categoryId: string | null }>, gridLines: Array<{ label: string, coordinates: Array<{ latitude: number, longitude: number, height: number }> }> }, projectTerrain: { demtype: string, fetchedAt: string } | null, projectBuildings: { count: number, fetchedAt: string } | null, cadOverlays: Array<{ id: string, offsetE: number, offsetN: number, rotationDeg: number, scale: number, elevation: number, visible: boolean }>, pointGroups: Array<{ id: string, name: string, memberIds: Array<string> }> };

export type TerrainContentQueryVariables = Exact<{
  id: string;
}>;


export type TerrainContentQuery = { projectTerrainContent: string };

export type BuildingsContentQueryVariables = Exact<{
  id: string;
}>;


export type BuildingsContentQuery = { projectBuildingsContent: string };

export type OverlayGeometryQueryVariables = Exact<{
  id: string;
}>;


export type OverlayGeometryQuery = { cadOverlayGeometry: { layers: Array<string>, polylines: Array<{ layer: string, points: Array<{ x: number, y: number }> }> } };

export type RefreshTerrainMutationVariables = Exact<{
  id: string;
  south: number;
  north: number;
  west: number;
  east: number;
  force?: boolean | null | undefined;
}>;


export type RefreshTerrainMutation = { refreshTerrain: { demtype: string, fetchedAt: string } };

export type RefreshBuildingsMutationVariables = Exact<{
  id: string;
  south: number;
  north: number;
  west: number;
  east: number;
  force?: boolean | null | undefined;
}>;


export type RefreshBuildingsMutation = { refreshBuildings: { count: number, fetchedAt: string } };

export type SurveyPointsQueryVariables = Exact<{
  id: string;
  search?: string | null | undefined;
  cat?: string | null | undefined;
  group?: string | null | undefined;
  limit?: number | null | undefined;
  offset?: number | null | undefined;
  sort?: string | null | undefined;
  descending?: boolean | null | undefined;
}>;


export type SurveyPointsQuery = { surveyPointCount: number, surveyPoints: Array<{ id: string, projectId: string, label: string, northing: number, easting: number, elevation: number | null, description: string, categoryId: string | null, tags: Array<string>, importBatchId: string | null }> };

export type DeleteSurveyPointMutationVariables = Exact<{
  id: string;
}>;


export type DeleteSurveyPointMutation = { deleteSurveyPoint: boolean };

export type DeleteSurveyPointsMutationVariables = Exact<{
  ids: Array<string> | string;
}>;


export type DeleteSurveyPointsMutation = { deleteSurveyPoints: number };

export type AssignCategoryMutationVariables = Exact<{
  ids: Array<string> | string;
  cat?: string | null | undefined;
}>;


export type AssignCategoryMutation = { assignCategory: number };

export type CreatePointGroupMutationVariables = Exact<{
  id: string;
  name: string;
  ids: Array<string> | string;
}>;


export type CreatePointGroupMutation = { createPointGroup: { id: string } };

export type PointGroupsQueryVariables = Exact<{
  id: string;
}>;


export type PointGroupsQuery = { pointGroups: Array<{ id: string, projectId: string, name: string, memberIds: Array<string> }> };

export type AddPointsToGroupMutationVariables = Exact<{
  groupId: string;
  ids: Array<string> | string;
}>;


export type AddPointsToGroupMutation = { addPointsToGroup: { id: string, memberIds: Array<string> } };

export type SolveTransformMutationVariables = Exact<{
  id: string;
}>;


export type SolveTransformMutation = { solveTransform: { translationE: number, translationN: number, rotationDegrees: number, scale: number, rmsError: number, pointCount: number, residuals: Array<{ label: string, deltaEasting: number, deltaNorthing: number, magnitude: number }> } };

export type UtilityTypesQueryVariables = Exact<{ [key: string]: never; }>;


export type UtilityTypesQuery = { utilityTypes: Array<{ key: string, label: string, apwaColor: string, defaultGeometry: string }> };

export type UtilitiesQueryVariables = Exact<{
  projectId: string;
  typeKey?: string | null | undefined;
  level?: string | null | undefined;
  search?: string | null | undefined;
}>;


export type UtilitiesQuery = { utilities: { runs: Array<{ id: string, typeKey: string, label: string, level: string | null, diameter: number | null, material: string | null, invertUp: number | null, invertDown: number | null, slope: number | null, length: number | null, source: string, tags: Array<string>, vertices: Array<{ seq: number, northing: number, easting: number, elevation: number | null, sourcePointId: string | null }> }>, structures: Array<{ id: string, typeKey: string, label: string, level: string | null, northing: number, easting: number, rimElev: number | null, material: string | null, source: string, tags: Array<string> }> } };

export type CreateUtilityRunMutationVariables = Exact<{
  projectId: string;
  input: UtilityRunInput;
  vertices: Array<UtilityVertexInput> | UtilityVertexInput;
}>;


export type CreateUtilityRunMutation = { createUtilityRun: { id: string } };

export type CreateUtilityStructureMutationVariables = Exact<{
  projectId: string;
  input: UtilityStructureInput;
}>;


export type CreateUtilityStructureMutation = { createUtilityStructure: { id: string } };

export type DeleteUtilityRunMutationVariables = Exact<{
  id: string;
}>;


export type DeleteUtilityRunMutation = { deleteUtilityRun: boolean };

export type DeleteUtilityStructureMutationVariables = Exact<{
  id: string;
}>;


export type DeleteUtilityStructureMutation = { deleteUtilityStructure: boolean };

export type ResetPasswordMutationVariables = Exact<{
  t: string;
  p: string;
}>;


export type ResetPasswordMutation = { resetPassword: boolean };

export type SignupMutationVariables = Exact<{
  e: string;
  p: string;
  o: string;
}>;


export type SignupMutation = { signup: { verificationToken: string } };

export type VerifyEmailMutationVariables = Exact<{
  t: string;
}>;


export type VerifyEmailMutation = { verifyEmail: boolean };

export type BillingQueryVariables = Exact<{ [key: string]: never; }>;


export type BillingQuery = { billing: { plan: string, status: string | null, currentPeriodEnd: string | null, cancelAtPeriodEnd: boolean, restricted: boolean, canExport: boolean, projects: number, admins: number, nonAdmin: number, maxProjects: number, maxAdmins: number, maxNonAdmin: number, adminEmails: Array<string> } };

export type CreateCheckoutSessionMutationVariables = Exact<{
  interval: BillingInterval;
}>;


export type CreateCheckoutSessionMutation = { createCheckoutSession: string };

export type CreateBillingPortalSessionMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateBillingPortalSessionMutation = { createBillingPortalSession: string };

export type PlanCatalogQueryVariables = Exact<{ [key: string]: never; }>;


export type PlanCatalogQuery = { planCatalog: { features: Array<{ key: string, label: string, blurb: string, minPlan: Plan }>, plans: Array<{ plan: Plan, maxProjects: number, maxAdmins: number, maxNonAdmin: number }> } };

export type ProjectChangedSubscriptionVariables = Exact<{
  projectId: string;
}>;


export type ProjectChangedSubscription = { projectChanged: string };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const WorkspaceDocument = new TypedDocumentString(`
    query Workspace($id: UUID!) {
  project(id: $id) {
    id
    orgId
    name
    description
    epsgCode
    displayUnit
    combinedScaleFactor
    siteOriginLat
    siteOriginLon
    siteOriginRotationDeg
    createdAt
    updatedAt
  }
  gridAxes(projectId: $id) {
    id
    projectId
    family
    label
    position
  }
  controlPoints(projectId: $id) {
    id
    projectId
    label
    northing
    easting
    elevation
    gridX
    gridY
    source
  }
  transform(projectId: $id) {
    translationE
    translationN
    rotationDegrees
    scale
    rmsError
    pointCount
    residuals {
      label
      deltaEasting
      deltaNorthing
      magnitude
    }
  }
  categories {
    id
    orgId
    name
    color
    icon
    isDefault
  }
  cadOverlays(projectId: $id) {
    id
    projectId
    originalFilename
    offsetE
    offsetN
    rotationDeg
    scale
    elevation
    assumeRealWorld
    visible
  }
  surveyPointCount(projectId: $id)
}
    `) as unknown as TypedDocumentString<WorkspaceQuery, WorkspaceQueryVariables>;
export const ProjectsDocument = new TypedDocumentString(`
    query Projects {
  projects {
    id
    orgId
    name
    description
    epsgCode
    displayUnit
    combinedScaleFactor
    siteOriginLat
    siteOriginLon
    siteOriginRotationDeg
    createdAt
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<ProjectsQuery, ProjectsQueryVariables>;
export const DeleteProjectDocument = new TypedDocumentString(`
    mutation DeleteProject($id: UUID!) {
  deleteProject(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteProjectMutation, DeleteProjectMutationVariables>;
export const BillingMeDocument = new TypedDocumentString(`
    query BillingMe {
  me {
    id
    orgId
    email
    role
    emailVerified
  }
}
    `) as unknown as TypedDocumentString<BillingMeQuery, BillingMeQueryVariables>;
export const SettingsDataDocument = new TypedDocumentString(`
    query SettingsData {
  me {
    id
    orgId
    email
    role
    emailVerified
  }
  organization {
    id
    name
  }
}
    `) as unknown as TypedDocumentString<SettingsDataQuery, SettingsDataQueryVariables>;
export const DeleteOrganizationDocument = new TypedDocumentString(`
    mutation DeleteOrganization {
  deleteOrganization
}
    `) as unknown as TypedDocumentString<DeleteOrganizationMutation, DeleteOrganizationMutationVariables>;
export const UsersMeDocument = new TypedDocumentString(`
    query UsersMe {
  me {
    id
    orgId
    email
    role
    emailVerified
  }
}
    `) as unknown as TypedDocumentString<UsersMeQuery, UsersMeQueryVariables>;
export const OrgMembersDocument = new TypedDocumentString(`
    query OrgMembers {
  orgMembers {
    id
    email
    role
    status
    createdAt
  }
}
    `) as unknown as TypedDocumentString<OrgMembersQuery, OrgMembersQueryVariables>;
export const InviteUserDocument = new TypedDocumentString(`
    mutation InviteUser($email: String!, $role: Role!) {
  inviteUser(email: $email, role: $role) {
    user {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<InviteUserMutation, InviteUserMutationVariables>;
export const UpdateUserRoleDocument = new TypedDocumentString(`
    mutation UpdateUserRole($userId: UUID!, $role: Role!) {
  updateUserRole(userId: $userId, role: $role) {
    id
  }
}
    `) as unknown as TypedDocumentString<UpdateUserRoleMutation, UpdateUserRoleMutationVariables>;
export const AdminResetPasswordDocument = new TypedDocumentString(`
    mutation AdminResetPassword($userId: UUID!) {
  adminResetPassword(userId: $userId)
}
    `) as unknown as TypedDocumentString<AdminResetPasswordMutation, AdminResetPasswordMutationVariables>;
export const RemoveUserDocument = new TypedDocumentString(`
    mutation RemoveUser($userId: UUID!) {
  removeUser(userId: $userId)
}
    `) as unknown as TypedDocumentString<RemoveUserMutation, RemoveUserMutationVariables>;
export const AcceptInviteDocument = new TypedDocumentString(`
    mutation AcceptInvite($t: String!, $p: String!) {
  acceptInvite(token: $t, password: $p) {
    id
  }
}
    `) as unknown as TypedDocumentString<AcceptInviteMutation, AcceptInviteMutationVariables>;
export const MeDocument = new TypedDocumentString(`
    query Me {
  me {
    id
    orgId
    email
    role
    emailVerified
  }
}
    `) as unknown as TypedDocumentString<MeQuery, MeQueryVariables>;
export const LogoutDocument = new TypedDocumentString(`
    mutation Logout {
  logout
}
    `) as unknown as TypedDocumentString<LogoutMutation, LogoutMutationVariables>;
export const RequestPasswordResetDocument = new TypedDocumentString(`
    mutation RequestPasswordReset($e: String!) {
  requestPasswordReset(email: $e)
}
    `) as unknown as TypedDocumentString<RequestPasswordResetMutation, RequestPasswordResetMutationVariables>;
export const LoginDocument = new TypedDocumentString(`
    mutation Login($e: String!, $p: String!) {
  login(email: $e, password: $p) {
    id
  }
}
    `) as unknown as TypedDocumentString<LoginMutation, LoginMutationVariables>;
export const ResendVerificationDocument = new TypedDocumentString(`
    mutation ResendVerification($e: String!) {
  resendVerification(email: $e)
}
    `) as unknown as TypedDocumentString<ResendVerificationMutation, ResendVerificationMutationVariables>;
export const AddSurveyPointDocument = new TypedDocumentString(`
    mutation AddSurveyPoint($projectId: UUID!, $label: String!, $space: CoordinateSpace!, $x: Float!, $y: Float!, $elevation: Float, $description: String, $categoryId: UUID, $unit: LengthUnit!) {
  addSurveyPoint(
    projectId: $projectId
    label: $label
    space: $space
    x: $x
    y: $y
    elevation: $elevation
    description: $description
    categoryId: $categoryId
    unit: $unit
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<AddSurveyPointMutation, AddSurveyPointMutationVariables>;
export const UploadDxfDocument = new TypedDocumentString(`
    mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {
  uploadDxf(projectId: $id, filename: $f, content: $c) {
    id
  }
}
    `) as unknown as TypedDocumentString<UploadDxfMutation, UploadDxfMutationVariables>;
export const SetCadGeoreferenceDocument = new TypedDocumentString(`
    mutation SetCadGeoreference($id: UUID!, $oe: Float, $on: Float, $rot: Float, $sc: Float, $el: Float, $vis: Boolean) {
  setCadGeoreference(
    id: $id
    offsetE: $oe
    offsetN: $on
    rotationDeg: $rot
    scale: $sc
    elevation: $el
    visible: $vis
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<SetCadGeoreferenceMutation, SetCadGeoreferenceMutationVariables>;
export const DeleteCadOverlayDocument = new TypedDocumentString(`
    mutation DeleteCadOverlay($id: UUID!) {
  deleteCadOverlay(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteCadOverlayMutation, DeleteCadOverlayMutationVariables>;
export const SiteProjectedDocument = new TypedDocumentString(`
    query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {
  convertCoordinate(
    projectId: $id
    space: GEOGRAPHIC
    x: $lon
    y: $lat
    unit: METER
  ) {
    projectedGridE
    projectedGridN
  }
}
    `) as unknown as TypedDocumentString<SiteProjectedQuery, SiteProjectedQueryVariables>;
export const CadOverlayGeomDocument = new TypedDocumentString(`
    query CadOverlayGeom($id: UUID!) {
  cadOverlayGeometry(id: $id) {
    polylines {
      layer
      points {
        x
        y
      }
    }
  }
}
    `) as unknown as TypedDocumentString<CadOverlayGeomQuery, CadOverlayGeomQueryVariables>;
export const OverlayScenePointsDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<OverlayScenePointsQuery, OverlayScenePointsQueryVariables>;
export const CreateCategoryDocument = new TypedDocumentString(`
    mutation CreateCategory($name: String!, $color: String!, $icon: String!) {
  createCategory(name: $name, color: $color, icon: $icon) {
    id
  }
}
    `) as unknown as TypedDocumentString<CreateCategoryMutation, CreateCategoryMutationVariables>;
export const DeleteCategoryDocument = new TypedDocumentString(`
    mutation DeleteCategory($id: UUID!) {
  deleteCategory(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteCategoryMutation, DeleteCategoryMutationVariables>;
export const AddControlPointDocument = new TypedDocumentString(`
    mutation AddControlPoint($id: UUID!, $label: String!, $n: Float!, $e: Float!, $z: Float, $gx: Float, $gy: Float, $unit: LengthUnit!, $src: String) {
  addControlPoint(
    projectId: $id
    label: $label
    northing: $n
    easting: $e
    elevation: $z
    gridX: $gx
    gridY: $gy
    unit: $unit
    source: $src
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<AddControlPointMutation, AddControlPointMutationVariables>;
export const UpdateControlPointDocument = new TypedDocumentString(`
    mutation UpdateControlPoint($id: UUID!, $label: String, $n: Float, $e: Float, $z: Float, $gx: Float, $gy: Float, $unit: LengthUnit!, $src: String) {
  updateControlPoint(
    id: $id
    label: $label
    northing: $n
    easting: $e
    elevation: $z
    gridX: $gx
    gridY: $gy
    unit: $unit
    source: $src
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<UpdateControlPointMutation, UpdateControlPointMutationVariables>;
export const DeleteControlPointDocument = new TypedDocumentString(`
    mutation DeleteControlPoint($id: UUID!) {
  deleteControlPoint(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteControlPointMutation, DeleteControlPointMutationVariables>;
export const StandaloneConvertDocument = new TypedDocumentString(`
    query StandaloneConvert($id: UUID!, $space: CoordinateSpace!, $x: Float!, $y: Float!, $unit: LengthUnit!) {
  convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {
    gridX
    gridY
    projectedGridE
    projectedGridN
    projectedGroundE
    projectedGroundN
    latitude
    longitude
  }
}
    `) as unknown as TypedDocumentString<StandaloneConvertQuery, StandaloneConvertQueryVariables>;
export const ConvertCoordinateDocument = new TypedDocumentString(`
    query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {
  convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {
    gridX
    gridY
    projectedGridE
    projectedGridN
    projectedGroundE
    projectedGroundN
    latitude
    longitude
  }
}
    `) as unknown as TypedDocumentString<ConvertCoordinateQuery, ConvertCoordinateQueryVariables>;
export const CreateProjectDocument = new TypedDocumentString(`
    mutation CreateProject($name: String!, $desc: String, $epsg: Int!, $unit: LengthUnit!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {
  createProject(
    name: $name
    description: $desc
    epsgCode: $epsg
    displayUnit: $unit
    combinedScaleFactor: $scale
    siteOriginLat: $lat
    siteOriginLon: $lon
    siteOriginRotationDeg: $rot
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<CreateProjectMutation, CreateProjectMutationVariables>;
export const UpdateProjectDocument = new TypedDocumentString(`
    mutation UpdateProject($id: UUID!, $name: String, $desc: String, $epsg: Int, $unit: LengthUnit, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {
  updateProject(
    id: $id
    name: $name
    description: $desc
    epsgCode: $epsg
    displayUnit: $unit
    combinedScaleFactor: $scale
    siteOriginLat: $lat
    siteOriginLon: $lon
    siteOriginRotationDeg: $rot
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<UpdateProjectMutation, UpdateProjectMutationVariables>;
export const UpdateSurveyPointDocument = new TypedDocumentString(`
    mutation UpdateSurveyPoint($id: UUID!, $label: String, $description: String, $categoryId: UUID) {
  updateSurveyPoint(
    id: $id
    label: $label
    description: $description
    categoryId: $categoryId
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<UpdateSurveyPointMutation, UpdateSurveyPointMutationVariables>;
export const SearchEpsgDocument = new TypedDocumentString(`
    query SearchEpsg($q: String!, $limit: Int) {
  searchEpsg(query: $q, limit: $limit) {
    code
    name
  }
}
    `) as unknown as TypedDocumentString<SearchEpsgQuery, SearchEpsgQueryVariables>;
export const ExportPointsDocument = new TypedDocumentString(`
    query ExportPoints($id: UUID!, $format: ExportFormat!, $space: ExportSpace!, $unit: LengthUnit!, $columns: [ExportColumn!], $pointIds: [UUID!], $categoryId: UUID) {
  exportPoints(
    projectId: $id
    format: $format
    space: $space
    unit: $unit
    columns: $columns
    pointIds: $pointIds
    categoryId: $categoryId
  )
}
    `) as unknown as TypedDocumentString<ExportPointsQuery, ExportPointsQueryVariables>;
export const ProjectExportDocument = new TypedDocumentString(`
    query ProjectExport($id: UUID!) {
  projectExport(projectId: $id)
}
    `) as unknown as TypedDocumentString<ProjectExportQuery, ProjectExportQueryVariables>;
export const FieldExportPresetsDocument = new TypedDocumentString(`
    query FieldExportPresets {
  fieldExportPresets {
    id
    app
    format
    defaultSpace
    defaultUnit
    description
  }
}
    `) as unknown as TypedDocumentString<FieldExportPresetsQuery, FieldExportPresetsQueryVariables>;
export const ExportFieldDocument = new TypedDocumentString(`
    query ExportField($id: UUID!, $presetId: String!, $space: ExportSpace, $unit: LengthUnit, $categoryId: UUID, $codeField: CodeField) {
  exportField(
    projectId: $id
    presetId: $presetId
    space: $space
    unit: $unit
    categoryId: $categoryId
    codeField: $codeField
  ) {
    filename
    mimeType
    contentBase64
  }
}
    `) as unknown as TypedDocumentString<ExportFieldQuery, ExportFieldQueryVariables>;
export const DetectFieldFormatDocument = new TypedDocumentString(`
    mutation DetectFieldFormat($content: String!) {
  detectFieldFormat(contentBase64: $content) {
    format
    needsMapping
  }
}
    `) as unknown as TypedDocumentString<DetectFieldFormatMutation, DetectFieldFormatMutationVariables>;
export const ImportAsBuiltDocument = new TypedDocumentString(`
    mutation ImportAsBuilt($id: UUID!, $content: String!, $filename: String, $format: FieldFormat, $presetId: String, $space: ExportSpace, $unit: LengthUnit, $baselineScope: BaselineScope, $baselineRefId: UUID) {
  importAsBuilt(
    projectId: $id
    contentBase64: $content
    filename: $filename
    format: $format
    presetId: $presetId
    space: $space
    unit: $unit
    baselineScope: $baselineScope
    baselineRefId: $baselineRefId
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<ImportAsBuiltMutation, ImportAsBuiltMutationVariables>;
export const AsBuiltBatchesDocument = new TypedDocumentString(`
    query AsBuiltBatches($id: UUID!) {
  asBuiltBatches(projectId: $id) {
    id
    sourceFilename
    format
    baselineScope
    reportUnit
    createdAt
  }
}
    `) as unknown as TypedDocumentString<AsBuiltBatchesQuery, AsBuiltBatchesQueryVariables>;
export const ComparisonDocument = new TypedDocumentString(`
    query Comparison($batchId: UUID!) {
  comparison(batchId: $batchId) {
    batch {
      id
      sourceFilename
      reportUnit
      createdAt
    }
    summary {
      pass
      warn
      fail
      unmatched
      noVertical
      maxMiss
      rmsMiss
    }
    rows {
      id
      asBuiltLabel
      asBuiltN
      asBuiltE
      asBuiltZ
      designPointId
      designN
      designE
      designZ
      matchMethod
      deltaN
      deltaE
      deltaZ
      deltaHRadial
      deltaGridN
      deltaGridE
      status
      asBuiltLatitude
      asBuiltLongitude
      asBuiltHeight
      designLatitude
      designLongitude
      designHeight
    }
  }
}
    `) as unknown as TypedDocumentString<ComparisonQuery, ComparisonQueryVariables>;
export const ComparisonReportCsvDocument = new TypedDocumentString(`
    query ComparisonReportCsv($batchId: UUID!) {
  comparisonReportCsv(batchId: $batchId) {
    filename
    mimeType
    contentBase64
  }
}
    `) as unknown as TypedDocumentString<ComparisonReportCsvQuery, ComparisonReportCsvQueryVariables>;
export const ComparisonReportPdfDocument = new TypedDocumentString(`
    query ComparisonReportPdf($batchId: UUID!) {
  comparisonReportPdf(batchId: $batchId) {
    filename
    mimeType
    contentBase64
  }
}
    `) as unknown as TypedDocumentString<ComparisonReportPdfQuery, ComparisonReportPdfQueryVariables>;
export const RepairComparisonDocument = new TypedDocumentString(`
    mutation RepairComparison($batchId: UUID!, $compId: UUID!, $designPointId: UUID!) {
  repairComparison(
    batchId: $batchId
    asBuiltCompId: $compId
    designPointId: $designPointId
  ) {
    id
  }
}
    `) as unknown as TypedDocumentString<RepairComparisonMutation, RepairComparisonMutationVariables>;
export const DeleteAsBuiltBatchDocument = new TypedDocumentString(`
    mutation DeleteAsBuiltBatch($batchId: UUID!) {
  deleteAsBuiltBatch(batchId: $batchId)
}
    `) as unknown as TypedDocumentString<DeleteAsBuiltBatchMutation, DeleteAsBuiltBatchMutationVariables>;
export const DesignPointsForPairingDocument = new TypedDocumentString(`
    query DesignPointsForPairing($id: UUID!) {
  surveyPoints(projectId: $id, limit: 1000) {
    id
    label
  }
}
    `) as unknown as TypedDocumentString<DesignPointsForPairingQuery, DesignPointsForPairingQueryVariables>;
export const UpdateGeoreferenceDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<UpdateGeoreferenceMutation, UpdateGeoreferenceMutationVariables>;
export const SetGridAxesDocument = new TypedDocumentString(`
    mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {
  setGridAxes(projectId: $id, unit: $unit, axes: $axes) {
    id
  }
}
    `) as unknown as TypedDocumentString<SetGridAxesMutation, SetGridAxesMutationVariables>;
export const GroupManagerGroupsDocument = new TypedDocumentString(`
    query GroupManagerGroups($id: UUID!) {
  pointGroups(projectId: $id) {
    id
    projectId
    name
    memberIds
  }
}
    `) as unknown as TypedDocumentString<GroupManagerGroupsQuery, GroupManagerGroupsQueryVariables>;
export const GroupManagerCreateDocument = new TypedDocumentString(`
    mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {
  createPointGroup(projectId: $id, name: $name, memberIds: $ids) {
    id
  }
}
    `) as unknown as TypedDocumentString<GroupManagerCreateMutation, GroupManagerCreateMutationVariables>;
export const GroupManagerDeleteDocument = new TypedDocumentString(`
    mutation GroupManagerDelete($id: UUID!) {
  deletePointGroup(id: $id)
}
    `) as unknown as TypedDocumentString<GroupManagerDeleteMutation, GroupManagerDeleteMutationVariables>;
export const ImportPointsDocument = new TypedDocumentString(`
    mutation ImportPoints($id: UUID!, $format: ImportFormat!, $content: String!, $unit: LengthUnit!, $mapping: CsvMappingInput, $filename: String, $categoryId: UUID, $profile: String) {
  importPoints(
    projectId: $id
    format: $format
    content: $content
    unit: $unit
    mapping: $mapping
    sourceFilename: $filename
    categoryId: $categoryId
    saveProfileName: $profile
  ) {
    rowCount
  }
}
    `) as unknown as TypedDocumentString<ImportPointsMutation, ImportPointsMutationVariables>;
export const ImportProjectDocument = new TypedDocumentString(`
    mutation ImportProject($content: String!) {
  importProject(content: $content) {
    id
    name
  }
}
    `) as unknown as TypedDocumentString<ImportProjectMutation, ImportProjectMutationVariables>;
export const SceneDocument = new TypedDocumentString(`
    query Scene($id: UUID!) {
  sceneData(projectId: $id) {
    origin {
      latitude
      longitude
      height
    }
    originProjectedE
    originProjectedN
    controlPoints {
      id
      label
      latitude
      longitude
      height
      easting
      northing
      categoryId
    }
    surveyPoints {
      id
      label
      latitude
      longitude
      height
      easting
      northing
      categoryId
    }
    gridLines {
      label
      coordinates {
        latitude
        longitude
        height
      }
    }
  }
  projectTerrain(projectId: $id) {
    demtype
    fetchedAt
  }
  projectBuildings(projectId: $id) {
    count
    fetchedAt
  }
  cadOverlays(projectId: $id) {
    id
    offsetE
    offsetN
    rotationDeg
    scale
    elevation
    visible
  }
  pointGroups(projectId: $id) {
    id
    name
    memberIds
  }
}
    `) as unknown as TypedDocumentString<SceneQuery, SceneQueryVariables>;
export const TerrainContentDocument = new TypedDocumentString(`
    query TerrainContent($id: UUID!) {
  projectTerrainContent(projectId: $id)
}
    `) as unknown as TypedDocumentString<TerrainContentQuery, TerrainContentQueryVariables>;
export const BuildingsContentDocument = new TypedDocumentString(`
    query BuildingsContent($id: UUID!) {
  projectBuildingsContent(projectId: $id)
}
    `) as unknown as TypedDocumentString<BuildingsContentQuery, BuildingsContentQueryVariables>;
export const OverlayGeometryDocument = new TypedDocumentString(`
    query OverlayGeometry($id: UUID!) {
  cadOverlayGeometry(id: $id) {
    layers
    polylines {
      layer
      points {
        x
        y
      }
    }
  }
}
    `) as unknown as TypedDocumentString<OverlayGeometryQuery, OverlayGeometryQueryVariables>;
export const RefreshTerrainDocument = new TypedDocumentString(`
    mutation RefreshTerrain($id: UUID!, $south: Float!, $north: Float!, $west: Float!, $east: Float!, $force: Boolean) {
  refreshTerrain(
    projectId: $id
    south: $south
    north: $north
    west: $west
    east: $east
    force: $force
  ) {
    demtype
    fetchedAt
  }
}
    `) as unknown as TypedDocumentString<RefreshTerrainMutation, RefreshTerrainMutationVariables>;
export const RefreshBuildingsDocument = new TypedDocumentString(`
    mutation RefreshBuildings($id: UUID!, $south: Float!, $north: Float!, $west: Float!, $east: Float!, $force: Boolean) {
  refreshBuildings(
    projectId: $id
    south: $south
    north: $north
    west: $west
    east: $east
    force: $force
  ) {
    count
    fetchedAt
  }
}
    `) as unknown as TypedDocumentString<RefreshBuildingsMutation, RefreshBuildingsMutationVariables>;
export const SurveyPointsDocument = new TypedDocumentString(`
    query SurveyPoints($id: UUID!, $search: String, $cat: UUID, $group: UUID, $limit: Int, $offset: Int, $sort: String, $descending: Boolean) {
  surveyPoints(
    projectId: $id
    search: $search
    categoryId: $cat
    groupId: $group
    limit: $limit
    offset: $offset
    sort: $sort
    descending: $descending
  ) {
    id
    projectId
    label
    northing
    easting
    elevation
    description
    categoryId
    tags
    importBatchId
  }
  surveyPointCount(
    projectId: $id
    search: $search
    categoryId: $cat
    groupId: $group
  )
}
    `) as unknown as TypedDocumentString<SurveyPointsQuery, SurveyPointsQueryVariables>;
export const DeleteSurveyPointDocument = new TypedDocumentString(`
    mutation DeleteSurveyPoint($id: UUID!) {
  deleteSurveyPoint(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteSurveyPointMutation, DeleteSurveyPointMutationVariables>;
export const DeleteSurveyPointsDocument = new TypedDocumentString(`
    mutation DeleteSurveyPoints($ids: [UUID!]!) {
  deleteSurveyPoints(ids: $ids)
}
    `) as unknown as TypedDocumentString<DeleteSurveyPointsMutation, DeleteSurveyPointsMutationVariables>;
export const AssignCategoryDocument = new TypedDocumentString(`
    mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {
  assignCategory(ids: $ids, categoryId: $cat)
}
    `) as unknown as TypedDocumentString<AssignCategoryMutation, AssignCategoryMutationVariables>;
export const CreatePointGroupDocument = new TypedDocumentString(`
    mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {
  createPointGroup(projectId: $id, name: $name, memberIds: $ids) {
    id
  }
}
    `) as unknown as TypedDocumentString<CreatePointGroupMutation, CreatePointGroupMutationVariables>;
export const PointGroupsDocument = new TypedDocumentString(`
    query PointGroups($id: UUID!) {
  pointGroups(projectId: $id) {
    id
    projectId
    name
    memberIds
  }
}
    `) as unknown as TypedDocumentString<PointGroupsQuery, PointGroupsQueryVariables>;
export const AddPointsToGroupDocument = new TypedDocumentString(`
    mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {
  addPointsToGroup(groupId: $groupId, memberIds: $ids) {
    id
    memberIds
  }
}
    `) as unknown as TypedDocumentString<AddPointsToGroupMutation, AddPointsToGroupMutationVariables>;
export const SolveTransformDocument = new TypedDocumentString(`
    mutation SolveTransform($id: UUID!) {
  solveTransform(projectId: $id) {
    translationE
    translationN
    rotationDegrees
    scale
    rmsError
    pointCount
    residuals {
      label
      deltaEasting
      deltaNorthing
      magnitude
    }
  }
}
    `) as unknown as TypedDocumentString<SolveTransformMutation, SolveTransformMutationVariables>;
export const UtilityTypesDocument = new TypedDocumentString(`
    query UtilityTypes {
  utilityTypes {
    key
    label
    apwaColor
    defaultGeometry
  }
}
    `) as unknown as TypedDocumentString<UtilityTypesQuery, UtilityTypesQueryVariables>;
export const UtilitiesDocument = new TypedDocumentString(`
    query Utilities($projectId: UUID!, $typeKey: String, $level: String, $search: String) {
  utilities(
    projectId: $projectId
    typeKey: $typeKey
    level: $level
    search: $search
  ) {
    runs {
      id
      typeKey
      label
      level
      diameter
      material
      invertUp
      invertDown
      slope
      length
      source
      tags
      vertices {
        seq
        northing
        easting
        elevation
        sourcePointId
      }
    }
    structures {
      id
      typeKey
      label
      level
      northing
      easting
      rimElev
      material
      source
      tags
    }
  }
}
    `) as unknown as TypedDocumentString<UtilitiesQuery, UtilitiesQueryVariables>;
export const CreateUtilityRunDocument = new TypedDocumentString(`
    mutation CreateUtilityRun($projectId: UUID!, $input: UtilityRunInput!, $vertices: [UtilityVertexInput!]!) {
  createUtilityRun(projectId: $projectId, input: $input, vertices: $vertices) {
    id
  }
}
    `) as unknown as TypedDocumentString<CreateUtilityRunMutation, CreateUtilityRunMutationVariables>;
export const CreateUtilityStructureDocument = new TypedDocumentString(`
    mutation CreateUtilityStructure($projectId: UUID!, $input: UtilityStructureInput!) {
  createUtilityStructure(projectId: $projectId, input: $input) {
    id
  }
}
    `) as unknown as TypedDocumentString<CreateUtilityStructureMutation, CreateUtilityStructureMutationVariables>;
export const DeleteUtilityRunDocument = new TypedDocumentString(`
    mutation DeleteUtilityRun($id: UUID!) {
  deleteUtilityRun(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteUtilityRunMutation, DeleteUtilityRunMutationVariables>;
export const DeleteUtilityStructureDocument = new TypedDocumentString(`
    mutation DeleteUtilityStructure($id: UUID!) {
  deleteUtilityStructure(id: $id)
}
    `) as unknown as TypedDocumentString<DeleteUtilityStructureMutation, DeleteUtilityStructureMutationVariables>;
export const ResetPasswordDocument = new TypedDocumentString(`
    mutation ResetPassword($t: String!, $p: String!) {
  resetPassword(token: $t, newPassword: $p)
}
    `) as unknown as TypedDocumentString<ResetPasswordMutation, ResetPasswordMutationVariables>;
export const SignupDocument = new TypedDocumentString(`
    mutation Signup($e: String!, $p: String!, $o: String!) {
  signup(email: $e, password: $p, orgName: $o) {
    verificationToken
  }
}
    `) as unknown as TypedDocumentString<SignupMutation, SignupMutationVariables>;
export const VerifyEmailDocument = new TypedDocumentString(`
    mutation VerifyEmail($t: String!) {
  verifyEmail(token: $t)
}
    `) as unknown as TypedDocumentString<VerifyEmailMutation, VerifyEmailMutationVariables>;
export const BillingDocument = new TypedDocumentString(`
    query Billing {
  billing {
    plan
    status
    currentPeriodEnd
    cancelAtPeriodEnd
    restricted
    canExport
    projects
    admins
    nonAdmin
    maxProjects
    maxAdmins
    maxNonAdmin
    adminEmails
  }
}
    `) as unknown as TypedDocumentString<BillingQuery, BillingQueryVariables>;
export const CreateCheckoutSessionDocument = new TypedDocumentString(`
    mutation CreateCheckoutSession($interval: BillingInterval!) {
  createCheckoutSession(interval: $interval)
}
    `) as unknown as TypedDocumentString<CreateCheckoutSessionMutation, CreateCheckoutSessionMutationVariables>;
export const CreateBillingPortalSessionDocument = new TypedDocumentString(`
    mutation CreateBillingPortalSession {
  createBillingPortalSession
}
    `) as unknown as TypedDocumentString<CreateBillingPortalSessionMutation, CreateBillingPortalSessionMutationVariables>;
export const PlanCatalogDocument = new TypedDocumentString(`
    query PlanCatalog {
  planCatalog {
    features {
      key
      label
      blurb
      minPlan
    }
    plans {
      plan
      maxProjects
      maxAdmins
      maxNonAdmin
    }
  }
}
    `) as unknown as TypedDocumentString<PlanCatalogQuery, PlanCatalogQueryVariables>;
export const ProjectChangedDocument = new TypedDocumentString(`
    subscription ProjectChanged($projectId: UUID!) {
  projectChanged(projectId: $projectId)
}
    `) as unknown as TypedDocumentString<ProjectChangedSubscription, ProjectChangedSubscriptionVariables>;