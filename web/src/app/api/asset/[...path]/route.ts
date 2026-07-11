import { apiBaseUrl } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Proxies binary render-asset requests to the private Rust API's `/asset/*`
 * routes, keeping the session cookie same-origin (like the GraphQL proxy). The
 * API is not exposed publicly — only the web tier reaches it over the compose
 * network — so the browser talks to this route and we forward the `Cookie`.
 *
 * We forward `If-None-Match` and relay `ETag` + `Cache-Control` so the browser's
 * HTTP cache can revalidate against the stable asset URL: a repeat load sends
 * the ETag, the API answers `304`, and we relay it with no body.
 *
 * Note: server-side `fetch` transparently decompresses the API's gzip/brotli
 * response, so we hand the browser decoded bytes and let Next re-compress the
 * public hop.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const suffix = path.map(encodeURIComponent).join('/');
  const { search } = new URL(req.url);

  const headers: Record<string, string> = {};
  const cookie = req.headers.get('cookie');
  if (cookie) {
    headers.cookie = cookie;
  }
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch) {
    headers['if-none-match'] = ifNoneMatch;
  }

  const upstream = await fetch(`${apiBaseUrl()}/asset/${suffix}${search}`, {
    cache: 'no-store',
    headers,
  });

  const out = new Headers();
  for (const h of ['etag', 'content-type', 'content-disposition', 'cache-control']) {
    const value = upstream.headers.get(h);
    if (value) {
      out.set(h, value);
    }
  }

  // 304 / 204 must not carry a body.
  if (upstream.status === 304 || upstream.status === 204) {
    return new Response(null, { headers: out, status: upstream.status });
  }
  return new Response(await upstream.arrayBuffer(), { headers: out, status: upstream.status });
}
