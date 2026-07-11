import { graphql } from '@/lib/gql';

/** Contour-generation settings, shared between the Surfaces panel (which edits
 *  them) and the scene (which fetches + renders). Intervals are in the project's
 *  display unit; the scene converts to meters for the API call. */
export interface ContourSettings {
  enabled: boolean;
  /** Minor interval, in the project's display unit. */
  interval: number;
  /** Draw elevation labels on major contours. */
  labels: boolean;
  /** Major (labeled) interval, in the project's display unit. */
  majorInterval: number;
  /** Chaikin smoothing passes (0–3). */
  smoothing: number;
}

export const DEFAULT_CONTOURS: ContourSettings = {
  enabled: false,
  interval: 1,
  labels: true,
  majorInterval: 5,
  smoothing: 1,
};

/** Every surface in a project (newest first). */
export const SURFACES = graphql(`
  query Surfaces($projectId: UUID!) {
    surfaces(projectId: $projectId) {
      id
      name
      version
      kind
      status
      failureReason
      vertexCount
      triangleCount
      createdAt
    }
  }
`);

/** The computed render mesh (STIN binary blob, base64-encoded). */
export const SURFACE_MESH = graphql(`
  query SurfaceMesh($id: UUID!) {
    surfaceMesh(id: $id) {
      filename
      mimeType
      contentBase64
    }
  }
`);

/** Iso-line contours computed from a surface (SCTR binary blob, base64-encoded). */
export const SURFACE_CONTOURS = graphql(`
  query SurfaceContours($id: UUID!, $interval: Float!, $majorInterval: Float, $smoothing: Int) {
    surfaceContours(
      id: $id
      interval: $interval
      majorInterval: $majorInterval
      smoothing: $smoothing
    ) {
      filename
      mimeType
      contentBase64
    }
  }
`);

/** Build a new TIN surface from selected survey points. */
export const BUILD_SURFACE = graphql(`
  mutation BuildSurface($projectId: UUID!, $input: SurfaceInput!) {
    buildSurface(projectId: $projectId, input: $input) {
      id
      version
      vertexCount
      triangleCount
    }
  }
`);

/** Build a TIN surface from digitized points (a drawn design pad / graded points). */
export const BUILD_SURFACE_FROM_POINTS = graphql(`
  mutation BuildSurfaceFromPoints(
    $projectId: UUID!
    $name: String!
    $points: [SurfacePointInput!]!
    $maxEdgeLength: Float
  ) {
    buildSurfaceFromPoints(
      projectId: $projectId
      name: $name
      points: $points
      maxEdgeLength: $maxEdgeLength
    ) {
      id
      version
      vertexCount
      triangleCount
    }
  }
`);

/** Build a DEM surface from an uploaded GeoTIFF (client-parsed into a grid). */
export const BUILD_DEM_SURFACE = graphql(`
  mutation BuildDemSurface(
    $projectId: UUID!
    $name: String!
    $filename: String!
    $contentBase64: String!
    $grid: DemGridInput!
  ) {
    buildDemSurface(
      projectId: $projectId
      name: $name
      filename: $filename
      contentBase64: $contentBase64
      grid: $grid
    ) {
      id
      vertexCount
      triangleCount
    }
  }
`);

/** Rebuild an existing surface from (possibly new) inputs → next version. */
export const REBUILD_SURFACE = graphql(`
  mutation RebuildSurface($id: UUID!, $input: SurfaceInput!) {
    rebuildSurface(id: $id, input: $input) {
      id
      version
      vertexCount
      triangleCount
    }
  }
`);

/** Export a surface as LandXML / DXF / GeoTIFF (base64 FileBlob). */
export const EXPORT_SURFACE = graphql(`
  query ExportSurface(
    $id: UUID!
    $format: SurfaceExportFormat!
    $contourInterval: Float
    $cellSize: Float
  ) {
    exportSurface(
      id: $id
      format: $format
      contourInterval: $contourInterval
      cellSize: $cellSize
    ) {
      filename
      mimeType
      contentBase64
    }
  }
`);

/** Export a volume result as a PDF or CSV report (base64 FileBlob). */
export const EXPORT_VOLUME_REPORT = graphql(`
  query ExportVolumeReport($id: UUID!, $format: VolumeReportFormat!, $unit: VolumeUnit) {
    exportVolumeReport(id: $id, format: $format, unit: $unit) {
      filename
      mimeType
      contentBase64
    }
  }
`);

