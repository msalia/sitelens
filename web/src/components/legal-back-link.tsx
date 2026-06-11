'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { graphql } from '@/lib/gql';
import { gql } from '@/lib/graphql';

const LEGAL_ME = graphql(`
  query LegalMe {
    me {
      id
    }
  }
`);

/** A back link on the public legal pages that adapts to auth state: logged-in
 *  users go back to the app, signed-out visitors go to login. */
export function LegalBackLink({ className }: { className?: string }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    gql(LEGAL_ME)
      .then(({ me }) => setAuthed(Boolean(me)))
      .catch(() => setAuthed(false));
  }, []);

  const href = authed === null ? '/' : authed ? '/projects' : '/login';
  const label = authed === null ? 'Back' : authed ? 'Back to app' : 'Back to login';

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
