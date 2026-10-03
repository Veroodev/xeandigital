// Pembaca Server-Sent Events murni (tanpa dependensi). Dipakai oleh server dan browser.
// Menangani event yang terpotong di batas chunk, CRLF, komentar (": ping"), dan multi-line data.

export function parseSseEvent(raw) {
  let event = '';
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

export async function* readSse(body, { signal } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Saat dibatalkan, reader.cancel() langsung membebaskan read() yang sedang menunggu token berikutnya.
  const onAbort = () => reader.cancel().catch(() => {});
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const raw of parts) {
        const ev = parseSseEvent(raw);
        if (ev) yield ev;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const ev = parseSseEvent(buffer);
      if (ev) yield ev;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // Melepas koneksi bila konsumen berhenti lebih awal (abort, error, break).
    try {
      await reader.cancel();
    } catch {
      /* sudah tertutup */
    }
  }
}
