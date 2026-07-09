import type { Metadata } from 'next';

import fs from 'fs';
import path from 'path';

import { absoluteUrl, SITE_NAME } from '@/lib/site';

export type DocGroup =
  | 'Getting Started'
  | 'Coordinates & Transform'
  | 'Working with Data'
  | 'Visualization'
  | 'Plans & Pricing';

export interface DocMeta {
  description: string;
  group: DocGroup;
  href: string;
  slug: string;
  title: string;
}

/** Ordered list of documentation pages. Drives routing, prev/next, and the nav. */
export const docsOrder: DocMeta[] = [
  {
    description: 'What SiteLens is and the surveyor workflow it supports.',
    group: 'Getting Started',
    href: '/docs',
    slug: 'introduction',
    title: 'Introduction',
  },
  {
    description: 'Create a project, pick a CRS, and set your display units.',
    group: 'Getting Started',
    href: '/docs/getting-started',
    slug: 'getting-started',
    title: 'Getting Started',
  },
  {
    description:
      'Building grid, projected northing/easting, geographic, grid vs ground, and units.',
    group: 'Coordinates & Transform',
    href: '/docs/coordinate-systems',
    slug: 'coordinate-systems',
    title: 'Coordinate Systems',
  },
  {
    description: 'Define building gridlines and enter the city control points.',
    group: 'Coordinates & Transform',
    href: '/docs/grid-and-control-points',
    slug: 'grid-and-control-points',
    title: 'Grid & Control Points',
  },
  {
    description: 'Solve the grid-to-ground tie with a Helmert fit, residuals, and RMS.',
    group: 'Coordinates & Transform',
    href: '/docs/the-transform',
    slug: 'the-transform',
    title: 'The Transform',
  },
  {
    description: 'Bring in survey-machine exports via CSV and LandXML.',
    group: 'Working with Data',
    href: '/docs/importing-points',
    slug: 'importing-points',
    title: 'Importing Points',
  },
  {
    description: 'Convert coordinates across systems and export CSV, LandXML, and snapshots.',
    group: 'Working with Data',
    href: '/docs/converting-and-exporting',
    slug: 'converting-and-exporting',
    title: 'Converting & Exporting',
  },
  {
    description:
      'Export to Trimble/Carlson/Topcon, import as-builts, and run a stakeout QC comparison.',
    group: 'Working with Data',
    href: '/docs/field-exchange',
    slug: 'field-exchange',
    title: 'Field Exchange',
  },
  {
    description:
      'Capture buried and interior utilities as an attributed 3D as-built record, then export to CAD/GIS.',
    group: 'Working with Data',
    href: '/docs/utilities',
    slug: 'utilities',
    title: 'Utility Records',
  },
  {
    description:
      'Read the utility schedule PDF: the architectural plan sheet, its color and line conventions, and the dual-unit tables.',
    group: 'Working with Data',
    href: '/docs/utility-schedule',
    slug: 'utility-schedule',
    title: 'Utility Schedule PDF',
  },
  {
    description:
      'The 3D scene, terrain, projecting onto terrain, camera views, and display toggles.',
    group: 'Visualization',
    href: '/docs/visualization',
    slug: 'visualization',
    title: '3D Visualization',
  },
  {
    description: 'Import and georeference the architect drawing in the 3D scene.',
    group: 'Visualization',
    href: '/docs/dxf-overlay',
    slug: 'dxf-overlay',
    title: 'DXF Overlay',
  },
  {
    description:
      'Build TIN and DEM surfaces, derive contours, compute cut/fill volumes with a heatmap, and export LandXML/DXF/GeoTIFF/PDF.',
    group: 'Visualization',
    href: '/docs/surfaces',
    slug: 'surfaces',
    title: 'Surfaces & Volumes',
  },
  {
    description: 'What the Solo and Crew plans unlock, and how billing works.',
    group: 'Plans & Pricing',
    href: '/docs/plans',
    slug: 'plans',
    title: 'Plans & Pricing',
  },
];

/** Per-page SEO metadata for a documentation route, derived from `docsOrder`.
 *  Used by each docs `page.tsx` via `export const metadata`. */
export function getDocMetadata(href: string): Metadata {
  const doc = docsOrder.find((d) => d.href === href);
  if (!doc) {
    return {};
  }
  const ogTitle = `${doc.title} — ${SITE_NAME}`;
  // Defining a per-page `openGraph`/`twitter` object replaces the inherited
  // root one (including its file-based share image), so re-attach the image.
  const shareImage = absoluteUrl('/opengraph-image');
  return {
    alternates: { canonical: doc.href },
    description: doc.description,
    openGraph: {
      description: doc.description,
      images: [shareImage],
      title: ogTitle,
      type: 'article',
      url: doc.href,
    },
    title: doc.title,
    twitter: {
      card: 'summary_large_image',
      description: doc.description,
      images: [shareImage],
      title: ogTitle,
    },
  };
}

/** BreadcrumbList JSON-LD (Home › Docs › page) for a documentation route. */
export function getDocBreadcrumb(href: string): Record<string, unknown> | null {
  const doc = docsOrder.find((d) => d.href === href);
  if (!doc) {
    return null;
  }
  const items = [
    { name: 'Home', url: absoluteUrl('/') },
    { name: 'Documentation', url: absoluteUrl('/docs') },
  ];
  // The introduction page *is* /docs, so don't repeat it as a third crumb.
  if (doc.href !== '/docs') {
    items.push({ name: doc.title, url: absoluteUrl(doc.href) });
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      item: item.url,
      name: item.name,
      position: index + 1,
    })),
  };
}

export function getDocContent(slug: string): string {
  const filePath = path.join(process.cwd(), 'src/content/docs', `${slug}.md`);
  return fs.readFileSync(filePath, 'utf-8');
}

export function getDocNav(href: string) {
  const index = docsOrder.findIndex((d) => d.href === href);
  return {
    current: docsOrder[index],
    next: index < docsOrder.length - 1 ? docsOrder[index + 1] : null,
    prev: index > 0 ? docsOrder[index - 1] : null,
  };
}

export interface DocSection {
  id: string;
  title: string;
}

export function getDocSections(slug: string): DocSection[] {
  const content = getDocContent(slug);
  const headings: DocSection[] = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      const title = match[1];
      const id = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      headings.push({ id, title });
    }
  }
  return headings;
}

export interface DocNavItem {
  group: DocGroup;
  href: string;
  slug: string;
  title: string;
}

export function getDocsNav(): DocNavItem[] {
  return docsOrder.map(({ group, href, slug, title }) => ({ group, href, slug, title }));
}
