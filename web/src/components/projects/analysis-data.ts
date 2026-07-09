import { graphql } from '@/lib/gql';

/** Every analysis in a project (newest first). */
export const ANALYSES = graphql(`
  query Analyses($projectId: UUID!) {
    analyses(projectId: $projectId) {
      id
      type
      name
      status
      inputGeometry
    }
  }
`);

/** Create a draft analysis from a drawn input + params. */
export const CREATE_ANALYSIS = graphql(`
  mutation CreateAnalysis($projectId: UUID!, $input: AnalysisInput!) {
    createAnalysis(projectId: $projectId, input: $input) {
      id
      type
      name
    }
  }
`);

/** Update a draft analysis's name / params / drawn input. */
export const UPDATE_ANALYSIS = graphql(`
  mutation UpdateAnalysis($id: UUID!, $input: AnalysisInput!) {
    updateAnalysis(id: $id, input: $input) {
      id
    }
  }
`);

/** Delete an analysis. */
export const DELETE_ANALYSIS = graphql(`
  mutation DeleteAnalysis($id: UUID!) {
    deleteAnalysis(id: $id)
  }
`);

/** Clone an analysis as a fresh draft. */
export const DUPLICATE_ANALYSIS = graphql(`
  mutation DuplicateAnalysis($id: UUID!) {
    duplicateAnalysis(id: $id) {
      id
    }
  }
`);
