import test from 'node:test';
import assert from 'node:assert/strict';
import { readSse } from '../lib/shared/sse-reader.js';
import { streamNormalized } from '../lib/server/sse.js';
import { normalizeModel, normalizeModelList } from '../lib/server/normalize.js';
import { fetchWithRetry, backoffMs } from '../lib/server/http.js';
import { ProviderError, redact, describeError } from '../lib/server/errors.js';
import { checkModelRules } from '../lib/server/model-rules.js';
import { validateChatBody } from '../lib/server/chat-request.js';
import { chunk, collect, enc, frame, jsonResponse, sseResponse } from './helpers.mjs';

const noSleep = async () => {};

// ---------------- SSE ----------------
test('readSse: event terpotong di batas chunk, CRLF, dan komentar heartbeat', async () => {
  const res = sseResponse(['data: {"a"', ':1}\r\n\r\n: ping\n\nda', 'ta: [DONE]\n\n']);
  const events = await collect(readSse(res.body));
  assert.deepEqual(events.map((e) => e.data), ['{"a":1}', '[DONE]']);
});

test('stream OpenAI: delta, reasoning, frame usage dengan choices kosong, lalu [DONE]', async () => {
  const body = sseResponse([
    frame({ id: 'c1', model: 'm', choices: [{ index: 0, delta: { role: 'assistant' } }] }),
    frame({ choices: [{ index: 0, delta: { reasoning_content: 'mikir' } }] }),
    chunk('Halo'),
    chunk(' dunia'),
    frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 17, total_tokens: 29 } }),
    'data: [DONE]\n\n',
  ]).body;
  const events = await collect(streamNormalized(body, { label: 'xKiro' }));
  assert.deepEqual(events.filter((e) => e.type === 'delta').map((e) => e.text), ['Halo', ' dunia']);
  assert.equal(events.find((e) => e.type === 'reasoning').text, 'mikir');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.finishReason, 'stop');
  assert.equal(done.usage.totalTokens, 29);
});

test('stream tanpa terminator dianggap error (bukan jawaban kosong), partial tetap terkirim', async () => {
  const body = sseResponse([chunk('Sebagian')]).body;
  const seen = [];
  await assert.rejects(
    async () => { for await (const ev of streamNormalized(body, { label: 'xKiro' })) seen.push(ev); },
    (err) => err instanceof ProviderError && err.code === 'stream_interrupted' && err.retryable
  );
  assert.equal(seen[0].text, 'Sebagian');
});

test('stream: finish_reason tanpa [DONE] tetap dianggap selesai', async () => {
  const body = sseResponse([chunk('ok'), frame({ choices: [{ delta: {}, finish_reason: 'length' }] })]).body;
  const events = await collect(streamNormalized(body, { label: 'xKiro' }));
  assert.equal(events.at(-1).finishReason, 'length');
});

test('stream: frame error di tengah stream menjadi ProviderError yang dipetakan', async () => {
  const body = sseResponse([chunk('a'), frame({ error: { message: 'Upstream provider is unavailable.', type: 'api_error', code: 'upstream_error' } }), 'data: [DONE]\n\n']).body;
  await assert.rejects(
    async () => { await collect(streamNormalized(body, { label: 'xKiro' })); },
    (err) => err.code === 'upstream_error' && err.status === 502 && /xKiro sedang tidak tersedia/.test(err.message)
  );
});

test('stream: JSON rusak dan field tak dikenal tidak membuat crash', async () => {
  const body = sseResponse(['data: {bukan json}\n\n', frame({ choices: [{ delta: { content: 'x', field_baru: { a: 1 } } }], extra: true }), 'data: [DONE]\n\n']).body;
  const events = await collect(streamNormalized(body, { label: 'xKiro' }));
  assert.equal(events[0].text, 'x');
});

