'use client';

import { type ReactNode } from 'react';

/** Bottom-left overlay: caller-supplied live stats plus terrain / buildings
 * provenance and a "not survey-grade" disclaimer. Plain text, no interaction. */
export function SceneStats({
  buildingsMeta,
  stats,
  terrainMeta,
}: {
  stats?: { label: string; value: ReactNode }[];
  terrainMeta: { fetchedAt: string; demtype: string } | null;
  buildingsMeta: { count: number; fetchedAt: string } | null;
}) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 space-y-0.5 text-xs">
      {stats?.map((s) => (
        <div key={s.label}>
          <span className="text-muted-foreground">{s.label}:</span>{' '}
          <span className="text-foreground font-medium">{s.value}</span>
        </div>
      ))}
      {terrainMeta ? (
        <div>
          <span className="text-muted-foreground">Terrain:</span>{' '}
          <span className="text-foreground font-medium">
            {terrainMeta.demtype ? `${terrainMeta.demtype} · ` : ''}
            {new Date(terrainMeta.fetchedAt).toLocaleDateString()}
          </span>
        </div>
      ) : null}
      {buildingsMeta ? (
        <div>
          <span className="text-muted-foreground">Buildings:</span>{' '}
          <span className="text-foreground font-medium">
            {buildingsMeta.count} · OSM · {new Date(buildingsMeta.fetchedAt).toLocaleDateString()}
          </span>
        </div>
      ) : null}
      {terrainMeta || buildingsMeta ? (
        <div className="text-muted-foreground pt-1 text-[10px] whitespace-nowrap">
          Terrain &amp; buildings are not survey-grade — for visual reference only.
        </div>
      ) : null}
    </div>
  );
}
