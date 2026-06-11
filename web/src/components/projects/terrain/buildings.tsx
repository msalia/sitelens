'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { smoothstep } from '@/lib/terrain';

import type { BuildingFootprint } from '../terrain-shared';

import { type Frame, type Sampler, toLocal } from '../terrain-frame';
import { TERRAIN_FADE_END, TERRAIN_FADE_START } from '../terrain-mesh';

// Matte building shades — a touch darker than the clay terrain in light mode and
// a touch lighter in dark mode, so footprints read as solid massing either way.
export const BUILDING_COLOR = { dark: '#3b424f', light: '#d6dbe3' };
// Minimum extrusion so flat/zero-height OSM footprints still read as buildings.
const MIN_BUILDING_HEIGHT = 3;

/** OSM building footprints, extruded into matte prisms. Each lat/lon ring becomes
 * a `THREE.Shape` in the local frame, extruded by its height, and lifted so its
 * base sits on the sampled ground elevation. To keep buildings within the visible
 * terrain, each footprint is culled past the terrain tile's fade radius and given
 * a per-vertex alpha matching the terrain's radial gradient, so they dissolve into
 * the background in step with the terrain edge instead of floating on white. All
 * footprints merge into one geometry to keep the draw-call count low. */
export function Buildings({
  buildings,
  center,
  color,
  frame,
  radius,
  sample,
}: {
  buildings: BuildingFootprint[];
  /** Terrain tile centre in local meters (null when no terrain is loaded). */
  center: { x: number; z: number } | null;
  color: string;
  frame: Frame;
  /** Terrain tile half-diagonal in meters (null when no terrain is loaded). */
  radius: number | null;
  sample: Sampler;
}) {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const b of buildings) {
      if (!b.poly || b.poly.length < 3) {
        continue;
      }
      const shape = new THREE.Shape();
      let sumX = 0;
      let sumZ = 0;
      let sumLat = 0;
      let sumLon = 0;
      b.poly.forEach(([lat, lon], i) => {
        const [x, , z] = toLocal(frame, lat, lon, 0);
        // Shape is XY; rotateX(-90°) maps shape-X→world-X and shape-(-Y)→world-Z,
        // so negate z here to keep footprints un-mirrored. Extrude depth → world-Y.
        if (i === 0) {
          shape.moveTo(x, -z);
        } else {
          shape.lineTo(x, -z);
        }
        sumX += x;
        sumZ += z;
        sumLat += lat;
        sumLon += lon;
      });
      const n = b.poly.length;
      // Radial alpha from the terrain centre — cull (and fade) to the terrain edge.
      let alpha = 1;
      if (center && radius) {
        const frac = Math.hypot(sumX / n - center.x, sumZ / n - center.z) / radius;
        if (frac >= TERRAIN_FADE_END) {
          continue; // beyond the visible terrain — would float, so drop it
        }
        alpha =
          1 - smoothstep((frac - TERRAIN_FADE_START) / (TERRAIN_FADE_END - TERRAIN_FADE_START));
      }
      const height = Math.max(b.height || 0, MIN_BUILDING_HEIGHT);
      let geo: THREE.ExtrudeGeometry;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { bevelEnabled: false, depth: height });
      } catch {
        continue; // self-intersecting ring earcut can throw — skip it
      }
      geo.rotateX(-Math.PI / 2);
      if (sample) {
        const e = sample(sumLat / n, sumLon / n);
        if (e !== null) {
          geo.translate(0, e, 0);
        }
      }
      // Bake the building's alpha into a per-vertex RGBA color (RGB stays white so
      // the material tint shows through; alpha drives the edge dissolve).
      const vcount = geo.attributes.position.count;
      const colors = new Float32Array(vcount * 4);
      for (let k = 0; k < vcount; k++) {
        colors[k * 4] = 1;
        colors[k * 4 + 1] = 1;
        colors[k * 4 + 2] = 1;
        colors[k * 4 + 3] = alpha;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      parts.push(geo);
    }
    if (parts.length === 0) {
      return null;
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (merged) {
      merged.computeVertexNormals();
    }
    return merged;
  }, [buildings, frame, sample, center, radius]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) {
    return null;
  }
  return (
    <mesh geometry={geometry}>
      {/* depthWrite off: the prisms are a translucent radial-faded massing, so they
          blend rather than hard-occlude — and it keeps Fade from popping when it
          restores the original depth-write at the end of a fade-in. */}
      <meshStandardMaterial
        color={color}
        vertexColors
        transparent
        depthWrite={false}
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
