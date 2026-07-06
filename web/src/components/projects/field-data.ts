import { graphql } from '@/lib/gql';

export const FIELD_EXPORT_PRESETS = graphql(`
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
`);

export const EXPORT_FIELD = graphql(`
  query ExportField(
    $id: UUID!
    $presetId: String!
    $space: ExportSpace
    $unit: LengthUnit
    $categoryId: UUID
    $codeField: CodeField
  ) {
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
`);

export const DETECT_FIELD_FORMAT = graphql(`
  mutation DetectFieldFormat($content: String!) {
    detectFieldFormat(contentBase64: $content) {
      format
      needsMapping
    }
  }
`);

export const IMPORT_AS_BUILT = graphql(`
  mutation ImportAsBuilt(
    $id: UUID!
    $content: String!
    $filename: String
    $format: FieldFormat
    $presetId: String
    $space: ExportSpace
    $unit: LengthUnit
    $baselineScope: BaselineScope
    $baselineRefId: UUID
  ) {
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
`);

export const AS_BUILT_BATCHES = graphql(`
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
`);

export const COMPARISON = graphql(`
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
      }
    }
  }
`);

export const REPAIR_COMPARISON = graphql(`
  mutation RepairComparison($batchId: UUID!, $compId: UUID!, $designPointId: UUID!) {
    repairComparison(batchId: $batchId, asBuiltCompId: $compId, designPointId: $designPointId) {
      id
    }
  }
`);

export const DELETE_AS_BUILT_BATCH = graphql(`
  mutation DeleteAsBuiltBatch($batchId: UUID!) {
    deleteAsBuiltBatch(batchId: $batchId)
  }
`);

/** Lightweight design-point list for the manual-pairing picker. */
export const DESIGN_POINTS = graphql(`
  query DesignPointsForPairing($id: UUID!) {
    surveyPoints(projectId: $id, limit: 1000) {
      id
      label
    }
  }
`);
