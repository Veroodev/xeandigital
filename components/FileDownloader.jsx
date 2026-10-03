'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { downloadText, downloadZip } from '@/lib/download';

const base = (f) => f.split('/').pop();
const stem = (f) => base(f).replace(/\.[^.]+$/, '');

function asMarkdown(artifact) {
  let fence = '```';
  while (artifact.code.includes(fence)) fence += '`';
  return `${fence}${artifact.lang}\n${artifact.code}\n${fence}\n`;
}

export default function FileDownloader({ artifact, siblings = [] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); // memberi tahu handler Escape lain bahwa ini sudah ditangani
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = base(artifact.filename);
  const bom = artifact.ext === 'csv' ? '\uFEFF' : ''; // agar Excel membaca UTF-8 dengan benar

  const items = [
    {
      key: 'asli',
      label: `Berkas asli: ${name}`,
      run: () => downloadText(name, bom + artifact.code, artifact.mime),
    },
  ];
  if (artifact.ext !== 'txt') {
    items.push({
      key: 'txt',
      label: `Teks biasa: ${stem(name)}.txt`,
      run: () => downloadText(`${stem(name)}.txt`, artifact.code, 'text/plain'),
    });
  }
  if (artifact.ext !== 'md') {
    items.push({
      key: 'md',
      label: `Markdown: ${stem(name)}.md`,
      run: () => downloadText(`${stem(name)}.md`, asMarkdown(artifact), 'text/markdown'),
    });
  }
  items.push({
    key: 'zip',
    label: `Arsip zip: ${stem(name)}.zip`,
    run: () => downloadZip([artifact], `${stem(name)}.zip`),
  });
  if (siblings.length > 1) {
    items.push({
      key: 'semua',
      label: `Semua berkas (${siblings.length}) dalam satu zip`,
      run: () => downloadZip(siblings, 'xean-digital-ai-berkas.zip'),
    });
  }

  async function run(item) {
    setBusy(true);
    try {
      await item.run();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn btn-neon"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={!artifact.code || busy}
      >
        <Download size={16} />
        Unduh
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[85vw] border-2 border-black bg-white shadow-brutal"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => run(item)}
              className="block w-full truncate border-b-2 border-black px-3 py-2 text-left text-sm font-bold last:border-b-0 hover:bg-lemon"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
