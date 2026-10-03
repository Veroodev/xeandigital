'use client';

import { useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import CopyButton from './CopyButton';
import { TIER_LABEL, formatContext, formatPrice, reasoningLabel } from '@/lib/catalog.js';

const YES_NO = (v) => (v === true ? 'Ya' : v === false ? 'Tidak' : null);

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 border-b-2 border-black px-3 py-2 last:border-b-0">
      <dt className="text-xs font-bold">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium">
        {children ?? <span className="text-black/60">Tidak diberikan API</span>}
      </dd>
    </div>
  );
}

// Semua nilai berasal dari metadata API. Yang tidak ada ditampilkan apa adanya, tidak dikarang.
export default function ModelInfo({ model, modelId, providerLabel, missing, open, onOpenChange }) {
  const rootRef = useRef(null);
  const closeRef = useRef(onOpenChange);
  closeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) closeRef.current(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!modelId) return null;
  const caps = model?.capabilities ?? {};
  const efforts = model?.reasoningEfforts;

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="btn px-2" onClick={() => onOpenChange(!open)} aria-expanded={open} aria-label="Info model">
        <Info size={18} aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Info model"
          className="fixed inset-x-2 top-16 z-50 max-h-[80vh] overflow-y-auto border-4 border-black bg-white shadow-brutal-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[24rem]"
        >
          <div className="border-b-4 border-black bg-lemon px-3 py-2">
            <h2 className="break-words font-sans text-base font-black">{model?.name ?? modelId}</h2>
            {missing && <p className="mt-1 text-xs font-bold">Model ini tidak ada di katalog terbaru.</p>}
          </div>
          <dl>
            <Row label="Model ID">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{modelId}</span>
                <CopyButton text={modelId} label="Salin ID model" iconOnly className="btn-sm" />
              </span>
            </Row>
            <Row label="Provider">{providerLabel}</Row>
            <Row label="Vendor">{model?.vendor || model?.ownedBy || null}</Row>
            <Row label="Access tier">{model?.accessTier ? TIER_LABEL[model.accessTier] ?? model.accessTier : null}</Row>
            <Row label="Context">{model?.contextLength != null ? `${formatContext(model.contextLength)} (${model.contextLength.toLocaleString('id-ID')} token)` : null}</Row>
            <Row label="Max output">{model?.maxOutputTokens != null ? `${model.maxOutputTokens.toLocaleString('id-ID')} token` : null}</Row>
            <Row label="Vision">{YES_NO(caps.vision)}</Row>
            <Row label="Tools">{YES_NO(caps.tools)}</Row>
            <Row label="Reasoning">
              {efforts
                ? `Level: ${efforts.levels.map(reasoningLabel).join(', ')}${efforts.default ? ` (bawaan ${reasoningLabel(efforts.default)})` : ''}`
                : YES_NO(caps.reasoning)}
            </Row>
            <Row label="Harga">{formatPrice(model?.pricing)}</Row>
          </dl>
        </div>
      )}
    </div>
  );
}
