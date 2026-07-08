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
