'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { gql } from '@/lib/graphql';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  // No email provider yet: the verification token is surfaced so you can verify here.
  const [token, setToken] = useState<string | null>(null);

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await gql<{ signup: { verificationToken: string } }>(
        `mutation ($e: String!, $p: String!, $o: String!) {
          signup(email: $e, password: $p, orgName: $o) { verificationToken }
        }`,
        { e: email, o: orgName, p: password },
      );
      setToken(data.signup.verificationToken);
      toast.success('Account created. Verify to continue.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (!token) {
      return;
    }
    setBusy(true);
    try {
      await gql('mutation ($t: String!) { verifyEmail(token: $t) }', { t: token });
      toast.success('Email verified. Please log in.');
      router.replace('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create your SiteLens org</CardTitle>
          <CardDescription>
            {token
              ? 'Verify your email to finish (email delivery is not wired up yet).'
              : 'Sign up to create an organization — you become its admin.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <div className="flex flex-col gap-4">
              <div className="bg-muted text-muted-foreground rounded-md p-3 text-xs break-all">
                Verification token: <span className="text-foreground font-mono">{token}</span>
              </div>
              <Button onClick={onVerify} disabled={busy}>
                {busy ? 'Verifying…' : 'Verify & continue'}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSignup} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="org">Organization name</Label>
                <Input
                  id="org"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
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
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create account'}
              </Button>
            </form>
          )}
          <p className="text-muted-foreground mt-4 text-sm">
            Already have an account?{' '}
            <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
