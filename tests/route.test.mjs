// Uji end-to-end route handler (POST /api/chat, GET /api/models, /api/health, /api/providers)
// dengan fetch upstream ditiru. Alias "@/" dipetakan lewat hook resolver Node.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, frame, jsonResponse, sseResponse } from './helpers.mjs';

const BASE = pathToFileURL(new URL('..', import.meta.url).pathname).href.replace(/\/?$/, '/');
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { return s.startsWith('@/') ? n(new URL(s.slice(2), ${JSON.stringify(BASE)}).href, c) : n(s, c); }`
));

const SECRET = 'xk_live_ROUTETESTSECRET9876543210';
process.env.XKIRO_API_KEY = SECRET;
process.env.XKIRO_RETRY_BASE_MS = '1';
process.env.XKIRO_RETRY_MAX_DELAY_MS = '10';
delete process.env.APMIX_API_KEY;

const chatRoute = await import('../app/api/chat/route.js');
const modelsRoute = await import('../app/api/models/route.js');
const healthRoute = await import('../app/api/health/route.js');
const providersRoute = await import('../app/api/providers/route.js');
const { resetRegistry } = await import('../lib/server/registry.js');
const { resetProviders } = await import('../lib/server/providers/index.js');

const CATALOG = { object: 'list', data: [
  { id: 'qwen/qwen3.8-max:free', display_name: 'Qwen3.8 Max', access_tier: 'free', context_length: 1000000, max_output_tokens: 4096, capabilities: { vision: false, tools: true, reasoning: true }, reasoning_efforts: { levels: ['low', 'high'], default: 'low' } },
  { id: 'mistralai/mistral-large-2512', display_name: 'Mistral Large 3', access_tier: 'free', capabilities: { vision: true, tools: true } },
] };

const realFetch = globalThis.fetch;
let chatCalls;
function mock(chatImpl) {
  chatCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.endsWith('/models')) return jsonResponse(CATALOG);
    chatCalls.push({ url, init, body: JSON.parse(init.body) });
    return chatImpl(chatCalls.length);
  };
}
beforeEach(() => { resetRegistry(); resetProviders(); process.env.XKIRO_API_KEY = SECRET; });
afterEach(() => { globalThis.fetch = realFetch; });

const post = (body) => chatRoute.POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
const user = (content) => [{ role: 'user', content }];

async function readFrames(res) {
  const text = await res.text();
  return text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l.slice(5)));
}

test('POST /api/chat (stream): frame start, delta, usage, done; key tidak bocor', async () => {
  mock(() => sseResponse([chunk('Halo'), chunk(' Xean'), frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }), frame({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }), 'data: [DONE]\n\n']));
  const res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai'), reasoningEffort: 'high' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const raw = await res.clone().text();
  assert.ok(!raw.includes(SECRET));
  const frames = await readFrames(res);
  assert.deepEqual(frames.map((f) => f.type), ['start', 'delta', 'delta', 'usage', 'done']);
  assert.equal(frames[0].reasoningEffort, 'high');
  assert.equal(frames.filter((f) => f.type === 'delta').map((f) => f.text).join(''), 'Halo Xean');
  assert.equal(frames.at(-1).usage.totalTokens, 7);
  // permintaan upstream
  assert.equal(chatCalls[0].url, 'https://api.xkiro.com/v1/chat/completions');
  assert.equal(chatCalls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(chatCalls[0].body.model, 'qwen/qwen3.8-max:free');
  assert.equal(chatCalls[0].body.reasoning_effort, 'high');
  assert.equal(chatCalls[0].body.messages[0].role, 'system');
});

test('reasoning dari level yang tidak dideklarasikan model dibuang sebelum dikirim', async () => {
  mock(() => sseResponse([chunk('x'), 'data: [DONE]\n\n']));
  const res = await post({ provider: 'xkiro', model: 'mistralai/mistral-large-2512', messages: user('hai'), reasoningEffort: 'max' });
  const frames = await readFrames(res);
  assert.deepEqual(frames[0].dropped, ['reasoning_effort']);
  assert.equal('reasoning_effort' in chatCalls[0].body, false);
});

test('401 dari xKiro menjadi HTTP 401 dengan pesan ramah, tanpa key, tanpa retry', async () => {
  mock(() => jsonResponse({ error: { message: `bad key ${SECRET}`, type: 'authentication_error', code: 'authentication_error' } }, 401));
  const res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') });
  const text = await res.text();
  assert.equal(res.status, 401);
  assert.match(JSON.parse(text).error.message, /API key xKiro tidak valid/);
  assert.ok(!text.includes(SECRET));
  assert.equal(chatCalls.length, 1);
});

test('429 di-retry lalu sukses; 503 terus-menerus menjadi 503 setelah retry habis', async () => {
  mock((n) => (n < 3 ? jsonResponse({ error: { code: 'rate_limit_exceeded' } }, 429) : sseResponse([chunk('ok'), 'data: [DONE]\n\n'])));
  let res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') });
  assert.equal(res.status, 200);
  assert.equal(chatCalls.length, 3);
  await res.text();

  mock(() => jsonResponse({ error: { code: 'service_unavailable' } }, 503));
  res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') });
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.error.retryable, true);
  assert.match(body.error.message, /xKiro sedang tidak tersedia/);
  assert.equal(chatCalls.length, 4);
});

test('model tanpa prefix vendor / tidak ada di katalog: 404 tanpa memanggil chat upstream', async () => {
  mock(() => { throw new Error('tidak boleh dipanggil'); });
  const res = await post({ provider: 'xkiro', model: 'qwen3.8-max', messages: user('hai') });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'model_not_found');
  assert.equal(chatCalls.length, 0);
});

test('gambar ke model tanpa vision: 400 tanpa request upstream', async () => {
  mock(() => { throw new Error('tidak boleh dipanggil'); });
  const content = [{ type: 'text', text: 'apa ini' }, { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }];
  const res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: [{ role: 'user', content }] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.message, 'Model ini tidak mendukung input gambar.');
  assert.equal(chatCalls.length, 0);

  mock(() => sseResponse([chunk('ok'), 'data: [DONE]\n\n']));
  const ok = await post({ provider: 'xkiro', model: 'mistralai/mistral-large-2512', messages: [{ role: 'user', content }] });
  assert.equal(ok.status, 200);
  assert.equal(chatCalls[0].body.messages[1].content[1].type, 'image_url');
  await ok.text();
});

test('tanpa API key: 503 not_configured; provider/permintaan tidak valid: 400', async () => {
  mock(() => { throw new Error('tidak boleh dipanggil'); });
  process.env.XKIRO_API_KEY = '';
  resetProviders();
  let res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error.message, /XKIRO_API_KEY/);

  res = await post({ provider: 'tidak-ada', model: 'a/b', messages: user('hai') });
  assert.equal(res.status, 400);
  res = await chatRoute.POST(new Request('http://localhost/api/chat', { method: 'POST', body: '{rusak' }));
  assert.equal(res.status, 400);
  res = await post({ provider: 'xkiro', model: 'a/b', messages: [] });
  assert.equal(res.status, 400);
});

test('error di tengah stream: teks parsial terkirim lalu frame error (HTTP tetap 200)', async () => {
  mock(() => sseResponse([chunk('Sebagian'), frame({ error: { message: 'Upstream provider is unavailable.', type: 'api_error', code: 'upstream_error' } }), 'data: [DONE]\n\n']));
  const res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') });
  assert.equal(res.status, 200);
  const frames = await readFrames(res);
  assert.deepEqual(frames.map((f) => f.type), ['start', 'delta', 'error']);
  assert.equal(frames[1].text, 'Sebagian');
  assert.equal(frames[2].retryable, true);
});

test('stream putus tanpa terminator: partial + frame error stream_interrupted', async () => {
  mock(() => sseResponse([chunk('Terpotong')]));
  const frames = await readFrames(await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') }));
  assert.equal(frames.at(-1).type, 'error');
  assert.equal(frames.at(-1).code, 'stream_interrupted');
});

test('klien menekan Berhenti: stream upstream ikut ditutup', async () => {
  let upstreamCancelled = false;
  mock(() => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(chunk('mulai'))); },
    cancel() { upstreamCancelled = true; },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai') });
  const reader = res.body.getReader();
  await reader.read(); // frame start
  await reader.read(); // frame delta
  await reader.cancel();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(upstreamCancelled, true);
});

test('non-stream (stream:false): respons ternormalisasi', async () => {
  mock(() => jsonResponse({ id: 'chatcmpl-9', model: 'qwen/qwen3.8-max:free', created: 9, choices: [{ message: { role: 'assistant', content: 'Isi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  const res = await post({ provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: user('hai'), stream: false });
  const out = await res.json();
  assert.equal(out.content, 'Isi');
  assert.equal(out.provider, 'xkiro');
  assert.equal(out.finishReason, 'stop');
  assert.equal(chatCalls[0].body.stream, false);
});

test('GET /api/models, /api/providers, /api/health: data benar dan tidak membocorkan key', async () => {
  mock(() => { throw new Error('tidak dipakai'); });
  const m = await modelsRoute.GET(new Request('http://localhost/api/models?provider=xkiro'));
  const body = await m.json();
  assert.equal(m.status, 200);
  assert.equal(body.count, 2);
  assert.equal(body.source, 'live');
  assert.match(m.headers.get('cache-control'), /s-maxage=300/);
  assert.equal(body.models[0].reasoningEfforts.levels.length, 2);
  assert.ok(!JSON.stringify(body).includes(SECRET));

  const again = await (await modelsRoute.GET(new Request('http://localhost/api/models?provider=xkiro'))).json();
  assert.equal(again.source, 'cache');
  assert.equal((await modelsRoute.GET(new Request('http://localhost/api/models?provider=zzz'))).status, 400);

  const p = await (await providersRoute.GET()).json();
  assert.ok(p.providers.find((x) => x.id === 'xkiro').configured);
  assert.equal(p.default, 'xkiro'); // APMIX tanpa key, jadi xKiro menjadi provider pertama yang terkonfigurasi
  assert.ok(!JSON.stringify(p).includes(SECRET));

  const h = await (await healthRoute.GET(new Request('http://localhost/api/health?provider=xkiro'))).json();
  assert.equal(h.online, true);
  assert.equal(h.provider, 'xkiro');
});
