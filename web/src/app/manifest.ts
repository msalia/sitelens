import type { MetadataRoute } from 'next';

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: '#070b16',
    description: SITE_DESCRIPTION,
    display: 'standalone',
    icons: [
      { sizes: 'any', src: '/favicon.ico', type: 'image/x-icon' },
      { purpose: 'any', sizes: 'any', src: '/icon.svg', type: 'image/svg+xml' },
    ],
    name: `${SITE_NAME} — Coordinate-tie & 3D visualization`,
    short_name: SITE_NAME,
    start_url: '/',
    theme_color: '#070b16',
  };
}
