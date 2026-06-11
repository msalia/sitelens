/* eslint-disable @typescript-eslint/no-explicit-any */
// dxf-parser is loosely typed; we normalize its output into simple polylines.
import DxfParser from 'dxf-parser';

export interface DxfPolyline {
  layer: string;
  points: { x: number; y: number }[];
}

export interface ParsedDxf {
  layers: string[];
  polylines: DxfPolyline[];
}

/** Robust extent of a drawing's geometry, using the 2nd–98th percentile of all
 * vertices on each axis. Ignoring the extreme 2% keeps a stray title block,
 * leader line, or a lone point at the file's (0, 0) origin from skewing the
 * center or blowing up the span away from the actual floor plan. Returns the
 * center (cx, cy) and span; all zero when there are no points. */
export function dxfExtent(polylines: DxfPolyline[]): {
  cx: number;
  cy: number;
  spanX: number;
  spanY: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const pl of polylines) {
    for (const p of pl.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length === 0) {
    return { cx: 0, cy: 0, spanX: 0, spanY: 0 };
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const pct = (arr: number[], q: number) =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];
  const xLo = pct(xs, 0.02);
  const xHi = pct(xs, 0.98);
  const yLo = pct(ys, 0.02);
  const yHi = pct(ys, 0.98);
  return { cx: (xLo + xHi) / 2, cy: (yLo + yHi) / 2, spanX: xHi - xLo, spanY: yHi - yLo };
}

function tessellateArc(
  center: { x: number; y: number },
  radius: number,
  start: number,
  end: number,
  segments = 48,
): { x: number; y: number }[] {
  let a1 = end;
  if (a1 < start) {
    a1 += Math.PI * 2;
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = start + ((a1 - start) * i) / segments;
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return out;
}

/** Parses DXF text into renderable 2D polylines grouped by layer. */
export function parseDxf(text: string): ParsedDxf {
  const dxf: any = new DxfParser().parseSync(text);
  const polylines: DxfPolyline[] = [];
  const layers = new Set<string>();

  const push = (layer: string, points: { x: number; y: number }[]) => {
    if (points.length >= 2) {
      polylines.push({ layer, points });
      layers.add(layer);
    }
  };

  for (const e of dxf?.entities ?? []) {
    const layer: string = e.layer ?? '0';
    switch (e.type) {
      case 'LINE':
        if (e.vertices?.length >= 2) {
          push(layer, [
            { x: e.vertices[0].x, y: e.vertices[0].y },
            { x: e.vertices[1].x, y: e.vertices[1].y },
          ]);
        }
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts = (e.vertices ?? []).map((v: any) => ({ x: v.x, y: v.y }));
        if ((e.shape || e.closed) && pts.length > 0) {
          pts.push({ ...pts[0] });
        }
        push(layer, pts);
        break;
      }
      case 'ARC':
        push(layer, tessellateArc(e.center, e.radius, e.startAngle ?? 0, e.endAngle ?? 0));
        break;
      case 'CIRCLE':
        push(layer, tessellateArc(e.center, e.radius, 0, Math.PI * 2));
        break;
      default:
        break;
    }
  }

  return { layers: [...layers].sort(), polylines };
}
