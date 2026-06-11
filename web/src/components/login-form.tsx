'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';
import { cn } from '@/lib/utils';

const LOGIN = graphql(`
  mutation Login($e: String!, $p: String!) {
    login(email: $e, password: $p) {
      id
    }
  }
`);
const RESEND_VERIFICATION = graphql(`
  mutation ResendVerification($e: String!) {
    resendVerification(email: $e)
  }
`);

export function LoginForm({ className, ...props }: React.ComponentProps<'form'>) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Shown when login fails because the email isn't verified yet.
  const [needsVerification, setNeedsVerification] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNeedsVerification(false);
    try {
      await gql(LOGIN, { e: email, p: password });
      router.replace('/projects');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      if (/not verified/i.test(msg)) {
        setNeedsVerification(true);
      }
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    try {
      await gql(RESEND_VERIFICATION, { e: email });
      toast.success('Verification email sent — check your inbox.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend');
    }
  }

  return (
    <form onSubmit={onSubmit} className={cn('flex flex-col gap-6', className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Enter your email below to login to your account
        </p>
      </div>
      <div className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="m@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-3">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Logging in…' : 'Login'}
        </Button>
        {needsVerification ? (
          <div className="bg-muted text-muted-foreground rounded-md p-3 text-center text-sm">
            Your email isn’t verified yet.{' '}
            <button
              type="button"
              onClick={resendVerification}
              className="text-foreground underline underline-offset-4"
            >
              Resend verification email
            </button>
          </div>
        ) : null}
      </div>
      <div className="text-center text-sm">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="underline underline-offset-4">
          Sign up
        </Link>
      </div>
    </form>
  );
}
