import { describe, expect, it } from 'vitest';

import { type DemGrid, drapedHeight, isValidElevation, sampleElevation } from './terrain';

// A 2×2 grid spanning lon 0..1 (W→E) and lat 0..1 (S→N). Row 0 is the north edge,
// so band = [NW, NE, SW, SE].
const grid: DemGrid = {
  band: [10, 20, 30, 40], // NW=10 NE=20 SW=30 SE=40
  east: 1,
  height: 2,
  meanHeight: 25,
  north: 1,
  south: 0,
  west: 0,
  width: 2,
};

describe('isValidElevation', () => {
  it('rejects nodata sentinels and non-finite values', () => {
    expect(isValidElevation(-32768)).toBe(false);
    expect(isValidElevation(NaN)).toBe(false);
    expect(isValidElevation(Infinity)).toBe(false);
    expect(isValidElevation(123.4)).toBe(true);
    expect(isValidElevation(0)).toBe(true);
  });
});

describe('sampleElevation', () => {
  it('returns the exact corner values', () => {
    expect(sampleElevation(grid, 1, 0)).toBeCloseTo(10); // NW
    expect(sampleElevation(grid, 1, 1)).toBeCloseTo(20); // NE
    expect(sampleElevation(grid, 0, 0)).toBeCloseTo(30); // SW
    expect(sampleElevation(grid, 0, 1)).toBeCloseTo(40); // SE
  });

  it('bilinearly interpolates the centre', () => {
    expect(sampleElevation(grid, 0.5, 0.5)).toBeCloseTo(25); // mean of corners
  });

  it('interpolates along an edge', () => {
    expect(sampleElevation(grid, 1, 0.5)).toBeCloseTo(15); // midpoint of NW/NE
  });

  it('returns null outside the bbox', () => {
    expect(sampleElevation(grid, 2, 0.5)).toBeNull();
    expect(sampleElevation(grid, 0.5, -0.1)).toBeNull();
  });

  it('falls back to the mean for nodata cells', () => {
    const holed: DemGrid = { ...grid, band: [-32768, 20, 30, 40] };
    // NW is nodata → treated as meanHeight (25); centre = mean(25,20,30,40)=28.75
    expect(sampleElevation(holed, 0.5, 0.5)).toBeCloseTo(28.75);
  });
});

describe('drapedHeight', () => {
  const sample = (lat: number, lon: number) => sampleElevation(grid, lat, lon);

  it('keeps a non-zero z (the point wins over terrain)', () => {
    expect(drapedHeight(sample, 0.5, 0.5, 12.5)).toBe(12.5);
  });

  it('drapes a zero-elevation point onto the surface', () => {
    expect(drapedHeight(sample, 0.5, 0.5, 0)).toBeCloseTo(25);
  });

  it('leaves height untouched when no sampler is given', () => {
    expect(drapedHeight(null, 0.5, 0.5, 0)).toBe(0);
  });
});
