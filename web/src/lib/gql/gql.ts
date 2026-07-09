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
  '\n  query Workspace($id: UUID!) {\n    project(id: $id) {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n    gridAxes(projectId: $id) {\n      id\n      projectId\n      family\n      label\n      position\n    }\n    controlPoints(projectId: $id) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      gridX\n      gridY\n      source\n    }\n    transform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n    categories {\n      id\n      orgId\n      name\n      color\n      icon\n      isDefault\n    }\n    cadOverlays(projectId: $id) {\n      id\n      projectId\n      originalFilename\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      elevation\n      assumeRealWorld\n      visible\n    }\n    surveyPointCount(projectId: $id)\n  }\n': typeof types.WorkspaceDocument;
  '\n  query Projects {\n    projects {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n  }\n': typeof types.ProjectsDocument;
  '\n  mutation DeleteProject($id: UUID!) {\n    deleteProject(id: $id)\n  }\n': typeof types.DeleteProjectDocument;
  '\n  query BillingMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n': typeof types.BillingMeDocument;
  '\n  query SettingsData {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n    organization {\n      id\n      name\n    }\n  }\n': typeof types.SettingsDataDocument;
  '\n  mutation DeleteOrganization {\n    deleteOrganization\n  }\n': typeof types.DeleteOrganizationDocument;
  '\n  query UsersMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n': typeof types.UsersMeDocument;
  '\n  query OrgMembers {\n    orgMembers {\n      id\n      email\n      role\n      status\n      createdAt\n    }\n  }\n': typeof types.OrgMembersDocument;
  '\n  mutation InviteUser($email: String!, $role: Role!) {\n    inviteUser(email: $email, role: $role) {\n      user {\n        id\n      }\n    }\n  }\n': typeof types.InviteUserDocument;
  '\n  mutation UpdateUserRole($userId: UUID!, $role: Role!) {\n    updateUserRole(userId: $userId, role: $role) {\n      id\n    }\n  }\n': typeof types.UpdateUserRoleDocument;
  '\n  mutation AdminResetPassword($userId: UUID!) {\n    adminResetPassword(userId: $userId)\n  }\n': typeof types.AdminResetPasswordDocument;
  '\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId)\n  }\n': typeof types.RemoveUserDocument;
  '\n  mutation AcceptInvite($t: String!, $p: String!) {\n    acceptInvite(token: $t, password: $p) {\n      id\n    }\n  }\n': typeof types.AcceptInviteDocument;
  '\n  query Me {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n': typeof types.MeDocument;
  '\n  mutation Logout {\n    logout\n  }\n': typeof types.LogoutDocument;
  '\n  mutation RequestPasswordReset($e: String!) {\n    requestPasswordReset(email: $e)\n  }\n': typeof types.RequestPasswordResetDocument;
  '\n  mutation Login($e: String!, $p: String!) {\n    login(email: $e, password: $p) {\n      id\n    }\n  }\n': typeof types.LoginDocument;
  '\n  mutation ResendVerification($e: String!) {\n    resendVerification(email: $e)\n  }\n': typeof types.ResendVerificationDocument;
  '\n  mutation AddSurveyPoint(\n    $projectId: UUID!\n    $label: String!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $elevation: Float\n    $description: String\n    $categoryId: UUID\n    $unit: LengthUnit!\n  ) {\n    addSurveyPoint(\n      projectId: $projectId\n      label: $label\n      space: $space\n      x: $x\n      y: $y\n      elevation: $elevation\n      description: $description\n      categoryId: $categoryId\n      unit: $unit\n    ) {\n      id\n    }\n  }\n': typeof types.AddSurveyPointDocument;
  '\n  query Analyses($projectId: UUID!) {\n    analyses(projectId: $projectId) {\n      id\n      type\n      name\n      status\n      inputGeometry\n      result\n      resultGeometry\n    }\n  }\n': typeof types.AnalysesDocument;
  '\n  query VehicleTemplates {\n    vehicleTemplates {\n      id\n      name\n      vehicleClass\n      wheelbase\n      width\n      isPreset\n    }\n  }\n': typeof types.VehicleTemplatesDocument;
  '\n  mutation RunTurningAnalysis($projectId: UUID!, $input: TurningInput!) {\n    runTurningAnalysis(projectId: $projectId, input: $input) {\n      id\n      name\n      result\n    }\n  }\n': typeof types.RunTurningAnalysisDocument;
  '\n  mutation CreateAnalysis($projectId: UUID!, $input: AnalysisInput!) {\n    createAnalysis(projectId: $projectId, input: $input) {\n      id\n      type\n      name\n    }\n  }\n': typeof types.CreateAnalysisDocument;
  '\n  mutation UpdateAnalysis($id: UUID!, $input: AnalysisInput!) {\n    updateAnalysis(id: $id, input: $input) {\n      id\n    }\n  }\n': typeof types.UpdateAnalysisDocument;
  '\n  mutation DeleteAnalysis($id: UUID!) {\n    deleteAnalysis(id: $id)\n  }\n': typeof types.DeleteAnalysisDocument;
  '\n  mutation DuplicateAnalysis($id: UUID!) {\n    duplicateAnalysis(id: $id) {\n      id\n    }\n  }\n': typeof types.DuplicateAnalysisDocument;
  '\n  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {\n    uploadDxf(projectId: $id, filename: $f, content: $c) {\n      id\n    }\n  }\n': typeof types.UploadDxfDocument;
  '\n  mutation SetCadGeoreference(\n    $id: UUID!\n    $oe: Float\n    $on: Float\n    $rot: Float\n    $sc: Float\n    $el: Float\n    $vis: Boolean\n  ) {\n    setCadGeoreference(\n      id: $id\n      offsetE: $oe\n      offsetN: $on\n      rotationDeg: $rot\n      scale: $sc\n      elevation: $el\n      visible: $vis\n    ) {\n      id\n    }\n  }\n': typeof types.SetCadGeoreferenceDocument;
  '\n  mutation DeleteCadOverlay($id: UUID!) {\n    deleteCadOverlay(id: $id)\n  }\n': typeof types.DeleteCadOverlayDocument;
  '\n  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {\n    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {\n      projectedGridE\n      projectedGridN\n    }\n  }\n': typeof types.SiteProjectedDocument;
  '\n  query CadOverlayGeom($id: UUID!) {\n    cadOverlayGeometry(id: $id) {\n      polylines {\n        layer\n        points {\n          x\n          y\n        }\n      }\n    }\n  }\n': typeof types.CadOverlayGeomDocument;
  '\n  query OverlayScenePoints($id: UUID!) {\n    sceneData(projectId: $id) {\n      controlPoints {\n        easting\n        northing\n      }\n      surveyPoints {\n        easting\n        northing\n      }\n    }\n  }\n': typeof types.OverlayScenePointsDocument;
  '\n  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {\n    createCategory(name: $name, color: $color, icon: $icon) {\n      id\n    }\n  }\n': typeof types.CreateCategoryDocument;
  '\n  mutation DeleteCategory($id: UUID!) {\n    deleteCategory(id: $id)\n  }\n': typeof types.DeleteCategoryDocument;
  '\n  mutation AddControlPoint(\n    $id: UUID!\n    $label: String!\n    $n: Float!\n    $e: Float!\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    addControlPoint(\n      projectId: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n': typeof types.AddControlPointDocument;
  '\n  mutation UpdateControlPoint(\n    $id: UUID!\n    $label: String\n    $n: Float\n    $e: Float\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    updateControlPoint(\n      id: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n': typeof types.UpdateControlPointDocument;
  '\n  mutation DeleteControlPoint($id: UUID!) {\n    deleteControlPoint(id: $id)\n  }\n': typeof types.DeleteControlPointDocument;
  '\n  query StandaloneConvert(\n    $id: UUID!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $unit: LengthUnit!\n  ) {\n    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n': typeof types.StandaloneConvertDocument;
  '\n  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {\n    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n': typeof types.ConvertCoordinateDocument;
  '\n  mutation CreateProject(\n    $name: String!\n    $desc: String\n    $epsg: Int!\n    $unit: LengthUnit!\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    createProject(\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n': typeof types.CreateProjectDocument;
  '\n  mutation UpdateProject(\n    $id: UUID!\n    $name: String\n    $desc: String\n    $epsg: Int\n    $unit: LengthUnit\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    updateProject(\n      id: $id\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n': typeof types.UpdateProjectDocument;
  '\n  mutation UpdateSurveyPoint($id: UUID!, $label: String, $description: String, $categoryId: UUID) {\n    updateSurveyPoint(id: $id, label: $label, description: $description, categoryId: $categoryId) {\n      id\n    }\n  }\n': typeof types.UpdateSurveyPointDocument;
  '\n  query SearchEpsg($q: String!, $limit: Int) {\n    searchEpsg(query: $q, limit: $limit) {\n      code\n      name\n    }\n  }\n': typeof types.SearchEpsgDocument;
  '\n  query ExportPoints(\n    $id: UUID!\n    $format: ExportFormat!\n    $space: ExportSpace!\n    $unit: LengthUnit!\n    $columns: [ExportColumn!]\n    $pointIds: [UUID!]\n    $categoryId: UUID\n  ) {\n    exportPoints(\n      projectId: $id\n      format: $format\n      space: $space\n      unit: $unit\n      columns: $columns\n      pointIds: $pointIds\n      categoryId: $categoryId\n    )\n  }\n': typeof types.ExportPointsDocument;
  '\n  query ProjectExport($id: UUID!) {\n    projectExport(projectId: $id)\n  }\n': typeof types.ProjectExportDocument;
  '\n  query FieldExportPresets {\n    fieldExportPresets {\n      id\n      app\n      format\n      defaultSpace\n      defaultUnit\n      description\n    }\n  }\n': typeof types.FieldExportPresetsDocument;
  '\n  query ExportField(\n    $id: UUID!\n    $presetId: String!\n    $space: ExportSpace\n    $unit: LengthUnit\n    $categoryId: UUID\n    $codeField: CodeField\n  ) {\n    exportField(\n      projectId: $id\n      presetId: $presetId\n      space: $space\n      unit: $unit\n      categoryId: $categoryId\n      codeField: $codeField\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.ExportFieldDocument;
  '\n  mutation DetectFieldFormat($content: String!) {\n    detectFieldFormat(contentBase64: $content) {\n      format\n      needsMapping\n    }\n  }\n': typeof types.DetectFieldFormatDocument;
  '\n  mutation ImportAsBuilt(\n    $id: UUID!\n    $content: String!\n    $filename: String\n    $format: FieldFormat\n    $presetId: String\n    $space: ExportSpace\n    $unit: LengthUnit\n    $baselineScope: BaselineScope\n    $baselineRefId: UUID\n  ) {\n    importAsBuilt(\n      projectId: $id\n      contentBase64: $content\n      filename: $filename\n      format: $format\n      presetId: $presetId\n      space: $space\n      unit: $unit\n      baselineScope: $baselineScope\n      baselineRefId: $baselineRefId\n    ) {\n      id\n    }\n  }\n': typeof types.ImportAsBuiltDocument;
  '\n  query AsBuiltBatches($id: UUID!) {\n    asBuiltBatches(projectId: $id) {\n      id\n      sourceFilename\n      format\n      baselineScope\n      reportUnit\n      createdAt\n    }\n  }\n': typeof types.AsBuiltBatchesDocument;
  '\n  query Comparison($batchId: UUID!) {\n    comparison(batchId: $batchId) {\n      batch {\n        id\n        sourceFilename\n        reportUnit\n        createdAt\n      }\n      summary {\n        pass\n        warn\n        fail\n        unmatched\n        noVertical\n        maxMiss\n        rmsMiss\n      }\n      rows {\n        id\n        asBuiltLabel\n        asBuiltN\n        asBuiltE\n        asBuiltZ\n        designPointId\n        designN\n        designE\n        designZ\n        matchMethod\n        deltaN\n        deltaE\n        deltaZ\n        deltaHRadial\n        deltaGridN\n        deltaGridE\n        status\n        asBuiltLatitude\n        asBuiltLongitude\n        asBuiltHeight\n        designLatitude\n        designLongitude\n        designHeight\n      }\n    }\n  }\n': typeof types.ComparisonDocument;
  '\n  query ComparisonReportCsv($batchId: UUID!) {\n    comparisonReportCsv(batchId: $batchId) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.ComparisonReportCsvDocument;
  '\n  query ComparisonReportPdf($batchId: UUID!) {\n    comparisonReportPdf(batchId: $batchId) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.ComparisonReportPdfDocument;
  '\n  mutation RepairComparison($batchId: UUID!, $compId: UUID!, $designPointId: UUID!) {\n    repairComparison(batchId: $batchId, asBuiltCompId: $compId, designPointId: $designPointId) {\n      id\n    }\n  }\n': typeof types.RepairComparisonDocument;
  '\n  mutation DeleteAsBuiltBatch($batchId: UUID!) {\n    deleteAsBuiltBatch(batchId: $batchId)\n  }\n': typeof types.DeleteAsBuiltBatchDocument;
  '\n  query DesignPointsForPairing($id: UUID!) {\n    surveyPoints(projectId: $id, limit: 1000) {\n      id\n      label\n    }\n  }\n': typeof types.DesignPointsForPairingDocument;
  '\n  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {\n    updateProject(\n      id: $id\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n': typeof types.UpdateGeoreferenceDocument;
  '\n  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {\n    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {\n      id\n    }\n  }\n': typeof types.SetGridAxesDocument;
  '\n  query GroupManagerGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n': typeof types.GroupManagerGroupsDocument;
  '\n  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n': typeof types.GroupManagerCreateDocument;
  '\n  mutation GroupManagerDelete($id: UUID!) {\n    deletePointGroup(id: $id)\n  }\n': typeof types.GroupManagerDeleteDocument;
  '\n  mutation ImportPoints(\n    $id: UUID!\n    $format: ImportFormat!\n    $content: String!\n    $unit: LengthUnit!\n    $mapping: CsvMappingInput\n    $filename: String\n    $categoryId: UUID\n    $profile: String\n  ) {\n    importPoints(\n      projectId: $id\n      format: $format\n      content: $content\n      unit: $unit\n      mapping: $mapping\n      sourceFilename: $filename\n      categoryId: $categoryId\n      saveProfileName: $profile\n    ) {\n      rowCount\n    }\n  }\n': typeof types.ImportPointsDocument;
  '\n  mutation ImportProject($content: String!) {\n    importProject(content: $content) {\n      id\n      name\n    }\n  }\n': typeof types.ImportProjectDocument;
  '\n  query Scene($id: UUID!) {\n    sceneData(projectId: $id) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n      utilityRuns {\n        id\n        typeKey\n        label\n        apwaColor\n        diameter\n        vertices {\n          latitude\n          longitude\n          height\n        }\n      }\n      utilityStructures {\n        id\n        typeKey\n        label\n        apwaColor\n        latitude\n        longitude\n        rimElev\n        easting\n        northing\n      }\n    }\n    projectTerrain(projectId: $id) {\n      demtype\n      fetchedAt\n    }\n    projectBuildings(projectId: $id) {\n      count\n      fetchedAt\n    }\n    cadOverlays(projectId: $id) {\n      id\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      elevation\n      visible\n    }\n    pointGroups(projectId: $id) {\n      id\n      name\n      memberIds\n    }\n  }\n': typeof types.SceneDocument;
  '\n  query TerrainContent($id: UUID!) {\n    projectTerrainContent(projectId: $id)\n  }\n': typeof types.TerrainContentDocument;
  '\n  query BuildingsContent($id: UUID!) {\n    projectBuildingsContent(projectId: $id)\n  }\n': typeof types.BuildingsContentDocument;
  '\n  query OverlayGeometry($id: UUID!) {\n    cadOverlayGeometry(id: $id) {\n      layers\n      polylines {\n        layer\n        points {\n          x\n          y\n        }\n      }\n    }\n  }\n': typeof types.OverlayGeometryDocument;
  '\n  mutation RefreshTerrain(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshTerrain(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      demtype\n      fetchedAt\n    }\n  }\n': typeof types.RefreshTerrainDocument;
  '\n  mutation RefreshBuildings(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshBuildings(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      count\n      fetchedAt\n    }\n  }\n': typeof types.RefreshBuildingsDocument;
  '\n  query Surfaces($projectId: UUID!) {\n    surfaces(projectId: $projectId) {\n      id\n      name\n      version\n      kind\n      status\n      failureReason\n      vertexCount\n      triangleCount\n      createdAt\n    }\n  }\n': typeof types.SurfacesDocument;
  '\n  query SurfaceMesh($id: UUID!) {\n    surfaceMesh(id: $id) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.SurfaceMeshDocument;
  '\n  query SurfaceContours($id: UUID!, $interval: Float!, $majorInterval: Float, $smoothing: Int) {\n    surfaceContours(\n      id: $id\n      interval: $interval\n      majorInterval: $majorInterval\n      smoothing: $smoothing\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.SurfaceContoursDocument;
  '\n  mutation BuildSurface($projectId: UUID!, $input: SurfaceInput!) {\n    buildSurface(projectId: $projectId, input: $input) {\n      id\n      version\n      vertexCount\n      triangleCount\n    }\n  }\n': typeof types.BuildSurfaceDocument;
  '\n  mutation BuildDemSurface(\n    $projectId: UUID!\n    $name: String!\n    $filename: String!\n    $contentBase64: String!\n    $grid: DemGridInput!\n  ) {\n    buildDemSurface(\n      projectId: $projectId\n      name: $name\n      filename: $filename\n      contentBase64: $contentBase64\n      grid: $grid\n    ) {\n      id\n      vertexCount\n      triangleCount\n    }\n  }\n': typeof types.BuildDemSurfaceDocument;
  '\n  mutation RebuildSurface($id: UUID!, $input: SurfaceInput!) {\n    rebuildSurface(id: $id, input: $input) {\n      id\n      version\n      vertexCount\n      triangleCount\n    }\n  }\n': typeof types.RebuildSurfaceDocument;
  '\n  query ExportSurface(\n    $id: UUID!\n    $format: SurfaceExportFormat!\n    $contourInterval: Float\n    $cellSize: Float\n  ) {\n    exportSurface(\n      id: $id\n      format: $format\n      contourInterval: $contourInterval\n      cellSize: $cellSize\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.ExportSurfaceDocument;
  '\n  query ExportVolumeReport($id: UUID!, $format: VolumeReportFormat!, $unit: VolumeUnit) {\n    exportVolumeReport(id: $id, format: $format, unit: $unit) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.ExportVolumeReportDocument;
  '\n  mutation DeleteSurface($id: UUID!) {\n    deleteSurface(id: $id)\n  }\n': typeof types.DeleteSurfaceDocument;
  '\n  query Volumes($projectId: UUID!) {\n    volumes(projectId: $projectId) {\n      id\n      name\n      comparison\n      baseSurfaceId\n      baseVersion\n      compareSurfaceId\n      compareVersion\n      referenceElev\n      cellSize\n      cutVolume\n      fillVolume\n      netVolume\n      area\n      hasHeatmap\n      computedAt\n    }\n  }\n': typeof types.VolumesDocument;
  '\n  mutation ComputeVolume($projectId: UUID!, $input: VolumeInput!) {\n    computeVolume(projectId: $projectId, input: $input) {\n      id\n      cutVolume\n      fillVolume\n      netVolume\n      area\n    }\n  }\n': typeof types.ComputeVolumeDocument;
  '\n  mutation DeleteVolume($id: UUID!) {\n    deleteVolume(id: $id)\n  }\n': typeof types.DeleteVolumeDocument;
  '\n  query VolumeHeatmap($id: UUID!) {\n    volumeHeatmap(id: $id) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.VolumeHeatmapDocument;
  '\n  query Breaklines($projectId: UUID!) {\n    breaklines(projectId: $projectId) {\n      id\n      kind\n      closed\n      vertices\n      source\n      sourceLayer\n    }\n  }\n': typeof types.BreaklinesDocument;
  '\n  mutation CreateBreakline($projectId: UUID!, $input: BreaklineInput!) {\n    createBreakline(projectId: $projectId, input: $input) {\n      id\n      kind\n    }\n  }\n': typeof types.CreateBreaklineDocument;
  '\n  mutation DeleteBreakline($id: UUID!) {\n    deleteBreakline(id: $id)\n  }\n': typeof types.DeleteBreaklineDocument;
  '\n  mutation AutoBoundary($projectId: UUID!, $scope: PointScope!, $scopeRef: UUID) {\n    autoBoundary(projectId: $projectId, scope: $scope, scopeRef: $scopeRef) {\n      id\n      kind\n    }\n  }\n': typeof types.AutoBoundaryDocument;
  '\n  query PreviewBreaklineImport($projectId: UUID!, $contentBase64: String!) {\n    previewBreaklineImport(projectId: $projectId, contentBase64: $contentBase64) {\n      layers {\n        layer\n        count\n        suggestedKind\n      }\n    }\n  }\n': typeof types.PreviewBreaklineImportDocument;
  '\n  mutation ImportBreaklines(\n    $projectId: UUID!\n    $contentBase64: String!\n    $mappings: [BreaklineLayerMapping!]!\n    $unit: LengthUnit\n  ) {\n    importBreaklines(\n      projectId: $projectId\n      contentBase64: $contentBase64\n      mappings: $mappings\n      unit: $unit\n    ) {\n      created\n      skipped\n    }\n  }\n': typeof types.ImportBreaklinesDocument;
  '\n  query SurveyPoints(\n    $id: UUID!\n    $search: String\n    $cat: UUID\n    $group: UUID\n    $limit: Int\n    $offset: Int\n    $sort: String\n    $descending: Boolean\n  ) {\n    surveyPoints(\n      projectId: $id\n      search: $search\n      categoryId: $cat\n      groupId: $group\n      limit: $limit\n      offset: $offset\n      sort: $sort\n      descending: $descending\n    ) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      description\n      categoryId\n      tags\n      importBatchId\n    }\n    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)\n  }\n': typeof types.SurveyPointsDocument;
  '\n  mutation DeleteSurveyPoint($id: UUID!) {\n    deleteSurveyPoint(id: $id)\n  }\n': typeof types.DeleteSurveyPointDocument;
  '\n  mutation DeleteSurveyPoints($ids: [UUID!]!) {\n    deleteSurveyPoints(ids: $ids)\n  }\n': typeof types.DeleteSurveyPointsDocument;
  '\n  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {\n    assignCategory(ids: $ids, categoryId: $cat)\n  }\n': typeof types.AssignCategoryDocument;
  '\n  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n': typeof types.CreatePointGroupDocument;
  '\n  query PointGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n': typeof types.PointGroupsDocument;
  '\n  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {\n    addPointsToGroup(groupId: $groupId, memberIds: $ids) {\n      id\n      memberIds\n    }\n  }\n': typeof types.AddPointsToGroupDocument;
  '\n  mutation SolveTransform($id: UUID!) {\n    solveTransform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n  }\n': typeof types.SolveTransformDocument;
  '\n  query UtilityTypes {\n    utilityTypes {\n      key\n      label\n      apwaColor\n      defaultGeometry\n    }\n  }\n': typeof types.UtilityTypesDocument;
  '\n  query Utilities(\n    $projectId: UUID!\n    $typeKey: String\n    $level: String\n    $search: String\n    $limit: Int\n    $offset: Int\n  ) {\n    utilities(\n      projectId: $projectId\n      typeKey: $typeKey\n      level: $level\n      search: $search\n      limit: $limit\n      offset: $offset\n    ) {\n      runs {\n        id\n        typeKey\n        label\n        level\n        diameter\n        material\n        invertUp\n        invertDown\n        slope\n        length\n        source\n        tags\n        vertices {\n          seq\n          northing\n          easting\n          elevation\n          sourcePointId\n        }\n      }\n      structures {\n        id\n        typeKey\n        label\n        level\n        northing\n        easting\n        rimElev\n        material\n        source\n        tags\n      }\n    }\n  }\n': typeof types.UtilitiesDocument;
  '\n  query UtilityCount($projectId: UUID!, $typeKey: String, $level: String, $search: String) {\n    utilityCount(projectId: $projectId, typeKey: $typeKey, level: $level, search: $search)\n  }\n': typeof types.UtilityCountDocument;
  '\n  mutation CreateUtilityRun(\n    $projectId: UUID!\n    $input: UtilityRunInput!\n    $vertices: [UtilityVertexInput!]!\n  ) {\n    createUtilityRun(projectId: $projectId, input: $input, vertices: $vertices) {\n      id\n    }\n  }\n': typeof types.CreateUtilityRunDocument;
  '\n  mutation CreateUtilityStructure($projectId: UUID!, $input: UtilityStructureInput!) {\n    createUtilityStructure(projectId: $projectId, input: $input) {\n      id\n    }\n  }\n': typeof types.CreateUtilityStructureDocument;
  '\n  mutation DeleteUtilityRun($id: UUID!) {\n    deleteUtilityRun(id: $id)\n  }\n': typeof types.DeleteUtilityRunDocument;
  '\n  mutation DeleteUtilityStructure($id: UUID!) {\n    deleteUtilityStructure(id: $id)\n  }\n': typeof types.DeleteUtilityStructureDocument;
  '\n  query PreviewUtilityImport($projectId: UUID!, $format: String!, $contentBase64: String!) {\n    previewUtilityImport(projectId: $projectId, format: $format, contentBase64: $contentBase64) {\n      layers {\n        layer\n        kind\n        count\n        suggestedType\n      }\n    }\n  }\n': typeof types.PreviewUtilityImportDocument;
  '\n  query ExportUtilities($projectId: UUID!, $format: String!, $typeKey: String, $search: String) {\n    exportUtilities(projectId: $projectId, format: $format, typeKey: $typeKey, search: $search) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n': typeof types.ExportUtilitiesDocument;
  '\n  mutation ImportUtilities(\n    $projectId: UUID!\n    $format: String!\n    $contentBase64: String!\n    $mappings: [UtilityLayerMapping!]!\n    $space: String!\n    $unit: LengthUnit!\n    $source: String\n  ) {\n    importUtilities(\n      projectId: $projectId\n      format: $format\n      contentBase64: $contentBase64\n      mappings: $mappings\n      space: $space\n      unit: $unit\n      source: $source\n    ) {\n      runsCreated\n      structuresCreated\n      skipped\n    }\n  }\n': typeof types.ImportUtilitiesDocument;
  '\n  mutation ResetPassword($t: String!, $p: String!) {\n    resetPassword(token: $t, newPassword: $p)\n  }\n': typeof types.ResetPasswordDocument;
  '\n  mutation Signup($e: String!, $p: String!, $o: String!) {\n    signup(email: $e, password: $p, orgName: $o) {\n      verificationToken\n    }\n  }\n': typeof types.SignupDocument;
  '\n  mutation VerifyEmail($t: String!) {\n    verifyEmail(token: $t)\n  }\n': typeof types.VerifyEmailDocument;
  '\n  query Billing {\n    billing {\n      plan\n      status\n      currentPeriodEnd\n      cancelAtPeriodEnd\n      restricted\n      canExport\n      projects\n      admins\n      nonAdmin\n      maxProjects\n      maxAdmins\n      maxNonAdmin\n      adminEmails\n    }\n  }\n': typeof types.BillingDocument;
  '\n  mutation CreateCheckoutSession($interval: BillingInterval!) {\n    createCheckoutSession(interval: $interval)\n  }\n': typeof types.CreateCheckoutSessionDocument;
  '\n  mutation CreateBillingPortalSession {\n    createBillingPortalSession\n  }\n': typeof types.CreateBillingPortalSessionDocument;
  '\n  query PlanCatalog {\n    planCatalog {\n      features {\n        key\n        label\n        blurb\n        minPlan\n      }\n      plans {\n        plan\n        maxProjects\n        maxAdmins\n        maxNonAdmin\n      }\n    }\n  }\n': typeof types.PlanCatalogDocument;
  '\n  subscription ProjectChanged($projectId: UUID!) {\n    projectChanged(projectId: $projectId)\n  }\n': typeof types.ProjectChangedDocument;
};
const documents: Documents = {
  '\n  query Workspace($id: UUID!) {\n    project(id: $id) {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n    gridAxes(projectId: $id) {\n      id\n      projectId\n      family\n      label\n      position\n    }\n    controlPoints(projectId: $id) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      gridX\n      gridY\n      source\n    }\n    transform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n    categories {\n      id\n      orgId\n      name\n      color\n      icon\n      isDefault\n    }\n    cadOverlays(projectId: $id) {\n      id\n      projectId\n      originalFilename\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      elevation\n      assumeRealWorld\n      visible\n    }\n    surveyPointCount(projectId: $id)\n  }\n':
    types.WorkspaceDocument,
  '\n  query Projects {\n    projects {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n  }\n':
    types.ProjectsDocument,
  '\n  mutation DeleteProject($id: UUID!) {\n    deleteProject(id: $id)\n  }\n':
    types.DeleteProjectDocument,
  '\n  query BillingMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n':
    types.BillingMeDocument,
  '\n  query SettingsData {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n    organization {\n      id\n      name\n    }\n  }\n':
    types.SettingsDataDocument,
  '\n  mutation DeleteOrganization {\n    deleteOrganization\n  }\n':
    types.DeleteOrganizationDocument,
  '\n  query UsersMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n':
    types.UsersMeDocument,
  '\n  query OrgMembers {\n    orgMembers {\n      id\n      email\n      role\n      status\n      createdAt\n    }\n  }\n':
    types.OrgMembersDocument,
  '\n  mutation InviteUser($email: String!, $role: Role!) {\n    inviteUser(email: $email, role: $role) {\n      user {\n        id\n      }\n    }\n  }\n':
    types.InviteUserDocument,
  '\n  mutation UpdateUserRole($userId: UUID!, $role: Role!) {\n    updateUserRole(userId: $userId, role: $role) {\n      id\n    }\n  }\n':
    types.UpdateUserRoleDocument,
  '\n  mutation AdminResetPassword($userId: UUID!) {\n    adminResetPassword(userId: $userId)\n  }\n':
    types.AdminResetPasswordDocument,
  '\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId)\n  }\n':
    types.RemoveUserDocument,
  '\n  mutation AcceptInvite($t: String!, $p: String!) {\n    acceptInvite(token: $t, password: $p) {\n      id\n    }\n  }\n':
    types.AcceptInviteDocument,
  '\n  query Me {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n':
    types.MeDocument,
  '\n  mutation Logout {\n    logout\n  }\n': types.LogoutDocument,
  '\n  mutation RequestPasswordReset($e: String!) {\n    requestPasswordReset(email: $e)\n  }\n':
    types.RequestPasswordResetDocument,
  '\n  mutation Login($e: String!, $p: String!) {\n    login(email: $e, password: $p) {\n      id\n    }\n  }\n':
    types.LoginDocument,
  '\n  mutation ResendVerification($e: String!) {\n    resendVerification(email: $e)\n  }\n':
    types.ResendVerificationDocument,
  '\n  mutation AddSurveyPoint(\n    $projectId: UUID!\n    $label: String!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $elevation: Float\n    $description: String\n    $categoryId: UUID\n    $unit: LengthUnit!\n  ) {\n    addSurveyPoint(\n      projectId: $projectId\n      label: $label\n      space: $space\n      x: $x\n      y: $y\n      elevation: $elevation\n      description: $description\n      categoryId: $categoryId\n      unit: $unit\n    ) {\n      id\n    }\n  }\n':
    types.AddSurveyPointDocument,
  '\n  query Analyses($projectId: UUID!) {\n    analyses(projectId: $projectId) {\n      id\n      type\n      name\n      status\n      inputGeometry\n      result\n      resultGeometry\n    }\n  }\n':
    types.AnalysesDocument,
  '\n  query VehicleTemplates {\n    vehicleTemplates {\n      id\n      name\n      vehicleClass\n      wheelbase\n      width\n      isPreset\n    }\n  }\n':
    types.VehicleTemplatesDocument,
  '\n  mutation RunTurningAnalysis($projectId: UUID!, $input: TurningInput!) {\n    runTurningAnalysis(projectId: $projectId, input: $input) {\n      id\n      name\n      result\n    }\n  }\n':
    types.RunTurningAnalysisDocument,
  '\n  mutation CreateAnalysis($projectId: UUID!, $input: AnalysisInput!) {\n    createAnalysis(projectId: $projectId, input: $input) {\n      id\n      type\n      name\n    }\n  }\n':
    types.CreateAnalysisDocument,
  '\n  mutation UpdateAnalysis($id: UUID!, $input: AnalysisInput!) {\n    updateAnalysis(id: $id, input: $input) {\n      id\n    }\n  }\n':
    types.UpdateAnalysisDocument,
  '\n  mutation DeleteAnalysis($id: UUID!) {\n    deleteAnalysis(id: $id)\n  }\n':
    types.DeleteAnalysisDocument,
  '\n  mutation DuplicateAnalysis($id: UUID!) {\n    duplicateAnalysis(id: $id) {\n      id\n    }\n  }\n':
    types.DuplicateAnalysisDocument,
  '\n  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {\n    uploadDxf(projectId: $id, filename: $f, content: $c) {\n      id\n    }\n  }\n':
    types.UploadDxfDocument,
  '\n  mutation SetCadGeoreference(\n    $id: UUID!\n    $oe: Float\n    $on: Float\n    $rot: Float\n    $sc: Float\n    $el: Float\n    $vis: Boolean\n  ) {\n    setCadGeoreference(\n      id: $id\n      offsetE: $oe\n      offsetN: $on\n      rotationDeg: $rot\n      scale: $sc\n      elevation: $el\n      visible: $vis\n    ) {\n      id\n    }\n  }\n':
    types.SetCadGeoreferenceDocument,
  '\n  mutation DeleteCadOverlay($id: UUID!) {\n    deleteCadOverlay(id: $id)\n  }\n':
    types.DeleteCadOverlayDocument,
  '\n  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {\n    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {\n      projectedGridE\n      projectedGridN\n    }\n  }\n':
    types.SiteProjectedDocument,
  '\n  query CadOverlayGeom($id: UUID!) {\n    cadOverlayGeometry(id: $id) {\n      polylines {\n        layer\n        points {\n          x\n          y\n        }\n      }\n    }\n  }\n':
    types.CadOverlayGeomDocument,
  '\n  query OverlayScenePoints($id: UUID!) {\n    sceneData(projectId: $id) {\n      controlPoints {\n        easting\n        northing\n      }\n      surveyPoints {\n        easting\n        northing\n      }\n    }\n  }\n':
    types.OverlayScenePointsDocument,
  '\n  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {\n    createCategory(name: $name, color: $color, icon: $icon) {\n      id\n    }\n  }\n':
    types.CreateCategoryDocument,
  '\n  mutation DeleteCategory($id: UUID!) {\n    deleteCategory(id: $id)\n  }\n':
    types.DeleteCategoryDocument,
  '\n  mutation AddControlPoint(\n    $id: UUID!\n    $label: String!\n    $n: Float!\n    $e: Float!\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    addControlPoint(\n      projectId: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n':
    types.AddControlPointDocument,
  '\n  mutation UpdateControlPoint(\n    $id: UUID!\n    $label: String\n    $n: Float\n    $e: Float\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    updateControlPoint(\n      id: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n':
    types.UpdateControlPointDocument,
  '\n  mutation DeleteControlPoint($id: UUID!) {\n    deleteControlPoint(id: $id)\n  }\n':
    types.DeleteControlPointDocument,
  '\n  query StandaloneConvert(\n    $id: UUID!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $unit: LengthUnit!\n  ) {\n    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n':
    types.StandaloneConvertDocument,
  '\n  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {\n    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n':
    types.ConvertCoordinateDocument,
  '\n  mutation CreateProject(\n    $name: String!\n    $desc: String\n    $epsg: Int!\n    $unit: LengthUnit!\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    createProject(\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n':
    types.CreateProjectDocument,
  '\n  mutation UpdateProject(\n    $id: UUID!\n    $name: String\n    $desc: String\n    $epsg: Int\n    $unit: LengthUnit\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    updateProject(\n      id: $id\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n':
    types.UpdateProjectDocument,
  '\n  mutation UpdateSurveyPoint($id: UUID!, $label: String, $description: String, $categoryId: UUID) {\n    updateSurveyPoint(id: $id, label: $label, description: $description, categoryId: $categoryId) {\n      id\n    }\n  }\n':
    types.UpdateSurveyPointDocument,
  '\n  query SearchEpsg($q: String!, $limit: Int) {\n    searchEpsg(query: $q, limit: $limit) {\n      code\n      name\n    }\n  }\n':
    types.SearchEpsgDocument,
  '\n  query ExportPoints(\n    $id: UUID!\n    $format: ExportFormat!\n    $space: ExportSpace!\n    $unit: LengthUnit!\n    $columns: [ExportColumn!]\n    $pointIds: [UUID!]\n    $categoryId: UUID\n  ) {\n    exportPoints(\n      projectId: $id\n      format: $format\n      space: $space\n      unit: $unit\n      columns: $columns\n      pointIds: $pointIds\n      categoryId: $categoryId\n    )\n  }\n':
    types.ExportPointsDocument,
  '\n  query ProjectExport($id: UUID!) {\n    projectExport(projectId: $id)\n  }\n':
    types.ProjectExportDocument,
  '\n  query FieldExportPresets {\n    fieldExportPresets {\n      id\n      app\n      format\n      defaultSpace\n      defaultUnit\n      description\n    }\n  }\n':
    types.FieldExportPresetsDocument,
  '\n  query ExportField(\n    $id: UUID!\n    $presetId: String!\n    $space: ExportSpace\n    $unit: LengthUnit\n    $categoryId: UUID\n    $codeField: CodeField\n  ) {\n    exportField(\n      projectId: $id\n      presetId: $presetId\n      space: $space\n      unit: $unit\n      categoryId: $categoryId\n      codeField: $codeField\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.ExportFieldDocument,
  '\n  mutation DetectFieldFormat($content: String!) {\n    detectFieldFormat(contentBase64: $content) {\n      format\n      needsMapping\n    }\n  }\n':
    types.DetectFieldFormatDocument,
  '\n  mutation ImportAsBuilt(\n    $id: UUID!\n    $content: String!\n    $filename: String\n    $format: FieldFormat\n    $presetId: String\n    $space: ExportSpace\n    $unit: LengthUnit\n    $baselineScope: BaselineScope\n    $baselineRefId: UUID\n  ) {\n    importAsBuilt(\n      projectId: $id\n      contentBase64: $content\n      filename: $filename\n      format: $format\n      presetId: $presetId\n      space: $space\n      unit: $unit\n      baselineScope: $baselineScope\n      baselineRefId: $baselineRefId\n    ) {\n      id\n    }\n  }\n':
    types.ImportAsBuiltDocument,
  '\n  query AsBuiltBatches($id: UUID!) {\n    asBuiltBatches(projectId: $id) {\n      id\n      sourceFilename\n      format\n      baselineScope\n      reportUnit\n      createdAt\n    }\n  }\n':
    types.AsBuiltBatchesDocument,
  '\n  query Comparison($batchId: UUID!) {\n    comparison(batchId: $batchId) {\n      batch {\n        id\n        sourceFilename\n        reportUnit\n        createdAt\n      }\n      summary {\n        pass\n        warn\n        fail\n        unmatched\n        noVertical\n        maxMiss\n        rmsMiss\n      }\n      rows {\n        id\n        asBuiltLabel\n        asBuiltN\n        asBuiltE\n        asBuiltZ\n        designPointId\n        designN\n        designE\n        designZ\n        matchMethod\n        deltaN\n        deltaE\n        deltaZ\n        deltaHRadial\n        deltaGridN\n        deltaGridE\n        status\n        asBuiltLatitude\n        asBuiltLongitude\n        asBuiltHeight\n        designLatitude\n        designLongitude\n        designHeight\n      }\n    }\n  }\n':
    types.ComparisonDocument,
  '\n  query ComparisonReportCsv($batchId: UUID!) {\n    comparisonReportCsv(batchId: $batchId) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.ComparisonReportCsvDocument,
  '\n  query ComparisonReportPdf($batchId: UUID!) {\n    comparisonReportPdf(batchId: $batchId) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.ComparisonReportPdfDocument,
  '\n  mutation RepairComparison($batchId: UUID!, $compId: UUID!, $designPointId: UUID!) {\n    repairComparison(batchId: $batchId, asBuiltCompId: $compId, designPointId: $designPointId) {\n      id\n    }\n  }\n':
    types.RepairComparisonDocument,
  '\n  mutation DeleteAsBuiltBatch($batchId: UUID!) {\n    deleteAsBuiltBatch(batchId: $batchId)\n  }\n':
    types.DeleteAsBuiltBatchDocument,
  '\n  query DesignPointsForPairing($id: UUID!) {\n    surveyPoints(projectId: $id, limit: 1000) {\n      id\n      label\n    }\n  }\n':
    types.DesignPointsForPairingDocument,
  '\n  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {\n    updateProject(\n      id: $id\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n':
    types.UpdateGeoreferenceDocument,
  '\n  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {\n    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {\n      id\n    }\n  }\n':
    types.SetGridAxesDocument,
  '\n  query GroupManagerGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n':
    types.GroupManagerGroupsDocument,
  '\n  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n':
    types.GroupManagerCreateDocument,
  '\n  mutation GroupManagerDelete($id: UUID!) {\n    deletePointGroup(id: $id)\n  }\n':
    types.GroupManagerDeleteDocument,
  '\n  mutation ImportPoints(\n    $id: UUID!\n    $format: ImportFormat!\n    $content: String!\n    $unit: LengthUnit!\n    $mapping: CsvMappingInput\n    $filename: String\n    $categoryId: UUID\n    $profile: String\n  ) {\n    importPoints(\n      projectId: $id\n      format: $format\n      content: $content\n      unit: $unit\n      mapping: $mapping\n      sourceFilename: $filename\n      categoryId: $categoryId\n      saveProfileName: $profile\n    ) {\n      rowCount\n    }\n  }\n':
    types.ImportPointsDocument,
  '\n  mutation ImportProject($content: String!) {\n    importProject(content: $content) {\n      id\n      name\n    }\n  }\n':
    types.ImportProjectDocument,
  '\n  query Scene($id: UUID!) {\n    sceneData(projectId: $id) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n      utilityRuns {\n        id\n        typeKey\n        label\n        apwaColor\n        diameter\n        vertices {\n          latitude\n          longitude\n          height\n        }\n      }\n      utilityStructures {\n        id\n        typeKey\n        label\n        apwaColor\n        latitude\n        longitude\n        rimElev\n        easting\n        northing\n      }\n    }\n    projectTerrain(projectId: $id) {\n      demtype\n      fetchedAt\n    }\n    projectBuildings(projectId: $id) {\n      count\n      fetchedAt\n    }\n    cadOverlays(projectId: $id) {\n      id\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      elevation\n      visible\n    }\n    pointGroups(projectId: $id) {\n      id\n      name\n      memberIds\n    }\n  }\n':
    types.SceneDocument,
  '\n  query TerrainContent($id: UUID!) {\n    projectTerrainContent(projectId: $id)\n  }\n':
    types.TerrainContentDocument,
  '\n  query BuildingsContent($id: UUID!) {\n    projectBuildingsContent(projectId: $id)\n  }\n':
    types.BuildingsContentDocument,
  '\n  query OverlayGeometry($id: UUID!) {\n    cadOverlayGeometry(id: $id) {\n      layers\n      polylines {\n        layer\n        points {\n          x\n          y\n        }\n      }\n    }\n  }\n':
    types.OverlayGeometryDocument,
  '\n  mutation RefreshTerrain(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshTerrain(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      demtype\n      fetchedAt\n    }\n  }\n':
    types.RefreshTerrainDocument,
  '\n  mutation RefreshBuildings(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshBuildings(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      count\n      fetchedAt\n    }\n  }\n':
    types.RefreshBuildingsDocument,
  '\n  query Surfaces($projectId: UUID!) {\n    surfaces(projectId: $projectId) {\n      id\n      name\n      version\n      kind\n      status\n      failureReason\n      vertexCount\n      triangleCount\n      createdAt\n    }\n  }\n':
    types.SurfacesDocument,
  '\n  query SurfaceMesh($id: UUID!) {\n    surfaceMesh(id: $id) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.SurfaceMeshDocument,
  '\n  query SurfaceContours($id: UUID!, $interval: Float!, $majorInterval: Float, $smoothing: Int) {\n    surfaceContours(\n      id: $id\n      interval: $interval\n      majorInterval: $majorInterval\n      smoothing: $smoothing\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.SurfaceContoursDocument,
  '\n  mutation BuildSurface($projectId: UUID!, $input: SurfaceInput!) {\n    buildSurface(projectId: $projectId, input: $input) {\n      id\n      version\n      vertexCount\n      triangleCount\n    }\n  }\n':
    types.BuildSurfaceDocument,
  '\n  mutation BuildDemSurface(\n    $projectId: UUID!\n    $name: String!\n    $filename: String!\n    $contentBase64: String!\n    $grid: DemGridInput!\n  ) {\n    buildDemSurface(\n      projectId: $projectId\n      name: $name\n      filename: $filename\n      contentBase64: $contentBase64\n      grid: $grid\n    ) {\n      id\n      vertexCount\n      triangleCount\n    }\n  }\n':
    types.BuildDemSurfaceDocument,
  '\n  mutation RebuildSurface($id: UUID!, $input: SurfaceInput!) {\n    rebuildSurface(id: $id, input: $input) {\n      id\n      version\n      vertexCount\n      triangleCount\n    }\n  }\n':
    types.RebuildSurfaceDocument,
  '\n  query ExportSurface(\n    $id: UUID!\n    $format: SurfaceExportFormat!\n    $contourInterval: Float\n    $cellSize: Float\n  ) {\n    exportSurface(\n      id: $id\n      format: $format\n      contourInterval: $contourInterval\n      cellSize: $cellSize\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.ExportSurfaceDocument,
  '\n  query ExportVolumeReport($id: UUID!, $format: VolumeReportFormat!, $unit: VolumeUnit) {\n    exportVolumeReport(id: $id, format: $format, unit: $unit) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.ExportVolumeReportDocument,
  '\n  mutation DeleteSurface($id: UUID!) {\n    deleteSurface(id: $id)\n  }\n':
    types.DeleteSurfaceDocument,
  '\n  query Volumes($projectId: UUID!) {\n    volumes(projectId: $projectId) {\n      id\n      name\n      comparison\n      baseSurfaceId\n      baseVersion\n      compareSurfaceId\n      compareVersion\n      referenceElev\n      cellSize\n      cutVolume\n      fillVolume\n      netVolume\n      area\n      hasHeatmap\n      computedAt\n    }\n  }\n':
    types.VolumesDocument,
  '\n  mutation ComputeVolume($projectId: UUID!, $input: VolumeInput!) {\n    computeVolume(projectId: $projectId, input: $input) {\n      id\n      cutVolume\n      fillVolume\n      netVolume\n      area\n    }\n  }\n':
    types.ComputeVolumeDocument,
  '\n  mutation DeleteVolume($id: UUID!) {\n    deleteVolume(id: $id)\n  }\n':
    types.DeleteVolumeDocument,
  '\n  query VolumeHeatmap($id: UUID!) {\n    volumeHeatmap(id: $id) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.VolumeHeatmapDocument,
  '\n  query Breaklines($projectId: UUID!) {\n    breaklines(projectId: $projectId) {\n      id\n      kind\n      closed\n      vertices\n      source\n      sourceLayer\n    }\n  }\n':
    types.BreaklinesDocument,
  '\n  mutation CreateBreakline($projectId: UUID!, $input: BreaklineInput!) {\n    createBreakline(projectId: $projectId, input: $input) {\n      id\n      kind\n    }\n  }\n':
    types.CreateBreaklineDocument,
  '\n  mutation DeleteBreakline($id: UUID!) {\n    deleteBreakline(id: $id)\n  }\n':
    types.DeleteBreaklineDocument,
  '\n  mutation AutoBoundary($projectId: UUID!, $scope: PointScope!, $scopeRef: UUID) {\n    autoBoundary(projectId: $projectId, scope: $scope, scopeRef: $scopeRef) {\n      id\n      kind\n    }\n  }\n':
    types.AutoBoundaryDocument,
  '\n  query PreviewBreaklineImport($projectId: UUID!, $contentBase64: String!) {\n    previewBreaklineImport(projectId: $projectId, contentBase64: $contentBase64) {\n      layers {\n        layer\n        count\n        suggestedKind\n      }\n    }\n  }\n':
    types.PreviewBreaklineImportDocument,
  '\n  mutation ImportBreaklines(\n    $projectId: UUID!\n    $contentBase64: String!\n    $mappings: [BreaklineLayerMapping!]!\n    $unit: LengthUnit\n  ) {\n    importBreaklines(\n      projectId: $projectId\n      contentBase64: $contentBase64\n      mappings: $mappings\n      unit: $unit\n    ) {\n      created\n      skipped\n    }\n  }\n':
    types.ImportBreaklinesDocument,
  '\n  query SurveyPoints(\n    $id: UUID!\n    $search: String\n    $cat: UUID\n    $group: UUID\n    $limit: Int\n    $offset: Int\n    $sort: String\n    $descending: Boolean\n  ) {\n    surveyPoints(\n      projectId: $id\n      search: $search\n      categoryId: $cat\n      groupId: $group\n      limit: $limit\n      offset: $offset\n      sort: $sort\n      descending: $descending\n    ) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      description\n      categoryId\n      tags\n      importBatchId\n    }\n    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)\n  }\n':
    types.SurveyPointsDocument,
  '\n  mutation DeleteSurveyPoint($id: UUID!) {\n    deleteSurveyPoint(id: $id)\n  }\n':
    types.DeleteSurveyPointDocument,
  '\n  mutation DeleteSurveyPoints($ids: [UUID!]!) {\n    deleteSurveyPoints(ids: $ids)\n  }\n':
    types.DeleteSurveyPointsDocument,
  '\n  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {\n    assignCategory(ids: $ids, categoryId: $cat)\n  }\n':
    types.AssignCategoryDocument,
  '\n  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n':
    types.CreatePointGroupDocument,
  '\n  query PointGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n':
    types.PointGroupsDocument,
  '\n  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {\n    addPointsToGroup(groupId: $groupId, memberIds: $ids) {\n      id\n      memberIds\n    }\n  }\n':
    types.AddPointsToGroupDocument,
  '\n  mutation SolveTransform($id: UUID!) {\n    solveTransform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n  }\n':
    types.SolveTransformDocument,
  '\n  query UtilityTypes {\n    utilityTypes {\n      key\n      label\n      apwaColor\n      defaultGeometry\n    }\n  }\n':
    types.UtilityTypesDocument,
  '\n  query Utilities(\n    $projectId: UUID!\n    $typeKey: String\n    $level: String\n    $search: String\n    $limit: Int\n    $offset: Int\n  ) {\n    utilities(\n      projectId: $projectId\n      typeKey: $typeKey\n      level: $level\n      search: $search\n      limit: $limit\n      offset: $offset\n    ) {\n      runs {\n        id\n        typeKey\n        label\n        level\n        diameter\n        material\n        invertUp\n        invertDown\n        slope\n        length\n        source\n        tags\n        vertices {\n          seq\n          northing\n          easting\n          elevation\n          sourcePointId\n        }\n      }\n      structures {\n        id\n        typeKey\n        label\n        level\n        northing\n        easting\n        rimElev\n        material\n        source\n        tags\n      }\n    }\n  }\n':
    types.UtilitiesDocument,
  '\n  query UtilityCount($projectId: UUID!, $typeKey: String, $level: String, $search: String) {\n    utilityCount(projectId: $projectId, typeKey: $typeKey, level: $level, search: $search)\n  }\n':
    types.UtilityCountDocument,
  '\n  mutation CreateUtilityRun(\n    $projectId: UUID!\n    $input: UtilityRunInput!\n    $vertices: [UtilityVertexInput!]!\n  ) {\n    createUtilityRun(projectId: $projectId, input: $input, vertices: $vertices) {\n      id\n    }\n  }\n':
    types.CreateUtilityRunDocument,
  '\n  mutation CreateUtilityStructure($projectId: UUID!, $input: UtilityStructureInput!) {\n    createUtilityStructure(projectId: $projectId, input: $input) {\n      id\n    }\n  }\n':
    types.CreateUtilityStructureDocument,
  '\n  mutation DeleteUtilityRun($id: UUID!) {\n    deleteUtilityRun(id: $id)\n  }\n':
    types.DeleteUtilityRunDocument,
  '\n  mutation DeleteUtilityStructure($id: UUID!) {\n    deleteUtilityStructure(id: $id)\n  }\n':
    types.DeleteUtilityStructureDocument,
  '\n  query PreviewUtilityImport($projectId: UUID!, $format: String!, $contentBase64: String!) {\n    previewUtilityImport(projectId: $projectId, format: $format, contentBase64: $contentBase64) {\n      layers {\n        layer\n        kind\n        count\n        suggestedType\n      }\n    }\n  }\n':
    types.PreviewUtilityImportDocument,
  '\n  query ExportUtilities($projectId: UUID!, $format: String!, $typeKey: String, $search: String) {\n    exportUtilities(projectId: $projectId, format: $format, typeKey: $typeKey, search: $search) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n':
    types.ExportUtilitiesDocument,
  '\n  mutation ImportUtilities(\n    $projectId: UUID!\n    $format: String!\n    $contentBase64: String!\n    $mappings: [UtilityLayerMapping!]!\n    $space: String!\n    $unit: LengthUnit!\n    $source: String\n  ) {\n    importUtilities(\n      projectId: $projectId\n      format: $format\n      contentBase64: $contentBase64\n      mappings: $mappings\n      space: $space\n      unit: $unit\n      source: $source\n    ) {\n      runsCreated\n      structuresCreated\n      skipped\n    }\n  }\n':
    types.ImportUtilitiesDocument,
  '\n  mutation ResetPassword($t: String!, $p: String!) {\n    resetPassword(token: $t, newPassword: $p)\n  }\n':
    types.ResetPasswordDocument,
  '\n  mutation Signup($e: String!, $p: String!, $o: String!) {\n    signup(email: $e, password: $p, orgName: $o) {\n      verificationToken\n    }\n  }\n':
    types.SignupDocument,
  '\n  mutation VerifyEmail($t: String!) {\n    verifyEmail(token: $t)\n  }\n':
    types.VerifyEmailDocument,
  '\n  query Billing {\n    billing {\n      plan\n      status\n      currentPeriodEnd\n      cancelAtPeriodEnd\n      restricted\n      canExport\n      projects\n      admins\n      nonAdmin\n      maxProjects\n      maxAdmins\n      maxNonAdmin\n      adminEmails\n    }\n  }\n':
    types.BillingDocument,
  '\n  mutation CreateCheckoutSession($interval: BillingInterval!) {\n    createCheckoutSession(interval: $interval)\n  }\n':
    types.CreateCheckoutSessionDocument,
  '\n  mutation CreateBillingPortalSession {\n    createBillingPortalSession\n  }\n':
    types.CreateBillingPortalSessionDocument,
  '\n  query PlanCatalog {\n    planCatalog {\n      features {\n        key\n        label\n        blurb\n        minPlan\n      }\n      plans {\n        plan\n        maxProjects\n        maxAdmins\n        maxNonAdmin\n      }\n    }\n  }\n':
    types.PlanCatalogDocument,
  '\n  subscription ProjectChanged($projectId: UUID!) {\n    projectChanged(projectId: $projectId)\n  }\n':
    types.ProjectChangedDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Workspace($id: UUID!) {\n    project(id: $id) {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n    gridAxes(projectId: $id) {\n      id\n      projectId\n      family\n      label\n      position\n    }\n    controlPoints(projectId: $id) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      gridX\n      gridY\n      source\n    }\n    transform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n    categories {\n      id\n      orgId\n      name\n      color\n      icon\n      isDefault\n    }\n    cadOverlays(projectId: $id) {\n      id\n      projectId\n      originalFilename\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      elevation\n      assumeRealWorld\n      visible\n    }\n    surveyPointCount(projectId: $id)\n  }\n',
): typeof import('./graphql').WorkspaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Projects {\n    projects {\n      id\n      orgId\n      name\n      description\n      epsgCode\n      displayUnit\n      combinedScaleFactor\n      siteOriginLat\n      siteOriginLon\n      siteOriginRotationDeg\n      createdAt\n      updatedAt\n    }\n  }\n',
): typeof import('./graphql').ProjectsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteProject($id: UUID!) {\n    deleteProject(id: $id)\n  }\n',
): typeof import('./graphql').DeleteProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query BillingMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n',
): typeof import('./graphql').BillingMeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query SettingsData {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n    organization {\n      id\n      name\n    }\n  }\n',
): typeof import('./graphql').SettingsDataDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteOrganization {\n    deleteOrganization\n  }\n',
): typeof import('./graphql').DeleteOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UsersMe {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n',
): typeof import('./graphql').UsersMeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query OrgMembers {\n    orgMembers {\n      id\n      email\n      role\n      status\n      createdAt\n    }\n  }\n',
): typeof import('./graphql').OrgMembersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation InviteUser($email: String!, $role: Role!) {\n    inviteUser(email: $email, role: $role) {\n      user {\n        id\n      }\n    }\n  }\n',
): typeof import('./graphql').InviteUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UpdateUserRole($userId: UUID!, $role: Role!) {\n    updateUserRole(userId: $userId, role: $role) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UpdateUserRoleDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AdminResetPassword($userId: UUID!) {\n    adminResetPassword(userId: $userId)\n  }\n',
): typeof import('./graphql').AdminResetPasswordDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId)\n  }\n',
): typeof import('./graphql').RemoveUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AcceptInvite($t: String!, $p: String!) {\n    acceptInvite(token: $t, password: $p) {\n      id\n    }\n  }\n',
): typeof import('./graphql').AcceptInviteDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Me {\n    me {\n      id\n      orgId\n      email\n      role\n      emailVerified\n    }\n  }\n',
): typeof import('./graphql').MeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation Logout {\n    logout\n  }\n',
): typeof import('./graphql').LogoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RequestPasswordReset($e: String!) {\n    requestPasswordReset(email: $e)\n  }\n',
): typeof import('./graphql').RequestPasswordResetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation Login($e: String!, $p: String!) {\n    login(email: $e, password: $p) {\n      id\n    }\n  }\n',
): typeof import('./graphql').LoginDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ResendVerification($e: String!) {\n    resendVerification(email: $e)\n  }\n',
): typeof import('./graphql').ResendVerificationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AddSurveyPoint(\n    $projectId: UUID!\n    $label: String!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $elevation: Float\n    $description: String\n    $categoryId: UUID\n    $unit: LengthUnit!\n  ) {\n    addSurveyPoint(\n      projectId: $projectId\n      label: $label\n      space: $space\n      x: $x\n      y: $y\n      elevation: $elevation\n      description: $description\n      categoryId: $categoryId\n      unit: $unit\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').AddSurveyPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Analyses($projectId: UUID!) {\n    analyses(projectId: $projectId) {\n      id\n      type\n      name\n      status\n      inputGeometry\n      result\n      resultGeometry\n    }\n  }\n',
): typeof import('./graphql').AnalysesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query VehicleTemplates {\n    vehicleTemplates {\n      id\n      name\n      vehicleClass\n      wheelbase\n      width\n      isPreset\n    }\n  }\n',
): typeof import('./graphql').VehicleTemplatesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RunTurningAnalysis($projectId: UUID!, $input: TurningInput!) {\n    runTurningAnalysis(projectId: $projectId, input: $input) {\n      id\n      name\n      result\n    }\n  }\n',
): typeof import('./graphql').RunTurningAnalysisDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateAnalysis($projectId: UUID!, $input: AnalysisInput!) {\n    createAnalysis(projectId: $projectId, input: $input) {\n      id\n      type\n      name\n    }\n  }\n',
): typeof import('./graphql').CreateAnalysisDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UpdateAnalysis($id: UUID!, $input: AnalysisInput!) {\n    updateAnalysis(id: $id, input: $input) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UpdateAnalysisDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteAnalysis($id: UUID!) {\n    deleteAnalysis(id: $id)\n  }\n',
): typeof import('./graphql').DeleteAnalysisDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DuplicateAnalysis($id: UUID!) {\n    duplicateAnalysis(id: $id) {\n      id\n    }\n  }\n',
): typeof import('./graphql').DuplicateAnalysisDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {\n    uploadDxf(projectId: $id, filename: $f, content: $c) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UploadDxfDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation SetCadGeoreference(\n    $id: UUID!\n    $oe: Float\n    $on: Float\n    $rot: Float\n    $sc: Float\n    $el: Float\n    $vis: Boolean\n  ) {\n    setCadGeoreference(\n      id: $id\n      offsetE: $oe\n      offsetN: $on\n      rotationDeg: $rot\n      scale: $sc\n      elevation: $el\n      visible: $vis\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').SetCadGeoreferenceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteCadOverlay($id: UUID!) {\n    deleteCadOverlay(id: $id)\n  }\n',
): typeof import('./graphql').DeleteCadOverlayDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {\n    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {\n      projectedGridE\n      projectedGridN\n    }\n  }\n',
): typeof import('./graphql').SiteProjectedDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query CadOverlayGeom($id: UUID!) {\n    cadOverlayGeometry(id: $id) {\n      polylines {\n        layer\n        points {\n          x\n          y\n        }\n      }\n    }\n  }\n',
): typeof import('./graphql').CadOverlayGeomDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query OverlayScenePoints($id: UUID!) {\n    sceneData(projectId: $id) {\n      controlPoints {\n        easting\n        northing\n      }\n      surveyPoints {\n        easting\n        northing\n      }\n    }\n  }\n',
): typeof import('./graphql').OverlayScenePointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateCategory($name: String!, $color: String!, $icon: String!) {\n    createCategory(name: $name, color: $color, icon: $icon) {\n      id\n    }\n  }\n',
): typeof import('./graphql').CreateCategoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteCategory($id: UUID!) {\n    deleteCategory(id: $id)\n  }\n',
): typeof import('./graphql').DeleteCategoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AddControlPoint(\n    $id: UUID!\n    $label: String!\n    $n: Float!\n    $e: Float!\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    addControlPoint(\n      projectId: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').AddControlPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UpdateControlPoint(\n    $id: UUID!\n    $label: String\n    $n: Float\n    $e: Float\n    $z: Float\n    $gx: Float\n    $gy: Float\n    $unit: LengthUnit!\n    $src: String\n  ) {\n    updateControlPoint(\n      id: $id\n      label: $label\n      northing: $n\n      easting: $e\n      elevation: $z\n      gridX: $gx\n      gridY: $gy\n      unit: $unit\n      source: $src\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UpdateControlPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteControlPoint($id: UUID!) {\n    deleteControlPoint(id: $id)\n  }\n',
): typeof import('./graphql').DeleteControlPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query StandaloneConvert(\n    $id: UUID!\n    $space: CoordinateSpace!\n    $x: Float!\n    $y: Float!\n    $unit: LengthUnit!\n  ) {\n    convertCoordinate(projectId: $id, space: $space, x: $x, y: $y, unit: $unit) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n',
): typeof import('./graphql').StandaloneConvertDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ConvertCoordinate($id: UUID!, $x: Float!, $y: Float!) {\n    convertCoordinate(projectId: $id, space: PROJECTED, x: $x, y: $y, unit: METER) {\n      gridX\n      gridY\n      projectedGridE\n      projectedGridN\n      projectedGroundE\n      projectedGroundN\n      latitude\n      longitude\n    }\n  }\n',
): typeof import('./graphql').ConvertCoordinateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateProject(\n    $name: String!\n    $desc: String\n    $epsg: Int!\n    $unit: LengthUnit!\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    createProject(\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').CreateProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UpdateProject(\n    $id: UUID!\n    $name: String\n    $desc: String\n    $epsg: Int\n    $unit: LengthUnit\n    $scale: Float\n    $lat: Float\n    $lon: Float\n    $rot: Float\n  ) {\n    updateProject(\n      id: $id\n      name: $name\n      description: $desc\n      epsgCode: $epsg\n      displayUnit: $unit\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UpdateProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UpdateSurveyPoint($id: UUID!, $label: String, $description: String, $categoryId: UUID) {\n    updateSurveyPoint(id: $id, label: $label, description: $description, categoryId: $categoryId) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UpdateSurveyPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query SearchEpsg($q: String!, $limit: Int) {\n    searchEpsg(query: $q, limit: $limit) {\n      code\n      name\n    }\n  }\n',
): typeof import('./graphql').SearchEpsgDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ExportPoints(\n    $id: UUID!\n    $format: ExportFormat!\n    $space: ExportSpace!\n    $unit: LengthUnit!\n    $columns: [ExportColumn!]\n    $pointIds: [UUID!]\n    $categoryId: UUID\n  ) {\n    exportPoints(\n      projectId: $id\n      format: $format\n      space: $space\n      unit: $unit\n      columns: $columns\n      pointIds: $pointIds\n      categoryId: $categoryId\n    )\n  }\n',
): typeof import('./graphql').ExportPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ProjectExport($id: UUID!) {\n    projectExport(projectId: $id)\n  }\n',
): typeof import('./graphql').ProjectExportDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query FieldExportPresets {\n    fieldExportPresets {\n      id\n      app\n      format\n      defaultSpace\n      defaultUnit\n      description\n    }\n  }\n',
): typeof import('./graphql').FieldExportPresetsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ExportField(\n    $id: UUID!\n    $presetId: String!\n    $space: ExportSpace\n    $unit: LengthUnit\n    $categoryId: UUID\n    $codeField: CodeField\n  ) {\n    exportField(\n      projectId: $id\n      presetId: $presetId\n      space: $space\n      unit: $unit\n      categoryId: $categoryId\n      codeField: $codeField\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').ExportFieldDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DetectFieldFormat($content: String!) {\n    detectFieldFormat(contentBase64: $content) {\n      format\n      needsMapping\n    }\n  }\n',
): typeof import('./graphql').DetectFieldFormatDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ImportAsBuilt(\n    $id: UUID!\n    $content: String!\n    $filename: String\n    $format: FieldFormat\n    $presetId: String\n    $space: ExportSpace\n    $unit: LengthUnit\n    $baselineScope: BaselineScope\n    $baselineRefId: UUID\n  ) {\n    importAsBuilt(\n      projectId: $id\n      contentBase64: $content\n      filename: $filename\n      format: $format\n      presetId: $presetId\n      space: $space\n      unit: $unit\n      baselineScope: $baselineScope\n      baselineRefId: $baselineRefId\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').ImportAsBuiltDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query AsBuiltBatches($id: UUID!) {\n    asBuiltBatches(projectId: $id) {\n      id\n      sourceFilename\n      format\n      baselineScope\n      reportUnit\n      createdAt\n    }\n  }\n',
): typeof import('./graphql').AsBuiltBatchesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Comparison($batchId: UUID!) {\n    comparison(batchId: $batchId) {\n      batch {\n        id\n        sourceFilename\n        reportUnit\n        createdAt\n      }\n      summary {\n        pass\n        warn\n        fail\n        unmatched\n        noVertical\n        maxMiss\n        rmsMiss\n      }\n      rows {\n        id\n        asBuiltLabel\n        asBuiltN\n        asBuiltE\n        asBuiltZ\n        designPointId\n        designN\n        designE\n        designZ\n        matchMethod\n        deltaN\n        deltaE\n        deltaZ\n        deltaHRadial\n        deltaGridN\n        deltaGridE\n        status\n        asBuiltLatitude\n        asBuiltLongitude\n        asBuiltHeight\n        designLatitude\n        designLongitude\n        designHeight\n      }\n    }\n  }\n',
): typeof import('./graphql').ComparisonDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ComparisonReportCsv($batchId: UUID!) {\n    comparisonReportCsv(batchId: $batchId) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').ComparisonReportCsvDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ComparisonReportPdf($batchId: UUID!) {\n    comparisonReportPdf(batchId: $batchId) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').ComparisonReportPdfDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RepairComparison($batchId: UUID!, $compId: UUID!, $designPointId: UUID!) {\n    repairComparison(batchId: $batchId, asBuiltCompId: $compId, designPointId: $designPointId) {\n      id\n    }\n  }\n',
): typeof import('./graphql').RepairComparisonDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteAsBuiltBatch($batchId: UUID!) {\n    deleteAsBuiltBatch(batchId: $batchId)\n  }\n',
): typeof import('./graphql').DeleteAsBuiltBatchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query DesignPointsForPairing($id: UUID!) {\n    surveyPoints(projectId: $id, limit: 1000) {\n      id\n      label\n    }\n  }\n',
): typeof import('./graphql').DesignPointsForPairingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation UpdateGeoreference($id: UUID!, $scale: Float, $lat: Float, $lon: Float, $rot: Float) {\n    updateProject(\n      id: $id\n      combinedScaleFactor: $scale\n      siteOriginLat: $lat\n      siteOriginLon: $lon\n      siteOriginRotationDeg: $rot\n    ) {\n      id\n    }\n  }\n',
): typeof import('./graphql').UpdateGeoreferenceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation SetGridAxes($id: UUID!, $unit: LengthUnit!, $axes: [GridAxisInput!]!) {\n    setGridAxes(projectId: $id, unit: $unit, axes: $axes) {\n      id\n    }\n  }\n',
): typeof import('./graphql').SetGridAxesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query GroupManagerGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n',
): typeof import('./graphql').GroupManagerGroupsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation GroupManagerCreate($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n',
): typeof import('./graphql').GroupManagerCreateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation GroupManagerDelete($id: UUID!) {\n    deletePointGroup(id: $id)\n  }\n',
): typeof import('./graphql').GroupManagerDeleteDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ImportPoints(\n    $id: UUID!\n    $format: ImportFormat!\n    $content: String!\n    $unit: LengthUnit!\n    $mapping: CsvMappingInput\n    $filename: String\n    $categoryId: UUID\n    $profile: String\n  ) {\n    importPoints(\n      projectId: $id\n      format: $format\n      content: $content\n      unit: $unit\n      mapping: $mapping\n      sourceFilename: $filename\n      categoryId: $categoryId\n      saveProfileName: $profile\n    ) {\n      rowCount\n    }\n  }\n',
): typeof import('./graphql').ImportPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ImportProject($content: String!) {\n    importProject(content: $content) {\n      id\n      name\n    }\n  }\n',
): typeof import('./graphql').ImportProjectDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Scene($id: UUID!) {\n    sceneData(projectId: $id) {\n      origin {\n        latitude\n        longitude\n        height\n      }\n      originProjectedE\n      originProjectedN\n      controlPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      surveyPoints {\n        id\n        label\n        latitude\n        longitude\n        height\n        easting\n        northing\n        categoryId\n      }\n      gridLines {\n        label\n        coordinates {\n          latitude\n          longitude\n          height\n        }\n      }\n      utilityRuns {\n        id\n        typeKey\n        label\n        apwaColor\n        diameter\n        vertices {\n          latitude\n          longitude\n          height\n        }\n      }\n      utilityStructures {\n        id\n        typeKey\n        label\n        apwaColor\n        latitude\n        longitude\n        rimElev\n        easting\n        northing\n      }\n    }\n    projectTerrain(projectId: $id) {\n      demtype\n      fetchedAt\n    }\n    projectBuildings(projectId: $id) {\n      count\n      fetchedAt\n    }\n    cadOverlays(projectId: $id) {\n      id\n      offsetE\n      offsetN\n      rotationDeg\n      scale\n      elevation\n      visible\n    }\n    pointGroups(projectId: $id) {\n      id\n      name\n      memberIds\n    }\n  }\n',
): typeof import('./graphql').SceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query TerrainContent($id: UUID!) {\n    projectTerrainContent(projectId: $id)\n  }\n',
): typeof import('./graphql').TerrainContentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query BuildingsContent($id: UUID!) {\n    projectBuildingsContent(projectId: $id)\n  }\n',
): typeof import('./graphql').BuildingsContentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query OverlayGeometry($id: UUID!) {\n    cadOverlayGeometry(id: $id) {\n      layers\n      polylines {\n        layer\n        points {\n          x\n          y\n        }\n      }\n    }\n  }\n',
): typeof import('./graphql').OverlayGeometryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RefreshTerrain(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshTerrain(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      demtype\n      fetchedAt\n    }\n  }\n',
): typeof import('./graphql').RefreshTerrainDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RefreshBuildings(\n    $id: UUID!\n    $south: Float!\n    $north: Float!\n    $west: Float!\n    $east: Float!\n    $force: Boolean\n  ) {\n    refreshBuildings(\n      projectId: $id\n      south: $south\n      north: $north\n      west: $west\n      east: $east\n      force: $force\n    ) {\n      count\n      fetchedAt\n    }\n  }\n',
): typeof import('./graphql').RefreshBuildingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Surfaces($projectId: UUID!) {\n    surfaces(projectId: $projectId) {\n      id\n      name\n      version\n      kind\n      status\n      failureReason\n      vertexCount\n      triangleCount\n      createdAt\n    }\n  }\n',
): typeof import('./graphql').SurfacesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query SurfaceMesh($id: UUID!) {\n    surfaceMesh(id: $id) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').SurfaceMeshDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query SurfaceContours($id: UUID!, $interval: Float!, $majorInterval: Float, $smoothing: Int) {\n    surfaceContours(\n      id: $id\n      interval: $interval\n      majorInterval: $majorInterval\n      smoothing: $smoothing\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').SurfaceContoursDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation BuildSurface($projectId: UUID!, $input: SurfaceInput!) {\n    buildSurface(projectId: $projectId, input: $input) {\n      id\n      version\n      vertexCount\n      triangleCount\n    }\n  }\n',
): typeof import('./graphql').BuildSurfaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation BuildDemSurface(\n    $projectId: UUID!\n    $name: String!\n    $filename: String!\n    $contentBase64: String!\n    $grid: DemGridInput!\n  ) {\n    buildDemSurface(\n      projectId: $projectId\n      name: $name\n      filename: $filename\n      contentBase64: $contentBase64\n      grid: $grid\n    ) {\n      id\n      vertexCount\n      triangleCount\n    }\n  }\n',
): typeof import('./graphql').BuildDemSurfaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation RebuildSurface($id: UUID!, $input: SurfaceInput!) {\n    rebuildSurface(id: $id, input: $input) {\n      id\n      version\n      vertexCount\n      triangleCount\n    }\n  }\n',
): typeof import('./graphql').RebuildSurfaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ExportSurface(\n    $id: UUID!\n    $format: SurfaceExportFormat!\n    $contourInterval: Float\n    $cellSize: Float\n  ) {\n    exportSurface(\n      id: $id\n      format: $format\n      contourInterval: $contourInterval\n      cellSize: $cellSize\n    ) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').ExportSurfaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ExportVolumeReport($id: UUID!, $format: VolumeReportFormat!, $unit: VolumeUnit) {\n    exportVolumeReport(id: $id, format: $format, unit: $unit) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').ExportVolumeReportDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteSurface($id: UUID!) {\n    deleteSurface(id: $id)\n  }\n',
): typeof import('./graphql').DeleteSurfaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Volumes($projectId: UUID!) {\n    volumes(projectId: $projectId) {\n      id\n      name\n      comparison\n      baseSurfaceId\n      baseVersion\n      compareSurfaceId\n      compareVersion\n      referenceElev\n      cellSize\n      cutVolume\n      fillVolume\n      netVolume\n      area\n      hasHeatmap\n      computedAt\n    }\n  }\n',
): typeof import('./graphql').VolumesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ComputeVolume($projectId: UUID!, $input: VolumeInput!) {\n    computeVolume(projectId: $projectId, input: $input) {\n      id\n      cutVolume\n      fillVolume\n      netVolume\n      area\n    }\n  }\n',
): typeof import('./graphql').ComputeVolumeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteVolume($id: UUID!) {\n    deleteVolume(id: $id)\n  }\n',
): typeof import('./graphql').DeleteVolumeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query VolumeHeatmap($id: UUID!) {\n    volumeHeatmap(id: $id) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').VolumeHeatmapDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Breaklines($projectId: UUID!) {\n    breaklines(projectId: $projectId) {\n      id\n      kind\n      closed\n      vertices\n      source\n      sourceLayer\n    }\n  }\n',
): typeof import('./graphql').BreaklinesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateBreakline($projectId: UUID!, $input: BreaklineInput!) {\n    createBreakline(projectId: $projectId, input: $input) {\n      id\n      kind\n    }\n  }\n',
): typeof import('./graphql').CreateBreaklineDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteBreakline($id: UUID!) {\n    deleteBreakline(id: $id)\n  }\n',
): typeof import('./graphql').DeleteBreaklineDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AutoBoundary($projectId: UUID!, $scope: PointScope!, $scopeRef: UUID) {\n    autoBoundary(projectId: $projectId, scope: $scope, scopeRef: $scopeRef) {\n      id\n      kind\n    }\n  }\n',
): typeof import('./graphql').AutoBoundaryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query PreviewBreaklineImport($projectId: UUID!, $contentBase64: String!) {\n    previewBreaklineImport(projectId: $projectId, contentBase64: $contentBase64) {\n      layers {\n        layer\n        count\n        suggestedKind\n      }\n    }\n  }\n',
): typeof import('./graphql').PreviewBreaklineImportDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ImportBreaklines(\n    $projectId: UUID!\n    $contentBase64: String!\n    $mappings: [BreaklineLayerMapping!]!\n    $unit: LengthUnit\n  ) {\n    importBreaklines(\n      projectId: $projectId\n      contentBase64: $contentBase64\n      mappings: $mappings\n      unit: $unit\n    ) {\n      created\n      skipped\n    }\n  }\n',
): typeof import('./graphql').ImportBreaklinesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query SurveyPoints(\n    $id: UUID!\n    $search: String\n    $cat: UUID\n    $group: UUID\n    $limit: Int\n    $offset: Int\n    $sort: String\n    $descending: Boolean\n  ) {\n    surveyPoints(\n      projectId: $id\n      search: $search\n      categoryId: $cat\n      groupId: $group\n      limit: $limit\n      offset: $offset\n      sort: $sort\n      descending: $descending\n    ) {\n      id\n      projectId\n      label\n      northing\n      easting\n      elevation\n      description\n      categoryId\n      tags\n      importBatchId\n    }\n    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)\n  }\n',
): typeof import('./graphql').SurveyPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteSurveyPoint($id: UUID!) {\n    deleteSurveyPoint(id: $id)\n  }\n',
): typeof import('./graphql').DeleteSurveyPointDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteSurveyPoints($ids: [UUID!]!) {\n    deleteSurveyPoints(ids: $ids)\n  }\n',
): typeof import('./graphql').DeleteSurveyPointsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {\n    assignCategory(ids: $ids, categoryId: $cat)\n  }\n',
): typeof import('./graphql').AssignCategoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {\n    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {\n      id\n    }\n  }\n',
): typeof import('./graphql').CreatePointGroupDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query PointGroups($id: UUID!) {\n    pointGroups(projectId: $id) {\n      id\n      projectId\n      name\n      memberIds\n    }\n  }\n',
): typeof import('./graphql').PointGroupsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {\n    addPointsToGroup(groupId: $groupId, memberIds: $ids) {\n      id\n      memberIds\n    }\n  }\n',
): typeof import('./graphql').AddPointsToGroupDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation SolveTransform($id: UUID!) {\n    solveTransform(projectId: $id) {\n      translationE\n      translationN\n      rotationDegrees\n      scale\n      rmsError\n      pointCount\n      residuals {\n        label\n        deltaEasting\n        deltaNorthing\n        magnitude\n      }\n    }\n  }\n',
): typeof import('./graphql').SolveTransformDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UtilityTypes {\n    utilityTypes {\n      key\n      label\n      apwaColor\n      defaultGeometry\n    }\n  }\n',
): typeof import('./graphql').UtilityTypesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Utilities(\n    $projectId: UUID!\n    $typeKey: String\n    $level: String\n    $search: String\n    $limit: Int\n    $offset: Int\n  ) {\n    utilities(\n      projectId: $projectId\n      typeKey: $typeKey\n      level: $level\n      search: $search\n      limit: $limit\n      offset: $offset\n    ) {\n      runs {\n        id\n        typeKey\n        label\n        level\n        diameter\n        material\n        invertUp\n        invertDown\n        slope\n        length\n        source\n        tags\n        vertices {\n          seq\n          northing\n          easting\n          elevation\n          sourcePointId\n        }\n      }\n      structures {\n        id\n        typeKey\n        label\n        level\n        northing\n        easting\n        rimElev\n        material\n        source\n        tags\n      }\n    }\n  }\n',
): typeof import('./graphql').UtilitiesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query UtilityCount($projectId: UUID!, $typeKey: String, $level: String, $search: String) {\n    utilityCount(projectId: $projectId, typeKey: $typeKey, level: $level, search: $search)\n  }\n',
): typeof import('./graphql').UtilityCountDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateUtilityRun(\n    $projectId: UUID!\n    $input: UtilityRunInput!\n    $vertices: [UtilityVertexInput!]!\n  ) {\n    createUtilityRun(projectId: $projectId, input: $input, vertices: $vertices) {\n      id\n    }\n  }\n',
): typeof import('./graphql').CreateUtilityRunDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateUtilityStructure($projectId: UUID!, $input: UtilityStructureInput!) {\n    createUtilityStructure(projectId: $projectId, input: $input) {\n      id\n    }\n  }\n',
): typeof import('./graphql').CreateUtilityStructureDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteUtilityRun($id: UUID!) {\n    deleteUtilityRun(id: $id)\n  }\n',
): typeof import('./graphql').DeleteUtilityRunDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation DeleteUtilityStructure($id: UUID!) {\n    deleteUtilityStructure(id: $id)\n  }\n',
): typeof import('./graphql').DeleteUtilityStructureDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query PreviewUtilityImport($projectId: UUID!, $format: String!, $contentBase64: String!) {\n    previewUtilityImport(projectId: $projectId, format: $format, contentBase64: $contentBase64) {\n      layers {\n        layer\n        kind\n        count\n        suggestedType\n      }\n    }\n  }\n',
): typeof import('./graphql').PreviewUtilityImportDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query ExportUtilities($projectId: UUID!, $format: String!, $typeKey: String, $search: String) {\n    exportUtilities(projectId: $projectId, format: $format, typeKey: $typeKey, search: $search) {\n      filename\n      mimeType\n      contentBase64\n    }\n  }\n',
): typeof import('./graphql').ExportUtilitiesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ImportUtilities(\n    $projectId: UUID!\n    $format: String!\n    $contentBase64: String!\n    $mappings: [UtilityLayerMapping!]!\n    $space: String!\n    $unit: LengthUnit!\n    $source: String\n  ) {\n    importUtilities(\n      projectId: $projectId\n      format: $format\n      contentBase64: $contentBase64\n      mappings: $mappings\n      space: $space\n      unit: $unit\n      source: $source\n    ) {\n      runsCreated\n      structuresCreated\n      skipped\n    }\n  }\n',
): typeof import('./graphql').ImportUtilitiesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation ResetPassword($t: String!, $p: String!) {\n    resetPassword(token: $t, newPassword: $p)\n  }\n',
): typeof import('./graphql').ResetPasswordDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation Signup($e: String!, $p: String!, $o: String!) {\n    signup(email: $e, password: $p, orgName: $o) {\n      verificationToken\n    }\n  }\n',
): typeof import('./graphql').SignupDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation VerifyEmail($t: String!) {\n    verifyEmail(token: $t)\n  }\n',
): typeof import('./graphql').VerifyEmailDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Billing {\n    billing {\n      plan\n      status\n      currentPeriodEnd\n      cancelAtPeriodEnd\n      restricted\n      canExport\n      projects\n      admins\n      nonAdmin\n      maxProjects\n      maxAdmins\n      maxNonAdmin\n      adminEmails\n    }\n  }\n',
): typeof import('./graphql').BillingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateCheckoutSession($interval: BillingInterval!) {\n    createCheckoutSession(interval: $interval)\n  }\n',
): typeof import('./graphql').CreateCheckoutSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  mutation CreateBillingPortalSession {\n    createBillingPortalSession\n  }\n',
): typeof import('./graphql').CreateBillingPortalSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query PlanCatalog {\n    planCatalog {\n      features {\n        key\n        label\n        blurb\n        minPlan\n      }\n      plans {\n        plan\n        maxProjects\n        maxAdmins\n        maxNonAdmin\n      }\n    }\n  }\n',
): typeof import('./graphql').PlanCatalogDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  subscription ProjectChanged($projectId: UUID!) {\n    projectChanged(projectId: $projectId)\n  }\n',
): typeof import('./graphql').ProjectChangedDocument;

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
