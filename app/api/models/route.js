import { defaultProviderId, getProvider } from '@/lib/server/providers/index.js';
import { getModels } from '@/lib/server/registry.js';
import { errorFromThrown, errorResponse } from '@/lib/server/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models?provider=xkiro[&refresh=1]
// Sumber utama: GET {base}/models milik provider, di-cache di server (TTL dari env).
// refresh=1 = "Sync Models" (tetap dibatasi interval minimal agar tidak membanjiri provider).
export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const provider = getProvider(params.get('provider') || defaultProviderId());
  if (!provider) return errorResponse(400, 'unknown_provider', 'Provider tidak dikenal.');

  const force = params.get('refresh') === '1';
  try {
    const out = await getModels(provider, { force });
    const cacheable = !force && (out.source === 'live' || out.source === 'cache');
    return Response.json(
      {
        provider: provider.id,
        label: provider.label,
        ...out,
        count: out.models.length,
        defaultModel: provider.config.defaultModel || null,
        configured: provider.isConfigured(),
      },
      {
        headers: {
          'Cache-Control': cacheable
            ? `public, max-age=30, s-maxage=${out.ttlSeconds}, stale-while-revalidate=${out.ttlSeconds * 2}`
            : 'no-store',
        },
      }
    );
  } catch (err) {
    return errorFromThrown(err, provider);
  }
}