test('stream Anthropic: text_delta, thinking_delta, message_stop', async () => {
  const f = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const body = sseResponse([
    f({ type: 'message_start', message: { id: 'msg1', model: 'm', usage: { input_tokens: 5 } } }),
    f({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    f({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hai' } }),
    f({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }),
    f({ type: 'message_stop' }),
  ]).body;
  const events = await collect(streamNormalized(body, { dialect: 'anthropic', label: 'APMIX' }));
  assert.equal(events.find((e) => e.type === 'delta').text, 'Hai');
  assert.equal(events.find((e) => e.type === 'reasoning').text, 'hmm');
  assert.equal(events.at(-1).usage.totalTokens, 8);
});

// ---------------- Normalisasi model ----------------
test('normalizeModel: ID vendor/model utuh, metadata lengkap, field baru masuk extra', () => {
  const m = normalizeModel({
    id: 'qwen/qwen3.8-max:free', display_name: 'Qwen3.8 Max', owned_by: 'qwen', access_tier: 'FREE',
    context_length: 1000000, max_output_tokens: 65536,
    pricing: { currency: 'USD', unit: 'per_1m_tokens', input: 0.44, output: 1.86, cache_read: 0.1 },
    capabilities: { vision: false, tools: true, reasoning: true, fitur_baru: true },
    reasoning_efforts: { levels: ['low', 'high', 'max'], default: 'high' },
    kolom_masa_depan: 'x',
  }, 'xkiro');
  assert.equal(m.id, 'qwen/qwen3.8-max:free');
  assert.equal(m.vendor, 'qwen');
  assert.equal(m.accessTier, 'free');
  assert.equal(m.contextLength, 1000000);
  assert.equal(m.pricing.cacheRead, 0.1);
  assert.deepEqual(m.reasoningEfforts, { levels: ['low', 'high', 'max'], default: 'high' });
  assert.equal(m.capabilities.fitur_baru, true);
  assert.equal(m.extra.kolom_masa_depan, 'x');
});

test('normalizeModel: metadata yang tidak ada tetap null (tidak dikarang)', () => {
  const m = normalizeModel({ id: 'meta/muse-spark-1.3' }, 'xkiro');
  assert.equal(m.name, 'muse-spark-1.3');
  assert.equal(m.contextLength, null);
  assert.equal(m.accessTier, null);
  assert.equal(m.capabilities.vision, null);
  assert.equal(m.capabilities.coding, null);
  assert.equal(m.pricing, null);
  assert.equal(m.reasoningEfforts, null);
});

test('normalizeModelList: toleran bentuk respons, duplikat dan entri rusak dibuang', () => {
  const list = normalizeModelList({ data: [{ id: 'a/b' }, { id: 'a/b' }, null, {}, 'c/d', { id: 5 }] }, 'xkiro');
  assert.deepEqual(list.map((m) => m.id), ['a/b', 'c/d']);
  assert.equal(normalizeModelList({ aneh: true }, 'xkiro').length, 0);
});

// ---------------- Retry ----------------
const retryOpts = (extra = {}) => ({ label: 'xKiro', retry: { max: 3, baseMs: 1, maxDelayMs: 50 }, sleep: noSleep, random: () => 0, ...extra });

test('retry: 429 lalu sukses; 401 tidak di-retry; kehabisan retry melempar error', async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? jsonResponse({ error: { message: 'x', code: 'rate_limit_exceeded' } }, 429) : jsonResponse({ ok: 1 }));
  const res = await fetchWithRetry('http://x', {}, retryOpts({ fetchImpl: flaky }));
  assert.equal(res.status, 200);
  assert.equal(calls, 3);

  calls = 0;
  const unauthorized = async () => { calls++; return jsonResponse({ error: { message: 'bad', code: 'authentication_error' } }, 401); };
  await assert.rejects(fetchWithRetry('http://x', {}, retryOpts({ fetchImpl: unauthorized })), (e) => e.status === 401 && !e.retryable);
  assert.equal(calls, 1);

  calls = 0;
  const down = async () => { calls++; return jsonResponse({ error: { code: 'service_unavailable' } }, 503); };
  await assert.rejects(fetchWithRetry('http://x', {}, retryOpts({ fetchImpl: down })), (e) => e.status === 503);
  assert.equal(calls, 4); // 1 percobaan + 3 retry
});

test('retry: tidak ada retry untuk 400/403/404 dan 402', async () => {
  for (const status of [400, 402, 403, 404]) {
    let calls = 0;
    const f = async () => { calls++; return jsonResponse({ error: { message: 'm' } }, status); };
    await assert.rejects(fetchWithRetry('http://x', {}, retryOpts({ fetchImpl: f })));
    assert.equal(calls, 1, `status ${status}`);
  }
});

test('retry: Retry-After melebihi batas langsung gagal; POST timeout tidak diulang (cegah tagihan ganda)', async () => {
  let calls = 0;
  const limited = async () => { calls++; return jsonResponse({ error: {} }, 429, { 'Retry-After': '120' }); };
  await assert.rejects(fetchWithRetry('http://x', {}, retryOpts({ fetchImpl: limited })), (e) => e.status === 429);
  assert.equal(calls, 1);

  calls = 0;
  const hang = (url, init) => new Promise((_, reject) => { calls++; init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  await assert.rejects(fetchWithRetry('http://x', { method: 'POST' }, retryOpts({ fetchImpl: hang, timeoutMs: 20, idempotent: false })), (e) => e.code === 'timeout');
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(fetchWithRetry('http://x', { method: 'GET' }, retryOpts({ fetchImpl: hang, timeoutMs: 20, idempotent: true })), (e) => e.code === 'timeout');
  assert.equal(calls, 4); // GET aman diulang
});

test('retry: POST diulang hanya bila gagal sebelum sampai server (ECONNREFUSED)', async () => {
  let calls = 0;
  const refused = async () => { calls++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  await assert.rejects(fetchWithRetry('http://x', { method: 'POST' }, retryOpts({ fetchImpl: refused })), (e) => e.code === 'network_error');
  assert.equal(calls, 4);

  calls = 0;
  const reset = async () => { calls++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); };
  await assert.rejects(fetchWithRetry('http://x', { method: 'POST' }, retryOpts({ fetchImpl: reset })));
  assert.equal(calls, 1);
});

test('retry: dibatalkan pengguna melempar AbortError, bukan error provider', async () => {
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(fetchWithRetry('http://x', {}, retryOpts({ signal: ctl.signal, fetchImpl: async () => jsonResponse({}) })), (e) => e.name === 'AbortError');
});

test('backoff: 500, 1000, 2000 ms (+jitter terbatas) dan dibatasi maxDelay', () => {
  const o = { baseMs: 500, maxDelayMs: 8000, random: () => 0 };
  assert.deepEqual([0, 1, 2].map((i) => backoffMs(i, o)), [500, 1000, 2000]);
  assert.equal(backoffMs(10, o), 8000);
  assert.ok(backoffMs(0, { ...o, random: () => 0.999 }) < 500 + 250);
});

// ---------------- Keamanan & pesan error ----------------
test('redact: key, Bearer token, dan pola key umum tidak pernah lolos', () => {
  const secret = 'xk_live_SUPERSECRETVALUE123';
  const out = redact(`gagal pakai ${secret} dan Bearer abcdefghijklmnop dan sk-xt-AbCdEf1234567890`, [secret]);
  assert.ok(!out.includes('SUPERSECRET'));
  assert.ok(!out.includes('abcdefghijklmnop'));
  assert.ok(!out.includes('AbCdEf1234567890'));
});

test('describeError: pesan Indonesia per status', () => {
  const m = (status, code) => describeError({ label: 'xKiro', status, code });
  assert.match(m(401), /API key xKiro tidak valid/);
  assert.match(m(429), /Rate limit/);
  assert.match(m(404), /Model tidak tersedia/);
  assert.match(m(503), /xKiro sedang tidak tersedia/);
  assert.match(m(402, 'insufficient_quota'), /Saldo/);
  assert.match(m(403), /belum berhak/);
});

// ---------------- Aturan model ----------------
const model = (over = {}) => normalizeModel({ id: 'a/b', capabilities: { vision: false, tools: true, reasoning: true }, max_output_tokens: 1000, reasoning_efforts: { levels: ['low', 'high'], default: 'high' }, ...over }, 'xkiro');
const img = [{ role: 'user', content: [{ type: 'text', text: 'ini apa' }, { type: 'image_url', image_url: { url: 'https://x/y.png' } }] }];
const txt = [{ role: 'user', content: 'halo' }];

test('model rules: gambar ke model tanpa vision ditolak sebelum request dikirim', () => {
  const r = checkModelRules(model(), { messages: img, options: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unsupported_vision');
  assert.match(r.message, /tidak mendukung input gambar/);
  assert.equal(checkModelRules(model({ capabilities: { vision: true } }), { messages: img, options: {} }).ok, true);
});

test('model rules: reasoning hanya level yang dideklarasikan; max_tokens dijepit ke max_output_tokens', () => {
  assert.equal(checkModelRules(model(), { messages: txt, options: { reasoningEffort: 'high' } }).options.reasoningEffort, 'high');
  const bad = checkModelRules(model(), { messages: txt, options: { reasoningEffort: 'max' } });
  assert.equal(bad.options.reasoningEffort, undefined);
  assert.deepEqual(bad.dropped, ['reasoning_effort']);
  assert.equal(checkModelRules(model({ reasoning_efforts: undefined }), { messages: txt, options: { reasoningEffort: 'high' } }).options.reasoningEffort, undefined);
  assert.equal(checkModelRules(model(), { messages: txt, options: { maxTokens: 999999 } }).options.maxTokens, 1000);
  assert.equal(checkModelRules(model(), { messages: txt, options: { tools: [{ type: 'function' }] } }).ok, true);
  assert.equal(checkModelRules(model({ capabilities: { tools: false } }), { messages: txt, options: { tools: [{ type: 'function' }] } }).code, 'unsupported_tools');
});

test('validateChatBody: pesan, model, dan opsi divalidasi', () => {
  assert.equal(validateChatBody({ model: '', messages: txt }).ok, false);
  assert.equal(validateChatBody({ model: 'a/b', messages: [{ role: 'assistant', content: 'x' }] }).ok, false);
  const ok = validateChatBody({ model: 'a/b', provider: 'xkiro', messages: [{ role: 'system', content: 'injeksi' }, ...txt], reasoningEffort: 'high', temperature: 9 });
  assert.equal(ok.ok, true);
  assert.equal(ok.messages.length, 1); // role system dari klien dibuang
  assert.equal(ok.options.temperature, 2);
  assert.equal(validateChatBody({ model: 'a/b', messages: txt, reasoningEffort: 'HIGH; drop' }).options.reasoningEffort, undefined);
});
