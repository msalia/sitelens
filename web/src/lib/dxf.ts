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
