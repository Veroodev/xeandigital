// Normalisasi katalog model. Toleran: field baru/tak dikenal tidak membuat crash,
// dan field yang tidak diberikan API dibiarkan null (tidak dikarang).

const KNOWN_KEYS = new Set([
  'id', 'object', 'display_name', 'owned_by', 'access_tier', 'context_length',
  'max_output_tokens', 'pricing', 'capabilities', 'reasoning_efforts', 'modality',
]);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normalizePricing(p) {
  if (!isObj(p)) return null;
  const out = {
    currency: str(p.currency) ?? 'USD',
    unit: str(p.unit) ?? 'per_1m_tokens',
    input: num(p.input),
    output: num(p.output),
    cacheRead: num(p.cache_read),
    cacheWrite: num(p.cache_write),
  };
  return out.input == null && out.output == null ? null : out;
}

function normalizeEfforts(r) {
  if (!isObj(r) || !Array.isArray(r.levels)) return null;
  const levels = r.levels.filter((l) => typeof l === 'string' && l);
  if (!levels.length) return null;
  const def = typeof r.default === 'string' ? r.default : null;
  return { levels, default: def };
}

// "Coding" hanya muncul bila API memang menyediakannya (capabilities.coding atau tag/kategori).
function detectCoding(raw, caps) {
  if (typeof caps.coding === 'boolean') return caps.coding;
  for (const key of ['tags', 'categories', 'use_cases', 'tasks']) {
    const list = raw[key];
    if (Array.isArray(list) && list.some((t) => typeof t === 'string' && /^(coding|code|programming)$/i.test(t))) return true;
  }
  return null;
}

export function normalizeModel(raw, provider) {
  const r = isObj(raw) ? raw : {};
  const id = typeof raw === 'string' ? raw.trim() : str(r.id);
  if (!id) return null;

  const slash = id.indexOf('/');
  const caps = isObj(r.capabilities) ? r.capabilities : {};
  const boolCaps = Object.fromEntries(Object.entries(caps).filter(([, v]) => typeof v === 'boolean'));
  const efforts = normalizeEfforts(r.reasoning_efforts);
  const tier = typeof r.access_tier === 'string' ? r.access_tier.trim().toLowerCase() : null;

  const extra = {};
  for (const [k, v] of Object.entries(r)) if (!KNOWN_KEYS.has(k)) extra[k] = v;

  return {
    provider,
    id, // ID lengkap vendor/model, tidak pernah dipotong
    name: str(r.display_name) ?? (slash >= 0 ? id.slice(slash + 1) : id),
    vendor: slash > 0 ? id.slice(0, slash) : str(r.owned_by) ?? '',
    ownedBy: str(r.owned_by),
    accessTier: tier || null,
    contextLength: num(r.context_length),
    maxOutputTokens: num(r.max_output_tokens),
    pricing: normalizePricing(r.pricing),
    modality: str(r.modality),
    capabilities: {
      ...boolCaps,
      vision: typeof caps.vision === 'boolean' ? caps.vision : null,
      tools: typeof caps.tools === 'boolean' ? caps.tools : null,
      reasoning: typeof caps.reasoning === 'boolean' ? caps.reasoning : null,
      coding: detectCoding(r, caps),
    },
    reasoningEfforts: efforts,
    extra,
  };
}

export function normalizeModelList(json, provider) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const m = normalizeModel(item, provider);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
