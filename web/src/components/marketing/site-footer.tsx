import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';

import { CONTACT_HREF } from '@/components/marketing/links';

interface FooterColumn {
  links: { external?: boolean; href: string; label: string }[];
  title: string;
}

const COLUMNS: FooterColumn[] = [
  {
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/docs', label: 'Docs' },
    ],
    title: 'Product',
  },
  {
    links: [
      { external: true, href: CONTACT_HREF, label: 'Contact' },
      { href: '/login', label: 'Log in' },
      { href: '/signup', label: 'Sign up' },
    ],
    title: 'Company',
  },
  {
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/subprocessors', label: 'Subprocessors' },
    ],
    title: 'Legal',
  },
];

/** Public marketing footer: brand + tagline, three link columns, and a
 *  divider with the copyright line. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#070b16] text-white/70">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2 font-semibold text-white">
              <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-400 to-violet-500 text-white">
                <IconCompass className="size-4.5" />
              </span>
              SiteLens
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-white/55">
              Coordinate-tie and 3D visualization for construction surveyors.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-3 text-sm">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-white/10 pt-6">
          <p className="text-xs text-white/45">© 2023–2026 KeshavTech. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
