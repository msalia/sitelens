'use client';

import { createClient } from 'graphql-ws';

import { graphql } from '@/lib/gql';

// Defined via graphql() so codegen validates it against the schema; we send the
// raw query string over the socket.
const PROJECT_CHANGED = graphql(`
  subscription ProjectChanged($projectId: UUID!) {
    projectChanged(projectId: $projectId)
  }
`);

/** Resolves the GraphQL-over-WebSocket endpoint. Configurable via env; in local
 *  dev the web runs on :3000 and the API on :4000, and in prod the same origin
 *  serves `/graphql` (Traefik forwards the WS upgrade to the API). Called in the
 *  browser only (from `subscribeProjectChanged`). */
function endpoint(): string {
  const explicit = process.env.NEXT_PUBLIC_GRAPHQL_WS_URL;
  if (explicit) {
    return explicit;
  }
  const { host, protocol } = window.location;
  if (host === 'localhost:3000' || host === '127.0.0.1:3000') {
    return 'ws://localhost:4000/graphql';
  }
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/graphql`;
}

/**
 * Opens a `projectChanged` subscription over graphql-transport-ws (via the
 * official `graphql-ws` client, which handles reconnect + keepalive) and invokes
 * `onChange` on every push. Auth rides on the session cookie sent with the WS
 * upgrade. Returns a cleanup function that ends the subscription and closes the
 * socket. Call only in the browser.
 */
export function subscribeProjectChanged(projectId: string, onChange: () => void): () => void {
  const client = createClient({ retryAttempts: 6, url: endpoint() });
  const unsubscribe = client.subscribe(
    { query: PROJECT_CHANGED.toString(), variables: { projectId } },
    {
      complete: () => undefined,
      error: () => undefined,
      next: () => onChange(),
    },
  );
  return () => {
    unsubscribe();
    void client.dispose();
  };
}
