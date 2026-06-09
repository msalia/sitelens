import { apiBaseUrl } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Proxies GraphQL requests to the private Rust API. The API is not exposed
 * publicly — only the web tier reaches it (over the compose network). This keeps
 * the session cookie same-origin: we forward the incoming Cookie header to the
 * API and relay any Set-Cookie headers from the API back to the browser.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const cookie = req.headers.get('cookie') ?? '';

  const upstream = await fetch(`${apiBaseUrl()}/graphql`, {
    body,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', cookie },
    method: 'POST',
  });

  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const value of upstream.headers.getSetCookie()) {
    headers.append('set-cookie', value);
  }

  return new Response(await upstream.text(), { headers, status: upstream.status });
}
