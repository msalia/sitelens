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

/** The project's utility inventory — runs (with vertices) + structures.
 *  Server-paginated (combined runs+structures) via `limit`/`offset`; pair with
 *  `utilityCount` for the total. */
export const UTILITIES = graphql(`
  query Utilities(
    $projectId: UUID!
    $typeKey: String
    $level: String
    $search: String
    $limit: Int
    $offset: Int
  ) {
    utilities(
      projectId: $projectId
      typeKey: $typeKey
      level: $level
      search: $search
      limit: $limit
      offset: $offset
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
`);

/** Combined count of runs + structures matching the inventory filters. */
export const UTILITY_COUNT = graphql(`
  query UtilityCount($projectId: UUID!, $typeKey: String, $level: String, $search: String) {
    utilityCount(projectId: $projectId, typeKey: $typeKey, level: $level, search: $search)
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

/** Export the utility archive in a portable format (optionally scoped by type). */
export const EXPORT_UTILITIES = graphql(`
  query ExportUtilities($projectId: UUID!, $format: String!, $typeKey: String, $search: String) {
    exportUtilities(projectId: $projectId, format: $format, typeKey: $typeKey, search: $search) {
      filename
      mimeType
      contentBase64
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
