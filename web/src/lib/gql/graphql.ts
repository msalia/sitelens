/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** The space an input coordinate is expressed in (GraphQL enum). */
export type CoordinateSpace =
  /**
   * Geographic input: `x` is longitude, `y` is latitude (degrees); `unit` is
   * ignored. Derives projected/grid/ground via the project's CRS + transform.
   */
  'GEOGRAPHIC' | 'GRID' | 'PROJECTED';

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

export type ExportFormat = 'CSV' | 'LANDXML';

/** Which coordinate space the exported northing/easting are in. */
export type ExportSpace = 'GEOGRAPHIC' | 'GRID' | 'PROJECTED_GRID' | 'PROJECTED_GROUND';

/** Input for replacing the grid. `position` is expressed in `unit`. */
export type GridAxisInput = {
  family: GridFamily;
  label: string;
  position: number;
};

/** Which family a grid axis belongs to. */
export type GridFamily = 'LETTERED' | 'NUMBERED';

/** Import file format. */
export type ImportFormat = 'CSV' | 'LANDXML';

/** A length unit used at I/O boundaries. The canonical internal unit is meters. */
export type LengthUnit = 'INTERNATIONAL_FOOT' | 'METER' | 'US_SURVEY_FOOT';

/** In-org role. The string values match the `users.role` CHECK constraint. */
export type Role = 'ADMIN' | 'SURVEYOR' | 'VIEWER';

export type WorkspaceQueryVariables = Exact<{
  id: string;
}>;

