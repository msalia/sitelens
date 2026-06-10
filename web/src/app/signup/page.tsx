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
const VERIFY_EMAIL = graphql(`
  mutation VerifyEmail($t: String!) {
    verifyEmail(token: $t)
  }
`);

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
      const data = await gql(SIGNUP, { e: email, o: orgName, p: password });
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
      await gql(VERIFY_EMAIL, { t: token });
      toast.success('Email verified. Please log in.');
      router.replace('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
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
                {token
                  ? 'Verify your email to finish — email delivery isn’t wired up yet.'
                  : 'Sign up to create an organization. You become its admin.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {token ? (
                <div className="flex flex-col gap-4">
                  <div className="bg-muted text-muted-foreground rounded-md p-3 text-xs break-all">
                    Verification token: <span className="text-foreground font-mono">{token}</span>
                  </div>
                  <Button onClick={onVerify} disabled={busy} className="w-full">
                    {busy ? 'Verifying…' : 'Verify & continue'}
                  </Button>
                </div>
              ) : (
                <form onSubmit={onSignup} className="grid gap-6">
                  {/* SSO backend isn't built yet; wired entry point (placeholder route). */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push('/auth/google')}
                  >
                    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      />
                    </svg>
                    Sign up with Google
                  </Button>
                  <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                    <span className="bg-card text-muted-foreground relative z-10 px-2">
                      Or continue with
                    </span>
                  </div>
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
            By continuing, you agree to our <a href="#">Terms of Service</a> and{' '}
            <a href="#">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
