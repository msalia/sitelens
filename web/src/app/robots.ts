import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/** Allow crawling of the public marketing + docs + legal pages, but keep the
 *  authenticated app, auth flows, and API routes out of the index. */
export default function robots(): MetadataRoute.Robots {
  return {
    host: absoluteUrl('/'),
    rules: {
      allow: '/',
      disallow: [
        '/projects/',
        '/settings/',
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/verify',
        '/accept-invite',
        '/api/',
        '/stripe/',
      ],
      userAgent: '*',
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
