'use client';

import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import MessageContent from './MessageContent';

const STARTERS = [
  { text: 'Buat landing page toko kopi dalam satu berkas HTML dengan animasi scroll', tone: 'bg-lemon' },
  { text: 'Tulis skrip Python untuk merapikan file CSV dan menghapus baris duplikat', tone: 'bg-neon' },
  { text: 'Bandingkan React, Vue, dan Svelte dalam sebuah tabel', tone: 'bg-aqua' },
  { text: 'Bikin kalkulator cicilan interaktif dengan HTML, CSS, dan JavaScript', tone: 'bg-blaze' },
];

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 py-1" role="status">
      <span className="sr-only">Menunggu respons</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-3 w-3 animate-hop border-2 border-black bg-lemon"
          style={{ animationDelay: `${i * 120}ms` }}
          aria-hidden
        />
      ))}
    </div>
  );
}

function Reasoning({ text, live }) {
  return (
    <details open={live} className="mb-3 border-2 border-black bg-cream">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-sm font-bold">
        {live ? 'Sedang berpikir...' : 'Proses berpikir'}
      </summary>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t-2 border-black px-3 py-2 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    </details>
  );
}

function Meta({ meta }) {
  const parts = [meta.model];
  if (meta.usage?.totalTokens != null) parts.push(`${meta.usage.totalTokens} token`);
  if (meta.durationMs) parts.push(`${(meta.durationMs / 1000).toFixed(1).replace('.', ',')} dtk`);
  return <p className="mt-3 break-all border-t-2 border-black pt-2 font-mono text-[11px] font-medium">{parts.join(', ')}</p>;
}

export default function MessageList({ messages, streaming, activeArtifactId, onOpenArtifact, onPrompt }) {
  const scroller = useRef(null);
  const endRef = useRef(null);
  const stick = useRef(true);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-sans text-4xl font-black leading-tight sm:text-5xl">Mau bangun apa hari ini?</h2>
          <p className="mt-3 max-w-xl text-base font-medium">
            Kode dan berkas yang dibuat AI muncul di panel sebelah kanan, siap dipratinjau, disalin, dan diunduh.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s.text}
                type="button"
                onClick={() => onPrompt(s.text)}
                className={`btn !items-start !justify-start !px-4 !py-4 text-left text-[15px] shadow-brutal ${s.tone}`}
              >
                {s.text}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          if (m.role === 'user') {
            return (
              <li key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words border-2 border-black bg-aqua px-4 py-3 text-[15px] font-medium shadow-brutal">
                  {m.content}
                </div>
              </li>
            );
          }
          return (
            <li key={m.id} className="flex gap-3">
              <div
                className="mt-1 grid h-9 w-9 shrink-0 place-items-center border-2 border-black bg-blaze shadow-brutal-sm"
                aria-hidden
              >
                <Sparkles size={18} />
              </div>
              <div className="min-w-0 flex-1 border-2 border-black bg-white px-4 py-3 shadow-brutal">
                {m.reasoning && <Reasoning text={m.reasoning} live={streaming && isLast && !m.content} />}
                {m.content ? (
                  <>
                    <MessageContent
                      messageId={m.id}
                      content={m.content}
                      activeArtifactId={activeArtifactId}
                      onOpenArtifact={onOpenArtifact}
                    />
                    {streaming && isLast && (
                      <span className="mt-2 inline-block h-4 w-2 animate-blink bg-black align-middle" aria-hidden />
                    )}
                  </>
                ) : (
                  streaming && isLast && <Thinking />
                )}
                {m.incomplete && (
                  <p className="mt-3 border-2 border-black bg-blaze px-3 py-1.5 text-sm font-bold">
                    Jawaban terpotong sebelum selesai.
                  </p>
                )}
                {m.meta && !(streaming && isLast) && <Meta meta={m.meta} />}
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
