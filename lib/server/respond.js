import { toPublicError } from './errors.js';

export function errorResponse(status, code, message, extra = {}) {
  return Response.json(
    { error: { code, message, status, retryable: false, ...extra } },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function errorFromThrown(err, provider) {
  const pub = toPublicError(err, { label: provider?.label, secrets: provider?.secrets ?? [] });
  const status = pub.status >= 400 && pub.status < 600 ? pub.status : 502;
  const headers = { 'Cache-Control': 'no-store' };
  if (pub.retryAfterMs) headers['Retry-After'] = String(Math.ceil(pub.retryAfterMs / 1000));
  return Response.json({ error: pub }, { status, headers });
}
