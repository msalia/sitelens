'use client';

/**
 * Minimal GraphQL client for the browser. Posts to the same-origin proxy
 * (`/api/graphql`), which forwards to the private API and relays the session
 * cookie. Throws on GraphQL or network errors.
 */
export async function gql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/api/graphql', {
    body: JSON.stringify({ query, variables }),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  let payload: { data?: T; errors?: Array<{ message: string }> };
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message);
  }
  if (payload.data === undefined || payload.data === null) {
    throw new Error('Empty response from API');
  }
  return payload.data;
}
