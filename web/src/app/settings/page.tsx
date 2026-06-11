'use client';

import { IconAlertTriangle, IconChevronRight, IconUsers } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { Me } from '@/lib/types';

import { ThemeToggle } from '@/components/theme-toggle';
import { TypeToConfirmDialog } from '@/components/type-to-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const SETTINGS_DATA = graphql(`
  query SettingsData {
    me {
      id
      orgId
      email
      role
      emailVerified
    }
    organization {
      id
      name
    }
  }
`);
const DELETE_ORGANIZATION = graphql(`
  mutation DeleteOrganization {
    deleteOrganization
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
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    gql(SETTINGS_DATA)
      .then(({ me, organization }) => {
        setMe(me);
        setOrgName(organization?.name ?? null);
      })
      .catch(() => undefined);
  }, []);

  async function deleteOrganization() {
    try {
      await gql(DELETE_ORGANIZATION);
      toast.success('Organization deleted.');
      router.replace('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete organization');
    }
  }

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
            <Row label="Name" value={orgName ?? '—'} />
            <Row
              label="Organization ID"
              value={<span className="font-mono text-xs">{me?.orgId ?? '—'}</span>}
            />
          </CardContent>
        </Card>

        {me?.role === 'ADMIN' ? (
          <Link href="/settings/users" className="block">
            <Card className="hover:ring-primary/40 transition-shadow">
              <CardContent className="flex items-center gap-4">
                <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                  <IconUsers className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Users</p>
                  <p className="text-muted-foreground text-sm">
                    Invite teammates and manage their roles.
                  </p>
                </div>
                <IconChevronRight className="text-muted-foreground size-5" />
              </CardContent>
            </Card>
          </Link>
        ) : null}

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

        {me?.role === 'ADMIN' ? (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <IconAlertTriangle className="size-5" /> Danger zone
              </CardTitle>
              <CardDescription>
                Deleting your organization is permanent and closes the account for everyone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-sm">
                This removes <strong>every project</strong> and all its data and uploaded files, and{' '}
                <strong>every user account</strong> in this organization — including yours. It
                cannot be undone.
              </p>
              <TypeToConfirmDialog
                title="Delete this organization?"
                description={
                  <>
                    This <strong>permanently</strong> deletes the entire organization:{' '}
                    <strong>all projects</strong>, their data and uploaded files, and{' '}
                    <strong>every user account</strong> (including yours). Everyone will be signed
                    out and no one will be able to log in. This action is{' '}
                    <strong>irreversible</strong> and leaves no trace.
                  </>
                }
                confirmPhrase={orgName ?? ''}
                confirmLabel="Delete organization"
                onConfirm={deleteOrganization}
                trigger={
                  <Button variant="destructive" disabled={!orgName} className="shrink-0">
                    Delete organization
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
