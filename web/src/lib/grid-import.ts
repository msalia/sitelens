import { type GridFamily } from '@/lib/types';

/** A successfully parsed axis line. */
export type ValidGridRow = {
  ok: true;
  line: number;
  family: GridFamily;
  label: string;
  position: number;
};

/** A rejected line, with a human-readable reason. */
export type GridRowError = { ok: false; line: number; raw: string; error: string };

/** A parsed CSV line: either a valid axis or an error describing why it failed. */
export type ParsedGridRow = ValidGridRow | GridRowError;

/** Split parsed rows into the valid axes and the rejected lines, in one pass. */
export function partitionGridRows(rows: ParsedGridRow[]): {
  valid: ValidGridRow[];
  errors: GridRowError[];
} {
  const valid: ValidGridRow[] = [];
  const errors: GridRowError[] = [];
  for (const r of rows) {
    if (r.ok) {
      valid.push(r);
    } else {
      errors.push(r);
    }
  }
  return { errors, valid };
}

/** Parse a grid `family` token (case-insensitive; `L`/`N` shorthand allowed). */
export function parseGridFamily(raw: string): GridFamily | null {
  const v = raw.trim().toLowerCase();
  if (v === 'lettered' || v === 'l') {
    return 'LETTERED';
  }
  if (v === 'numbered' || v === 'n') {
    return 'NUMBERED';
  }
  return null;
}

/**
 * Parse `family,label,position` CSV text into rows, flagging bad lines.
 * Blank lines are skipped; with `hasHeader`, the first non-empty line is dropped.
 * Line numbers are 1-based (matching how editors show them) so callers can point
 * users at the offending row.
 */
export function parseGridCsv(text: string, hasHeader: boolean): ParsedGridRow[] {
  const lines = text.split(/\r?\n/);
  const headerLine = hasHeader ? lines.findIndex((l) => l.trim()) : -1;
  const rows: ParsedGridRow[] = [];
  lines.forEach((raw, i) => {
    if (!raw.trim() || i === headerLine) {
      return;
    }
    const line = i + 1;
    const cols = raw.split(',').map((c) => c.trim());
    if (cols.length < 3) {
      rows.push({ error: 'Expected family, label, position', line, ok: false, raw });
      return;
    }
    const family = parseGridFamily(cols[0]);
    if (!family) {
      rows.push({ error: `Unknown family "${cols[0]}"`, line, ok: false, raw });
      return;
    }
    const label = cols[1];
    if (!label) {
      rows.push({ error: 'Missing label', line, ok: false, raw });
      return;
    }
    const position = parseFloat(cols[2]);
    if (Number.isNaN(position)) {
      rows.push({ error: `Invalid position "${cols[2]}"`, line, ok: false, raw });
      return;
    }
    rows.push({ family, label, line, ok: true, position });
  });
  return rows;
}
