const MAX_MESSAGES = 100;
const MAX_CHARS = 400_000;
const MAX_IMAGE_CHARS = 8_000_000;

function cleanContent(content) {
  if (typeof content === 'string') return content.trim() ? content : null;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const p of content) {
    if (p?.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
    else if (p?.type === 'image_url' && typeof p.image_url?.url === 'string' && /^(https:\/\/|data:image\/)/.test(p.image_url.url)) {
      parts.push({ type: 'image_url', image_url: { url: p.image_url.url } });
    }
  }
  return parts.length ? parts : null;
}

function size(content) {
  if (typeof content === 'string') return { text: content.length, image: 0 };
  return content.reduce(
    (acc, p) => (p.type === 'text' ? { ...acc, text: acc.text + p.text.length } : { ...acc, image: acc.image + p.image_url.url.length }),
    { text: 0, image: 0 }
  );
}

export function validateChatBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, code: 'invalid_request', message: 'Body permintaan tidak valid.' };

  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!model) return { ok: false, code: 'invalid_request', message: 'Model belum dipilih.' };
  if (model.length > 200) return { ok: false, code: 'invalid_request', message: 'ID model terlalu panjang.' };

  if (!Array.isArray(body.messages)) return { ok: false, code: 'invalid_request', message: 'Daftar pesan tidak valid.' };
  const messages = [];
  for (const m of body.messages.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = cleanContent(m.content);
    if (content) messages.push({ role: m.role, content });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return { ok: false, code: 'invalid_request', message: 'Pesan terakhir harus berasal dari pengguna.' };
  }
  const total = messages.reduce((acc, m) => {
    const s = size(m.content);
    return { text: acc.text + s.text, image: acc.image + s.image };
  }, { text: 0, image: 0 });
  if (total.text > MAX_CHARS || total.image > MAX_IMAGE_CHARS) {
    return { ok: false, code: 'invalid_request', message: 'Percakapan terlalu panjang. Mulai percakapan baru.' };
  }

  const options = {};
  if (typeof body.reasoningEffort === 'string' && /^[a-z]{2,12}$/.test(body.reasoningEffort)) options.reasoningEffort = body.reasoningEffort;
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) options.temperature = Math.min(2, Math.max(0, body.temperature));
  if (Number.isInteger(body.maxTokens) && body.maxTokens > 0) options.maxTokens = body.maxTokens;
  if (Array.isArray(body.tools) && body.tools.length && body.tools.length <= 64) {
    options.tools = body.tools;
    if (body.toolChoice !== undefined) options.toolChoice = body.toolChoice;
  }

  return {
    ok: true,
    providerId: typeof body.provider === 'string' ? body.provider : null,
    model,
    messages,
    options,
    stream: body.stream !== false,
  };
}
