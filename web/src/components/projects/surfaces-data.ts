import { graphql } from '@/lib/gql';

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

/** Delete a surface and its mesh blob. */
export const DELETE_SURFACE = graphql(`
  mutation DeleteSurface($id: UUID!) {
    deleteSurface(id: $id)
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
