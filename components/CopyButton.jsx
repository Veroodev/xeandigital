'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function CopyButton({ text, label = 'Salin', iconOnly = false, className = '' }) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    const ok = await copyText(text);
    setState(ok ? 'done' : 'fail');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  }

  const shown = state === 'done' ? 'Tersalin' : state === 'fail' ? 'Gagal menyalin' : label;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn ${state === 'done' ? 'btn-neon' : ''} ${className}`}
      aria-label={iconOnly ? label : undefined}
    >
      {state === 'done' ? <Check size={16} /> : <Copy size={16} />}
      {!iconOnly && <span>{shown}</span>}
      <span className="sr-only" role="status">{state === 'done' ? 'Tersalin ke papan klip' : ''}</span>
    </button>
  );
}