export type WorkspaceQuery = {
  surveyPointCount: number;
  project: {
    id: string;
    orgId: string;
    name: string;
    description: string;
    epsgCode: number;
    displayUnit: LengthUnit;
    combinedScaleFactor: number;
    siteOriginLat: number | null;
    siteOriginLon: number | null;
    siteOriginRotationDeg: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  gridAxes: Array<{
    id: string;
    projectId: string;
    family: GridFamily;
    label: string;
    position: number;
  }>;
  controlPoints: Array<{
    id: string;
    projectId: string;
    label: string;
    northing: number;
    easting: number;
    elevation: number | null;
    gridX: number | null;
    gridY: number | null;
    source: string;
  }>;
  transform: {
    translationE: number;
    translationN: number;
    rotationDegrees: number;
    scale: number;
    rmsError: number;
    pointCount: number;
    residuals: Array<{
      label: string;
      deltaEasting: number;
      deltaNorthing: number;
      magnitude: number;
    }>;
  } | null;
  categories: Array<{
    id: string;
    orgId: string;
    name: string;
    color: string;
    icon: string;
    isDefault: boolean;
  }>;
  cadOverlays: Array<{
    id: string;
    projectId: string;
    originalFilename: string;
    offsetE: number;
    offsetN: number;
    rotationDeg: number;
    scale: number;
    elevation: number;
    assumeRealWorld: boolean;
    visible: boolean;
  }>;
};

export type ProjectsQueryVariables = Exact<{ [key: string]: never }>;

export type ProjectsQuery = {
  projects: Array<{
    id: string;
    orgId: string;
    name: string;
    description: string;
    epsgCode: number;
    displayUnit: LengthUnit;
    combinedScaleFactor: number;
    siteOriginLat: number | null;
    siteOriginLon: number | null;
    siteOriginRotationDeg: number;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type DeleteProjectMutationVariables = Exact<{
  id: string;
}>;

export type DeleteProjectMutation = { deleteProject: boolean };

export type SettingsDataQueryVariables = Exact<{ [key: string]: never }>;

export type SettingsDataQuery = {
  me: { id: string; orgId: string; email: string; role: Role; emailVerified: boolean } | null;
  organization: { id: string; name: string };
};

export type DeleteOrganizationMutationVariables = Exact<{ [key: string]: never }>;

export type DeleteOrganizationMutation = { deleteOrganization: boolean };

export type UsersMeQueryVariables = Exact<{ [key: string]: never }>;

export type UsersMeQuery = {
  me: { id: string; orgId: string; email: string; role: Role; emailVerified: boolean } | null;
};

export type OrgMembersQueryVariables = Exact<{ [key: string]: never }>;

export type OrgMembersQuery = {
  orgMembers: Array<{ id: string; email: string; role: Role; status: string; createdAt: string }>;
};

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

export type MeQueryVariables = Exact<{ [key: string]: never }>;

export type MeQuery = {
  me: { id: string; orgId: string; email: string; role: Role; emailVerified: boolean } | null;
};

export type LogoutMutationVariables = Exact<{ [key: string]: never }>;

export type LogoutMutation = { logout: boolean };

export type RequestPasswordResetMutationVariables = Exact<{
  e: string;
}>;

export type RequestPasswordResetMutation = { requestPasswordReset: boolean };

export type LegalMeQueryVariables = Exact<{ [key: string]: never }>;

export type LegalMeQuery = { me: { id: string } | null };

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

export type SiteProjectedQuery = {
  convertCoordinate: { projectedGridE: number | null; projectedGridN: number | null };
};

export type CadOverlayDxfQueryVariables = Exact<{
  id: string;
}>;

export type CadOverlayDxfQuery = { cadOverlayContent: string };

export type OverlayScenePointsQueryVariables = Exact<{
  id: string;
}>;

export type OverlayScenePointsQuery = {
  sceneData: {
    controlPoints: Array<{ easting: number; northing: number }>;
    surveyPoints: Array<{ easting: number; northing: number }>;
  };
};

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

export type StandaloneConvertQuery = {
  convertCoordinate: {
    gridX: number | null;
    gridY: number | null;
    projectedGridE: number | null;
    projectedGridN: number | null;
    projectedGroundE: number | null;
    projectedGroundN: number | null;
    latitude: number | null;
    longitude: number | null;
  };
};

export type ConvertCoordinateQueryVariables = Exact<{
  id: string;
  x: number;
  y: number;
}>;

export type ConvertCoordinateQuery = {
  convertCoordinate: {
    gridX: number | null;
    gridY: number | null;
    projectedGridE: number | null;
    projectedGridN: number | null;
    projectedGroundE: number | null;
    projectedGroundN: number | null;
    latitude: number | null;
    longitude: number | null;
  };
};

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

export type SearchEpsgQueryVariables = Exact<{
  q: string;
  limit?: number | null | undefined;
}>;

export type SearchEpsgQuery = { searchEpsg: Array<{ code: number; name: string }> };

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

export type GroupManagerGroupsQuery = {
  pointGroups: Array<{ id: string; projectId: string; name: string; memberIds: Array<string> }>;
};

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

export type ImportProjectMutation = { importProject: { id: string; name: string } };

export type SceneQueryVariables = Exact<{
  id: string;
}>;

export type SceneQuery = {
  sceneData: {
    originProjectedE: number | null;
    originProjectedN: number | null;
    origin: { latitude: number; longitude: number; height: number } | null;
    controlPoints: Array<{
      id: string | null;
      label: string;
      latitude: number;
      longitude: number;
      height: number;
      easting: number;
      northing: number;
      categoryId: string | null;
    }>;
    surveyPoints: Array<{
      id: string | null;
      label: string;
      latitude: number;
      longitude: number;
      height: number;
      easting: number;
      northing: number;
      categoryId: string | null;
    }>;
    gridLines: Array<{
      label: string;
      coordinates: Array<{ latitude: number; longitude: number; height: number }>;
    }>;
  };
  projectTerrain: { demtype: string; fetchedAt: string } | null;
  projectBuildings: { count: number; fetchedAt: string } | null;
  cadOverlays: Array<{
    id: string;
    offsetE: number;
    offsetN: number;
    rotationDeg: number;
    scale: number;
    elevation: number;
    visible: boolean;
  }>;
  pointGroups: Array<{ id: string; name: string; memberIds: Array<string> }>;
};

export type TerrainContentQueryVariables = Exact<{
  id: string;
}>;

export type TerrainContentQuery = { projectTerrainContent: string };

export type BuildingsContentQueryVariables = Exact<{
  id: string;
}>;

export type BuildingsContentQuery = { projectBuildingsContent: string };

export type OverlayContentQueryVariables = Exact<{
  id: string;
}>;

export type OverlayContentQuery = { cadOverlayContent: string };

export type RefreshTerrainMutationVariables = Exact<{
  id: string;
  south: number;
  north: number;
  west: number;
  east: number;
  force?: boolean | null | undefined;
}>;

export type RefreshTerrainMutation = { refreshTerrain: { demtype: string; fetchedAt: string } };

export type RefreshBuildingsMutationVariables = Exact<{
  id: string;
  south: number;
  north: number;
  west: number;
  east: number;
  force?: boolean | null | undefined;
}>;

export type RefreshBuildingsMutation = { refreshBuildings: { count: number; fetchedAt: string } };

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

export type SurveyPointsQuery = {
  surveyPointCount: number;
  surveyPoints: Array<{
    id: string;
    projectId: string;
    label: string;
    northing: number;
    easting: number;
    elevation: number | null;
    description: string;
    categoryId: string | null;
    tags: Array<string>;
    importBatchId: string | null;
  }>;
};

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

export type PointGroupsQuery = {
  pointGroups: Array<{ id: string; projectId: string; name: string; memberIds: Array<string> }>;
};

export type AddPointsToGroupMutationVariables = Exact<{
  groupId: string;
  ids: Array<string> | string;
}>;

export type AddPointsToGroupMutation = {
  addPointsToGroup: { id: string; memberIds: Array<string> };
};

export type SolveTransformMutationVariables = Exact<{
  id: string;
}>;

export type SolveTransformMutation = {
  solveTransform: {
    translationE: number;
    translationN: number;
    rotationDegrees: number;
    scale: number;
    rmsError: number;
    pointCount: number;
    residuals: Array<{
      label: string;
      deltaEasting: number;
      deltaNorthing: number;
      magnitude: number;
    }>;
  };
};

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
    `) as unknown as TypedDocumentString<
  DeleteOrganizationMutation,
  DeleteOrganizationMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  AdminResetPasswordMutation,
  AdminResetPasswordMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  RequestPasswordResetMutation,
  RequestPasswordResetMutationVariables
>;
export const LegalMeDocument = new TypedDocumentString(`
    query LegalMe {
  me {
    id
  }
}
    `) as unknown as TypedDocumentString<LegalMeQuery, LegalMeQueryVariables>;
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
    `) as unknown as TypedDocumentString<
  ResendVerificationMutation,
  ResendVerificationMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  SetCadGeoreferenceMutation,
  SetCadGeoreferenceMutationVariables
>;
export const DeleteCadOverlayDocument = new TypedDocumentString(`
    mutation DeleteCadOverlay($id: UUID!) {
  deleteCadOverlay(id: $id)
}
    `) as unknown as TypedDocumentString<
  DeleteCadOverlayMutation,
  DeleteCadOverlayMutationVariables
>;
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
export const CadOverlayDxfDocument = new TypedDocumentString(`
    query CadOverlayDxf($id: UUID!) {
  cadOverlayContent(id: $id)
}
    `) as unknown as TypedDocumentString<CadOverlayDxfQuery, CadOverlayDxfQueryVariables>;
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
    `) as unknown as TypedDocumentString<
  UpdateControlPointMutation,
  UpdateControlPointMutationVariables
>;
export const DeleteControlPointDocument = new TypedDocumentString(`
    mutation DeleteControlPoint($id: UUID!) {
  deleteControlPoint(id: $id)
}
    `) as unknown as TypedDocumentString<
  DeleteControlPointMutation,
  DeleteControlPointMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  UpdateGeoreferenceMutation,
  UpdateGeoreferenceMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  GroupManagerCreateMutation,
  GroupManagerCreateMutationVariables
>;
export const GroupManagerDeleteDocument = new TypedDocumentString(`
    mutation GroupManagerDelete($id: UUID!) {
  deletePointGroup(id: $id)
}
    `) as unknown as TypedDocumentString<
  GroupManagerDeleteMutation,
  GroupManagerDeleteMutationVariables
>;
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
export const OverlayContentDocument = new TypedDocumentString(`
    query OverlayContent($id: UUID!) {
  cadOverlayContent(id: $id)
}
    `) as unknown as TypedDocumentString<OverlayContentQuery, OverlayContentQueryVariables>;
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
    `) as unknown as TypedDocumentString<
  RefreshBuildingsMutation,
  RefreshBuildingsMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  DeleteSurveyPointMutation,
  DeleteSurveyPointMutationVariables
>;
export const DeleteSurveyPointsDocument = new TypedDocumentString(`
    mutation DeleteSurveyPoints($ids: [UUID!]!) {
  deleteSurveyPoints(ids: $ids)
}
    `) as unknown as TypedDocumentString<
  DeleteSurveyPointsMutation,
  DeleteSurveyPointsMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  CreatePointGroupMutation,
  CreatePointGroupMutationVariables
>;
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
    `) as unknown as TypedDocumentString<
  AddPointsToGroupMutation,
  AddPointsToGroupMutationVariables
>;
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
export const ProjectChangedDocument = new TypedDocumentString(`
    subscription ProjectChanged($projectId: UUID!) {
  projectChanged(projectId: $projectId)
}
    `) as unknown as TypedDocumentString<
  ProjectChangedSubscription,
  ProjectChangedSubscriptionVariables
>;
