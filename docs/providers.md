# 🔑 Provider AI dengan Free Tier (update: November 2026)

Semua provider di bawah punya API key gratis dan bisa dipakai bot ini cukup dengan mengubah 2 baris `.env`.

> ⚠️ **Kenyataan di lapangan (November 2026):** **Cerebras** dan **Mistral** kadang meminta kartu kredit
> saat membuat API key, walaupun dokumentasinya menyebut "no credit card". Ini bervariasi per akun,
> region, dan sistem anti-fraud mereka. Kalau kamu kena syarat itu, **lewati saja** — pakai Groq + Gemini +
> OpenRouter + NVIDIA NIM, yang terbukti tidak meminta kartu.

Angka limit **selalu berubah** — yang tertera adalah kisaran yang beredar saat dokumen ini ditulis;
cek halaman resmi (atau `npm run models` untuk daftar model) sebelum dipakai serius.

---

## Ringkasan

| Provider | Gratisnya | Limit kasar (free) | Tool calling¹ | Cocok untuk |
|---|---|---|---|---|
| **Groq** | Permanen, tanpa kartu | ±30 req/menit, ±1.000 req/hari & 8K TPM per model | ✅ | **Default repo ini** — tercepat, GPT-OSS 120B gratis |
| **Google Gemini** | Permanen, tanpa kartu | Model Flash/Flash-Lite puluhan–ratusan req/hari, Pro sangat dibatasi | ✅ | Kuota harian paling longgar untuk chat |
| **OpenRouter** | Model berlabel `:free` | 20 req/menit; 50 req/hari (jadi 1.000/hari setelah sekali beli kredit $10) | ✅ (tergantung model) | Bereksperimen banyak model |
| **NVIDIA NIM** | Kredit gratis (1.000 call), tanpa kartu | ±40 req/menit, 120+ model open-weight | ⚠️ bervariasi | Katalog model terbanyak tanpa kartu |
| **Cerebras** | ⚠️ **kadang minta kartu** | ±1 juta token/hari, konteks free pendek | ⚠️ | Kecepatan ekstrem, kalau key-nya bisa dibuat |
| **Mistral** | ⚠️ **kadang minta kartu** | ±1 miliar token/bulan, RPM rendah | ✅ | Data EU, kalau key-nya bisa dibuat |
| **Cloudflare Workers AI** | Permanen, tanpa kartu | 10.000 neuron/hari (setara ratusan chat) | ⚠️ terbatas | Sudah pakai ekosistem Cloudflare |
| **Ollama (lokal)** | Gratis total, tanpa key | Terbatas hardware kamu | ✅ | Privasi maksimal / offline |

¹ **Tool calling** dipakai bot ini untuk **memori otomatis** (`simpan_memori`).
Kalau model tidak mendukung, bot tidak crash — hanya memori otomatis mati, dan `/ingat` manual tetap jalan.

---

## Contoh `.env` siap tempel

### Groq (default — dapat key gratis di <https://console.groq.com/keys>)

```env
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
```

Alternatif model gratis di Groq: `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`.

> ⚠️ Llama 3.3 70B, Llama 3.1 8B, Llama 4 Scout, dan Qwen3 32B **sudah tidak gratis** per November 2026.
> Daftar ID lengkap: **[models.md](models.md)**.

### Google Gemini (<https://aistudio.google.com/api-keys>)

```env
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_MODEL=gemini-3.8-flash
```

Gunakan `gemini-3.5-flash-lite` kalau butuh limit lebih longgar. Model `gemini-2.5-*` sekarang legacy
(hanya untuk project yang pernah memakainya), dan semua model Pro butuh billing.
Karena RPM free tier kecil (±10–15), turunkan juga `RATE_LIMIT_PER_MINUTE=8`.

> ⚠️ Di free tier, Google dapat memakai data untuk peningkatan model. Untuk percakapan member
> yang sensitif, pertimbangkan Groq/Cerebras atau tier berbayar.

### OpenRouter (<https://openrouter.ai/keys>)

```env
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=google/gemma-4-31b-it:free
```

Daftar model gratis **cepat berganti** (bisa berubah dalam hitungan minggu) — cek
<https://openrouter.ai/models?max_price=0> dan selalu pilih yang berakhiran `:free`.

### NVIDIA NIM (<https://build.nvidia.com> → Get API Key)

