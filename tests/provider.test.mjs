import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, collect, frame, jsonResponse, sseResponse } from './helpers.mjs';

const SECRET = 'xk_live_SUPERSECRETVALUE123456';
process.env.XKIRO_API_KEY = SECRET;
process.env.XKIRO_RETRY_BASE_MS = '1';
process.env.XKIRO_RETRY_MAX_DELAY_MS = '20';
process.env.XKIRO_MODEL_CACHE_TTL_SECONDS = '300';
process.env.XKIRO_FALLBACK_MODELS = 'qwen/qwen3.8-max:free';

const { createXkiroProvider } = await import('../lib/server/providers/xkiro.js');
const { getModels, findModel, getHealth, resetRegistry } = await import('../lib/server/registry.js');
const { defaultProviderId, listProviders, resetProviders } = await import('../lib/server/providers/index.js');

const CATALOG = {
  object: 'list',
  data: [
    { id: 'qwen/qwen3.8-max:free', display_name: 'Qwen3.8 Max', access_tier: 'free', context_length: 1000000, capabilities: { vision: false, tools: true, reasoning: true }, reasoning_efforts: { levels: ['low', 'high'], default: 'high' } },
    { id: 'mistralai/mistral-large-2512', display_name: 'Mistral Large 3', access_tier: 'free', context_length: 256000, capabilities: { vision: true, tools: true, reasoning: false } },
    { id: 'meta/muse-spark-1.3', owned_by: 'meta', brand_new_field: 1 },
  ],
};

const realFetch = globalThis.fetch;
let calls;
const install = (impl) => { calls = []; globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return impl(String(url), init, calls.length); }; };

beforeEach(() => resetRegistry());
afterEach(() => { globalThis.fetch = realFetch; });

test('katalog: GET /v1/models publik (tanpa Authorization), semua model dinormalisasi', async () => {
  install(() => jsonResponse(CATALOG));
  const p = createXkiroProvider();
  const out = await getModels(p);
  assert.equal(out.source, 'live');
  assert.equal(out.models.length, 3);
  assert.equal(calls[0].url, 'https://api.xkiro.com/v1/models');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(out.models[2].extra.brand_new_field, 1);
});

test('cache: pembukaan berulang tidak memanggil API lagi; request serentak digabung', async () => {
  install(async () => jsonResponse(CATALOG));
  const p = createXkiroProvider();
  await Promise.all([getModels(p), getModels(p), getModels(p)]);
  assert.equal(calls.length, 1);
  assert.equal((await getModels(p)).source, 'cache');
  assert.equal(calls.length, 1);
});

test('Sync Models: model baru muncul, model yang hilang dibuang; sinkron paksa beruntun dibatasi', async () => {
  let version = 1;
  install(() => jsonResponse(version === 1 ? CATALOG : { data: [CATALOG.data[0], { id: 'baru/model-x' }] }));
  const p = createXkiroProvider();
  await getModels(p);

  // Dalam interval minimal, sinkron paksa dilayani dari cache.
  version = 2;
  assert.equal((await getModels(p, { force: true })).source, 'cache');
  assert.equal(calls.length, 1);

  // Setelah interval lewat, katalog terbaru dipakai.
  const later = () => Date.now() + 60_000;
  const out = await getModels(p, { force: true, now: later });
  assert.deepEqual(out.models.map((m) => m.id), ['qwen/qwen3.8-max:free', 'baru/model-x']);
});

test('gagal sinkron: memakai data lama (stale); tanpa cache memakai fallback dari env, validasi dilewati', async () => {
  install(() => jsonResponse(CATALOG));
  const p = createXkiroProvider();
  await getModels(p);
  install(() => jsonResponse({ error: { code: 'upstream_error' } }, 503));
  const stale = await getModels(p, { force: true, now: () => Date.now() + 60_000 });
  assert.equal(stale.source, 'stale');
  assert.equal(stale.models.length, 3);
  assert.ok(stale.error);

  resetRegistry();
  const fb = await getModels(p);
  assert.equal(fb.source, 'fallback');
  assert.equal(fb.models[0].id, 'qwen/qwen3.8-max:free');
  assert.equal((await findModel(p, 'apa/saja')).known, false); // validasi dilewati saat katalog tak terjangkau
});

test('findModel: model tidak ada di katalog live -> known=true, model=null', async () => {
  install(() => jsonResponse(CATALOG));
  const p = createXkiroProvider();
  assert.equal((await findModel(p, 'qwen/qwen3.8-max:free')).model.name, 'Qwen3.8 Max');
  assert.deepEqual(await findModel(p, 'qwen3.8-max'), { model: null, known: true }); // tanpa prefix vendor = tidak ada
});

