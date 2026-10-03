import { validateChatBody } from '@/lib/server/chat-request.js';
import { toPublicError } from '@/lib/server/errors.js';
import { logRequest } from '@/lib/server/log.js';
import { checkModelRules } from '@/lib/server/model-rules.js';
import { defaultProviderId, getProvider } from '@/lib/server/providers/index.js';
import { findModel } from '@/lib/server/registry.js';
import { errorFromThrown, errorResponse } from '@/lib/server/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // turunkan ke batas plan hosting Anda bila deploy menolak nilai ini

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
const HEARTBEAT_MS = 15_000;

export async function POST(req) {
  const t0 = Date.now();

  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json', 'Body permintaan harus berupa JSON.');
  }

  const parsed = validateChatBody(body);
  if (!parsed.ok) return errorResponse(400, parsed.code, parsed.message);

  const provider = getProvider(parsed.providerId || defaultProviderId());
  if (!provider) return errorResponse(400, 'unknown_provider', 'Provider tidak dikenal.');
  if (!provider.isConfigured()) {
    return errorResponse(503, 'not_configured', `API key ${provider.label} belum diatur di server (${provider.keyEnvName}).`);
  }

  // Validasi terhadap katalog (dari cache). Bila katalog tak terjangkau, keputusan diserahkan ke provider.
  const { model: meta, known } = await findModel(provider, parsed.model);
  if (known && !meta) {
    return errorResponse(404, 'model_not_found', `Model "${parsed.model}" tidak ada di katalog ${provider.label}. Sinkronkan daftar model lalu pilih ulang.`);
  }
  const rules = checkModelRules(meta, { messages: parsed.messages, options: parsed.options });
  if (!rules.ok) return errorResponse(rules.status, rules.code, rules.message);

  const args = { model: parsed.model, messages: parsed.messages, options: rules.options };
  const baseLog = { provider: provider.id, model: parsed.model };

  // ---- Non-stream ----
  if (!parsed.stream) {
    try {
      const out = await provider.sendMessage({ ...args, signal: req.signal });
      logRequest({ ...baseLog, status: 200, durationMs: Date.now() - t0, usage: out.usage, outcome: 'ok' }, provider.secrets);
      return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      const pub = toPublicError(err, { label: provider.label, secrets: provider.secrets });
      logRequest({ ...baseLog, status: pub.status, durationMs: Date.now() - t0, outcome: 'error', code: pub.code }, provider.secrets);
      return errorFromThrown(err, provider);
    }
  }

  // ---- Stream ----
  const upstreamCtl = new AbortController();
  const onAbort = () => upstreamCtl.abort();
  req.signal.addEventListener('abort', onAbort, { once: true });

  const iterator = provider.streamMessage({ ...args, signal: upstreamCtl.signal })[Symbol.asyncIterator]();

  // Ambil event pertama sebelum membalas, agar kegagalan koneksi (401/429/5xx) menjadi status HTTP yang benar.
  let first;
  try {
    first = await iterator.next();
  } catch (err) {
    req.signal.removeEventListener('abort', onAbort);
    const pub = toPublicError(err, { label: provider.label, secrets: provider.secrets });
    logRequest({ ...baseLog, status: pub.status, durationMs: Date.now() - t0, outcome: 'error', code: pub.code }, provider.secrets);
    return errorFromThrown(err, provider);
  }

  const encoder = new TextEncoder();
  let heartbeat = null;
  let usage = null;
  let outcome = 'ok';
  let code;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* klien sudah terputus */
        }
      };
      // Komentar SSE agar proxy tidak memutus koneksi saat model lama berpikir.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);

      send({ type: 'start', provider: provider.id, model: parsed.model, reasoningEffort: rules.options.reasoningEffort ?? null, dropped: rules.dropped });

      try {
        let step = first;
        while (!step.done) {
          const u = step.value.type === 'usage' ? step.value : step.value.type === 'done' ? step.value.usage : null;
          if (u) usage = u;
          send(step.value);
          step = await iterator.next();
        }
      } catch (err) {
        if (upstreamCtl.signal.aborted) {
          outcome = 'aborted';
        } else {
          const pub = toPublicError(err, { label: provider.label, secrets: provider.secrets });
          outcome = 'error';
          code = pub.code;
          send({ type: 'error', ...pub });
        }
      } finally {
        clearInterval(heartbeat);
        req.signal.removeEventListener('abort', onAbort);
        try {
          await iterator.return?.();
        } catch {
          /* ignore */
        }
        logRequest({ ...baseLog, status: 200, durationMs: Date.now() - t0, usage, outcome, code }, provider.secrets);
        try {
          controller.close();
        } catch {
          /* sudah ditutup */
        }
      }
    },
    cancel() {
      // Klien menekan Berhenti / menutup tab: hentikan panggilan upstream agar tidak ditagih lebih lama.
      clearInterval(heartbeat);
      upstreamCtl.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
