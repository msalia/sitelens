import type { LengthUnit } from '@/lib/types';

// Mirrors api/src/units.rs. Canonical storage unit is meters.
const US_SURVEY_FOOT_M = 1200 / 3937;
const INTERNATIONAL_FOOT_M = 0.3048;

function factor(unit: LengthUnit): number {
  switch (unit) {
    case 'US_SURVEY_FOOT':
      return US_SURVEY_FOOT_M;
    case 'INTERNATIONAL_FOOT':
      return INTERNATIONAL_FOOT_M;
    case 'METER':
      return 1;
  }
}

export function toMeters(value: number, unit: LengthUnit): number {
  return value * factor(unit);
}

export function fromMeters(meters: number, unit: LengthUnit): number {
  return meters / factor(unit);
}

/** Formats a meters value in the given unit with sensible precision. */
export function formatInUnit(meters: number, unit: LengthUnit, digits = 3): string {
  return fromMeters(meters, unit).toFixed(digits);
}
