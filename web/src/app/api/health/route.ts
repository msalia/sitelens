import { fetchHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await fetchHealth();
  const ok = health.status === 'healthy';
  return Response.json({ api: health, web: 'ok' }, { status: ok ? 200 : 503 });
}
