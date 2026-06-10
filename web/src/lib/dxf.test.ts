import { describe, expect, it } from 'vitest';

import { parseDxf } from '@/lib/dxf';

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
