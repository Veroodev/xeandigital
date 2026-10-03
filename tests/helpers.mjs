export const enc = new TextEncoder();

// Membuat Response SSE dari daftar chunk string (chunk boleh memotong event di tengah).
export function sseResponse(chunks, { status = 200, headers = {} } = {}) {
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream', ...headers } });
}

export const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
export const chunk = (content, extra = {}) => frame({ id: 'c1', model: 'qwen/qwen3.8-max:free', created: 1, choices: [{ index: 0, delta: { content } }], ...extra });

export async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

export const jsonResponse = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
