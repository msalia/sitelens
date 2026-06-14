import type { MetadataRoute } from 'next';

import { docsOrder } from '@/lib/docs';
import { absoluteUrl } from '@/lib/site';

/** The public, indexable surface: marketing home, the docs site (driven by
 *  `docsOrder` so new pages are picked up automatically), and the legal pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticPages: {
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  }[] = [
    { changeFrequency: 'weekly', path: '/', priority: 1 },
    { changeFrequency: 'yearly', path: '/terms', priority: 0.3 },
    { changeFrequency: 'yearly', path: '/privacy', priority: 0.3 },
    { changeFrequency: 'yearly', path: '/subprocessors', priority: 0.3 },
  ];

  const docPages = docsOrder.map((doc) => ({
    changeFrequency: 'monthly' as const,
    path: doc.href,
    priority: 0.7,
  }));

  return [...staticPages, ...docPages].map(({ changeFrequency, path, priority }) => ({
    changeFrequency,
    lastModified,
    priority,
    url: absoluteUrl(path),
  }));
}
