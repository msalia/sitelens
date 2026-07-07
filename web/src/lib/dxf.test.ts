import { describe, expect, it } from 'vitest';

import { dxfExtent } from '@/lib/dxf';

// DXF parsing moved to the API (api/src/dxf.rs); only dxfExtent remains here.
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
