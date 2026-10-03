'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Code2, Eye, RefreshCw, X } from 'lucide-react';
import CopyButton from './CopyButton';
import FileDownloader from './FileDownloader';
import Markdown from './Markdown';
import { FRAME_KINDS, buildPreviewDoc, isPreviewable } from '@/lib/artifacts';
import { highlight } from '@/lib/highlight';
import { parseCSV } from '@/lib/csv';

function useDebouncedValue(value, delay) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (!delay) {
      setV(value);
      return undefined;
    }
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function CsvTable({ text }) {
  const rows = useMemo(() => parseCSV(text), [text]);
  if (!rows.length) return <p className="p-4 text-sm font-medium">CSV masih kosong.</p>;
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} className="sticky top-0 border-2 border-black bg-aqua px-3 py-2 text-left font-extrabold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className={ri % 2 ? 'bg-cream' : 'bg-white'}>
              {head.map((_, ci) => (
                <td key={ci} className="border-2 border-black px-3 py-2 align-top">
                  {r[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ArtifactViewer({ artifacts, activeIndex, onSelect, onClose, streaming }) {
  const artifact = artifacts[activeIndex];
  const previewable = isPreviewable(artifact);
  const framed = FRAME_KINDS.includes(artifact.lang);

  const [mode, setMode] = useState('code');
  const [reloadKey, setReloadKey] = useState(0);

  // Saat AI masih menulis: tampilkan kode. Setelah selesai: pindah ke pratinjau bila tersedia.
  useEffect(() => {
    setMode(previewable && !streaming ? 'preview' : 'code');
  }, [artifact.id, streaming, previewable]);

  const deferredCode = useDeferredValue(artifact.code);
  const codeHtml = useMemo(
    () => (mode === 'code' ? highlight(deferredCode, artifact.hljsLang) : ''),
    [mode, deferredCode, artifact.hljsLang]
  );

  const doc = useMemo(
    () => (mode === 'preview' && framed ? buildPreviewDoc(artifact, artifacts) : ''),
    [mode, framed, artifact, artifacts]
  );
  const frameDoc = useDebouncedValue(doc, streaming ? 500 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-cream">
      <div className="flex flex-wrap items-center gap-2 border-b-4 border-black bg-lemon px-3 py-2.5">
        <div className="min-w-0 flex-1 basis-40">
          <h2 className="truncate font-sans text-base font-black">{artifact.filename}</h2>
          <p className="flex items-center gap-2 text-xs font-medium">
            <span>
              {artifact.label}, {artifact.lineCount} baris
            </span>
            {streaming && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 animate-blink bg-black" aria-hidden />
                sedang ditulis
              </span>
            )}
          </p>
        </div>

        {previewable && (
          <div role="group" aria-label="Mode tampilan" className="flex border-2 border-black bg-white shadow-brutal-sm">
            <button
              type="button"
              aria-pressed={mode === 'code'}
              onClick={() => setMode('code')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-bold ${
                mode === 'code' ? 'bg-black text-white' : 'hover:bg-aqua'
              }`}
            >
              <Code2 size={16} /> Kode
            </button>
            <button
              type="button"
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
              className={`inline-flex items-center gap-1.5 border-l-2 border-black px-2.5 py-1.5 text-sm font-bold ${
                mode === 'preview' ? 'bg-black text-white' : 'hover:bg-aqua'
              }`}
            >
              <Eye size={16} /> Pratinjau
            </button>
          </div>
        )}

        {mode === 'preview' && framed && (
          <button
            type="button"
            className="btn px-2"
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="Muat ulang pratinjau"
          >
            <RefreshCw size={16} />
          </button>
        )}

        <CopyButton text={artifact.code} />
        <FileDownloader artifact={artifact} siblings={artifacts} />
        <button type="button" className="btn btn-blaze px-2" onClick={onClose} aria-label="Tutup panel">
          <X size={16} />
        </button>
      </div>

      {artifacts.length > 1 && (
        <div role="tablist" aria-label="Berkas hasil" className="flex gap-2 overflow-x-auto border-b-4 border-black bg-white px-3 py-2">
          {artifacts.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              onClick={() => onSelect(i)}
              className={`shrink-0 border-2 border-black px-3 py-1 text-sm font-bold ${
                i === activeIndex ? 'bg-neon shadow-brutal-sm' : 'bg-white hover:bg-lemon'
              }`}
            >
              {a.filename}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 p-3 pr-4 pb-4">
        <div className="h-full overflow-auto border-2 border-black bg-white shadow-brutal">
          {mode === 'code' && (
            <pre className="min-h-full p-4 font-mono text-[13px] leading-relaxed">
              <code className="hljs" dangerouslySetInnerHTML={{ __html: codeHtml }} />
            </pre>
          )}

          {mode === 'preview' && framed && (
            <iframe
              key={reloadKey}
              title={`Pratinjau ${artifact.filename}`}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              referrerPolicy="no-referrer"
              srcDoc={frameDoc}
              className="block h-full w-full border-0 bg-white"
            />
          )}

          {mode === 'preview' && artifact.lang === 'md' && (
            <div className="p-5">
              <Markdown>{artifact.code}</Markdown>
            </div>
          )}

          {mode === 'preview' && artifact.lang === 'csv' && <CsvTable text={artifact.code} />}
        </div>
      </div>
    </div>
  );
}
