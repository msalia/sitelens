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
      result
      resultGeometry
    }
  }
`);

/** The vehicle library (global presets + the org's custom vehicles). */
export const VEHICLE_TEMPLATES = graphql(`
  query VehicleTemplates {
    vehicleTemplates {
      id
      name
      vehicleClass
      wheelbase
      width
      isPreset
    }
  }
`);

/** Run a turning-radius analysis (tractrix swept path + clearance verdict). */
export const RUN_TURNING_ANALYSIS = graphql(`
  mutation RunTurningAnalysis($projectId: UUID!, $input: TurningInput!) {
    runTurningAnalysis(projectId: $projectId, input: $input) {
      id
      name
      result
    }
  }
`);

/** Run a parking analysis (bay-based stall tiling + count + ADA/ratio checks). */
export const RUN_PARKING_ANALYSIS = graphql(`
  mutation RunParkingAnalysis($projectId: UUID!, $input: ParkingInput!) {
    runParkingAnalysis(projectId: $projectId, input: $input) {
      id
      name
      result
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
