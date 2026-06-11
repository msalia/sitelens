'use client';

import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const SIGNUP = graphql(`
  mutation Signup($e: String!, $p: String!, $o: String!) {
    signup(email: $e, password: $p, orgName: $o) {
      verificationToken
    }
  }
`);

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  // After signup we show a "check your email" screen; the verification link is
  // emailed (see /verify), not surfaced in-app.
  const [done, setDone] = useState(false);

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gql(SIGNUP, { e: email, o: orgName, p: password });
      setDone(true);
      toast.success('Account created — check your email to verify.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <IconCompass className="size-4" />
          </div>
          SiteLens
        </Link>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Create your organization</CardTitle>
              <CardDescription>
                {done
                  ? 'Check your email to verify your account.'
                  : 'Sign up to create an organization. You become its admin.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {done ? (
                <div className="flex flex-col gap-4">
                  <div className="bg-muted text-muted-foreground rounded-md p-3 text-sm">
                    We sent a verification link to{' '}
                    <span className="text-foreground font-medium break-all">{email}</span>. Click it
                    to finish setting up your account, then log in.
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => router.replace('/login')}
                    className="w-full"
                  >
                    Go to login
                  </Button>
                </div>
              ) : (
                <form onSubmit={onSignup} className="grid gap-6">
                  <div className="grid gap-3">
                    <Label htmlFor="org">Organization name</Label>
                    <Input
                      id="org"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      required
                    />
                  </div>
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
                  <Button type="submit" disabled={busy} className="w-full">
                    {busy ? 'Creating…' : 'Create account'}
                  </Button>
                  <div className="text-center text-sm">
                    Already have an account?{' '}
                    <Link href="/login" className="underline underline-offset-4">
                      Log in
                    </Link>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
          <p className="text-muted-foreground *:[a]:hover:text-primary text-center text-xs text-balance *:[a]:underline *:[a]:underline-offset-4">
            By continuing, you agree to our <Link href="/terms">Terms of Service</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
