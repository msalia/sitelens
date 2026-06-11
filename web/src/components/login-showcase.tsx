'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

export type ShowcasePlace = { id: string; label: string; lat: number; lon: number };

// The R3F scene is client-only and heavy, so it's lazy-loaded (no SSR) — it never
// ships in the initial login bundle.
const LoginShowcaseScene = dynamic(
  () => import('./login-showcase-scene').then((m) => m.LoginShowcaseScene),
  { ssr: false },
);

/** Login cover: an auto-cycling, orbiting 3D view of cached iconic places. Renders
 *  nothing if the baked assets are absent (the login page keeps its own backdrop
 *  behind this), so it degrades gracefully. */
export function LoginShowcase() {
  const [places, setPlaces] = useState<ShowcasePlace[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/showcase/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ShowcasePlace[]) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setPlaces(list);
        }
      })
      .catch(() => {
        /* assets not baked — leave the page backdrop showing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (places.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0">
      <LoginShowcaseScene places={places} />
    </div>
  );
}
