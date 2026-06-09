'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { DocGroup, DocNavItem } from '@/lib/docs';

import { cn } from '@/lib/utils';

const GROUPS: DocGroup[] = ['Guides', 'Reference'];

interface DocsNavProps {
  items: DocNavItem[];
}

export function DocsNav({ items }: DocsNavProps) {
  const pathname = usePathname();

  return (
    <nav className="bg-background/60 sticky top-0 h-[100dvh] w-64 shrink-0 overflow-y-auto border-r px-4 py-6">
      <Link href="/" className="mb-6 block px-2 text-lg font-bold tracking-tight">
        SiteLens
      </Link>
      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) {
          return null;
        }
        return (
          <div key={group} className="mb-6">
            <p className="text-muted-foreground mb-2 px-2 text-xs font-semibold tracking-wide uppercase">
              {group}
            </p>
            <ul className="space-y-px">
              {groupItems.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={item.href}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-[13px] transition-colors',
                      pathname === item.href
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
