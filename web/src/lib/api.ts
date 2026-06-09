/**
 * Resolves the base URL of the Rust GraphQL API.
 *
 * In the Docker Compose network the API is reachable at `http://api:4000`.
 * For local hybrid dev (web running natively) it defaults to localhost.
 */
export function apiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
}

export interface HealthStatus {
  db: string;
  status: string;
}

/** Fetches the API health endpoint. Never throws — returns an unhealthy status on failure. */
export async function fetchHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch(`${apiBaseUrl()}/health`, { cache: 'no-store' });
    if (!res.ok) {
      return { db: 'unknown', status: 'unhealthy' };
    }
    return (await res.json()) as HealthStatus;
  } catch {
    return { db: 'unreachable', status: 'unhealthy' };
  }
}
