'use client';

import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';

import type { LengthUnit } from '@/lib/types';

import { fromMeters } from '@/lib/units';

import { type Frame, toLocal, type Vec3 } from '../terrain-frame';

/** One decoded iso-elevation: its polylines (in local scene space) + level. */
interface DecodedLevel {
  isMajor: boolean;
  level: number; // meters
  polylines: Vec3[][];
}

/** Small lift (m) so contour lines float just above the surface, avoiding
 *  z-fighting with the coincident TIN faces. */
const LIFT = 0.05;
/** Topographic browns: minor thin, major bolder + labeled. */
const MINOR_COLOR = '#9a3412';
const MAJOR_COLOR = '#7c2d12';
/** Cap on major labels drawn, so a very fine interval can't flood the scene. */
const MAX_LABELS = 160;

/**
 * Decodes the server's SCTR contour blob into scene-space polylines. Points are
 * geographic `[lat, lon]` at the level's elevation; each is placed with the same
 * {@link toLocal} transform the mesh uses, so contours drape on the surface.
 * Layout (little-endian): see `api/src/surface/mod.rs`.
 */
function decodeContours(buf: ArrayBuffer, frame: Frame): DecodedLevel[] {
  if (buf.byteLength < 12) {
    return [];
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SCTR') {
    return [];
  }
  const levelCount = dv.getUint32(8, true);
  const levels: DecodedLevel[] = [];
  let off = 12;
  for (let l = 0; l < levelCount; l++) {
    const level = dv.getFloat64(off, true);
    const isMajor = dv.getUint32(off + 8, true) === 1;
    const polyCount = dv.getUint32(off + 12, true);
    off += 16;
    const polylines: Vec3[][] = [];
    for (let p = 0; p < polyCount; p++) {
      const n = dv.getUint32(off, true);
      off += 4;
      const pts: Vec3[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const lat = dv.getFloat64(off, true);
        const lon = dv.getFloat64(off + 8, true);
        off += 16;
        pts[i] = toLocal(frame, lat, lon, level + LIFT);
      }
      polylines.push(pts);
    }
    levels.push({ isMajor, level, polylines });
  }
  return levels;
}

/** Formats an elevation (meters) in the display unit with a compact suffix. */
function labelText(meters: number, unit: LengthUnit): string {
  const v = fromMeters(meters, unit);
  const num = Number.isInteger(v) ? v.toString() : v.toFixed(2);
  return `${num} ${unit === 'METER' ? 'm' : 'ft'}`;
}

/**
 * Renders computed contour lines over the active surface: minor lines thin, major
 * lines bolder with optional elevation labels placed at each major polyline's
 * midpoint.
 */
export function SurfaceContours({
  contentBase64,
  displayUnit,
  frame,
  showLabels = true,
  visible = true,
}: {
  /** The SCTR contour blob (base64), or null when none is loaded. */
  contentBase64: string | null;
  frame: Frame;
  displayUnit: LengthUnit;
  showLabels?: boolean;
  visible?: boolean;
}) {
  const levels = useMemo(() => {
    if (!contentBase64) {
      return [];
    }
    try {
      const bin = atob(contentBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return decodeContours(bytes.buffer, frame);
    } catch {
      return [];
    }
  }, [contentBase64, frame]);

  // Major-contour labels at each major polyline's midpoint (capped).
  const labels = useMemo(() => {
    if (!showLabels) {
      return [];
    }
    const out: { key: string; position: Vec3; text: string }[] = [];
    for (const lv of levels) {
      if (!lv.isMajor) {
        continue;
      }
      const text = labelText(lv.level, displayUnit);
      for (let p = 0; p < lv.polylines.length && out.length < MAX_LABELS; p++) {
        const pl = lv.polylines[p];
        if (pl.length >= 2) {
          out.push({ key: `${lv.level}-${p}`, position: pl[Math.floor(pl.length / 2)], text });
        }
      }
      if (out.length >= MAX_LABELS) {
        break;
      }
    }
    return out;
  }, [levels, showLabels, displayUnit]);

  if (!visible || levels.length === 0) {
    return null;
  }

  return (
    <>
      {levels.map((lv, i) =>
        lv.polylines.map((pts, j) => (
          <Line
            key={`${i}-${j}`}
            points={pts}
            color={lv.isMajor ? MAJOR_COLOR : MINOR_COLOR}
            lineWidth={lv.isMajor ? 1.8 : 1}
            transparent
            opacity={lv.isMajor ? 0.95 : 0.75}
          />
        )),
      )}
      {labels.map((lbl) => (
        <group key={lbl.key} position={lbl.position}>
          <Html position={[0, 0, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <span className="bg-background/85 rounded px-1 text-[9px] leading-none font-semibold text-[#7c2d12] shadow-sm">
              {lbl.text}
            </span>
          </Html>
        </group>
      ))}
    </>
  );
}
