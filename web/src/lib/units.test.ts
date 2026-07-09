import { describe, expect, it } from 'vitest';

import type { LengthUnit } from '@/lib/types';

import {
  formatArea,
  formatInUnit,
  formatVolume,
  fromCubicMeters,
  fromMeters,
  toMeters,
} from '@/lib/units';

describe('units', () => {
  it('treats meters as the identity', () => {
    expect(toMeters(42, 'METER')).toBe(42);
    expect(fromMeters(42, 'METER')).toBe(42);
  });

  it('uses the exact US survey foot definition (3937 ft = 1200 m)', () => {
    // The whole point of the survey foot is this exact ratio.
    expect(toMeters(3937, 'US_SURVEY_FOOT')).toBeCloseTo(1200, 9);
  });

  it('uses the exact international foot definition (1 ft = 0.3048 m)', () => {
    expect(toMeters(1, 'INTERNATIONAL_FOOT')).toBeCloseTo(0.3048, 12);
  });

  it('round-trips every unit', () => {
    const units: LengthUnit[] = ['US_SURVEY_FOOT', 'INTERNATIONAL_FOOT', 'METER'];
    for (const u of units) {
      expect(fromMeters(toMeters(1234.567, u), u)).toBeCloseTo(1234.567, 9);
    }
  });

  it('distinguishes survey and international feet (≈2 ppm)', () => {
    const diff = toMeters(1000, 'US_SURVEY_FOOT') - toMeters(1000, 'INTERNATIONAL_FOOT');
    expect(Math.abs(diff)).toBeGreaterThan(1e-6);
    expect(Math.abs(diff)).toBeLessThan(0.01); // sub-cm over 1000 ft
  });

  it('formats with the requested precision', () => {
    expect(formatInUnit(1, 'METER')).toBe('1.000');
    expect(formatInUnit(1, 'METER', 1)).toBe('1.0');
    // 0.3048 m is exactly 1 international foot.
    expect(formatInUnit(0.3048, 'INTERNATIONAL_FOOT', 4)).toBe('1.0000');
  });

  it('mirrors the canonical server conversions for a known value', () => {
    // 100 m → US survey feet, matching api/src/units.rs.
    expect(fromMeters(100, 'US_SURVEY_FOOT')).toBeCloseTo((100 * 3937) / 1200, 9);
  });

  it('converts cubic meters to cubic yards (1 yd³ = 0.7645549 m³)', () => {
    expect(fromCubicMeters(0.764554857984, 'CUBIC_YARD')).toBeCloseTo(1, 9);
    expect(fromCubicMeters(42, 'CUBIC_METER')).toBe(42);
    expect(formatVolume(0.764554857984, 'CUBIC_YARD')).toBe('1 yd³');
    expect(formatVolume(5, 'CUBIC_METER')).toBe('5 m³');
  });

  it('converts area to the display unit squared', () => {
    expect(formatArea(100, 'METER')).toBe('100 m²');
    // 1 international ft = 0.3048 m ⇒ 1 ft² = 0.09290304 m².
    expect(formatArea(0.09290304, 'INTERNATIONAL_FOOT')).toBe('1 ft²');
  });
});
