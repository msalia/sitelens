import { fromArrayBuffer } from 'geotiff';
import * as THREE from 'three';

import { isValidElevation, sampleElevation, smoothstep } from '@/lib/terrain';

import { type Frame, toLocal } from './terrain-frame';

// Radial alpha falloff for the terrain tile, as fractions of the tile's
// half-diagonal: fully opaque within FADE_START, fully transparent beyond
// FADE_END. Buildings reuse these so they dissolve in step with the terrain edge.
export const TERRAIN_FADE_START = 0.12;
export const TERRAIN_FADE_END = 0.62;

export interface TerrainMesh {
  /** Tile centre in local meters. */
  cx: number;
  cz: number;
  geometry: THREE.BufferGeometry;
  /** Mean elevation — fallback for missing samples. */
  meanHeight: number;
  /** Half-diagonal of the tile in meters. */
  radius: number;
  /** Bilinear elevation sampler (meters). Null outside the tile's bbox. */
  sample: (lat: number, lon: number) => number | null;
}

/** Builds the terrain mesh geometry from a GeoTIFF DEM, decimated for the GPU. */
export async function buildTerrainGeometry(buf: ArrayBuffer, frame: Frame): Promise<TerrainMesh> {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const w = image.getWidth();
  const h = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const rasters = await image.readRasters({ samples: [0] });
  const band = rasters[0] as unknown as ArrayLike<number>;

  const valid = isValidElevation;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < band.length; i++) {
    if (valid(band[i])) {
      sum += band[i];
      count++;
    }
  }
  const meanHeight = count ? sum / count : 0;

  // Decimate to keep the mesh under ~256×256 vertices regardless of DEM size.
  const target = 256;
  const colIdx: number[] = [];
  const rowIdx: number[] = [];
  const stepX = Math.max(1, Math.ceil(w / target));
  const stepZ = Math.max(1, Math.ceil(h / target));
  for (let c = 0; c < w; c += stepX) {
    colIdx.push(c);
  }
  if (colIdx[colIdx.length - 1] !== w - 1) {
    colIdx.push(w - 1);
  }
  for (let r = 0; r < h; r += stepZ) {
    rowIdx.push(r);
  }
  if (rowIdx[rowIdx.length - 1] !== h - 1) {
    rowIdx.push(h - 1);
  }

  const nCols = colIdx.length;
  const nRows = rowIdx.length;
  const positions = new Float32Array(nRows * nCols * 3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let ri = 0; ri < nRows; ri++) {
    const r = rowIdx[ri];
    const lat = north - (r / (h - 1)) * (north - south);
    for (let ci = 0; ci < nCols; ci++) {
      const c = colIdx[ci];
      const lon = west + (c / (w - 1)) * (east - west);
      const raw = band[r * w + c];
      const elev = valid(raw) ? raw : meanHeight;
      const k = ri * nCols + ci;
      const [x, y, z] = toLocal(frame, lat, lon, elev);
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  // Per-vertex RGBA: RGB stays white (the material tints it to the clay color)
  // while the alpha falls off RADIALLY from the tile centre. A radial dissolve
  // (rather than per-edge) leaves no rectangular silhouette — the terrain reads
  // as a soft patch embedded in the background, clear around the data and fully
  // transparent toward the corners. `smoothstep` keeps the falloff gentle.
  const colors = new Float32Array(nRows * nCols * 4);
  // Feather around the PROJECT ORIGIN (local 0,0 = the project lon/lat), not the
  // DEM tile's geometric center — so the soft opaque patch sits under the site.
  const cxg = 0;
  const czg = 0;
  const maxR = Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2) || 1;
  const fadeStart = TERRAIN_FADE_START; // fully opaque within this fraction of the radius
  const fadeEnd = TERRAIN_FADE_END; // fully transparent beyond this fraction
  for (let k = 0; k < nRows * nCols; k++) {
    const x = positions[k * 3];
    const z = positions[k * 3 + 2];
    const r = Math.hypot(x - cxg, z - czg) / maxR;
    const alpha = 1 - smoothstep((r - fadeStart) / (fadeEnd - fadeStart));
    colors[k * 4] = 1;
    colors[k * 4 + 1] = 1;
    colors[k * 4 + 2] = 1;
    colors[k * 4 + 3] = alpha;
  }

  const indices: number[] = [];
  for (let ri = 0; ri < nRows - 1; ri++) {
    for (let ci = 0; ci < nCols - 1; ci++) {
      const a = ri * nCols + ci;
      const b = a + 1;
      const cc = a + nCols;
      const d = cc + 1;
      indices.push(a, cc, b, b, cc, d);
    }
  }

  // Bilinear elevation sampler over the full-resolution DEM (for draping points
  // and grid lines onto the surface). Returns null outside the tile's bbox.
  const sample = (lat: number, lon: number): number | null =>
    sampleElevation({ band, east, height: h, meanHeight, north, south, west, width: w }, lat, lon);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { cx: cxg, cz: czg, geometry, meanHeight, radius: maxR, sample };
}