test('chat stream: payload memakai ID penuh, header Bearer, stream_options, reasoning hanya bila diminta', async () => {
  install(() => sseResponse([chunk('Halo'), frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }), frame({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }), 'data: [DONE]\n\n']));
  const p = createXkiroProvider();
  const events = await collect(p.streamMessage({ model: 'qwen/qwen3.8-max:free', messages: [{ role: 'user', content: 'hai' }], options: { reasoningEffort: 'high' } }));
  const req = calls[0];
  const body = JSON.parse(req.init.body);
  assert.equal(req.url, 'https://api.xkiro.com/v1/chat/completions');
  assert.equal(req.init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(body.model, 'qwen/qwen3.8-max:free');
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.reasoning_effort, 'high');
  assert.ok(!JSON.stringify(body).includes(SECRET), 'key tidak boleh ada di body');
  assert.equal(events.at(-1).usage.totalTokens, 3);

  await collect(p.streamMessage({ model: 'a/b', messages: [{ role: 'user', content: 'hai' }], options: {} }));
  assert.equal('reasoning_effort' in JSON.parse(calls.at(-1).init.body), false);
});

test('chat: 401 menjadi pesan ramah tanpa membocorkan key; 429 di-retry lalu sukses', async () => {
  install(() => jsonResponse({ error: { message: `Invalid key ${SECRET}`, type: 'authentication_error', code: 'authentication_error' } }, 401));
  const p = createXkiroProvider();
  await assert.rejects(collect(p.streamMessage({ model: 'a/b', messages: [{ role: 'user', content: 'x' }], options: {} })), (err) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /API key xKiro tidak valid/);
    assert.ok(!err.message.includes(SECRET));
    return true;
  });
  assert.equal(calls.length, 1); // 401 tidak di-retry

  install((url, init, n) => (n < 3 ? jsonResponse({ error: { code: 'rate_limit_exceeded' } }, 429, { 'Retry-After': '0' }) : sseResponse([chunk('ok'), 'data: [DONE]\n\n'])));
  const events = await collect(p.streamMessage({ model: 'a/b', messages: [{ role: 'user', content: 'x' }], options: {} }));
  assert.equal(events[0].text, 'ok');
  assert.equal(calls.length, 3);
});

test('chat: model tidak dikenal (404) dan sendMessage non-stream dinormalisasi', async () => {
  install(() => jsonResponse({ error: { message: 'Model "x" not found.', type: 'not_found_error', code: 'not_found' } }, 404));
  const p = createXkiroProvider();
  await assert.rejects(p.sendMessage({ model: 'x', messages: [{ role: 'user', content: 'x' }], options: {} }), (e) => e.status === 404 && /ID lengkap vendor\/model/.test(e.message));

  install(() => jsonResponse({ id: 'chatcmpl-1', model: 'a/b', created: 5, choices: [{ message: { role: 'assistant', content: 'Jawaban' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }));
  const out = await p.sendMessage({ model: 'a/b', messages: [{ role: 'user', content: 'x' }], options: {} });
  assert.deepEqual(Object.keys(out).sort(), ['content', 'created', 'finishReason', 'id', 'model', 'provider', 'reasoning', 'toolCalls', 'usage']);
  assert.equal(out.content, 'Jawaban');
  assert.equal(out.provider, 'xkiro');
  assert.equal(out.usage.totalTokens, 5);
});

test('batal: abort menutup stream upstream (cleanup koneksi)', async () => {
  let cancelled = false;
  install(() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(chunk('a'))); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const p = createXkiroProvider();
  const it = p.streamMessage({ model: 'a/b', messages: [{ role: 'user', content: 'x' }], options: {} })[Symbol.asyncIterator]();
  assert.equal((await it.next()).value.text, 'a');
  await it.return();
  assert.equal(cancelled, true);
});

test('health check: online/offline, hasil di-cache sehingga tidak memanggil API berulang', async () => {
  install(() => jsonResponse(CATALOG));
  const p = createXkiroProvider();
  const a = await getHealth(p);
  const b = await getHealth(p);
  assert.equal(a.online, true);
  assert.equal(a.keyConfigured, true);
  assert.equal(calls.length, 1);
  assert.equal(b.checkedAt, a.checkedAt);

  resetRegistry();
  install(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  const down = await getHealth(p, { force: true });
  assert.equal(down.online, false);
  assert.ok(!JSON.stringify(down).includes(SECRET));
});

test('provider manager: xKiro terdaftar; key tidak pernah ikut daftar provider', () => {
  resetProviders();
  const list = listProviders();
  assert.ok(list.find((p) => p.id === 'xkiro').configured);
  assert.ok(!JSON.stringify(list).includes(SECRET));
  process.env.DEFAULT_PROVIDER = 'xkiro';
  assert.equal(defaultProviderId(), 'xkiro');
  delete process.env.DEFAULT_PROVIDER;
});
