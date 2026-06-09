import fs from 'fs';
import path from 'path';

export type DocGroup = 'Guides' | 'Reference';

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
    group: 'Guides',
    href: '/docs',
    slug: 'introduction',
    title: 'Introduction',
  },
  {
    description: 'Create a project, pick a CRS, and set your display units.',
    group: 'Guides',
    href: '/docs/getting-started',
    slug: 'getting-started',
    title: 'Getting Started',
  },
  {
    description:
      'Building grid, projected northing/easting, geographic, grid vs ground, and units.',
    group: 'Guides',
    href: '/docs/coordinate-systems',
    slug: 'coordinate-systems',
    title: 'Coordinate Systems',
  },
  {
    description: 'Define building gridlines and enter the city control points.',
    group: 'Guides',
    href: '/docs/grid-and-control-points',
    slug: 'grid-and-control-points',
    title: 'Grid & Control Points',
  },
  {
    description: 'Solve the grid-to-ground tie with a Helmert fit, residuals, and RMS.',
    group: 'Guides',
    href: '/docs/the-transform',
    slug: 'the-transform',
    title: 'The Transform',
  },
  {
    description: 'Bring in survey-machine exports via CSV and LandXML.',
    group: 'Guides',
    href: '/docs/importing-points',
    slug: 'importing-points',
    title: 'Importing Points',
  },
  {
    description: 'The Cesium scene, terrain backdrop, elevation, and point categories.',
    group: 'Guides',
    href: '/docs/visualization',
    slug: 'visualization',
    title: '3D Visualization',
  },
  {
    description: 'Import and georeference the architect drawing in the 3D scene.',
    group: 'Guides',
    href: '/docs/dxf-overlay',
    slug: 'dxf-overlay',
    title: 'DXF Overlay',
  },
  {
    description: 'Convert coordinates across systems and export CSV, LandXML, and snapshots.',
    group: 'Guides',
    href: '/docs/converting-and-exporting',
    slug: 'converting-and-exporting',
    title: 'Converting & Exporting',
  },
  {
    description: 'System topology, services, the geo-core, and data model.',
    group: 'Reference',
    href: '/docs/architecture',
    slug: 'architecture',
    title: 'Architecture',
  },
];

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
