import Link from 'next/link';

import { fetchHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const health = await fetchHealth();
  const healthy = health.status === 'healthy';

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 p-24">
      <h1 className="text-4xl font-bold tracking-tight">SiteLens</h1>
      <p className="max-w-md text-center text-zinc-600 dark:text-zinc-400">
        Coordinate-tie &amp; 3D visualization for construction surveyors.
      </p>
      <div
        className={`rounded-lg border px-5 py-3 text-sm ${
          healthy
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : 'border-red-300 bg-red-50 text-red-800'
        }`}
      >
        API: <span className="font-semibold">{health.status}</span> · DB:{' '}
        <span className="font-semibold">{health.db}</span>
      </div>
      <div className="flex items-center gap-5 text-sm font-medium">
        <Link
          href="/login"
          className="text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100"
        >
          Sign up
        </Link>
      </div>
    </main>
  );
}
