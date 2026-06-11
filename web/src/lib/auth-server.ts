// Server-only: importing `next/headers` makes this module unusable in client
// components (it errors if bundled), so it never reaches the browser.
import { cookies } from 'next/headers';

import { apiBaseUrl } from '@/lib/api';

/**
 * Server-side check: does the incoming request carry a valid session?
 * Forwards the session cookie to the API and asks for `me`. Used by the auth
 * pages to redirect already-signed-in users before any form renders.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) {
      return false;
    }
    const res = await fetch(`${apiBaseUrl()}/graphql`, {
      body: JSON.stringify({ query: '{ me { id } }' }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
      method: 'POST',
    });
    if (!res.ok) {
      return false;
    }
    const json = (await res.json()) as { data?: { me?: { id: string } | null } };
    return Boolean(json.data?.me);
  } catch {
    return false;
  }
}
