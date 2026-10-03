import { redact } from './errors.js';

// Hanya mencatat metadata aman: provider, model, status, durasi, token. Tidak pernah header/secret/isi pesan.
export function logRequest({ provider, model, status, durationMs, usage, outcome, code }, secrets = []) {
  const line = {
    t: new Date().toISOString(),
    provider,
    model,
    status,
    ms: durationMs,
    outcome,
    ...(code ? { code } : {}),
    ...(usage ? { tokens: usage.totalTokens ?? null } : {}),
  };
  console.info('[xean]', redact(JSON.stringify(line), secrets));
}