```env
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=nvapi-...
```

Atau sebagai fallback: `AI_FALLBACKS=nvidia:openai/gpt-oss-120b` dengan `NVIDIA_API_KEY=nvapi-...`.
Daftar modelnya sangat banyak (±120) dan berubah-ubah — cek dengan `npm run models`.

### Cerebras (<https://cloud.cerebras.ai> → API Keys) — *bisa meminta kartu*

```env
AI_BASE_URL=https://api.cerebras.ai/v1
AI_MODEL=llama-3.3-70b
```

Konteks di free tier lebih pendek; kalau transkrip/room panjang, turunkan `AI_HISTORY_LIMIT=10`.

### Mistral (<https://console.mistral.ai> → API Keys) — *bisa meminta kartu*

```env
AI_BASE_URL=https://api.mistral.ai/v1
AI_MODEL=mistral-small-latest
```

Butuh verifikasi nomor HP. Tier gratis untuk evaluasi, bukan produksi.

### Cloudflare Workers AI (<https://dash.cloudflare.com/profile/api-tokens>)

```env
AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AI_MODEL=@cf/meta/llama-3.1-8b-instruct
AI_API_KEY=<token Cloudflare>
```

Butuh `ACCOUNT_ID` di URL. Dukungan tool calling tidak konsisten → memori otomatis mungkin nonaktif.

### Ollama lokal (tanpa API key, tanpa biaya)

```bash
ollama pull llama3.1
ollama serve
```

```env
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.1
AI_API_KEY=ollama
```

---

## 🔁 Fallback otomatis (rekomendasi)

Daripada mengganti `.env` manual saat kena limit, daftarkan provider cadangan. Bot akan mencoba
**provider utama dulu**, lalu pindah otomatis kalau gagal — tanpa restart, tanpa user sadar.

```env
# utama (Groq)
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=gsk_xxxxxxxx

# cadangan, dicoba berurutan saat provider utama gagal
AI_FALLBACKS=gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free,nvidia:openai/gpt-oss-120b

GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-v1-...
NVIDIA_API_KEY=nvapi-...
```

Perilaku yang sudah diatur di `src/lib/llm.ts`:

| Kondisi | Aksi bot |
|---|---|
| Rate limit (429) / gangguan 5xx / timeout | Retry 2–3× dengan backoff, lalu pindah provider |
| API key ditolak (401/403), model tidak ada (404), kredit habis (402) | **Langsung** pindah provider tanpa buang waktu retry |
| Percakapan terlalu panjang | Berhenti & minta user `/reset` (fallback tidak akan menolong) |
| Model tidak mendukung tool calling | Ulang di provider yang sama tanpa tools, memori otomatis nonaktif |
| Semua provider gagal | Pesan ramah berisi ringkasan penyebab tiap provider |
| Provider menolak `stream: true` | Otomatis memakai mode non-streaming di provider itu, jawaban tetap keluar |
| Provider minta kartu kredit saat signup | Bukan urusan bot — lewati provider itu, pilih yang tanpa kartu (Groq/Gemini/OpenRouter/NVIDIA) |

Urutan dicoba dari kiri ke kanan. Entri yang salah atau key-nya kosong akan dilewati dengan
peringatan di log, jadi bot tetap jalan.

Verifikasi cepat tanpa API key asli:

```bash
npm run test:fallback
```

Skrip ini menyalakan dua server tiruan (satu selalu 429) dan memastikan bot benar-benar berpindah provider.

## Cara menguji setelah ganti provider

1. Jalankan bot: `npm run dev`
2. Di Discord: `/tanya pertanyaan:Halo, kamu model apa?`
3. Kalau muncul error, cek log — bot membedakan **401 (key salah)**, **429 (limit)**, dan **404 (nama model salah)** dengan pesan yang jelas.

## Kalau limit terkena (429)

- Turunkan `RATE_LIMIT_PER_MINUTE` (mis. 8 untuk Gemini, 20 untuk Groq).
- Bot sudah punya retry + backoff otomatis, tapi tidak bisa melewati kuota harian.
- Untuk komunitas ramai: pakai 2 provider (Groq untuk harian, Gemini sebagai cadangan) dengan
  mengganti `.env` + restart, atau tambahkan fallback multi-provider di `src/lib/llm.ts`.
