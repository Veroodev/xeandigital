import { ProviderError, RETRYABLE_STATUSES, abortError, errorFromResponse, networkError } from './errors.js';

const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true }
    );
  });

function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const ctl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

// Galat jaringan yang pasti terjadi SEBELUM permintaan sampai ke server (aman di-retry untuk POST).
const CONNECT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
export const isConnectFailure = (err) => CONNECT_CODES.has(err?.cause?.code || err?.code);

export function backoffMs(attempt, { baseMs, maxDelayMs, retryAfterMs = null, random = Math.random }) {
  const exp = baseMs * 2 ** attempt; // 500, 1000, 2000, ...
  const wait = retryAfterMs != null ? Math.max(retryAfterMs, exp) : exp;
  return Math.min(maxDelayMs, wait) + Math.floor(random() * 250); // jitter agar klien tidak retry serentak
}

/**
 * fetch dengan retry terukur.
 * - Hanya status retryable (default 429/500/502/503/504/529) yang diulang, dengan exponential backoff + jitter.
 * - Menghormati Retry-After; bila lebih lama dari maxDelayMs, error langsung dilempar.
 * - POST (idempotent=false) hanya diulang bila gagal sebelum sampai ke server atau server menjawab status retryable,
 *   supaya tidak terjadi tagihan ganda. GET (idempotent=true) juga diulang saat timeout/galat jaringan.
 * - timeoutMs berlaku sampai header respons diterima; pembacaan stream sesudahnya tidak dibatasi.
 */
export async function fetchWithRetry(url, init, opts = {}) {
  const {
    label = 'Provider',
    secrets = [],
    signal,
    idempotent = false,
    timeoutMs = 0,
    retry = {},
    fetchImpl = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = opts;

  const max = retry.max ?? 0;
  const baseMs = retry.baseMs ?? 500;
  const maxDelayMs = retry.maxDelayMs ?? 8000;
  const statuses = retry.statuses ?? RETRYABLE_STATUSES;

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError();

    const timeoutCtl = new AbortController();
    const timer = timeoutMs ? setTimeout(() => timeoutCtl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: anySignal([signal, timeoutCtl.signal]) });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (signal?.aborted) throw abortError();
      const timedOut = timeoutCtl.signal.aborted;
      const canRetry = attempt < max && (idempotent || (!timedOut && isConnectFailure(err)));
      if (!canRetry) throw networkError({ label, timedOut, cause: err });
      await sleep(backoffMs(attempt, { baseMs, maxDelayMs, random }), signal);
      continue;
    }
    if (timer) clearTimeout(timer);

    if (res.ok) return res;

    const err = await errorFromResponse(res, { label, secrets, retryStatuses: statuses });
    const delayOk = err.retryAfterMs == null || err.retryAfterMs <= maxDelayMs;
    if (!err.retryable || attempt >= max || !delayOk) throw err;
    await sleep(backoffMs(attempt, { baseMs, maxDelayMs, retryAfterMs: err.retryAfterMs, random }), signal);
  }
}

export { ProviderError };
