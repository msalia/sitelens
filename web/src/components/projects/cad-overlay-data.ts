import { graphql } from '@/lib/gql';

export const UPLOAD = graphql(`
  mutation UploadDxf($id: UUID!, $f: String!, $c: String!) {
    uploadDxf(projectId: $id, filename: $f, content: $c) {
      id
    }
  }
`);

export const SET_GEO = graphql(`
  mutation SetCadGeoreference(
    $id: UUID!
    $oe: Float
    $on: Float
    $rot: Float
    $sc: Float
    $el: Float
    $vis: Boolean
  ) {
    setCadGeoreference(
      id: $id
      offsetE: $oe
      offsetN: $on
      rotationDeg: $rot
      scale: $sc
      elevation: $el
      visible: $vis
    ) {
      id
    }
  }
`);

export const DELETE_CAD_OVERLAY = graphql(`
  mutation DeleteCadOverlay($id: UUID!) {
    deleteCadOverlay(id: $id)
  }
`);

export const SITE_PROJECTED = graphql(`
  query SiteProjected($id: UUID!, $lon: Float!, $lat: Float!) {
    convertCoordinate(projectId: $id, space: GEOGRAPHIC, x: $lon, y: $lat, unit: METER) {
      projectedGridE
      projectedGridN
    }
  }
`);

export const OVERLAY_DXF = graphql(`
  query CadOverlayDxf($id: UUID!) {
    cadOverlayContent(id: $id)
  }
`);

export const SCENE_POINTS = graphql(`
  query OverlayScenePoints($id: UUID!) {
    sceneData(projectId: $id) {
      controlPoints {
        easting
        northing
      }
      surveyPoints {
        easting
        northing
      }
    }
  }
`);

// Mirror of the API's `MAX_DXF_BYTES` so oversized files fail fast client-side.
export const MAX_DXF_BYTES = 10 * 1024 * 1024;

export const OFFSET_WINDOW = 100; // meters of fine-nudge range on each side of the slider
export const ELEV_WINDOW = 50; // meters of fine-nudge range on each side for elevation
