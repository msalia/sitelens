// DXF parsing now happens server-side (`api/src/dxf.rs`, exposed via the
// `cadOverlayGeometry` query). This module keeps only the pure geometry helper
// used to auto-place an overlay, plus the shared polyline type.

export interface DxfPolyline {
  layer: string;
  points: { x: number; y: number }[];
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
