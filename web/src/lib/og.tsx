import { ImageResponse } from 'next/og';

import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

/** Shared 1200×630 social-share card, reused by both the Open Graph image
 *  (`opengraph-image.tsx`) and the Twitter image (`twitter-image.tsx`) so the
 *  two never drift. Renders the dark brand backdrop, a compass mark, the
 *  wordmark, and the tagline. */

export const OG_SIZE = { height: 630, width: 1200 };
export const OG_CONTENT_TYPE = 'image/png';
export const OG_ALT = `${SITE_NAME} — ${SITE_TAGLINE}`;

export function renderOgImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        background: 'radial-gradient(120% 90% at 50% -10%, #4f46e5 0%, transparent 55%), #070b16',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        height: '100%',
        justifyContent: 'center',
        padding: '80px',
        width: '100%',
      }}
    >
      {/* Brand row: compass mark + wordmark. */}
      <div style={{ alignItems: 'center', display: 'flex', gap: 24 }}>
        <div
          style={{
            alignItems: 'center',
            background: 'linear-gradient(135deg, #818cf8 0%, #8b5cf6 100%)',
            borderRadius: 24,
            display: 'flex',
            height: 96,
            justifyContent: 'center',
            width: 96,
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
        </div>
        <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-0.02em' }}>{SITE_NAME}</span>
      </div>

      {/* Tagline / value prop. */}
      <div
        style={{
          display: 'flex',
          fontSize: 52,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          marginTop: 56,
          maxWidth: 900,
        }}
      >
        Tie every survey to ground truth.
      </div>
      <div
        style={{
          color: 'rgba(255,255,255,0.6)',
          display: 'flex',
          fontSize: 30,
          marginTop: 24,
          maxWidth: 880,
        }}
      >
        Least-squares Helmert coordinate-tie and live 3D visualization for construction surveyors.
      </div>
    </div>,
    OG_SIZE,
  );
}
