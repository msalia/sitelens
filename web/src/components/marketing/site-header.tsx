'use client';

import { IconCompass, IconMenu2, IconX } from '@tabler/icons-react';
import Link from 'next/link';
import { useState } from 'react';

import { CONTACT_HREF, NAV_LINKS } from '@/components/marketing/links';
import { cn } from '@/lib/utils';

/** Public marketing header: compass wordmark, centered section links, and the
 *  auth CTAs. Collapses to a slide-down menu on small screens. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070b16]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-400 to-violet-500 text-white">
            <IconCompass className="size-4.5" />
          </span>
          SiteLens
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-white/70 md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-400"
          >
            Sign up
          </Link>
        </div>

        <button
          type="button"
          className="text-white/80 transition-colors hover:text-white md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconX className="size-6" /> : <IconMenu2 className="size-6" />}
        </button>
      </div>

      {/* Mobile menu. */}
      <div
        className={cn(
          'overflow-hidden border-t border-white/10 transition-[max-height] duration-300 md:hidden',
          open ? 'max-h-96' : 'max-h-0 border-t-transparent',
        )}
      >
        <nav className="flex flex-col gap-1 px-6 py-4 text-sm font-medium text-white/80">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-2 transition-colors hover:bg-white/10 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-center text-white/90 transition-colors hover:bg-white/10"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg bg-violet-500 px-3 py-2 text-center text-white transition-colors hover:bg-violet-400"
            >
              Sign up
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

export { CONTACT_HREF };
