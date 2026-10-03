# Xean Digital AI

Aplikasi web AI Chat bergaya Claude: chat streaming, panel samping artifact untuk kode dan berkas, desain Neobrutalism.
Next.js (App Router), Tailwind CSS, Lucide React, highlight.js.

Provider yang didukung: **xKiro** (katalog model dinamis) dan **APMIX** (provider lama, tetap berfungsi).

## Instalasi

Butuh Node.js 20.19 atau lebih baru.

```bash
npm install
cp .env.example .env.local     # lalu isi XKIRO_API_KEY (dan/atau APMIX_API_KEY)
npm run dev
```

Buka http://localhost:3000. Setelah mengubah `.env.local`, hentikan lalu jalankan ulang `npm run dev`.

## Arsitektur

```
Browser (UI)
   |  tidak pernah memegang API key
   v
Next.js route handler (server)
   |  /api/providers  /api/models  /api/chat  /api/health
   v
Provider Manager  ->  xKiro / APMIX  (lib/server/providers)
   |
   +-- Model Registry (cache TTL, dedupe, stale-while-error)  <- GET {base}/models
   +-- fetchWithRetry (exponential backoff, Retry-After)
   +-- Normalizer SSE (OpenAI dan Anthropic -> event Xean)
   v
POST {base}/chat/completions  (model = ID penuh vendor/model)
```

Event yang diterima browser dari `/api/chat` selalu seragam, apa pun providernya:
`start`, `delta`, `reasoning`, `tool_call`, `usage`, `done`, `error`.

```
app/api/        chat, models, providers, health
lib/server/     config, errors, http (retry), sse, normalize, registry, model-rules, log, providers/
lib/shared/     sse-reader (dipakai server dan browser)
lib/            catalog (filter/cari), catalog-cache, useCatalog (hook), stream, artifacts, ...
components/     ChatInterface, ModelSelector, ModelInfo, ComposerToolbar, MessageList, ArtifactViewer, ...
tests/          49 tes (node:test)
scripts/        check-secrets.mjs
```

## xKiro

- **Katalog dinamis.** Daftar model hanya berasal dari `GET https://api.xkiro.com/v1/models`. Model baru dari xKiro muncul sendiri
  setelah cache habis atau setelah menekan **Sync** di selector. Tidak ada daftar model yang ditulis manual.
  `XKIRO_FALLBACK_MODELS` (opsional) hanya dipakai bila katalog tak terjangkau dan belum ada cache.
- **Metadata disimpan lengkap:** id, display_name, owned_by, access_tier, context_length, max_output_tokens, pricing,
  capabilities, reasoning_efforts, modality, dan field tak dikenal (di `extra`). Field baru tidak membuat aplikasi crash.
- **ID selalu utuh** (`qwen/qwen3.8-max:free`), tidak pernah dipotong prefix vendornya.
- **Auth:** `Authorization: Bearer ${XKIRO_API_KEY}` hanya dari server. Katalog bersifat publik, jadi key tidak dikirim ke endpoint itu.
- **Cache dua lapis:** memori server (TTL `XKIRO_MODEL_CACHE_TTL_SECONDS`, default 300 detik, request serentak digabung)
  dan `localStorage` browser (TTL yang sama). Membuka dropdown atau mengetik pencarian tidak memanggil API.
  Sinkron paksa dibatasi minimal 10 detik antar panggilan.
- **Selector:** pencarian (nama, ID, vendor, capability, "1m context"), filter Semua / Gratis / Berbayar / Premium / Vision /
  Reasoning / Tools / Coding / Long Context, info model lengkap, status online/offline, tombol Sync, navigasi keyboard,
  tampil sebagai sheet penuh di layar kecil.
- **Reasoning:** pilihan level hanya yang ada di `reasoning_efforts.levels` model. "Bawaan" berarti parameter tidak dikirim.
- **Retry:** hanya `429, 500, 502, 503, 504, 529` (bisa diubah), maksimal `XKIRO_MAX_RETRIES` (default 3), jeda 500/1000/2000 ms
  plus jitter, menghormati `Retry-After`. 400/401/403/404 dan 402 tidak pernah diulang. Permintaan chat (POST) tidak diulang
  saat timeout supaya tidak tertagih dua kali.
- **Streaming:** SSE dengan tombol Berhenti (AbortController sampai ke koneksi xKiro), heartbeat tiap 15 detik, teks parsial
  tetap tampil bila koneksi putus, dan stream tanpa terminator dianggap galat.
- **Tidak ada fallback model otomatis.** Bila model gagal, muncul pesan dan tombol "Pakai model lain"; pilihan tetap di tangan pengguna.

### Menambah provider lain

Buat satu file di `lib/server/providers/` (lihat `xkiro.js`, hanya belasan baris untuk provider yang kompatibel OpenAI),
lalu daftarkan di `providers/index.js`. UI, cache, retry, dan streaming otomatis ikut.

## Variabel environment

Lihat `.env.example` untuk daftar lengkap. Yang terpenting:

| Nama | Isi |
| --- | --- |
| `XKIRO_API_KEY` | Key xKiro (wajib untuk chat) |
| `APMIX_API_KEY` | Key APMIX (provider lama) |
| `DEFAULT_PROVIDER` | `xkiro` atau `apmix`; kosong = provider pertama yang key-nya terisi |
| `XKIRO_MODEL_CACHE_TTL_SECONDS` | Umur cache daftar model (default 300) |
| `XKIRO_MAX_RETRIES` | Maksimal retry (default 3) |

## Keamanan

- Key hanya dibaca di `lib/server/*` dan `app/api/*`. Tidak ada variabel berawalan `NEXT_PUBLIC_`.
- `npm run check:secrets` memeriksa kode sumber; `npm run build` menjalankannya otomatis setelah build dan **menggagalkan build**
  bila nilai key (atau pola `apx_live_`, `xk_live_`, `sk-xt-`) ditemukan di `.next/static` (bundle browser).
- Log server hanya memuat provider, model, status, durasi, dan jumlah token. Pesan error disaring dari key dan token Bearer.
- Pratinjau HTML berjalan di `iframe` ber-`sandbox` tanpa `allow-same-origin`.
- Tambahkan autentikasi pengguna dan rate limiting di `/api/chat` sebelum dipublikasikan, karena route itu memakai kuota key Anda.

## Pengujian

```bash
npm test                # 49 tes: SSE, normalisasi, retry, registry/cache, filter/cari, dan route handler end-to-end
npm run check:secrets
```

Tes memakai fetch tiruan, jadi tidak memakai kuota xKiro dan tidak butuh internet.

## Deployment (Vercel)

1. Push proyek ke GitHub (pastikan `.env.local` tidak ikut).
2. Import repositori di Vercel.
3. Isi `XKIRO_API_KEY` (dan variabel lain bila perlu) di Project Settings, Environment Variables, lalu deploy.

`app/api/chat/route.js` memakai `maxDuration = 300` agar jawaban panjang tidak terpotong. Bila deploy menolak nilai itu untuk
plan Anda, turunkan ke batas plan (mis. 60). Di server sendiri dengan Nginx, tambahkan `proxy_buffering off;` dan
`proxy_next_upstream off;` pada `/api/chat`.
