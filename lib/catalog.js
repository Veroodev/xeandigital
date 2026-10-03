// Logika murni katalog model di sisi klien: filter, pencarian, format. Tanpa React, tanpa fetch.
// Semua berdasarkan metadata dari API; tidak ada daftar model yang ditulis manual.

// Ambang "Long Context" (token). Ini definisi tampilan, bukan data model; ubah sesuai selera.
export const LONG_CONTEXT_MIN = 200_000;

export const FILTERS = [
  { id: 'all', label: 'Semua' },
  { id: 'free', label: 'Gratis' },
  { id: 'paid', label: 'Berbayar' },
  { id: 'premium', label: 'Premium' },
  { id: 'vision', label: 'Vision' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'tools', label: 'Tools' },
  { id: 'coding', label: 'Coding' },
  { id: 'long', label: 'Long Context' },
];

export const TIER_LABEL = { free: 'Gratis', paid: 'Berbayar', premium: 'Premium' };

const REASONING_LABEL = {
  none: 'Mati', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
  xhigh: 'XHigh', max: 'Max', off: 'Off', on: 'On', adaptive: 'Adaptif', disabled: 'Nonaktif',
};
export const reasoningLabel = (level) => REASONING_LABEL[level] ?? level;

export function matchesFilter(model, filter) {
  const c = model.capabilities ?? {};
  switch (filter) {
    case 'free': case 'paid': case 'premium': return model.accessTier === filter;
    case 'vision': return c.vision === true;
    case 'tools': return c.tools === true;
    case 'reasoning': return c.reasoning === true || Boolean(model.reasoningEfforts);
    case 'coding': return c.coding === true;
    case 'long': return (model.contextLength ?? 0) >= LONG_CONTEXT_MIN;
    default: return true;
  }
}

// Filter "Coding" hanya aktif jika API memang memberi metadata coding pada minimal satu model.
export const hasCodingMetadata = (models) => models.some((m) => m.capabilities?.coding === true);

export function formatContext(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function formatPrice(p) {
  if (!p) return null;
  if (p.input === 0 && p.output === 0) return 'Gratis';
  const fmt = (v) => (v == null ? '?' : `$${v}`);
  return `${fmt(p.input)} masuk / ${fmt(p.output)} keluar per 1 juta token`;
}

export function capabilityWords(m) {
  const c = m.capabilities ?? {};
  const words = [];
  if (c.vision) words.push('vision', 'gambar');
  if (c.tools) words.push('tools');
  if (c.reasoning || m.reasoningEfforts) words.push('reasoning');
  if (c.coding) words.push('coding');
  return words;
}

// Indeks pencarian dibangun sekali per daftar model, lalu dipakai ulang di setiap ketikan.
export function buildIndex(models) {
  return models.map((model) => {
    const ctx = formatContext(model.contextLength);
    const hay = [
      model.name, model.id, model.vendor, model.ownedBy, model.provider,
      TIER_LABEL[model.accessTier], model.accessTier,
      ...capabilityWords(model),
      ctx ? `${ctx} context konteks` : '',
    ].filter(Boolean).join(' ').toLowerCase();
    return { model, hay };
  });
}

export function searchIndex(index, { query = '', filter = 'all' } = {}) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const { model, hay } of index) {
    if (filter !== 'all' && !matchesFilter(model, filter)) continue;
    if (tokens.every((t) => hay.includes(t))) out.push(model);
  }
  return out;
}

export function diffModels(prev = [], next = []) {
  const a = new Set(prev.map((m) => m.id));
  const b = new Set(next.map((m) => m.id));
  return {
    added: next.filter((m) => !a.has(m.id)).map((m) => m.id),
    removed: prev.filter((m) => !b.has(m.id)).map((m) => m.id),
  };
}

export function describeSync(prev, next, source) {
  if (source === 'stale') return 'Sinkronisasi gagal, memakai daftar model yang tersimpan.';
  if (source === 'fallback') return 'Katalog tidak terjangkau, memakai daftar sementara.';
  const { added, removed } = diffModels(prev, next);
  if (!prev.length) return `${next.length} model dimuat.`;
  const parts = [];
  if (added.length) parts.push(`${added.length} model baru`);
  if (removed.length) parts.push(`${removed.length} dihapus`);
  return `Sinkron selesai: ${next.length} model${parts.length ? `, ${parts.join(', ')}` : ', tidak ada perubahan'}.`;
}

// Pilihan awal saat belum ada model terpilih: default dari konfigurasi bila ada, lalu model gratis pertama.
export function pickDefaultModel(models, preferredId) {
  if (!models.length) return null;
  return (models.find((m) => m.id === preferredId) ?? models.find((m) => m.accessTier === 'free') ?? models[0]).id;
}

// Perkiraan kasar (4 karakter ≈ 1 token) hanya untuk indikator; hitungan resmi ada di provider.
export function estimateTokens(messages) {
  const chars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  return Math.ceil(chars / 4);
}

export function formatAge(ts, now = Date.now()) {
  if (!ts) return 'belum pernah';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'baru saja';
  if (s < 3600) return `${Math.round(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}
