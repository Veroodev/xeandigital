// Cache katalog di browser (localStorage) supaya pemuatan ulang halaman tidak memanggil API lagi
// selama TTL belum habis. TTL berasal dari server (ttlSeconds), yang diatur lewat environment.

const catalogKey = (provider) => `xean-digital-ai:catalog:v1:${provider}`;
const SELECTION_KEY = 'xean-digital-ai:selection:v1';

export function loadCatalog(provider) {
  try {
    const raw = localStorage.getItem(catalogKey(provider));
    const v = raw ? JSON.parse(raw) : null;
    return v && Array.isArray(v.models) ? v : null;
  } catch {
    return null;
  }
}

export function saveCatalog(provider, data) {
  try {
    const { models, fetchedAt, ttlSeconds, defaultModel, source } = data;
    localStorage.setItem(catalogKey(provider), JSON.stringify({ models, fetchedAt, ttlSeconds, defaultModel, source }));
  } catch {
    /* kuota penuh atau diblokir: abaikan */
  }
}

export const isExpired = (c, now = Date.now()) => !c?.fetchedAt || now - c.fetchedAt > (c.ttlSeconds ?? 300) * 1000;

export function loadSelection() {
  try {
    const v = JSON.parse(localStorage.getItem(SELECTION_KEY) || 'null');
    return v && typeof v === 'object' ? { providerId: v.providerId ?? null, models: v.models ?? {} } : { providerId: null, models: {} };
  } catch {
    return { providerId: null, models: {} };
  }
}

export function saveSelection(sel) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    /* abaikan */
  }
}
