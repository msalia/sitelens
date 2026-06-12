import { apiBaseUrl } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Proxies Stripe webhooks to the private Rust API, which isn't exposed publicly
 * (only the web tier reaches it over the compose network) — so prod needs no
 * Traefik/Dokploy route change, same as `/api/graphql`.
 *
 * The API verifies the Stripe signature over the *raw* request body, so we
 * forward the exact bytes (`req.text()`) and the `Stripe-Signature` header
 * untouched. Anything that re-serialized the JSON would break verification.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  const upstream = await fetch(`${apiBaseUrl()}/stripe/webhook`, {
    body,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    method: 'POST',
  });

  return new Response(await upstream.text(), { status: upstream.status });
}
