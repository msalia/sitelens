'use client';

import type { TypedDocumentString } from '@/lib/gql/graphql';

/**
 * Type-safe GraphQL client. Pass a `graphql(...)` document from `@/lib/gql`;
 * the result and variable types are inferred from the API schema (via codegen).
 * Posts to the same-origin proxy (`/api/graphql`), which forwards the session
 * cookie. Throws on GraphQL or network errors.
 */
export async function gql<TResult, TVariables>(
  document: TypedDocumentString<TResult, TVariables>,
  ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TResult> {
  const res = await fetch('/api/graphql', {
    body: JSON.stringify({ query: document.toString(), variables }),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  let payload: { data?: TResult; errors?: Array<{ message: string }> };
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
