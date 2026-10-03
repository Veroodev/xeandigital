import { envStr } from '../env.js';
import { createApmixProvider } from './apmix.js';
import { createXkiroProvider } from './xkiro.js';

// Provider Manager. Menambah provider baru = buat satu file provider lalu daftarkan di sini.
const FACTORIES = [createApmixProvider, createXkiroProvider];
let cache = null;

export function getProviders() {
  if (!cache) cache = new Map(FACTORIES.map((make) => { const p = make(); return [p.id, p]; }));
  return cache;
}

export function resetProviders() {
  cache = null;
}

export const getProvider = (id) => getProviders().get(id) ?? null;

export function defaultProviderId() {
  const wanted = envStr('DEFAULT_PROVIDER').toLowerCase();
  if (getProviders().has(wanted)) return wanted;
  for (const p of getProviders().values()) if (p.isConfigured()) return p.id;
  return 'xkiro';
}

export function listProviders() {
  const def = defaultProviderId();
  return [...getProviders().values()].map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    isDefault: p.id === def,
  }));
}
