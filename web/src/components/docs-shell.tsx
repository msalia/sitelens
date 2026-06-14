import { IconArrowUpRight, IconCompass } from '@tabler/icons-react';
import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Public, server-rendered chrome for the documentation site. Unlike the
 *  authenticated `AppShell`, this renders its children directly into the SSR
 *  HTML and requires no login, so the docs are crawlable and indexable. */
export function DocsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-40 flex items-center justify-between border-b px-6 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <IconCompass className="size-4" />
          </div>
          <span className="tracking-tight">SiteLens</span>
          <span className="text-muted-foreground ml-1 text-sm font-normal">Docs</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className={cn(
              buttonVariants({ size: 'sm', variant: 'ghost' }),
              'hidden sm:inline-flex',
            )}
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

      <div className="flex-1">{children}</div>
    </div>
  );
}
