import { readSse } from '@/lib/shared/sse-reader.js';

export class ChatError extends Error {
  constructor({ message, code = 'error', status = 0, retryable = false }) {
    super(message);
    this.name = 'ChatError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function errorFromResponse(res) {
  let info = null;
  try {
    info = (await res.json())?.error ?? null;
  } catch {
    /* body bukan JSON */
  }
  return new ChatError({
    message: info?.message || `Permintaan gagal (${res.status}).`,
    code: info?.code || `http_${res.status}`,
    status: res.status,
    retryable: Boolean(info?.retryable) || [429, 500, 502, 503, 504, 529].includes(res.status),
  });
}

/**
 * Memanggil /api/chat dan membaca event ternormalisasi dari server:
 *   start, delta, reasoning, tool_call, usage, done, error
 * Browser tidak pernah berbicara langsung ke provider dan tidak pernah memegang API key.
 * Stream yang putus tanpa 'done' dilaporkan sebagai error; teks yang sudah diterima tetap aman di UI.
 */
export async function streamChat({ provider, model, messages, reasoningEffort, signal, onEvent }) {
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, messages, reasoningEffort: reasoningEffort || undefined, stream: true }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ChatError({ message: 'Tidak bisa menghubungi server Xean Digital AI. Periksa koneksi Anda.', code: 'network_error', retryable: true });
  }
  if (!res.ok || !res.body) throw await errorFromResponse(res);

  let finished = false;
  try {
    for await (const ev of readSse(res.body)) {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (frame.type === 'error') {
        throw new ChatError({ message: frame.message, code: frame.code, status: frame.status, retryable: frame.retryable });
      }
      onEvent(frame);
      if (frame.type === 'done') {
        finished = true;
        break;
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' || err instanceof ChatError) throw err;
    throw new ChatError({ message: 'Koneksi terputus saat menerima jawaban.', code: 'stream_interrupted', retryable: true });
  }
  if (!finished) {
    throw new ChatError({ message: 'Koneksi terputus sebelum jawaban selesai.', code: 'stream_interrupted', retryable: true });
  }
}
