'use client';

import { formatContext, reasoningLabel } from '@/lib/catalog.js';

function ContextMeter({ used, total }) {
  const ratio = Math.min(1, used / total);
  const tone = ratio > 0.85 ? 'bg-blaze' : ratio > 0.6 ? 'bg-lemon' : 'bg-neon';
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs font-bold">
      <span className="shrink-0">Konteks</span>
      <div
        className="h-3 w-24 shrink-0 border-2 border-black bg-white"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="Perkiraan pemakaian jendela konteks"
      >
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
      </div>
      <span className="truncate font-medium">
        ~{formatContext(used) ?? used} / {formatContext(total)}
        {ratio > 0.85 && ', hampir penuh'}
      </span>
    </div>
  );
}

// Selector reasoning hanya menampilkan level yang benar-benar diberikan metadata model.
// "Bawaan" = parameter tidak dikirim, sehingga model memakai default-nya sendiri.
export default function ComposerToolbar({ model, reasoningEffort, onReasoningChange, estimatedTokens }) {
  const efforts = model?.reasoningEfforts;
  const showMeter = model?.contextLength && estimatedTokens > 0;
  if (!efforts && !showMeter) return null;

  return (
    <div className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2">
      {efforts && (
        <div role="group" aria-label="Reasoning" className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-bold">Reasoning</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[{ value: '', label: 'Bawaan' }, ...efforts.levels.map((l) => ({ value: l, label: reasoningLabel(l) }))].map((o) => (
              <button
                key={o.value || 'default'}
                type="button"
                aria-pressed={reasoningEffort === o.value}
                title={o.value === '' && efforts.default ? `Bawaan model: ${reasoningLabel(efforts.default)}` : undefined}
                onClick={() => onReasoningChange(o.value)}
                className={`btn btn-sm shrink-0 ${reasoningEffort === o.value ? '!bg-black !text-white' : ''}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {showMeter && <ContextMeter used={estimatedTokens} total={model.contextLength} />}
    </div>
  );
}
