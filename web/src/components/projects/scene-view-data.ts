import type { SceneData } from '@/lib/types';

import { graphql } from '@/lib/gql';

// The server enforces a 7-day cooldown on re-fetching terrain (OpenTopography is
// rate-limited). On top of that we add a short client-side anti-spam window so a
// failed/initial fetch can't be hammered before the server guard kicks in.
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const SPAM_COOLDOWN_MS = 30 * 60 * 1000;

export const SCENE_QUERY = graphql(`
  query Scene($id: UUID!) {
    sceneData(projectId: $id) {
      origin {
        latitude
        longitude
        height
      }
      originProjectedE
      originProjectedN
      controlPoints {
        id
        label
        latitude
        longitude
        height
        easting
        northing
        categoryId
      }
      surveyPoints {
        id
        label
        latitude
        longitude
        height
        easting
        northing
        categoryId
      }
      gridLines {
        label
        coordinates {
          latitude
          longitude
          height
        }
      }
    }
    projectTerrain(projectId: $id) {
      demtype
      fetchedAt
    }
    projectBuildings(projectId: $id) {
      count
      fetchedAt
    }
    cadOverlays(projectId: $id) {
      id
      offsetE
      offsetN
      rotationDeg
      scale
      elevation
      visible
    }
    pointGroups(projectId: $id) {
      id
      name
      memberIds
    }
  }
`);

export const TERRAIN_CONTENT = graphql(`
  query TerrainContent($id: UUID!) {
    projectTerrainContent(projectId: $id)
  }
`);

export const BUILDINGS_CONTENT = graphql(`
  query BuildingsContent($id: UUID!) {
    projectBuildingsContent(projectId: $id)
  }
`);

export const OVERLAY_GEOMETRY = graphql(`
  query OverlayGeometry($id: UUID!) {
    cadOverlayGeometry(id: $id) {
      layers
      polylines {
        layer
        points {
          x
          y
        }
      }
    }
  }
`);

export const REFRESH_TERRAIN = graphql(`
  mutation RefreshTerrain(
    $id: UUID!
    $south: Float!
    $north: Float!
    $west: Float!
    $east: Float!
    $force: Boolean
  ) {
    refreshTerrain(
      projectId: $id
      south: $south
      north: $north
      west: $west
      east: $east
      force: $force
    ) {
      demtype
      fetchedAt
    }
  }
`);

export const REFRESH_BUILDINGS = graphql(`
  mutation RefreshBuildings(
    $id: UUID!
    $south: Float!
    $north: Float!
    $west: Float!
    $east: Float!
    $force: Boolean
  ) {
    refreshBuildings(
      projectId: $id
      south: $south
      north: $north
      west: $west
      east: $east
      force: $force
    ) {
      count
      fetchedAt
    }
  }
`);

/** Bounding box (degrees) covering all scene geometry, padded so the terrain
 * extends a little past the survey. Returns null when there's nothing sited. */
export function sceneBbox(
  scene: SceneData,
): { south: number; north: number; west: number; east: number } | null {
  const pts = [...scene.controlPoints, ...scene.surveyPoints];
  const lats = pts.map((p) => p.latitude);
  const lons = pts.map((p) => p.longitude);
  // Drive the bbox off the actual points; only fall back to the site origin when
  // there are none. (A misconfigured origin far from the points would otherwise
  // stretch the bbox into a useless sliver of terrain.)
  if (pts.length === 0 && scene.origin) {
    lats.push(scene.origin.latitude);
    lons.push(scene.origin.longitude);
  }
  if (lats.length === 0) {
    return null;
  }
  let south = Math.min(...lats);
  let north = Math.max(...lats);
  let west = Math.min(...lons);
  let east = Math.max(...lons);
  // Pad by ~10% of the span, with a small floor so a single point still fetches
  // a usable tile. Kept modest to minimize the OpenTopography request size.
  const padLat = Math.max((north - south) * 0.1, 0.0025);
  const padLon = Math.max((east - west) * 0.1, 0.0025);
  south -= padLat;
  north += padLat;
  west -= padLon;
  east += padLon;
  return { east, north, south, west };
}
