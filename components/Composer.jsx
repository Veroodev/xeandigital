'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal, Square } from 'lucide-react';

export default function Composer({ onSend, onStop, streaming, toolbar = null }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 224)}px`;
  }, [value]);

  function submit() {
    if (!value.trim() || streaming) return;
    onSend(value);
    setValue('');
  }

  return (
    <div className="border-t-4 border-black bg-cream p-3 sm:p-4">
      {toolbar}
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Tulis perintah, mis. buat kalkulator dengan HTML"
          aria-label="Pesan untuk AI"
          className="max-h-56 min-h-[52px] flex-1 resize-none border-2 border-black bg-white px-4 py-3 font-mono text-sm shadow-brutal placeholder:text-black/50"
        />
        {streaming ? (
          <button type="button" className="btn btn-blaze h-[52px] px-4" onClick={onStop}>
            <Square size={16} fill="currentColor" />
            Berhenti
          </button>
        ) : (
          <button type="button" className="btn btn-lemon h-[52px] px-4" onClick={submit} disabled={!value.trim()}>
            <SendHorizontal size={18} />
            Kirim
          </button>
        )}
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-xs font-medium">Enter untuk kirim, Shift+Enter untuk baris baru.</p>
    </div>
  );
}
