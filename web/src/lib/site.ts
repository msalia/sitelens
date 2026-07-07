/** Single source of truth for site-wide SEO/branding constants and URL helpers.
 *  Imported by the metadata in `layout.tsx`, the `robots`/`sitemap`/`manifest`
 *  route handlers, the OG image, and JSON-LD structured data so the canonical
 *  origin and copy stay consistent everywhere. */

// Configurable branding. These are `NEXT_PUBLIC_*` so a single value is inlined
// at build time into both server and client bundles — set them once (compose
// build args / env) and every surface stays in sync. Defaults keep dev + the
// reference deployment working with no configuration.

/** Canonical production origin — no trailing slash. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sitelens.msalia.org';

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'SiteLens';

/** Short value proposition used in titles and OG. */
export const SITE_TAGLINE = 'Coordinate-tie & 3D visualization for surveyors';

/** Default meta description — kept under ~160 chars for clean SERP rendering. */
export const SITE_DESCRIPTION =
  'SiteLens ties an architect grid to ground truth with a least-squares Helmert transform, then renders control, points, and CAD in a live 3D scene — built for construction surveyors.';

/** The legal entity behind the product (used for Organization JSON-LD + author). */
export const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME || 'KeshavTech LLC';

/** Support contact, mirrored from the marketing chrome. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@msalia.org';

/** Topical keywords for the surveying/geomatics niche. */
export const SITE_KEYWORDS = [
  'construction surveying',
  'coordinate transformation',
  'Helmert transform',
  'grid to ground',
  'survey control points',
  'coordinate conversion',
  'EPSG',
  'state plane coordinates',
  'LandXML',
  'DXF overlay',
  '3D survey visualization',
  'geomatics software',
];

/** Default `<title>` for the home page / root default. */
export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

/**
 * Resolve a site-relative path (or absolute URL) to a canonical absolute URL.
 * - The root path collapses to the bare origin (no trailing slash).
 * - Already-absolute `http(s)` URLs are returned untouched.
 */
export function absoluteUrl(path = '/'): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/$/, '') : withSlash;
  return trimmed === '/' ? SITE_URL : `${SITE_URL}${trimmed}`;
}
