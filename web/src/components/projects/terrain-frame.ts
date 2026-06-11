import type { SceneData } from '@/lib/types';

/** A flat-Earth ENU frame anchored at a reference lat/lon. Good for site-scale. */
export interface Frame {
  lat0: number;
  lon0: number;
  mPerLat: number;
  mPerLon: number;
}

/** Terrain elevation sampler (meters), or null when no terrain is loaded. */
export type Sampler = ((lat: number, lon: number) => number | null) | null;

/** Local-space point: [x east, y up, z south-negative-north], in meters. */
export type Vec3 = [number, number, number];

/** Builds the local ENU frame, anchored at the scene origin (or first point). */
export function makeFrame(scene: SceneData): Frame {
  const ref =
    scene.origin ??
    scene.controlPoints[0] ??
    scene.surveyPoints[0] ??
    ({ latitude: 0, longitude: 0 } as { latitude: number; longitude: number });
  const lat0 = ref.latitude;
  const lon0 = ref.longitude;
  return {
    lat0,
    lon0,
    mPerLat: 111_320,
    mPerLon: 111_320 * Math.cos((lat0 * Math.PI) / 180),
  };
}

/** lat/lon/height → local meters (x east, y up, z south-negative-north). */
export function toLocal(f: Frame, lat: number, lon: number, height: number): Vec3 {
  return [(lon - f.lon0) * f.mPerLon, height, -(lat - f.lat0) * f.mPerLat];
}

/** Decodes base64 (e.g. a GeoTIFF payload) into an ArrayBuffer. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}
