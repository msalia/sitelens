'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import type { TypedDocumentString } from '@/lib/gql/graphql';

import { errMsg } from '@/lib/utils';

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

/**
 * Wraps the common mutation envelope: a `busy` flag plus `run(action, opts)` that
 * toasts success/error and runs an `onDone` callback, so call sites stop repeating
 * `setBusy(true)` / try / `toast.error(err instanceof Error …)` / `finally`.
 *
 *   const { busy, run } = useMutation();
 *   run(() => gql(DOC, vars), { success: 'Saved', error: 'Save failed', onDone: reload });
 *
 * Returns the action's result on success, or `undefined` if it threw.
 */
export function useMutation() {
  const [busy, setBusy] = useState(false);

  async function run<T>(
    action: () => Promise<T>,
    opts?: { success?: string; error?: string; onDone?: (result: T) => void },
  ): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      if (opts?.success) {
        toast.success(opts.success);
      }
      opts?.onDone?.(result);
      return result;
    } catch (err) {
      toast.error(errMsg(err, opts?.error ?? 'Something went wrong'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}
