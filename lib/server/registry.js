// Registry model per provider: cache memori dengan TTL, satu request upstream untuk banyak pemanggil
// (dedupe), stale-while-error, dan batas minimal antar sinkronisasi paksa.

const STORE = Symbol.for('xean.registry');
const store = (globalThis[STORE] ??= new Map());

export const MIN_FORCE_INTERVAL_MS = 10_000;
const HEALTH_TTL_MS = 30_000;

function entry(id) {
  if (!store.has(id)) store.set(id, { models: null, fetchedAt: 0, inflight: null, health: null, healthInflight: null });
  return store.get(id);
}

export function resetRegistry() {
  store.clear();
}

const snapshot = (e, ttlMs, source, extra = {}) => ({
  models: e.models,
  fetchedAt: e.fetchedAt || null,
  ttlSeconds: Math.round(ttlMs / 1000),
  source,
  ...extra,
});

/** Mengembalikan { models, fetchedAt, ttlSeconds, source: 'live' | 'cache' | 'stale' | 'fallback', error? } */
export async function getModels(provider, { force = false, now = Date.now } = {}) {
  const e = entry(provider.id);
  const ttl = provider.config.modelCacheTtlMs;
  const age = now() - e.fetchedAt;

  if (e.models && !force && age < ttl) return snapshot(e, ttl, 'cache');
  if (e.models && force && age < MIN_FORCE_INTERVAL_MS) return snapshot(e, ttl, 'cache'); // cegah spam tombol sinkron

  if (!e.inflight) {
    e.inflight = provider
      .fetchModels()
      .then((models) => {
        e.models = models;
        e.fetchedAt = now();
        return models;
      })
      .finally(() => {
        e.inflight = null;
      });
  }

  try {
    await e.inflight;
    return snapshot(e, ttl, 'live');
  } catch (err) {
    const error = { code: err.code ?? 'error', message: err.message };
    if (e.models) return snapshot(e, ttl, 'stale', { error });
    const fallback = provider.fallbackModels();
    if (fallback.length) return { models: fallback, fetchedAt: null, ttlSeconds: Math.round(ttl / 1000), source: 'fallback', error };
    throw err;
  }
}

/**
 * Mencari satu model. known=false berarti katalog tidak bisa dipastikan (fallback/gagal),
 * sehingga validasi "model tidak ada" dilewati dan keputusan diserahkan ke provider.
 */
export async function findModel(provider, modelId) {
  try {
    const out = await getModels(provider);
    const model = out.models.find((m) => m.id === modelId) ?? null;
    return { model, known: out.source !== 'fallback' };
  } catch {
    return { model: null, known: false };
  }
}

export async function getHealth(provider, { force = false, now = Date.now } = {}) {
  const e = entry(provider.id);
  const age = e.health ? now() - e.health.checkedAt : Infinity;
  if (e.health && (force ? age < 5000 : age < HEALTH_TTL_MS)) return e.health;

  if (!e.healthInflight) {
    e.healthInflight = provider
      .healthCheck()
      .then((result) => {
        e.health = { ...result, checkedAt: now() };
        return e.health;
      })
      .finally(() => {
        e.healthInflight = null;
      });
  }
  return e.healthInflight;
}
