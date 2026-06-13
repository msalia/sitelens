/** Shared link constants for the public marketing chrome (header + footer). */

export const CONTACT_HREF = 'mailto:support@msalia.org?subject=SiteLens%20enquiry';

export interface NavLink {
  href: string;
  label: string;
}

/** Top-nav sections. Features/Pricing are in-page anchors on the landing page;
 *  Docs is the (auth-gated) docs site; Contact is a `mailto:`. */
export const NAV_LINKS: NavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
  { href: CONTACT_HREF, label: 'Contact' },
];
