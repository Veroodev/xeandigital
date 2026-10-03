import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, searchIndex, matchesFilter, hasCodingMetadata, formatContext, formatPrice, diffModels, describeSync, pickDefaultModel, estimateTokens } from '../lib/catalog.js';
import { normalizeModelList } from '../lib/server/normalize.js';

const models = normalizeModelList({ data: [
  { id: 'qwen/qwen3.8-max:free', display_name: 'Qwen3.8 Max', access_tier: 'free', context_length: 1000000, capabilities: { vision: false, tools: true, reasoning: true }, reasoning_efforts: { levels: ['low', 'high'], default: 'low' } },
  { id: 'mistralai/mistral-large-2512', display_name: 'Mistral Large 3', access_tier: 'free', context_length: 256000, capabilities: { vision: true, tools: true, reasoning: false } },
  { id: 'z-ai/glm-5.3', display_name: 'GLM 5.3', access_tier: 'paid', context_length: 128000, pricing: { input: 0.44, output: 1.86 }, capabilities: { vision: false, tools: true, reasoning: true } },
  { id: 'openai/gpt-5.6-sol', display_name: 'GPT-5.6 Sol', access_tier: 'premium', context_length: 400000 },
  { id: 'meta/muse-spark-1.3' },
] }, 'xkiro');
const idx = buildIndex(models);
const ids = (r) => r.map((m) => m.id);

test('filter berdasarkan metadata API, bukan nama model', () => {
  assert.equal(ids(searchIndex(idx, { filter: 'free' })).length, 2);
  assert.deepEqual(ids(searchIndex(idx, { filter: 'paid' })), ['z-ai/glm-5.3']);
  assert.deepEqual(ids(searchIndex(idx, { filter: 'premium' })), ['openai/gpt-5.6-sol']);
  assert.deepEqual(ids(searchIndex(idx, { filter: 'vision' })), ['mistralai/mistral-large-2512']);
  assert.deepEqual(ids(searchIndex(idx, { filter: 'reasoning' })), ['qwen/qwen3.8-max:free', 'z-ai/glm-5.3']);
  assert.equal(ids(searchIndex(idx, { filter: 'tools' })).length, 3);
  assert.deepEqual(ids(searchIndex(idx, { filter: 'long' })), ['qwen/qwen3.8-max:free', 'mistralai/mistral-large-2512', 'openai/gpt-5.6-sol']);
  assert.equal(searchIndex(idx, { filter: 'all' }).length, 5);
  // model tanpa metadata hanya muncul di "Semua", tidak ditebak dari nama (":free", dll.)
  assert.ok(!ids(searchIndex(idx, { filter: 'free' })).includes('meta/muse-spark-1.3'));
});

test('Coding: tidak ada metadata coding dari API -> filter tidak mengarang hasil', () => {
  assert.equal(hasCodingMetadata(models), false);
  assert.equal(searchIndex(idx, { filter: 'coding' }).length, 0);
  const withCoding = normalizeModelList({ data: [{ id: 'a/b', capabilities: { coding: true } }, { id: 'c/d', tags: ['Coding'] }] }, 'x');
  assert.equal(hasCodingMetadata(withCoding), true);
  assert.equal(withCoding.filter((m) => matchesFilter(m, 'coding')).length, 2);
});

test('pencarian: nama, ID, vendor, capability, konteks, tier', () => {
  const q = (query) => ids(searchIndex(idx, { query }));
  assert.deepEqual(q('Qwen'), ['qwen/qwen3.8-max:free']);
  assert.deepEqual(q('mistral'), ['mistralai/mistral-large-2512']);
  assert.deepEqual(q('meta'), ['meta/muse-spark-1.3']);
  assert.deepEqual(q('vision'), ['mistralai/mistral-large-2512']);
  assert.deepEqual(q('REASONING'), ['qwen/qwen3.8-max:free', 'z-ai/glm-5.3']);
  assert.deepEqual(q('1m context'), ['qwen/qwen3.8-max:free']);
  assert.deepEqual(q('qwen3.8-max:free'), ['qwen/qwen3.8-max:free']);
  assert.deepEqual(q('z-ai glm'), ['z-ai/glm-5.3']);
  assert.deepEqual(q('premium'), ['openai/gpt-5.6-sol']);
  assert.deepEqual(q('tidak-ada'), []);
  assert.deepEqual(q('qwen', ), ['qwen/qwen3.8-max:free']);
  assert.deepEqual(ids(searchIndex(idx, { query: 'max', filter: 'paid' })), []);
});

test('format konteks tidak di-hardcode dan mengikuti nilai API', () => {
  assert.equal(formatContext(1000000), '1M');
  assert.equal(formatContext(1048576), '1M');
  assert.equal(formatContext(256000), '256K');
  assert.equal(formatContext(262144), '262K');
  assert.equal(formatContext(null), null);
  assert.equal(formatPrice(models[2].pricing), '$0.44 masuk / $1.86 keluar per 1 juta token');
  assert.equal(formatPrice(null), null);
});

test('diff sinkron: model baru terdeteksi, model hilang dibuang, pilihan default', () => {
  const next = [...models.slice(1), ...normalizeModelList({ data: [{ id: 'baru/x' }] }, 'xkiro')];
  const d = diffModels(models, next);
  assert.deepEqual(d.added, ['baru/x']);
  assert.deepEqual(d.removed, ['qwen/qwen3.8-max:free']);
  assert.match(describeSync(models, next, 'live'), /1 model baru, 1 dihapus/);
  assert.match(describeSync(models, models, 'live'), /tidak ada perubahan/);
  assert.match(describeSync(models, models, 'stale'), /gagal/);
  assert.equal(pickDefaultModel(models, 'z-ai/glm-5.3'), 'z-ai/glm-5.3');
  assert.equal(pickDefaultModel(models, 'tidak/ada'), 'qwen/qwen3.8-max:free'); // model gratis pertama
  assert.equal(pickDefaultModel([], null), null);
  assert.equal(estimateTokens([{ content: 'a'.repeat(400) }]), 100);
});