/** Delete a surface and its mesh blob. */
export const DELETE_SURFACE = graphql(`
  mutation DeleteSurface($id: UUID!) {
    deleteSurface(id: $id)
  }
`);

/** Every volume computation in a project (newest first). */
export const VOLUMES = graphql(`
  query Volumes($projectId: UUID!) {
    volumes(projectId: $projectId) {
      id
      name
      comparison
      baseSurfaceId
      baseVersion
      compareSurfaceId
      compareVersion
      referenceElev
      cellSize
      cutVolume
      fillVolume
      netVolume
      area
      hasHeatmap
      computedAt
    }
  }
`);

/** Compute a reproducible cut/fill volume. */
export const COMPUTE_VOLUME = graphql(`
  mutation ComputeVolume($projectId: UUID!, $input: VolumeInput!) {
    computeVolume(projectId: $projectId, input: $input) {
      id
      cutVolume
      fillVolume
      netVolume
      area
    }
  }
`);

/** Delete a volume and its heatmap grid. */
export const DELETE_VOLUME = graphql(`
  mutation DeleteVolume($id: UUID!) {
    deleteVolume(id: $id)
  }
`);

/** The cut/fill heatmap grid (SVOL binary blob, base64-encoded). */
export const VOLUME_HEATMAP = graphql(`
  query VolumeHeatmap($id: UUID!) {
    volumeHeatmap(id: $id) {
      filename
      mimeType
      contentBase64
    }
  }
`);

/** Clean earthwork solid (cut/fill clipped to the design footprint) — ESOL blob. */
export const VOLUME_EARTHWORK_SOLID = graphql(`
  query VolumeEarthworkSolid($id: UUID!) {
    volumeEarthworkSolid(id: $id)
  }
`);

/** Clean graded-terrain surface (terrain carved to the design footprint) — ESOL. */
export const VOLUME_GRADED_TERRAIN = graphql(`
  query VolumeGradedTerrain($id: UUID!) {
    volumeGradedTerrain(id: $id)
  }
`);

/** The combined graded terrain (CTER) for a set of volumes over the split terrain. */
export const GRADED_TERRAIN = graphql(`
  query GradedTerrain($projectId: UUID!, $volumeIds: [UUID!]!) {
    gradedTerrain(projectId: $projectId, volumeIds: $volumeIds)
  }
`);

/** Every constraint (breakline / boundary / hole) in a project. */
export const BREAKLINES = graphql(`
  query Breaklines($projectId: UUID!) {
    breaklines(projectId: $projectId) {
      id
      kind
      closed
      vertices
      source
      sourceLayer
    }
  }
`);

/** Create a digitized breakline / boundary / hole. */
export const CREATE_BREAKLINE = graphql(`
  mutation CreateBreakline($projectId: UUID!, $input: BreaklineInput!) {
    createBreakline(projectId: $projectId, input: $input) {
      id
      kind
    }
  }
`);

/** Delete a breakline. */
export const DELETE_BREAKLINE = graphql(`
  mutation DeleteBreakline($id: UUID!) {
    deleteBreakline(id: $id)
  }
`);

/** Generate an auto concave-hull boundary from a point scope. */
export const AUTO_BOUNDARY = graphql(`
  mutation AutoBoundary($projectId: UUID!, $scope: PointScope!, $scopeRef: UUID) {
    autoBoundary(projectId: $projectId, scope: $scope, scopeRef: $scopeRef) {
      id
      kind
    }
  }
`);

/** Preview a DXF file's polyline layers for breakline import. */
export const PREVIEW_BREAKLINE_IMPORT = graphql(`
  query PreviewBreaklineImport($projectId: UUID!, $contentBase64: String!) {
    previewBreaklineImport(projectId: $projectId, contentBase64: $contentBase64) {
      layers {
        layer
        count
        suggestedKind
      }
    }
  }
`);

/** Import breaklines from mapped DXF layers. */
export const IMPORT_BREAKLINES = graphql(`
  mutation ImportBreaklines(
    $projectId: UUID!
    $contentBase64: String!
    $mappings: [BreaklineLayerMapping!]!
    $unit: LengthUnit
  ) {
    importBreaklines(
      projectId: $projectId
      contentBase64: $contentBase64
      mappings: $mappings
      unit: $unit
    ) {
      created
      skipped
    }
  }
`);
