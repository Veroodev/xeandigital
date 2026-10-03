import { envInt, envList, envStr } from './env.js';
import { RETRYABLE_STATUSES } from './errors.js';

// Semua nilai bisa diubah lewat environment variable berawalan nama provider,
// mis. XKIRO_MAX_RETRIES, XKIRO_MODEL_CACHE_TTL_SECONDS.
export function makeConfig(prefix, { baseUrl, dialect = 'openai', defaultModel = '' }) {
  const base = envStr(`${prefix}_BASE_URL`, baseUrl).replace(/\/+$/, '');
  const root = base.replace(/\/v1$/, '');
  const statuses = envList(`${prefix}_RETRY_STATUSES`).map(Number).filter((n) => n >= 400 && n < 600);

  return {
    prefix,
    dialect,
    apiKey: envStr(`${prefix}_API_KEY`),
    base,
    chatUrl: dialect === 'anthropic' ? `${root}/v1/messages` : `${base}/chat/completions`,
    modelsUrl: dialect === 'anthropic' ? `${root}/v1/models` : `${base}/models`,
    defaultModel: envStr(`${prefix}_DEFAULT_MODEL`, defaultModel),
    modelCacheTtlMs: envInt(`${prefix}_MODEL_CACHE_TTL_SECONDS`, 300) * 1000,
    modelsTimeoutMs: envInt(`${prefix}_MODELS_TIMEOUT_MS`, 10_000),
    connectTimeoutMs: envInt(`${prefix}_CONNECT_TIMEOUT_MS`, 30_000), // sampai header respons; stream sesudahnya tidak dibatasi
    requestTimeoutMs: envInt(`${prefix}_REQUEST_TIMEOUT_MS`, 100_000), // permintaan non-stream (xKiro memotong di 95 detik)
    retry: {
      max: envInt(`${prefix}_MAX_RETRIES`, 3),
      baseMs: envInt(`${prefix}_RETRY_BASE_MS`, 500),
      maxDelayMs: envInt(`${prefix}_RETRY_MAX_DELAY_MS`, 8000),
      statuses: statuses.length ? statuses : RETRYABLE_STATUSES,
    },
    fallbackModels: envList(`${prefix}_FALLBACK_MODELS`),
  };
}
