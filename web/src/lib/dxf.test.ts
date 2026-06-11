import { describe, expect, it } from 'vitest';

import { dxfExtent, parseDxf } from '@/lib/dxf';

// Minimal hand-written DXF documents (group-code / value pairs, one per line).
function entities(body: string): string {
  return `0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;
}

const LINE = '0\nLINE\n8\nWALLS\n10\n0\n20\n0\n11\n10\n21\n5\n';
const LWPOLYLINE = '0\nLWPOLYLINE\n8\nGRID\n90\n3\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n';
const POINT = '0\nPOINT\n8\nNODES\n10\n5\n20\n5\n';

describe('parseDxf', () => {
  it('parses a LINE into a 2-point polyline on its layer', () => {
    const { layers, polylines } = parseDxf(entities(LINE));
    expect(polylines).toHaveLength(1);
    expect(polylines[0].layer).toBe('WALLS');
    expect(polylines[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(layers).toEqual(['WALLS']);
  });

  it('parses an LWPOLYLINE with all its vertices', () => {
    const { polylines } = parseDxf(entities(LWPOLYLINE));
    expect(polylines).toHaveLength(1);
    expect(polylines[0].layer).toBe('GRID');
    expect(polylines[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('groups multiple entities and returns sorted unique layers', () => {
    const { layers, polylines } = parseDxf(entities(LINE + LWPOLYLINE));
    expect(polylines).toHaveLength(2);
    expect(layers).toEqual(['GRID', 'WALLS']); // sorted, deduped
  });

  it('ignores entity types it does not render (e.g. POINT)', () => {
    const { polylines } = parseDxf(entities(POINT));
    expect(polylines).toHaveLength(0);
  });

  it('returns nothing for an empty entities section', () => {
    const { layers, polylines } = parseDxf(entities(''));
    expect(polylines).toHaveLength(0);
    expect(layers).toHaveLength(0);
  });
});

describe('dxfExtent', () => {
  it('returns all zeros when there is no geometry', () => {
    expect(dxfExtent([])).toEqual({ cx: 0, cy: 0, spanX: 0, spanY: 0 });
  });

  it('centers on a simple box', () => {
    const box = [
      {
        layer: 'A',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 4 },
        ],
      },
    ];
    const { cx, cy, spanX, spanY } = dxfExtent(box);
    expect(cx).toBeCloseTo(5);
    expect(cy).toBeCloseTo(2);
    expect(spanX).toBeCloseTo(10);
    expect(spanY).toBeCloseTo(4);
  });

  it('ignores a stray outlier so the center tracks the dense cluster', () => {
    // A tight 0..10 cluster plus one far-away stray point at 1e6. A plain
    // bounding box would center near 5e5; the 2–98 percentile ignores the stray.
    const cluster = Array.from({ length: 50 }, (_, i) => ({ x: i / 5, y: i / 5 }));
    const points = [...cluster, { x: 1_000_000, y: 1_000_000 }];
    const { cx, cy } = dxfExtent([{ layer: 'A', points }]);
    expect(cx).toBeLessThan(20);
    expect(cy).toBeLessThan(20);
  });
});
