'use client';

import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const ACCEPT_INVITE = graphql(`
  mutation AcceptInvite($t: String!, $p: String!) {
    acceptInvite(token: $t, password: $p) {
      id
    }
  }
`);

function AcceptInviteContent() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast.error('This invite link is missing its token.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      await gql(ACCEPT_INVITE, { p: password, t: token });
      toast.success('Welcome aboard!');
      router.replace('/projects');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not accept invite');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Accept your invite</CardTitle>
        <CardDescription>Set a password to join your organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <div className="grid gap-3">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="grid gap-3">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Joining…' : 'Join organization'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <IconCompass className="size-4" />
          </div>
          SiteLens
        </Link>
        <Suspense>
          <AcceptInviteContent />
        </Suspense>
      </div>
    </div>
  );
}
