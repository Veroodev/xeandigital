'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeSync, pickDefaultModel } from '@/lib/catalog.js';
import { isExpired, loadCatalog, loadSelection, saveCatalog, saveSelection } from '@/lib/catalog-cache.js';

// Hook katalog: provider, daftar model (cache + sinkron), model terpilih, dan status health.
// Daftar model TIDAK diambil ulang saat dropdown dibuka; hanya saat pertama kali, cache kedaluwarsa,
// sinkron manual, atau pemuatan sebelumnya gagal.
export function useCatalog() {
  const [providers, setProviders] = useState([]);
  const [selection, setSelection] = useState({ providerId: null, models: {} });
  const [catalogs, setCatalogs] = useState({});
  const [health, setHealth] = useState({});
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);

  const catalogsRef = useRef({});
  const inflight = useRef(new Map());
  const alive = useRef(true);

  const commit = useCallback((providerId, patch) => {
    const next = { ...catalogsRef.current, [providerId]: { ...(catalogsRef.current[providerId] ?? { models: [] }), ...patch } };
    catalogsRef.current = next;
    if (alive.current) setCatalogs(next);
  }, []);

  const loadModels = useCallback(async (providerId, { force = false } = {}) => {
    const existing = catalogsRef.current[providerId];
    if (!force && existing?.models?.length && !isExpired(existing)) return;
    if (inflight.current.has(providerId)) return inflight.current.get(providerId);

    const job = (async () => {
      commit(providerId, { loading: true, error: null });
      try {
        const res = await fetch(`/api/models?provider=${encodeURIComponent(providerId)}${force ? '&refresh=1' : ''}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.models) throw new Error(data?.error?.message || `Gagal memuat daftar model (${res.status}).`);

        const prev = catalogsRef.current[providerId]?.models ?? [];
        const next = {
          models: data.models,
          fetchedAt: data.fetchedAt ?? null,
          ttlSeconds: data.ttlSeconds ?? 300,
          source: data.source,
          defaultModel: data.defaultModel ?? null,
          loading: false,
          error: data.error?.message ?? null,
        };
        commit(providerId, next);
        if (data.source !== 'fallback') saveCatalog(providerId, next);
        if (force && alive.current) setNotice(describeSync(prev, data.models, data.source));
      } catch (err) {
        commit(providerId, { loading: false, error: err.message || 'Gagal memuat daftar model.' });
      } finally {
        inflight.current.delete(providerId);
      }
    })();
    inflight.current.set(providerId, job);
    return job;
  }, [commit]);

  const loadHealth = useCallback(async (providerId, force = false) => {
    try {
      const res = await fetch(`/api/health?provider=${encodeURIComponent(providerId)}${force ? '&refresh=1' : ''}`);
      const data = await res.json();
      if (alive.current && res.ok) setHealth((h) => ({ ...h, [providerId]: data }));
    } catch {
      if (alive.current) setHealth((h) => ({ ...h, [providerId]: { online: false } }));
    }
  }, []);

  const prepareProvider = useCallback((providerId) => {
    if (!catalogsRef.current[providerId]) {
      const cached = loadCatalog(providerId);
      if (cached) commit(providerId, { ...cached, loading: false, error: null });
    }
    loadModels(providerId);
    loadHealth(providerId);
  }, [commit, loadModels, loadHealth]);

  // Inisialisasi: daftar provider, pilihan tersimpan, cache lokal.
  useEffect(() => {
    alive.current = true;
    (async () => {
      const stored = loadSelection();
      let list = [];
      let def = null;
      try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        list = data.providers ?? [];
        def = data.default ?? null;
      } catch {
        /* server belum siap: pakai pilihan tersimpan */
      }
      if (!alive.current) return;
      const providerId = list.find((p) => p.id === stored.providerId)?.id ?? def ?? stored.providerId ?? 'xkiro';
      setProviders(list);
      setSelection({ providerId, models: stored.models });
      prepareProvider(providerId);
      setReady(true);
    })();
    return () => {
      alive.current = false;
    };
  }, [prepareProvider]);

  const providerId = selection.providerId;
  const catalog = catalogs[providerId] ?? { models: [], loading: false, error: null };
  const modelId = selection.models[providerId] ?? null;

  // Belum ada model terpilih untuk provider ini: pilih default. Pilihan yang sudah ada tidak pernah diganti otomatis.
  useEffect(() => {
    if (!providerId || modelId || !catalog.models.length) return;
    const id = pickDefaultModel(catalog.models, catalog.defaultModel);
    if (id) setSelection((s) => ({ ...s, models: { ...s.models, [providerId]: id } }));
  }, [providerId, modelId, catalog.models, catalog.defaultModel]);

  useEffect(() => {
    if (ready) saveSelection(selection);
  }, [selection, ready]);

  const selectProvider = useCallback((id) => {
    setSelection((s) => ({ ...s, providerId: id }));
    setNotice('');
    prepareProvider(id);
  }, [prepareProvider]);

  const selectModel = useCallback((id) => {
    setSelection((s) => ({ ...s, models: { ...s.models, [s.providerId]: id } }));
  }, []);

  const sync = useCallback(async () => {
    if (!providerId) return;
    await loadModels(providerId, { force: true });
    loadHealth(providerId, true);
  }, [providerId, loadModels, loadHealth]);

  const selectedModel = useMemo(() => catalog.models.find((m) => m.id === modelId) ?? null, [catalog.models, modelId]);
  const modelMissing = Boolean(modelId) && catalog.models.length > 0 && catalog.source !== 'fallback' && !selectedModel;
  const providerInfo = providers.find((p) => p.id === providerId) ?? null;

  return {
    ready, providers, providerId, providerInfo, catalog, modelId, selectedModel, modelMissing,
    health: health[providerId] ?? null, notice, clearNotice: () => setNotice(''),
    selectProvider, selectModel, sync,
    refreshHealth: () => providerId && loadHealth(providerId, true),
  };
}
