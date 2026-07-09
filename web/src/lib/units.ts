import { type LengthUnit, UNIT_OPTIONS } from '@/lib/types';

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

const UNIT_NAMES = Object.fromEntries(UNIT_OPTIONS.map((o) => [o.value, o.label])) as Record<
  LengthUnit,
  string
>;

/** The full human label for a unit (e.g. "US survey foot"), via a record lookup
 *  instead of scanning UNIT_OPTIONS at each call site. */
export function unitName(unit: LengthUnit): string {
  return UNIT_NAMES[unit];
}

// --- Volume / area --------------------------------------------------------
// Volumes are computed canonically in cubic meters; earthwork is reported in
// cubic yards (US convention) or cubic meters.

/** A volume display unit. */
export type VolumeUnit = 'CUBIC_YARD' | 'CUBIC_METER';

const CUBIC_YARD_M3 = 0.764554857984; // (0.9144 m)³, exact

/** Converts a cubic-meter volume to the given volume unit. */
export function fromCubicMeters(m3: number, unit: VolumeUnit): number {
  return unit === 'CUBIC_YARD' ? m3 / CUBIC_YARD_M3 : m3;
}

/** Compact volume label, e.g. "1,234 yd³". */
export function formatVolume(m3: number, unit: VolumeUnit): string {
  const v = fromCubicMeters(m3, unit);
  const suffix = unit === 'CUBIC_YARD' ? 'yd³' : 'm³';
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${suffix}`;
}

/** Converts a square-meter area to the given length unit's square, with a label. */
export function formatArea(m2: number, unit: LengthUnit): string {
  const f = factor(unit);
  const v = m2 / (f * f);
  const suffix = unit === 'METER' ? 'm²' : 'ft²';
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${suffix}`;
}
