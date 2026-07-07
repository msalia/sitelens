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

/** Parse an import file → its layers with suggested APWA types (mapping UI). */
export const PREVIEW_UTILITY_IMPORT = graphql(`
  query PreviewUtilityImport($projectId: UUID!, $format: String!, $contentBase64: String!) {
    previewUtilityImport(projectId: $projectId, format: $format, contentBase64: $contentBase64) {
      layers {
        layer
        kind
        count
        suggestedType
      }
    }
  }
`);

/** Commit an import with a confirmed layer→type mapping. */
export const IMPORT_UTILITIES = graphql(`
  mutation ImportUtilities(
    $projectId: UUID!
    $format: String!
    $contentBase64: String!
    $mappings: [UtilityLayerMapping!]!
    $space: String!
    $unit: LengthUnit!
    $source: String
  ) {
    importUtilities(
      projectId: $projectId
      format: $format
      contentBase64: $contentBase64
      mappings: $mappings
      space: $space
      unit: $unit
      source: $source
    ) {
      runsCreated
      structuresCreated
      skipped
    }
  }
`);
