'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// The R3F scene is client-only and pulls in three.js, so it's lazy-loaded — it
// never ships in the initial landing bundle.
const HeroGlobeScene = dynamic(() => import('./hero-globe-scene').then((m) => m.HeroGlobeScene), {
  ssr: false,
});

/** A static great-circle globe for browsers without WebGL (and the pre-mount
 *  frame). Pure SVG, so it always paints. */
function GlobeFallback() {
  return (
    <svg
      viewBox="-160 -160 320 320"
      className="h-full w-full"
      aria-hidden="true"
      role="presentation"
    >
      <circle cx="0" cy="0" r="150" fill="#0e1a40" opacity="0.35" />
      <circle cx="0" cy="0" r="150" fill="none" stroke="#4f7bff" strokeOpacity="0.5" />
      {[150, 116, 70].map((rx) => (
        <ellipse
          key={`h${rx}`}
          cx="0"
          cy="0"
          rx={rx}
          ry="150"
          fill="none"
          stroke="#6366f1"
          strokeOpacity="0.35"
        />
      ))}
      {[150, 116, 70].map((ry) => (
        <ellipse
          key={`v${ry}`}
          cx="0"
          cy="0"
          rx="150"
          ry={ry}
          fill="none"
          stroke="#818cf8"
          strokeOpacity="0.3"
        />
      ))}
    </svg>
  );
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export function HeroGlobe() {
  // null = undecided (SSR + first paint → fallback); true/false after mount.
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebgl(hasWebGL());
  }, []);

  return <div className="absolute inset-0">{webgl ? <HeroGlobeScene /> : <GlobeFallback />}</div>;
}
