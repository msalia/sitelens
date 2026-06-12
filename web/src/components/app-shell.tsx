'use client';

import {
  IconBook2,
  IconChevronDown,
  IconCompass,
  IconCreditCard,
  IconFileText,
  IconLayoutGrid,
  IconLogout,
  IconSearch,
  IconSettings,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { Me } from '@/lib/types';

import { UpgradeGate } from '@/components/billing/upgrade-gate';
import { ThemeToggle } from '@/components/theme-toggle';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBilling } from '@/lib/billing';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { cn } from '@/lib/utils';

const ME = graphql(`
  query Me {
    me {
      id
      orgId
      email
      role
      emailVerified
    }
  }
`);
const LOGOUT = graphql(`
  mutation Logout {
    logout
  }
`);

const NAV = [
  { href: '/projects', icon: IconLayoutGrid, label: 'Projects' },
  { href: '/docs', icon: IconBook2, label: 'Docs' },
  { href: '/terms', icon: IconFileText, label: 'Terms of Service' },
  { href: '/privacy', icon: IconShieldLock, label: 'Privacy Policy' },
] as const;

/** Guards a route: redirects unauthenticated users to /login, then renders the
 *  command-center chrome — a top bar (brand, search, theme, user menu) over a
 *  left icon rail + the page content. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const { billing } = useBilling();

  useEffect(() => {
    gql(ME)
      .then(({ me }) => {
        if (!me) {
          router.replace('/login');
          return;
        }
        setMe(me);
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  async function logout() {
    try {
      await gql(LOGOUT);
    } finally {
      router.replace('/login');
    }
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/projects?q=${encodeURIComponent(q)}` : '/projects');
  }

  if (loading || !me) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-svh flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b px-4 py-2.5">
        <Link href="/projects" className="flex w-52 shrink-0 items-center gap-2 font-semibold">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <IconCompass className="size-4" />
          </div>
          <span className="tracking-tight">SiteLens</span>
        </Link>

        <form onSubmit={onSearch} className="relative mx-auto w-full max-w-xl">
          <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="bg-muted/50 rounded-full pl-9"
            aria-label="Search projects"
          />
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <UserMenu me={me} onLogout={logout} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left icon rail */}
        <nav className="bg-muted/30 flex w-16 shrink-0 flex-col items-center gap-1 border-r py-3">
          {NAV.map((item) => (
            <RailLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            {me.role === 'ADMIN' ? (
              <RailLink
                href="/settings/users"
                icon={IconUsers}
                label="Users"
                active={pathname.startsWith('/settings/users')}
              />
            ) : null}
            <RailLink
              href="/settings/billing"
              icon={IconCreditCard}
              label="Billing"
              active={pathname.startsWith('/settings/billing')}
            />
            <RailLink
              href="/settings"
              icon={IconSettings}
              label="Settings"
              active={pathname === '/settings'}
            />
            <RailButton icon={IconLogout} label="Log out" onClick={logout} />
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto">
          {/* Lapsed-subscription lock: full-screen read-only gate everywhere except
              the billing page itself, so admins can still resubscribe. */}
          {billing?.restricted && !pathname.startsWith('/settings/billing') ? (
            <UpgradeGate billing={billing} isAdmin={me.role === 'ADMIN'} />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

const railClass = (active = false) =>
  cn(
    'flex size-11 items-center justify-center rounded-xl transition-colors',
    active
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

function RailLink({
  active,
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof IconLayoutGrid;
  label: string;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link href={href} aria-label={label} className={railClass(active)}>
            <Icon className="size-5" />
          </Link>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof IconLayoutGrid;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" aria-label={label} onClick={onClick} className={railClass()}>
            <Icon className="size-5" />
          </button>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = me.email.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors"
      >
        <span className="bg-primary/15 text-primary flex size-8 items-center justify-center rounded-full text-xs font-semibold">
          {initials}
        </span>
        <span className="hidden text-left text-sm leading-tight sm:block">
          <span className="block max-w-40 truncate font-medium">{me.email}</span>
          <span className="text-muted-foreground block text-xs capitalize">
            {me.role.toLowerCase()}
          </span>
        </span>
        <IconChevronDown className="text-muted-foreground size-4" />
      </button>

      {open && (
        <div className="bg-popover absolute right-0 z-50 mt-2 w-56 rounded-xl border p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{me.email}</p>
            <p className="text-muted-foreground text-xs capitalize">{me.role.toLowerCase()}</p>
          </div>
          <div className="bg-border my-1 h-px" />
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <IconSettings className="size-4" /> Settings
          </Link>
          <Link
            href="/settings/billing"
            onClick={() => setOpen(false)}
            className="hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <IconCreditCard className="size-4" /> Billing
          </Link>
          <Link
            href="/terms"
            onClick={() => setOpen(false)}
            className="hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <IconFileText className="size-4" /> Terms of Service
          </Link>
          <Link
            href="/privacy"
            onClick={() => setOpen(false)}
            className="hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <IconShieldLock className="size-4" /> Privacy Policy
          </Link>
          <div className="bg-border my-1 h-px" />
          <button
            type="button"
            onClick={onLogout}
            className="hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
          >
            <IconLogout className="size-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
