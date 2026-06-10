'use client';

import { useEffect, useRef, useState } from 'react';

import type { EpsgEntry } from '@/lib/types';

import { Input } from '@/components/ui/input';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const SEARCH = graphql(`
  query SearchEpsg($q: String!, $limit: Int) {
    searchEpsg(query: $q, limit: $limit) {
      code
      name
    }
  }
`);

/** A searchable EPSG coordinate-reference-system picker. */
export function EpsgPicker({
  idPrefix,
  onChange,
  value,
}: {
  idPrefix: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EpsgEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Resolve the current code's name for display.
  useEffect(() => {
    if (!value) {
      setSelectedName('');
      return;
    }
    let cancelled = false;
    gql(SEARCH, { limit: 5, q: value })
      .then(({ searchEpsg }) => {
        const hit = searchEpsg.find((e) => String(e.code) === value);
        if (!cancelled) {
          setSelectedName(hit?.name ?? '');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Debounced search as the user types.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handle = setTimeout(() => {
      gql(SEARCH, { limit: 25, q: query })
        .then(({ searchEpsg }) => setResults(searchEpsg))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function select(entry: EpsgEntry) {
    onChange(String(entry.code));
    setSelectedName(entry.name);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        id={`${idPrefix}-epsg`}
        value={open ? query : value ? `${value}${selectedName ? ` — ${selectedName}` : ''}` : ''}
        placeholder="Search EPSG (e.g. 2229 or “California zone 5”)"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
      />
      {open && results.length > 0 && (
        <ul className="bg-popover absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border shadow-md">
          {results.map((e) => (
            <li key={e.code}>
              <button
                type="button"
                onClick={() => select(e)}
                className="hover:bg-muted flex w-full flex-col items-start px-3 py-1.5 text-left text-sm"
              >
                <span className="font-medium">EPSG:{e.code}</span>
                <span className="text-muted-foreground truncate text-xs">{e.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
