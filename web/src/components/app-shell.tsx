'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Me } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { gql } from '@/lib/graphql';

/** Guards a route: redirects unauthenticated users to /login and shows a header. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gql<{ me: Me | null }>('{ me { id orgId email role emailVerified } }')
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
      await gql('mutation { logout }');
    } finally {
      router.replace('/login');
    }
  }

  if (loading || !me) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/projects" className="font-bold tracking-tight">
          SiteLens
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {me.email} · {me.role.toLowerCase()}
          </span>
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
