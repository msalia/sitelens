'use client';

import { useEffect, useState } from 'react';

import type { Me } from '@/lib/types';

import { ThemeToggle } from '@/components/theme-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const ME = graphql(`
  query SettingsMe {
    me {
      id
      orgId
      email
      role
      emailVerified
    }
  }
`);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    gql(ME)
      .then(({ me }) => setMe(me))
      .catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Your account, organization, and appearance.</p>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Who you are signed in as.</CardDescription>
          </CardHeader>
          <CardContent className="divide-border divide-y">
            <Row label="Email" value={me?.email ?? '—'} />
            <Row
              label="Role"
              value={<span className="capitalize">{me?.role.toLowerCase() ?? '—'}</span>}
            />
            <Row label="Email verified" value={me ? (me.emailVerified ? 'Yes' : 'No') : '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>The tenant your data belongs to.</CardDescription>
          </CardHeader>
          <CardContent className="divide-border divide-y">
            <Row
              label="Organization ID"
              value={<span className="font-mono text-xs">{me?.orgId ?? '—'}</span>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Switch between light and dark.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-sm">Theme</span>
            <ThemeToggle />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
