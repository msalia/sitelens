import { describe, expect, it } from 'vitest';

import { parseGridCsv, parseGridFamily, partitionGridRows } from '@/lib/grid-import';

describe('parseGridFamily', () => {
  it('accepts full names case-insensitively', () => {
    expect(parseGridFamily('LETTERED')).toBe('LETTERED');
    expect(parseGridFamily('lettered')).toBe('LETTERED');
    expect(parseGridFamily('Numbered')).toBe('NUMBERED');
  });

  it('accepts L/N shorthand and trims whitespace', () => {
    expect(parseGridFamily(' l ')).toBe('LETTERED');
    expect(parseGridFamily('N')).toBe('NUMBERED');
  });

  it('rejects anything else', () => {
    expect(parseGridFamily('letter')).toBeNull();
    expect(parseGridFamily('')).toBeNull();
    expect(parseGridFamily('3')).toBeNull();
  });
});

describe('parseGridCsv', () => {
  it('parses valid rows with 1-based line numbers', () => {
    const rows = parseGridCsv('LETTERED,A,0\nNUMBERED,1,12.5', false);
    expect(rows).toEqual([
      { family: 'LETTERED', label: 'A', line: 1, ok: true, position: 0 },
      { family: 'NUMBERED', label: '1', line: 2, ok: true, position: 12.5 },
    ]);
  });

  it('skips blank lines but keeps original line numbers', () => {
    const rows = parseGridCsv('LETTERED,A,0\n\n\nNUMBERED,1,5', false);
    expect(rows.map((r) => r.line)).toEqual([1, 4]);
  });

  it('drops the first non-empty line when hasHeader is set', () => {
    const rows = parseGridCsv('family,label,position\nLETTERED,A,0', true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'A', ok: true });
  });

  it('treats a leading blank line correctly with a header', () => {
    const rows = parseGridCsv('\nfamily,label,position\nLETTERED,A,0', true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'A', line: 3, ok: true });
  });

  it('flags rows with too few columns', () => {
    const rows = parseGridCsv('LETTERED,A', false);
    expect(rows[0]).toMatchObject({ error: 'Expected family, label, position', ok: false });
  });

  it('flags unknown families', () => {
    const rows = parseGridCsv('BOGUS,A,0', false);
    expect(rows[0]).toMatchObject({ error: 'Unknown family "BOGUS"', ok: false });
  });

  it('flags missing labels', () => {
    const rows = parseGridCsv('LETTERED,,0', false);
    expect(rows[0]).toMatchObject({ error: 'Missing label', ok: false });
  });

  it('flags non-numeric positions', () => {
    const rows = parseGridCsv('LETTERED,A,abc', false);
    expect(rows[0]).toMatchObject({ error: 'Invalid position "abc"', ok: false });
  });

  it('trims surrounding whitespace in cells', () => {
    const rows = parseGridCsv('  LETTERED , A , 6.0 ', false);
    expect(rows[0]).toMatchObject({ family: 'LETTERED', label: 'A', ok: true, position: 6 });
  });

  it('accepts negative and decimal positions', () => {
    const rows = parseGridCsv('NUMBERED,1,-3.25', false);
    expect(rows[0]).toMatchObject({ ok: true, position: -3.25 });
  });

  it('returns an empty array for blank input', () => {
    expect(parseGridCsv('', false)).toEqual([]);
    expect(parseGridCsv('\n\n', true)).toEqual([]);
  });
});

describe('partitionGridRows', () => {
  it('splits valid axes from rejected lines preserving order', () => {
    const rows = parseGridCsv('LETTERED,A,0\nBOGUS,B,1\nNUMBERED,1,5', false);
    const { errors, valid } = partitionGridRows(rows);
    expect(valid.map((r) => r.label)).toEqual(['A', '1']);
    expect(errors.map((r) => r.line)).toEqual([2]);
  });

  it('returns empty buckets for empty input', () => {
    expect(partitionGridRows([])).toEqual({ errors: [], valid: [] });
  });
});
