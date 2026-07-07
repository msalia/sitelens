import { IconArrowUpRight, IconCompass } from '@tabler/icons-react';
import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { SITE_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';

/** Shared public (no-auth) top bar for the crawlable surfaces — the docs site
 *  and the legal pages — so their chrome stays identical. `label` is the small
 *  section tag next to the wordmark ("Docs", "Legal"). */
export function PublicHeader({ label }: { label?: string }) {
  return (
    <header className="bg-background/80 sticky top-0 z-40 flex items-center justify-between border-b px-6 py-3 backdrop-blur">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
          <IconCompass className="size-4" />
        </div>
        <span className="tracking-tight">{SITE_NAME}</span>
        {label ? (
          <span className="text-muted-foreground ml-1 text-sm font-normal">{label}</span>
        ) : null}
      </Link>

      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'hidden sm:inline-flex')}
        >
          Log in
        </Link>
        <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }))}>
          Open the app
          <IconArrowUpRight className="ml-1 size-4" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
