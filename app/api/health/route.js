import { defaultProviderId, getProvider } from '@/lib/server/providers/index.js';
import { getHealth } from '@/lib/server/registry.js';
import { errorResponse } from '@/lib/server/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/health?provider=xkiro  -> { online, latencyMs, status, keyConfigured, checkedAt }
// Hasil di-cache 30 detik di server supaya endpoint provider tidak dipanggil berlebihan.
export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const provider = getProvider(params.get('provider') || defaultProviderId());
  if (!provider) return errorResponse(400, 'unknown_provider', 'Provider tidak dikenal.');

  const health = await getHealth(provider, { force: params.get('refresh') === '1' });
  return Response.json({ provider: provider.id, label: provider.label, ...health }, { headers: { 'Cache-Control': 'no-store' } });
}
