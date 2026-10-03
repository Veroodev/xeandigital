// Status yang layak di-retry menurut dokumentasi xKiro (+504/529 untuk gateway/overload).
// 400/401/403/404 tidak pernah di-retry. 402 butuh saldo, jadi tidak di-retry juga.
export const RETRYABLE_STATUSES = [429, 500, 502, 503, 504, 529];

export class ProviderError extends Error {
  constructor({ status = 502, code = 'provider_error', message, retryable = false, retryAfterMs = null, cause }) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}

export function abortError() {
  return Object.assign(new Error('Dibatalkan'), { name: 'AbortError' });
}

// Menyembunyikan secret dari teks yang akan ditampilkan atau dicatat.
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[disembunyikan]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [disembunyikan]');
  out = out.replace(/\b(?:apx|sk|xk|xkr)[-_][A-Za-z0-9][A-Za-z0-9_-]{8,}/gi, '[disembunyikan]');
  return out;
}

// Pesan untuk pengguna (Indonesia). Pesan asli dari provider hanya ditambahkan untuk 400/422,
// karena di sana isinya berguna (mis. jendela konteks terlampaui).
export function describeError({ label, status, code, upstream }) {
  const detail = upstream ? ` (${upstream})` : '';
  if (code === 'insufficient_quota' || status === 402) return `Saldo ${label} tidak cukup. Isi saldo lalu coba lagi.`;
  if (status === 401) return `API key ${label} tidak valid atau sudah dicabut. Periksa konfigurasi di server.`;
  if (status === 403) return 'Akun Anda belum berhak memakai model ini. Model premium biasanya butuh deposit.';
  if (status === 404) return `Model tidak tersedia di ${label}. Pastikan memakai ID lengkap vendor/model.`;
  if (status === 408 || status === 504) return `${label} terlalu lama merespons. Coba lagi atau pilih model lain.`;
  if (status === 429) return 'Rate limit tercapai. Tunggu sebentar lalu coba lagi.';
  if (status === 400 || status === 422) return `Permintaan ditolak oleh ${label}${detail}.`;
  if (status >= 500) return `${label} sedang tidak tersedia. Coba lagi sebentar lagi.`;
  return `Terjadi kesalahan dari ${label} (${status}).`;
}

const CODE_TO_STATUS = {
  rate_limit_exceeded: 429, rate_limit_error: 429,
  authentication_error: 401, permission_denied: 403, permission_error: 403,
  not_found: 404, not_found_error: 404, insufficient_quota: 402, billing_error: 402,
  invalid_request: 400, invalid_request_error: 400, timeout: 408, timeout_error: 408,
  overloaded: 529, overloaded_error: 529, service_unavailable: 503,
  bad_gateway: 502, internal_error: 500, api_error: 502, upstream_error: 502, server_error: 502,
};

export function statusFromCode(code, fallback = 502) {
  return CODE_TO_STATUS[code] ?? fallback;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

// Membangun ProviderError dari respons HTTP non-2xx. Mendukung bentuk OpenAI dan Anthropic.
export async function errorFromResponse(res, { label, secrets = [], retryStatuses = RETRYABLE_STATUSES }) {
  let json = null;
  try {
    json = JSON.parse((await res.text()).slice(0, 4000));
  } catch {
    /* body bukan JSON */
  }
  const err = json?.error && typeof json.error === 'object' ? json.error : {};
  const code = err.code || err.type || `http_${res.status}`;
  const upstream = redact(err.message || '', secrets).slice(0, 300);
  return new ProviderError({
    status: res.status,
    code,
    message: describeError({ label, status: res.status, code, upstream }),
    retryable: retryStatuses.includes(res.status),
    retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')),
  });
}

// Error pada frame stream (status HTTP sudah 200 saat ini terjadi).
export function errorFromStreamFrame(frame, { label, secrets = [] }) {
  const obj = typeof frame === 'object' && frame ? frame : { message: String(frame) };
  const code = obj.code || obj.type || 'upstream_error';
  const status = statusFromCode(code);
  return new ProviderError({
    status,
    code,
    message: describeError({ label, status, code, upstream: redact(obj.message || '', secrets).slice(0, 300) }),
    retryable: RETRYABLE_STATUSES.includes(status),
  });
}

export function networkError({ label, timedOut = false, cause }) {
  return new ProviderError({
    status: timedOut ? 504 : 502,
    code: timedOut ? 'timeout' : 'network_error',
    message: timedOut
      ? `${label} tidak merespons tepat waktu.`
      : `Tidak bisa menghubungi ${label}. Periksa koneksi server.`,
    retryable: true,
    cause,
  });
}

// Bentuk error yang aman dikirim ke browser.
export function toPublicError(err, { label = 'Provider', secrets = [] } = {}) {
  if (err instanceof ProviderError) {
    return {
      code: err.code,
      status: err.status,
      message: redact(err.message, secrets),
      retryable: err.retryable,
      retryAfterMs: err.retryAfterMs,
    };
  }
  return {
    code: 'internal_error',
    status: 500,
    message: `Terjadi kesalahan tak terduga saat menghubungi ${label}.`,
    retryable: false,
    retryAfterMs: null,
  };
}
