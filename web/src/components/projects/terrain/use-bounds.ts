'use client';

import { useMemo } from 'react';

import type { SceneData } from '@/lib/types';

import { type Frame, toLocal } from '../terrain-frame';

/** Planar scene bounds (centre x/z + extent, meters) for camera framing. Prefers
 * the building-grid extent (the camera orbits the grid centre); falls back to the
 * points when there's no grid. Y is resolved separately so it can track terrain. */
export function useBounds(scene: SceneData, frame: Frame): { cx: number; cz: number; ext: number } {
  return useMemo(() => {
    const coords: { latitude: number; longitude: number }[] = scene.gridLines.length
      ? scene.gridLines.flatMap((l) => l.coordinates)
      : [...scene.controlPoints, ...scene.surveyPoints];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of coords) {
      const [x, , z] = toLocal(frame, p.latitude, p.longitude, 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) {
      return { cx: 0, cz: 0, ext: 120 };
    }
    const ext = Math.max(maxX - minX, maxZ - minZ, 40);
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, ext };
  }, [scene.gridLines, scene.controlPoints, scene.surveyPoints, frame]);
}
