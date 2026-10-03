'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Search } from 'lucide-react';
import {
  FILTERS, TIER_LABEL, buildIndex, capabilityWords, formatAge, formatContext, hasCodingMetadata, searchIndex,
} from '@/lib/catalog.js';

const PAGE = 80;

function TierBadge({ tier }) {
  if (!tier) return null;
  const tone = tier === 'free' ? 'bg-neon' : tier === 'premium' ? 'bg-blaze' : 'bg-aqua';
  return (
    <span className={`shrink-0 border-2 border-black px-1.5 py-0.5 text-[11px] font-extrabold leading-none ${tone}`}>
      {TIER_LABEL[tier] ?? tier}
    </span>
  );
}

function Chip({ children }) {
  return <span className="border border-black bg-white px-1.5 py-0.5 text-[11px] font-bold leading-none">{children}</span>;
}

function HealthDot({ health }) {
  const tone = !health ? 'bg-lemon' : health.online ? 'bg-neon' : 'bg-blaze';
  const text = !health ? 'memeriksa' : health.online ? 'online' : 'offline';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 border border-black ${tone}`} aria-hidden />
      <span>{text}</span>
    </span>
  );
}

const CAP_LABEL = { vision: 'Vision', tools: 'Tools', reasoning: 'Reasoning', coding: 'Coding' };

export default function ModelSelector({ catalogState, open, onOpenChange }) {
  const {
    providers, providerId, providerInfo, catalog, modelId, selectedModel, modelMissing,
    health, notice, selectProvider, selectModel, sync,
  } = catalogState;

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [active, setActive] = useState(0);

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const closeRef = useRef(onOpenChange);
  closeRef.current = onOpenChange;

  // Pencarian memakai data cache di memori; tidak ada request API saat mengetik.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    setLimit(PAGE);
    setActive(0);
  }, [debounced, filter, providerId]);

  const index = useMemo(() => buildIndex(catalog.models), [catalog.models]);
  const results = useMemo(() => searchIndex(index, { query: debounced, filter }), [index, debounced, filter]);
  const codingAvailable = useMemo(() => hasCodingMetadata(catalog.models), [catalog.models]);
  const visible = results.slice(0, limit);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) closeRef.current(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function pick(m) {
    selectModel(m.id);
    setQuery('');
    onOpenChange(false);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(visible.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible[active]) pick(visible[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); // menandai bahwa Escape sudah dipakai (panel artifact tidak ikut tertutup)
      onOpenChange(false);
    }
  }

  const triggerLabel = selectedModel?.name ?? modelId ?? (catalog.loading ? 'Memuat model...' : 'Pilih model');
  const label = providerInfo?.label ?? 'Provider';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`btn max-w-[11rem] sm:max-w-[18rem] ${modelMissing ? 'btn-blaze' : 'btn-aqua'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {health && <span className={`inline-block h-2.5 w-2.5 shrink-0 border border-black ${health.online ? 'bg-neon' : 'bg-blaze'}`} aria-hidden />}
        <span className="min-w-0 truncate">{triggerLabel}</span>
        {modelMissing && <span className="sr-only">tidak tersedia di katalog</span>}
        <ChevronDown size={16} className="shrink-0" aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => onOpenChange(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="Pilih model"
            className="fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col border-4 border-black bg-cream shadow-brutal-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-3 sm:h-[34rem] sm:max-h-[78vh] sm:w-[36rem]"
          >
            {providers.length > 1 && (
              <div role="tablist" aria-label="Provider" className="flex gap-2 overflow-x-auto border-b-2 border-black bg-lemon px-3 py-2">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={p.id === providerId}
                    onClick={() => selectProvider(p.id)}
                    className={`btn btn-sm shrink-0 ${p.id === providerId ? '!bg-black !text-white' : ''}`}
                  >
                    {p.label}
                    {!p.configured && <span className="text-[10px] font-medium">(tanpa key)</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="border-b-2 border-black bg-white p-3">
              <label className="relative block">
                <span className="sr-only">Cari model</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Cari model, ID, vendor, vision, 1m context..."
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="model-listbox"
                  aria-activedescendant={visible[active] ? `model-opt-${active}` : undefined}
                  className="w-full border-2 border-black bg-cream py-2 pl-9 pr-3 font-mono text-sm"
                />
              </label>
              <div role="group" aria-label="Filter model" className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {FILTERS.map((f) => {
                  const disabled = f.id === 'coding' && !codingAvailable;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={filter === f.id}
                      disabled={disabled}
                      title={disabled ? 'API provider belum menyediakan metadata coding' : undefined}
                      onClick={() => setFilter(f.id)}
                      className={`btn btn-sm shrink-0 ${filter === f.id ? '!bg-black !text-white' : ''}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 border-b-2 border-black bg-white px-3 py-2 text-xs font-bold">
              <span className="shrink-0">
                {label}: <HealthDot health={health} />
              </span>
              <span className="min-w-0 flex-1 truncate text-right font-medium">
                {results.length} dari {catalog.models.length} model, sinkron {formatAge(catalog.fetchedAt)}
              </span>
              <button type="button" className="btn btn-sm btn-lemon shrink-0" onClick={sync} disabled={catalog.loading}>
                <RefreshCw size={14} className={catalog.loading ? 'animate-spin' : ''} aria-hidden />
                Sync
              </button>
            </div>

            <div aria-live="polite">
              {notice && <p className="border-b-2 border-black bg-neon px-3 py-1.5 text-xs font-bold">{notice}</p>}
              {catalog.error && catalog.models.length > 0 && (
                <p className="border-b-2 border-black bg-blaze px-3 py-1.5 text-xs font-bold">{catalog.error}</p>
              )}
              {modelMissing && (
                <p className="border-b-2 border-black bg-blaze px-3 py-1.5 text-xs font-bold">
                  Model terpilih ({modelId}) sudah tidak ada di katalog. Pilih model lain.
                </p>
              )}
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-3">
              {catalog.models.length === 0 && (
                <div className="border-2 border-dashed border-black p-4 text-sm font-medium">
                  {catalog.loading ? (
                    'Memuat daftar model...'
                  ) : (
                    <>
                      <p className="font-bold">{catalog.error || 'Belum ada model.'}</p>
                      <button type="button" className="btn btn-sm btn-lemon mt-3" onClick={sync}>
                        <RefreshCw size={14} aria-hidden /> Coba lagi
                      </button>
                    </>
                  )}
                </div>
              )}

              {catalog.models.length > 0 && results.length === 0 && (
                <p className="border-2 border-dashed border-black p-4 text-sm font-medium">
                  Tidak ada model yang cocok. Ubah kata kunci atau pilih filter Semua.
                </p>
              )}

              <ul id="model-listbox" role="listbox" aria-label="Daftar model" className="space-y-3">
                {visible.map((m, i) => {
                  const selected = m.id === modelId;
                  const ctx = formatContext(m.contextLength);
                  return (
                    <li key={m.id} role="option" id={`model-opt-${i}`} data-idx={i} aria-selected={selected}>
                      <button
                        type="button"
                        onClick={() => pick(m)}
                        onMouseEnter={() => setActive(i)}
                        className={`block w-full border-2 border-black p-3 text-left transition-colors ${
                          selected ? 'bg-neon shadow-brutal-sm' : i === active ? 'bg-lemon' : 'bg-white'
                        }`}
                      >
                        <span className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 break-words font-sans text-[15px] font-extrabold">{m.name}</span>
                          <TierBadge tier={m.accessTier} />
                        </span>
                        <span className="mt-0.5 block break-all font-mono text-xs">{m.id}</span>
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {ctx && <Chip>{ctx} context</Chip>}
                          {['vision', 'tools', 'reasoning', 'coding']
                            .filter((w) => capabilityWords(m).includes(w))
                            .map((w) => (
                              <Chip key={w}>{CAP_LABEL[w]}</Chip>
                            ))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {results.length > visible.length && (
                <button type="button" className="btn mt-3 w-full" onClick={() => setLimit((n) => n + PAGE)}>
                  Tampilkan {Math.min(PAGE, results.length - visible.length)} lagi ({results.length - visible.length} tersisa)
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
