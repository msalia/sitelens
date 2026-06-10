/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query Workspace($id: UUID!) {\n    project(id: $id) {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n    gridAxes(projectId: $id) {\n      id\n      projectId\n      family\n      label\n      position\n    }\n    controlPoints(projectId: $id) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      gridX\n      gridY\n      source\n    }\n    transform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n    categories {\n      id\n      orgId\n      name\n      color\n      icon\n      isDefault\n    }\n    cadOverlays(projectId: $id) {\n      id\n      projectId\n      originalFilename\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      assumeRealWorld\n      visible\n    }\n    surveyPointCount(projectId: $id)\n  }\n": typeof types.WorkspaceDocument,
    "\n  query Projects {\n    projects {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.ProjectsDocument,
    "\n  mutation DeleteProject($id: UUID!) {\n    deleteProject(id: $id)\n  }\n": typeof types.DeleteProjectDocument,
    "\n  query SettingsMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n": typeof types.SettingsMeDocument,
    "\n  mutation Signup($e: String!, $p: String!, $o: String!) {\n    signup(email: $e, password: $p, orgName: $o) {\n      verificationToken\n    }\n  }\n": typeof types.SignupDocument,
    "\n  mutation VerifyEmail($t: String!) {\n    verifyEmail(token: $t)\n  }\n": typeof types.VerifyEmailDocument,
    "\n  query Me {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n": typeof types.MeDocument,
    "\n  mutation Logout {\n    logout\n  }\n": typeof types.LogoutDocument,
    "\n  mutation Login($e: String!, $p: String!) {\n    login(email: $e, password: $p) {\n      id\n    }\n  }\n": typeof types.LoginDocument,
    "\n  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {\n    uploadDxf(projectId: $id, filename: $f, content: $c) {\n      id\n    }\n  }\n": typeof types.UploadDxfDocument,
    "\n  mutation SetCadGeoreference(\n    $id: UUID!\n    $oe: Float\n    $on: Float\n    $rot: Float\n    $sc: Float\n    $vis: Boolean\n  ) {\n    setCadGeoreference(\n      id: $id\n      offsetE: $oe\n      offsetN: $on\n      rotationDeg: $rot\n      scale: $sc\n      visible: $vis\n    ) {\n      id\n    }\n  }\n": typeof types.SetCadGeoreferenceDocument,
    "\n  mutation DeleteCadOverlay($id: UUID!) {\n    deleteCadOverlay(id: $id)\n  }\n": typeof types.DeleteCadOverlayDocument,
    "\n  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {\n    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {\n      projectedGridE\n      projectedGridN\n    }\n  }\n": typeof types.SiteProjectedDocument,
    "\n  query CadOverlayDxf($id: UUID!) {\n    cadOverlayContent(id: $id)\n  }\n": typeof types.CadOverlayDxfDocument,
    "\n  query OverlayScenePoints($id: UUID!) {\n    sceneData(projectId: $id) {\n      controlPoints {\n        easting\n        northing\n      }\n      surveyPoints {\n        easting\n        northing\n      }\n    }\n  }\n": typeof types.OverlayScenePointsDocument,
    "\n  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {\n    createCategory(name: $name, color: $color, icon: $icon) {\n      id\n    }\n  }\n": typeof types.CreateCategoryDocument,
    "\n  mutation DeleteCategory($id: UUID!) {\n    deleteCategory(id: $id)\n  }\n": typeof types.DeleteCategoryDocument,
    "\n  mutation AddControlPoint(\n    $id: UUID!\n    $label: String!\n    $n: Float!\n    $e: Float!\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    addControlPoint(\n      projectId: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n": typeof types.AddControlPointDocument,
    "\n  mutation UpdateControlPoint(\n    $id: UUID!\n    $label: String\n    $n: Float\n    $e: Float\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    updateControlPoint(\n      id: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n": typeof types.UpdateControlPointDocument,
    "\n  mutation DeleteControlPoint($id: UUID!) {\n    deleteControlPoint(id: $id)\n  }\n": typeof types.DeleteControlPointDocument,
    "\n  query StandaloneConvert(\n    $id: UUID!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $unit: LengthUnit!\n  ) {\n    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n": typeof types.StandaloneConvertDocument,
    "\n  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {\n    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n": typeof types.ConvertCoordinateDocument,
    "\n  mutation CreateProject(\n    $name: String!\n    $desc: String\n    $epsg: Int!\n    $unit: LengthUnit!\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    createProject(\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n": typeof types.CreateProjectDocument,
    "\n  mutation UpdateProject(\n    $id: UUID!\n    $name: String\n    $desc: String\n    $epsg: Int\n    $unit: LengthUnit\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    updateProject(\n      id: $id\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n": typeof types.UpdateProjectDocument,
    "\n  query SearchEpsg($q: String!, $limit: Int) {\n    searchEpsg(query: $q, limit: $limit) {\n      code\n      name\n    }\n  }\n": typeof types.SearchEpsgDocument,
    "\n  query ExportPoints(\n    $id: UUID!\n    $format: ExportFormat!\n    $space: ExportSpace!\n    $unit: LengthUnit!\n    $columns: [ExportColumn!]\n    $pointIds: [UUID!]\n    $categoryId: UUID\n  ) {\n    exportPoints(\n      projectId: $id\n      format: $format\n      space: $space\n      unit: $unit\n      columns: $columns\n      pointIds: $pointIds\n      categoryId: $categoryId\n    )\n  }\n": typeof types.ExportPointsDocument,
    "\n  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {\n    updateProject(\n      id: $id\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n": typeof types.UpdateGeoreferenceDocument,
    "\n  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {\n    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {\n      id\n    }\n  }\n": typeof types.SetGridAxesDocument,
    "\n  query GroupManagerGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n": typeof types.GroupManagerGroupsDocument,
    "\n  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n": typeof types.GroupManagerCreateDocument,
    "\n  mutation GroupManagerDelete($id: UUID!) {\n    deletePointGroup(id: $id)\n  }\n": typeof types.GroupManagerDeleteDocument,
    "\n  mutation ImportPoints(\n    $id: UUID!\n    $format: ImportFormat!\n    $content: String!\n    $unit: LengthUnit!\n    $mapping: CsvMappingInput\n    $filename: String\n    $categoryId: UUID\n    $profile: String\n  ) {\n    importPoints(\n      projectId: $id\n      format: $format\n      content: $content\n      unit: $unit\n      mapping: $mapping\n      sourceFilename: $filename\n      categoryId: $categoryId\n      saveProfileName: $profile\n    ) {\n      rowCount\n    }\n  }\n": typeof types.ImportPointsDocument,
    "\n  query Scene($id: UUID!) {\n    sceneData(projectId: $id) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n    }\n    projectTerrain(projectId: $id) {\n      demtype\n      fetchedAt\n    }\n    projectBuildings(projectId: $id) {\n      count\n      fetchedAt\n    }\n    cadOverlays(projectId: $id) {\n      id\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      visible\n    }\n    pointGroups(projectId: $id) {\n      id\n      name\n      memberIds\n    }\n  }\n": typeof types.SceneDocument,
    "\n  query PreviewScene($id: UUID!, $lat: Float, $lon: Float, $rot: Float) {\n    sceneData(\n      projectId: $id\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n    }\n  }\n": typeof types.PreviewSceneDocument,
    "\n  query TerrainContent($id: UUID!) {\n    projectTerrainContent(projectId: $id)\n  }\n": typeof types.TerrainContentDocument,
    "\n  query BuildingsContent($id: UUID!) {\n    projectBuildingsContent(projectId: $id)\n  }\n": typeof types.BuildingsContentDocument,
    "\n  query OverlayContent($id: UUID!) {\n    cadOverlayContent(id: $id)\n  }\n": typeof types.OverlayContentDocument,
    "\n  mutation RefreshTerrain(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshTerrain(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      demtype\n      fetchedAt\n    }\n  }\n": typeof types.RefreshTerrainDocument,
    "\n  mutation RefreshBuildings(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshBuildings(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      count\n      fetchedAt\n    }\n  }\n": typeof types.RefreshBuildingsDocument,
    "\n  query SurveyPoints(\n    $id: UUID!\n    $search: String\n    $cat: UUID\n    $group: UUID\n    $limit: Int\n    $offset: Int\n    $sort: String\n    $descending: Boolean\n  ) {\n    surveyPoints(\n      projectId: $id\n      search: $search\n      categoryId: $cat\n      groupId: $group\n      limit: $limit\n      offset: $offset\n      sort: $sort\n      descending: $descending\n    ) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      description\n      categoryId\n      tags\n      importBatchId\n    }\n    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)\n  }\n": typeof types.SurveyPointsDocument,
    "\n  mutation DeleteSurveyPoint($id: UUID!) {\n    deleteSurveyPoint(id: $id)\n  }\n": typeof types.DeleteSurveyPointDocument,
    "\n  mutation DeleteSurveyPoints($ids: [UUID!]!) {\n    deleteSurveyPoints(ids: $ids)\n  }\n": typeof types.DeleteSurveyPointsDocument,
    "\n  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {\n    assignCategory(ids: $ids, categoryId: $cat)\n  }\n": typeof types.AssignCategoryDocument,
    "\n  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n": typeof types.CreatePointGroupDocument,
    "\n  query PointGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n": typeof types.PointGroupsDocument,
    "\n  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {\n    addPointsToGroup(groupId: $groupId, memberIds: $ids) {\n      id\n      memberIds\n    }\n  }\n": typeof types.AddPointsToGroupDocument,
    "\n  mutation SolveTransform($id: UUID!) {\n    solveTransform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n  }\n": typeof types.SolveTransformDocument,
};
const documents: Documents = {
    "\n  query Workspace($id: UUID!) {\n    project(id: $id) {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n    gridAxes(projectId: $id) {\n      id\n      projectId\n      family\n      label\n      position\n    }\n    controlPoints(projectId: $id) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      gridX\n      gridY\n      source\n    }\n    transform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n    categories {\n      id\n      orgId\n      name\n      color\n      icon\n      isDefault\n    }\n    cadOverlays(projectId: $id) {\n      id\n      projectId\n      originalFilename\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      assumeRealWorld\n      visible\n    }\n    surveyPointCount(projectId: $id)\n  }\n": types.WorkspaceDocument,
    "\n  query Projects {\n    projects {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n  }\n": types.ProjectsDocument,
    "\n  mutation DeleteProject($id: UUID!) {\n    deleteProject(id: $id)\n  }\n": types.DeleteProjectDocument,
    "\n  query SettingsMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n": types.SettingsMeDocument,
    "\n  mutation Signup($e: String!, $p: String!, $o: String!) {\n    signup(email: $e, password: $p, orgName: $o) {\n      verificationToken\n    }\n  }\n": types.SignupDocument,
    "\n  mutation VerifyEmail($t: String!) {\n    verifyEmail(token: $t)\n  }\n": types.VerifyEmailDocument,
    "\n  query Me {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n": types.MeDocument,
    "\n  mutation Logout {\n    logout\n  }\n": types.LogoutDocument,
    "\n  mutation Login($e: String!, $p: String!) {\n    login(email: $e, password: $p) {\n      id\n    }\n  }\n": types.LoginDocument,
    "\n  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {\n    uploadDxf(projectId: $id, filename: $f, content: $c) {\n      id\n    }\n  }\n": types.UploadDxfDocument,
    "\n  mutation SetCadGeoreference(\n    $id: UUID!\n    $oe: Float\n    $on: Float\n    $rot: Float\n    $sc: Float\n    $vis: Boolean\n  ) {\n    setCadGeoreference(\n      id: $id\n      offsetE: $oe\n      offsetN: $on\n      rotationDeg: $rot\n      scale: $sc\n      visible: $vis\n    ) {\n      id\n    }\n  }\n": types.SetCadGeoreferenceDocument,
    "\n  mutation DeleteCadOverlay($id: UUID!) {\n    deleteCadOverlay(id: $id)\n  }\n": types.DeleteCadOverlayDocument,
    "\n  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {\n    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {\n      projectedGridE\n      projectedGridN\n    }\n  }\n": types.SiteProjectedDocument,
    "\n  query CadOverlayDxf($id: UUID!) {\n    cadOverlayContent(id: $id)\n  }\n": types.CadOverlayDxfDocument,
    "\n  query OverlayScenePoints($id: UUID!) {\n    sceneData(projectId: $id) {\n      controlPoints {\n        easting\n        northing\n      }\n      surveyPoints {\n        easting\n        northing\n      }\n    }\n  }\n": types.OverlayScenePointsDocument,
    "\n  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {\n    createCategory(name: $name, color: $color, icon: $icon) {\n      id\n    }\n  }\n": types.CreateCategoryDocument,
    "\n  mutation DeleteCategory($id: UUID!) {\n    deleteCategory(id: $id)\n  }\n": types.DeleteCategoryDocument,
    "\n  mutation AddControlPoint(\n    $id: UUID!\n    $label: String!\n    $n: Float!\n    $e: Float!\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    addControlPoint(\n      projectId: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n": types.AddControlPointDocument,
    "\n  mutation UpdateControlPoint(\n    $id: UUID!\n    $label: String\n    $n: Float\n    $e: Float\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    updateControlPoint(\n      id: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n": types.UpdateControlPointDocument,
    "\n  mutation DeleteControlPoint($id: UUID!) {\n    deleteControlPoint(id: $id)\n  }\n": types.DeleteControlPointDocument,
    "\n  query StandaloneConvert(\n    $id: UUID!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $unit: LengthUnit!\n  ) {\n    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n": types.StandaloneConvertDocument,
    "\n  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {\n    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n": types.ConvertCoordinateDocument,
    "\n  mutation CreateProject(\n    $name: String!\n    $desc: String\n    $epsg: Int!\n    $unit: LengthUnit!\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    createProject(\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n": types.CreateProjectDocument,
    "\n  mutation UpdateProject(\n    $id: UUID!\n    $name: String\n    $desc: String\n    $epsg: Int\n    $unit: LengthUnit\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    updateProject(\n      id: $id\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n": types.UpdateProjectDocument,
    "\n  query SearchEpsg($q: String!, $limit: Int) {\n    searchEpsg(query: $q, limit: $limit) {\n      code\n      name\n    }\n  }\n": types.SearchEpsgDocument,
    "\n  query ExportPoints(\n    $id: UUID!\n    $format: ExportFormat!\n    $space: ExportSpace!\n    $unit: LengthUnit!\n    $columns: [ExportColumn!]\n    $pointIds: [UUID!]\n    $categoryId: UUID\n  ) {\n    exportPoints(\n      projectId: $id\n      format: $format\n      space: $space\n      unit: $unit\n      columns: $columns\n      pointIds: $pointIds\n      categoryId: $categoryId\n    )\n  }\n": types.ExportPointsDocument,
    "\n  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {\n    updateProject(\n      id: $id\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n": types.UpdateGeoreferenceDocument,
    "\n  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {\n    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {\n      id\n    }\n  }\n": types.SetGridAxesDocument,
    "\n  query GroupManagerGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n": types.GroupManagerGroupsDocument,
    "\n  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n": types.GroupManagerCreateDocument,
    "\n  mutation GroupManagerDelete($id: UUID!) {\n    deletePointGroup(id: $id)\n  }\n": types.GroupManagerDeleteDocument,
    "\n  mutation ImportPoints(\n    $id: UUID!\n    $format: ImportFormat!\n    $content: String!\n    $unit: LengthUnit!\n    $mapping: CsvMappingInput\n    $filename: String\n    $categoryId: UUID\n    $profile: String\n  ) {\n    importPoints(\n      projectId: $id\n      format: $format\n      content: $content\n      unit: $unit\n      mapping: $mapping\n      sourceFilename: $filename\n      categoryId: $categoryId\n      saveProfileName: $profile\n    ) {\n      rowCount\n    }\n  }\n": types.ImportPointsDocument,
    "\n  query Scene($id: UUID!) {\n    sceneData(projectId: $id) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n    }\n    projectTerrain(projectId: $id) {\n      demtype\n      fetchedAt\n    }\n    projectBuildings(projectId: $id) {\n      count\n      fetchedAt\n    }\n    cadOverlays(projectId: $id) {\n      id\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      visible\n    }\n    pointGroups(projectId: $id) {\n      id\n      name\n      memberIds\n    }\n  }\n": types.SceneDocument,
    "\n  query PreviewScene($id: UUID!, $lat: Float, $lon: Float, $rot: Float) {\n    sceneData(\n      projectId: $id\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n    }\n  }\n": types.PreviewSceneDocument,
    "\n  query TerrainContent($id: UUID!) {\n    projectTerrainContent(projectId: $id)\n  }\n": types.TerrainContentDocument,
    "\n  query BuildingsContent($id: UUID!) {\n    projectBuildingsContent(projectId: $id)\n  }\n": types.BuildingsContentDocument,
    "\n  query OverlayContent($id: UUID!) {\n    cadOverlayContent(id: $id)\n  }\n": types.OverlayContentDocument,
    "\n  mutation RefreshTerrain(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshTerrain(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      demtype\n      fetchedAt\n    }\n  }\n": types.RefreshTerrainDocument,
    "\n  mutation RefreshBuildings(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshBuildings(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      count\n      fetchedAt\n    }\n  }\n": types.RefreshBuildingsDocument,
    "\n  query SurveyPoints(\n    $id: UUID!\n    $search: String\n    $cat: UUID\n    $group: UUID\n    $limit: Int\n    $offset: Int\n    $sort: String\n    $descending: Boolean\n  ) {\n    surveyPoints(\n      projectId: $id\n      search: $search\n      categoryId: $cat\n      groupId: $group\n      limit: $limit\n      offset: $offset\n      sort: $sort\n      descending: $descending\n    ) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      description\n      categoryId\n      tags\n      importBatchId\n    }\n    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)\n  }\n": types.SurveyPointsDocument,
    "\n  mutation DeleteSurveyPoint($id: UUID!) {\n    deleteSurveyPoint(id: $id)\n  }\n": types.DeleteSurveyPointDocument,
    "\n  mutation DeleteSurveyPoints($ids: [UUID!]!) {\n    deleteSurveyPoints(ids: $ids)\n  }\n": types.DeleteSurveyPointsDocument,
    "\n  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {\n    assignCategory(ids: $ids, categoryId: $cat)\n  }\n": types.AssignCategoryDocument,
    "\n  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n": types.CreatePointGroupDocument,
    "\n  query PointGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n": types.PointGroupsDocument,
    "\n  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {\n    addPointsToGroup(groupId: $groupId, memberIds: $ids) {\n      id\n      memberIds\n    }\n  }\n": types.AddPointsToGroupDocument,
    "\n  mutation SolveTransform($id: UUID!) {\n    solveTransform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n  }\n": types.SolveTransformDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Workspace($id: UUID!) {\n    project(id: $id) {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n    gridAxes(projectId: $id) {\n      id\n      projectId\n      family\n      label\n      position\n    }\n    controlPoints(projectId: $id) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      gridX\n      gridY\n      source\n    }\n    transform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n    categories {\n      id\n      orgId\n      name\n      color\n      icon\n      isDefault\n    }\n    cadOverlays(projectId: $id) {\n      id\n      projectId\n      originalFilename\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      assumeRealWorld\n      visible\n    }\n    surveyPointCount(projectId: $id)\n  }\n"): typeof import('./graphql').WorkspaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Projects {\n    projects {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').ProjectsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteProject($id: UUID!) {\n    deleteProject(id: $id)\n  }\n"): typeof import('./graphql').DeleteProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SettingsMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n"): typeof import('./graphql').SettingsMeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Signup($e: String!, $p: String!, $o: String!) {\n    signup(email: $e, password: $p, orgName: $o) {\n      verificationToken\n    }\n  }\n"): typeof import('./graphql').SignupDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation VerifyEmail($t: String!) {\n    verifyEmail(token: $t)\n  }\n"): typeof import('./graphql').VerifyEmailDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Me {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n"): typeof import('./graphql').MeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Logout {\n    logout\n  }\n"): typeof import('./graphql').LogoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Login($e: String!, $p: String!) {\n    login(email: $e, password: $p) {\n      id\n    }\n  }\n"): typeof import('./graphql').LoginDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {\n    uploadDxf(projectId: $id, filename: $f, content: $c) {\n      id\n    }\n  }\n"): typeof import('./graphql').UploadDxfDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetCadGeoreference(\n    $id: UUID!\n    $oe: Float\n    $on: Float\n    $rot: Float\n    $sc: Float\n    $vis: Boolean\n  ) {\n    setCadGeoreference(\n      id: $id\n      offsetE: $oe\n      offsetN: $on\n      rotationDeg: $rot\n      scale: $sc\n      visible: $vis\n    ) {\n      id\n    }\n  }\n"): typeof import('./graphql').SetCadGeoreferenceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteCadOverlay($id: UUID!) {\n    deleteCadOverlay(id: $id)\n  }\n"): typeof import('./graphql').DeleteCadOverlayDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {\n    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {\n      projectedGridE\n      projectedGridN\n    }\n  }\n"): typeof import('./graphql').SiteProjectedDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CadOverlayDxf($id: UUID!) {\n    cadOverlayContent(id: $id)\n  }\n"): typeof import('./graphql').CadOverlayDxfDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OverlayScenePoints($id: UUID!) {\n    sceneData(projectId: $id) {\n      controlPoints {\n        easting\n        northing\n      }\n      surveyPoints {\n        easting\n        northing\n      }\n    }\n  }\n"): typeof import('./graphql').OverlayScenePointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {\n    createCategory(name: $name, color: $color, icon: $icon) {\n      id\n    }\n  }\n"): typeof import('./graphql').CreateCategoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteCategory($id: UUID!) {\n    deleteCategory(id: $id)\n  }\n"): typeof import('./graphql').DeleteCategoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddControlPoint(\n    $id: UUID!\n    $label: String!\n    $n: Float!\n    $e: Float!\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    addControlPoint(\n      projectId: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n"): typeof import('./graphql').AddControlPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateControlPoint(\n    $id: UUID!\n    $label: String\n    $n: Float\n    $e: Float\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    updateControlPoint(\n      id: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n"): typeof import('./graphql').UpdateControlPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteControlPoint($id: UUID!) {\n    deleteControlPoint(id: $id)\n  }\n"): typeof import('./graphql').DeleteControlPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StandaloneConvert(\n    $id: UUID!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $unit: LengthUnit!\n  ) {\n    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n"): typeof import('./graphql').StandaloneConvertDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {\n    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n"): typeof import('./graphql').ConvertCoordinateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateProject(\n    $name: String!\n    $desc: String\n    $epsg: Int!\n    $unit: LengthUnit!\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    createProject(\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n"): typeof import('./graphql').CreateProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateProject(\n    $id: UUID!\n    $name: String\n    $desc: String\n    $epsg: Int\n    $unit: LengthUnit\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    updateProject(\n      id: $id\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n"): typeof import('./graphql').UpdateProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SearchEpsg($q: String!, $limit: Int) {\n    searchEpsg(query: $q, limit: $limit) {\n      code\n      name\n    }\n  }\n"): typeof import('./graphql').SearchEpsgDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ExportPoints(\n    $id: UUID!\n    $format: ExportFormat!\n    $space: ExportSpace!\n    $unit: LengthUnit!\n    $columns: [ExportColumn!]\n    $pointIds: [UUID!]\n    $categoryId: UUID\n  ) {\n    exportPoints(\n      projectId: $id\n      format: $format\n      space: $space\n      unit: $unit\n      columns: $columns\n      pointIds: $pointIds\n      categoryId: $categoryId\n    )\n  }\n"): typeof import('./graphql').ExportPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {\n    updateProject(\n      id: $id\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n"): typeof import('./graphql').UpdateGeoreferenceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {\n    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {\n      id\n    }\n  }\n"): typeof import('./graphql').SetGridAxesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GroupManagerGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n"): typeof import('./graphql').GroupManagerGroupsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n"): typeof import('./graphql').GroupManagerCreateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GroupManagerDelete($id: UUID!) {\n    deletePointGroup(id: $id)\n  }\n"): typeof import('./graphql').GroupManagerDeleteDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportPoints(\n    $id: UUID!\n    $format: ImportFormat!\n    $content: String!\n    $unit: LengthUnit!\n    $mapping: CsvMappingInput\n    $filename: String\n    $categoryId: UUID\n    $profile: String\n  ) {\n    importPoints(\n      projectId: $id\n      format: $format\n      content: $content\n      unit: $unit\n      mapping: $mapping\n      sourceFilename: $filename\n      categoryId: $categoryId\n      saveProfileName: $profile\n    ) {\n      rowCount\n    }\n  }\n"): typeof import('./graphql').ImportPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Scene($id: UUID!) {\n    sceneData(projectId: $id) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n    }\n    projectTerrain(projectId: $id) {\n      demtype\n      fetchedAt\n    }\n    projectBuildings(projectId: $id) {\n      count\n      fetchedAt\n    }\n    cadOverlays(projectId: $id) {\n      id\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      visible\n    }\n    pointGroups(projectId: $id) {\n      id\n      name\n      memberIds\n    }\n  }\n"): typeof import('./graphql').SceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PreviewScene($id: UUID!, $lat: Float, $lon: Float, $rot: Float) {\n    sceneData(\n      projectId: $id\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').PreviewSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TerrainContent($id: UUID!) {\n    projectTerrainContent(projectId: $id)\n  }\n"): typeof import('./graphql').TerrainContentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query BuildingsContent($id: UUID!) {\n    projectBuildingsContent(projectId: $id)\n  }\n"): typeof import('./graphql').BuildingsContentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OverlayContent($id: UUID!) {\n    cadOverlayContent(id: $id)\n  }\n"): typeof import('./graphql').OverlayContentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RefreshTerrain(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshTerrain(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      demtype\n      fetchedAt\n    }\n  }\n"): typeof import('./graphql').RefreshTerrainDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RefreshBuildings(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshBuildings(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      count\n      fetchedAt\n    }\n  }\n"): typeof import('./graphql').RefreshBuildingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SurveyPoints(\n    $id: UUID!\n    $search: String\n    $cat: UUID\n    $group: UUID\n    $limit: Int\n    $offset: Int\n    $sort: String\n    $descending: Boolean\n  ) {\n    surveyPoints(\n      projectId: $id\n      search: $search\n      categoryId: $cat\n      groupId: $group\n      limit: $limit\n      offset: $offset\n      sort: $sort\n      descending: $descending\n    ) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      description\n      categoryId\n      tags\n      importBatchId\n    }\n    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)\n  }\n"): typeof import('./graphql').SurveyPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSurveyPoint($id: UUID!) {\n    deleteSurveyPoint(id: $id)\n  }\n"): typeof import('./graphql').DeleteSurveyPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSurveyPoints($ids: [UUID!]!) {\n    deleteSurveyPoints(ids: $ids)\n  }\n"): typeof import('./graphql').DeleteSurveyPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {\n    assignCategory(ids: $ids, categoryId: $cat)\n  }\n"): typeof import('./graphql').AssignCategoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n"): typeof import('./graphql').CreatePointGroupDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PointGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n"): typeof import('./graphql').PointGroupsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {\n    addPointsToGroup(groupId: $groupId, memberIds: $ids) {\n      id\n      memberIds\n    }\n  }\n"): typeof import('./graphql').AddPointsToGroupDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SolveTransform($id: UUID!) {\n    solveTransform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n  }\n"): typeof import('./graphql').SolveTransformDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
