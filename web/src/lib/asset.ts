/**
 * Same-origin URLs + fetch helpers for the binary render-asset proxy
 * (`/api/asset/*` → Rust `/asset/*`). Replaces base64-in-GraphQL for the large
 * render blobs (terrain GeoTIFFs, TIN meshes, volume heatmaps, buildings): the
 * bytes ride a plain HTTP fetch (gzip/brotli + ETag caching) instead of inflating
 * a JSON response.
 */
export const assetUrls = {
  projectBuildings: (projectId: string) => `/api/asset/project/${projectId}/buildings`,
  projectDetailedTerrain: (projectId: string) =>
    `/api/asset/project/${projectId}/terrain-detailed`,
  projectTerrain: (projectId: string) => `/api/asset/project/${projectId}/terrain`,
  surfaceMesh: (surfaceId: string) => `/api/asset/surface/${surfaceId}/mesh`,
  volumeHeatmap: (volumeId: string) => `/api/asset/volume/${volumeId}/heatmap`,
} as const;

/** Fetches a binary asset as an `ArrayBuffer`; `null` when absent (`404`). */
export async function fetchAssetBuffer(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`asset fetch failed (${res.status}): ${url}`);
  }
  return res.arrayBuffer();
}

/** Fetches a text/JSON asset; `null` when absent (`404`). */
export async function fetchAssetText(url: string): Promise<string | null> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`asset fetch failed (${res.status}): ${url}`);
  }
  return res.text();
}
