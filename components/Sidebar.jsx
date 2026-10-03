'use client';

import { Plus, Trash2, X } from 'lucide-react';

// docked = true: sidebar menempel permanen mulai layar lg.
// docked = false (saat panel artifact terbuka): sidebar menjadi laci kecuali di layar 2xl.
export default function Sidebar({ threads, activeId, onSelect, onNew, onDelete, open, onClose, docked }) {
  return (
    <>
      {open && (
        <div
          className={`fixed inset-0 z-30 bg-black/40 ${docked ? 'lg:hidden' : '2xl:hidden'}`}
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r-4 border-black bg-lemon transition-transform duration-150 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${docked ? 'lg:static lg:translate-x-0' : '2xl:static 2xl:translate-x-0'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b-4 border-black p-4">
          <div className="border-2 border-black bg-white px-3 py-1 font-sans text-lg font-black leading-tight shadow-brutal-sm">
            Xean Digital AI
          </div>
          <button
            type="button"
            className={`btn px-2 ${docked ? 'lg:hidden' : '2xl:hidden'}`}
            onClick={onClose}
            aria-label="Tutup menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <button type="button" className="btn btn-neon w-full py-2.5" onClick={onNew}>
            <Plus size={18} />
            Percakapan baru
          </button>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-4 pb-4" aria-label="Riwayat percakapan">
          {threads.length === 0 && (
            <p className="border-2 border-dashed border-black p-3 text-sm font-medium">
              Belum ada percakapan. Kirim pesan pertama untuk memulai.
            </p>
          )}
          {threads.map((t) => {
            const active = t.id === activeId;
            return (
              <div
                key={t.id}
                className={`flex items-stretch border-2 border-black ${
                  active ? 'bg-black text-white shadow-brutal-sm' : 'bg-white'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm font-bold"
                  onClick={() => onSelect(t.id)}
                  aria-current={active ? 'true' : undefined}
                >
                  {t.title}
                </button>
                <button
                  type="button"
                  className="border-l-2 border-black px-2 hover:bg-blaze hover:text-black"
                  onClick={() => onDelete(t.id)}
                  aria-label={`Hapus percakapan ${t.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
