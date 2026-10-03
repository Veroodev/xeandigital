import { defaultProviderId, listProviders } from '@/lib/server/providers/index.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Daftar provider dan apakah API key-nya sudah diatur (nilai key tidak pernah dikirim).
export async function GET() {
  return Response.json({ providers: listProviders(), default: defaultProviderId() }, { headers: { 'Cache-Control': 'no-store' } });
}
