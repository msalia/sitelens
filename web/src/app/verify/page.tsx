'use client';

import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const VERIFY_EMAIL = graphql(`
  mutation VerifyEmail($t: String!) {
    verifyEmail(token: $t)
  }
`);

type Status = 'pending' | 'ok' | 'error';

function VerifyContent() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  // Derive the initial state from the token so the missing-token case needs no
  // effect; the effect below only runs the (async) verification network call.
  const [status, setStatus] = useState<Status>(token ? 'pending' : 'error');
  const [message, setMessage] = useState(
    token ? 'Verifying your email…' : 'This verification link is missing its token.',
  );
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) {
      return;
    }
    ran.current = true;
    gql(VERIFY_EMAIL, { t: token })
      .then(() => {
        setStatus('ok');
        setMessage('Your email is verified — you can log in now.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed.');
      });
  }, [token]);

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          {status === 'ok'
            ? 'Email verified'
            : status === 'error'
              ? 'Verification failed'
              : 'Verifying…'}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === 'ok' ? (
          <Button className="w-full" onClick={() => router.replace('/login')}>
            Continue to login
          </Button>
        ) : status === 'error' ? (
          <Button variant="outline" className="w-full" onClick={() => router.replace('/login')}>
            Back to login
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function VerifyPage() {
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
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  );
}
