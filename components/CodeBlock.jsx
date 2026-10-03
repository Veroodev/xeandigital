'use client';

import { useMemo } from 'react';
import { FileCode2, PanelRightOpen } from 'lucide-react';
import CopyButton from './CopyButton';
import { highlight } from '@/lib/highlight';
import { isLargeBlock } from '@/lib/artifacts';

export default function CodeBlock({ block, active, onOpen }) {
  const large = isLargeBlock(block);
  const html = useMemo(
    () => (large ? '' : highlight(block.code, block.hljsLang)),
    [large, block.code, block.hljsLang]
  );

  if (large) {
    return (
      <div
        className={`flex items-center gap-3 border-2 border-black p-3 shadow-brutal-sm ${
          active ? 'bg-neon' : 'bg-lemon'
        }`}
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center border-2 border-black bg-white" aria-hidden>
          <FileCode2 size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{block.filename}</p>
          <p className="text-xs font-medium">
            {block.label}, {block.lineCount} baris{block.closed ? '' : ', sedang ditulis'}
          </p>
        </div>
        <button type="button" className="btn" onClick={onOpen}>
          <PanelRightOpen size={16} />
          Buka
        </button>
        <CopyButton text={block.code} label="Salin kode" iconOnly />
      </div>
    );
  }

  return (
    <figure className="border-2 border-black bg-white shadow-brutal-sm">
      <figcaption className="flex items-center gap-2 border-b-2 border-black bg-lemon px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold">
          {block.named ? block.filename : block.label}
        </span>
        <CopyButton text={block.code} className="btn-sm" />
        <button type="button" className="btn btn-sm" onClick={onOpen} aria-label="Buka di panel">
          <PanelRightOpen size={14} />
        </button>
      </figcaption>
      <pre className="max-h-96 overflow-auto p-3 font-mono text-[13px] leading-relaxed">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </figure>
  );
}
