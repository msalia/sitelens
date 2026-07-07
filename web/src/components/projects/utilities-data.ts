import { graphql } from '@/lib/gql';

/** Curated APWA utility-type catalog (seeded, read-only). */
export const UTILITY_TYPES = graphql(`
  query UtilityTypes {
    utilityTypes {
      key
      label
      apwaColor
      defaultGeometry
    }
  }
`);

/** The project's utility inventory — runs (with vertices) + structures. */
export const UTILITIES = graphql(`
  query Utilities($projectId: UUID!, $typeKey: String, $level: String, $search: String) {
    utilities(projectId: $projectId, typeKey: $typeKey, level: $level, search: $search) {
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
`);

/** Create a run from a digitized/entered vertex list (≥2 vertices). */
export const CREATE_UTILITY_RUN = graphql(`
  mutation CreateUtilityRun(
    $projectId: UUID!
    $input: UtilityRunInput!
    $vertices: [UtilityVertexInput!]!
  ) {
    createUtilityRun(projectId: $projectId, input: $input, vertices: $vertices) {
      id
    }
  }
`);

/** Create a node structure at a snapped/entered position. */
export const CREATE_UTILITY_STRUCTURE = graphql(`
  mutation CreateUtilityStructure($projectId: UUID!, $input: UtilityStructureInput!) {
    createUtilityStructure(projectId: $projectId, input: $input) {
      id
    }
  }
`);

export const DELETE_UTILITY_RUN = graphql(`
  mutation DeleteUtilityRun($id: UUID!) {
    deleteUtilityRun(id: $id)
  }
`);

export const DELETE_UTILITY_STRUCTURE = graphql(`
  mutation DeleteUtilityStructure($id: UUID!) {
    deleteUtilityStructure(id: $id)
  }
`);
