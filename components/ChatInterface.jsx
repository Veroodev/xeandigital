'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, RotateCcw, X } from 'lucide-react';
import Sidebar from './Sidebar';
import MessageList from './MessageList';
import Composer from './Composer';
import ComposerToolbar from './ComposerToolbar';
import ArtifactViewer from './ArtifactViewer';
import ModelSelector from './ModelSelector';
import ModelInfo from './ModelInfo';
import { extractArtifacts, isLargeBlock } from '@/lib/artifacts';
import { estimateTokens } from '@/lib/catalog.js';
import { ChatError, streamChat } from '@/lib/stream';
import { loadThreads, saveThreads } from '@/lib/storage';
import { useCatalog } from '@/lib/useCatalog';
import { makeTitle, uid } from '@/lib/utils';

export default function ChatInterface() {
  const catalogState = useCatalog();
  const { ready, providerId, providerInfo, modelId, selectedModel, modelMissing } = catalogState;

  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null); // { message, code, retryable }
  const [artifactRef, setArtifactRef] = useState(null); // { messageId, index }
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState('');

  const abortRef = useRef(null);
  const sendLock = useRef(false); // mencegah kirim ganda (klik/Enter berulang)
  const autoOpened = useRef(new Set());

  // Muat riwayat
  useEffect(() => {
    const saved = loadThreads();
    setThreads(saved);
    setActiveId(saved[0]?.id ?? null);
    setHydrated(true);
  }, []);

  // Bersihkan koneksi saat komponen dilepas
  useEffect(() => () => abortRef.current?.abort(), []);

  // Simpan riwayat (ditunda saat streaming agar tidak menulis setiap token)
  useEffect(() => {
    if (!hydrated) return undefined;
    const t = setTimeout(() => saveThreads(threads), streaming ? 800 : 0);
    return () => clearTimeout(t);
  }, [threads, hydrated, streaming]);

  // Level reasoning hanya berlaku bila model terpilih mendeklarasikannya
  useEffect(() => {
    const levels = selectedModel?.reasoningEfforts?.levels;
    if (reasoningEffort && !levels?.includes(reasoningEffort)) setReasoningEffort('');
  }, [selectedModel, reasoningEffort]);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeId) || null, [threads, activeId]);

  // Artifact yang dibuka dihitung ulang dari isi pesan agar ikut update saat streaming
  const artifactState = useMemo(() => {
    if (!artifactRef || !activeThread) return null;
    const idx = activeThread.messages.findIndex((m) => m.id === artifactRef.messageId);
    if (idx < 0) return null;
    const msg = activeThread.messages[idx];
    const blocks = extractArtifacts(msg.content).map((b) => ({ ...b, id: `${msg.id}:${b.index}` }));
    if (!blocks.length) return null;
    return {
      messageId: msg.id,
      blocks,
      index: Math.min(artifactRef.index, blocks.length - 1),
      streaming: streaming && idx === activeThread.messages.length - 1,
    };
  }, [artifactRef, activeThread, streaming]);

  const panelOpen = Boolean(artifactState);
  const activeArtifactId = artifactState ? `${artifactState.messageId}:${artifactState.index}` : null;

  useEffect(() => {
    if (!streaming || !activeThread) return;
    const last = activeThread.messages[activeThread.messages.length - 1];
    if (!last || last.role !== 'assistant' || autoOpened.current.has(last.id)) return;
    const idx = extractArtifacts(last.content).findIndex((b) => isLargeBlock(b));
    if (idx >= 0) {
      autoOpened.current.add(last.id);
      setArtifactRef({ messageId: last.id, index: idx });
    }
  }, [activeThread, streaming]);

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setArtifactRef(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const updateThread = (id, fn) => setThreads((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

  function stop() {
    abortRef.current?.abort();
  }

  // Pemeriksaan sebelum request. Model tidak pernah diganti diam-diam oleh aplikasi.
  function precheck() {
    if (!modelId) return { message: ready ? 'Pilih model terlebih dahulu.' : 'Daftar model masih dimuat. Coba lagi sebentar.', code: 'no_model' };
    if (modelMissing) {
      return { message: 'Model terpilih sudah tidak ada di katalog terbaru. Pilih model lain atau sinkronkan daftar model.', code: 'model_not_found' };
    }
    return null;
  }

  async function runCompletion(threadId, history, botId) {
    const controller = new AbortController();
    abortRef.current = controller;
    sendLock.current = true;
    setStreaming(true);
    setError(null);

    const started = Date.now();
    const target = { providerId, modelId };
    const effort = reasoningEffort && selectedModel?.reasoningEfforts?.levels?.includes(reasoningEffort) ? reasoningEffort : '';
    let pendingText = '';
    let pendingReasoning = '';
    let timer = null;
    let usage = null;
    let finishReason = null;
    let failed = null;

    const patchBot = (fn) =>
      updateThread(threadId, (t) => ({ ...t, messages: t.messages.map((m) => (m.id === botId ? fn(m) : m)) }));
    // Token digabung dalam jeda singkat agar render tetap ringan
    const flush = () => {
      timer = null;
      if (!pendingText && !pendingReasoning) return;
      const text = pendingText;
      const reasoning = pendingReasoning;
      pendingText = '';
      pendingReasoning = '';
      patchBot((m) => ({ ...m, content: m.content + text, reasoning: (m.reasoning ?? '') + reasoning }));
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, 40);
    };

    try {
      await streamChat({
        provider: target.providerId,
        model: target.modelId,
        reasoningEffort: effort,
        messages: history.map(({ role, content }) => ({ role, content })),
        signal: controller.signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') {
            pendingText += ev.text;
            schedule();
          } else if (ev.type === 'reasoning') {
            pendingReasoning += ev.text;
            schedule();
          } else if (ev.type === 'usage') {
            usage = ev;
          } else if (ev.type === 'done') {
            finishReason = ev.finishReason;
            usage = ev.usage ?? usage;
          }
        },
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        failed = err instanceof ChatError ? err : new ChatError({ message: err?.message || 'Terjadi kesalahan.', code: 'error' });
      }
    } finally {
      if (timer) clearTimeout(timer);
      flush();
      patchBot((m) => ({
        ...m,
        meta: { provider: target.providerId, model: target.modelId, usage, finishReason, durationMs: Date.now() - started },
        ...(failed && m.content ? { incomplete: true } : {}), // teks parsial tetap ditampilkan
      }));
      // Buang balasan yang benar-benar kosong (galat/dibatalkan sebelum token pertama)
      updateThread(threadId, (t) => ({ ...t, messages: t.messages.filter((m) => m.id !== botId || m.content.trim()) }));
      if (failed) {
        setError({ message: failed.message, code: failed.code, retryable: failed.retryable });
        if (failed.retryable || failed.status >= 500) catalogState.refreshHealth();
      }
      abortRef.current = null;
      sendLock.current = false;
      setStreaming(false);
    }
  }

  async function handleSend(text) {
    const content = text.trim();
    if (!content || streaming || sendLock.current) return;
    const problem = precheck();
    if (problem) {
      setError(problem);
      return;
    }
    sendLock.current = true;

    const userMsg = { id: uid(), role: 'user', content };
    const botMsg = { id: uid(), role: 'assistant', content: '' };
    let threadId = activeId;
    let history;
    const existing = threads.find((t) => t.id === threadId);

    if (existing) {
      history = [...existing.messages, userMsg];
      updateThread(threadId, (t) => ({ ...t, messages: [...t.messages, userMsg, botMsg], updatedAt: Date.now() }));
    } else {
      threadId = uid();
      history = [userMsg];
      const created = { id: threadId, title: makeTitle(content), messages: [userMsg, botMsg], updatedAt: Date.now() };
      setThreads((prev) => [created, ...prev]);
      setActiveId(threadId);
    }
    await runCompletion(threadId, history, botMsg.id);
  }

  // Ulangi dari pesan pengguna terakhir (mis. setelah 429/503 atau jawaban terpotong)
  async function handleRetry() {
    if (streaming || sendLock.current || !activeThread) return;
    const problem = precheck();
    if (problem) {
      setError(problem);
      return;
    }
    const msgs = activeThread.messages;
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return;
    sendLock.current = true;
    const history = msgs.slice(0, lastUser + 1);
    const botMsg = { id: uid(), role: 'assistant', content: '' };
    updateThread(activeThread.id, (t) => ({ ...t, messages: [...history, botMsg] }));
    await runCompletion(activeThread.id, history, botMsg.id);
  }

  function resetView() {
    stop();
    setArtifactRef(null);
    setSidebarOpen(false);
    setError(null);
  }

  function handleNew() {
    resetView();
    setActiveId(null);
  }

  function handleSelect(id) {
    resetView();
    setActiveId(id);
  }

  function handleDelete(id) {
    const target = threads.find((t) => t.id === id);
    if (!target || !window.confirm(`Hapus percakapan "${target.title}"?`)) return;
    if (id === activeId) {
      resetView();
      const next = threads.find((t) => t.id !== id);
      setActiveId(next?.id ?? null);
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
  }

  const docked = !panelOpen;
  const lastMsg = activeThread?.messages[activeThread.messages.length - 1];
  const canRetry = !streaming && Boolean(lastMsg) && (lastMsg.role === 'user' || Boolean(lastMsg.incomplete));

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-cream">
      <Sidebar
        threads={threads}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        docked={docked}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b-4 border-black bg-white px-4 py-3 sm:gap-3">
          <button
            type="button"
            className={`btn px-2 ${docked ? 'lg:hidden' : '2xl:hidden'}`}
            onClick={() => setSidebarOpen(true)}
            aria-label="Buka menu"
          >
            <Menu size={18} />
          </button>
          <h1 className="min-w-0 flex-1 truncate font-sans text-lg font-black">{activeThread?.title ?? 'Percakapan baru'}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <ModelSelector catalogState={catalogState} open={selectorOpen} onOpenChange={setSelectorOpen} />
            <ModelInfo
              model={selectedModel}
              modelId={modelId}
              providerLabel={providerInfo?.label}
              missing={modelMissing}
              open={infoOpen}
              onOpenChange={setInfoOpen}
            />
          </div>
        </header>

        {error && (
          <div role="alert" className="mx-4 mt-3 border-2 border-black bg-blaze p-3 text-sm font-bold shadow-brutal-sm">
            <div className="flex items-start gap-3">
              <p className="min-w-0 flex-1 break-words">{error.message}</p>
              <button type="button" className="btn px-1.5 py-1" onClick={() => setError(null)} aria-label="Tutup pesan galat">
                <X size={14} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {canRetry && (
                <button type="button" className="btn btn-sm" onClick={handleRetry}>
                  <RotateCcw size={14} aria-hidden /> Coba lagi
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setError(null);
                  setSelectorOpen(true);
                }}
              >
                Pakai model lain
              </button>
            </div>
          </div>
        )}

        <MessageList
          messages={activeThread?.messages ?? []}
          streaming={streaming}
          activeArtifactId={activeArtifactId}
          onOpenArtifact={(messageId, index) => setArtifactRef({ messageId, index })}
          onPrompt={handleSend}
        />

        <Composer
          onSend={handleSend}
          onStop={stop}
          streaming={streaming}
          toolbar={
            <ComposerToolbar
              model={selectedModel}
              reasoningEffort={reasoningEffort}
              onReasoningChange={setReasoningEffort}
              estimatedTokens={estimateTokens(activeThread?.messages ?? [])}
            />
          }
        />
      </section>

      {artifactState && (
        <aside
          className="fixed inset-0 z-50 flex flex-col bg-cream xl:static xl:z-auto xl:w-[52%] xl:max-w-[920px] xl:shrink-0 xl:border-l-4 xl:border-black"
          aria-label="Panel artifact"
        >
          <ArtifactViewer
            artifacts={artifactState.blocks}
            activeIndex={artifactState.index}
            onSelect={(i) => setArtifactRef({ messageId: artifactState.messageId, index: i })}
            onClose={() => setArtifactRef(null)}
            streaming={artifactState.streaming}
          />
        </aside>
      )}
    </div>
  );
}
