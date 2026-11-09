# 🧩 Model AI gratis — ID yang bisa dipakai di `AI_FALLBACKS`

Formatnya selalu **`provider:model_id`**:

```env
AI_FALLBACKS=gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free
```

Nama provider dikenali bot (`groq`, `gemini`, `openrouter`, `cerebras`, `mistral`, `ollama`), sedangkan
di belakang titik dua adalah **ID model persis** seperti yang dipakai provider tersebut.

> ⚠️ Daftar di bawah **snapshot November 2026**. Katalog gratis berubah cepat — Groq sendiri sudah
> mencabut Llama 3.3/3.1 dari free tier dan Gemini memindahkan 2.5 ke status legacy.
> **Selalu verifikasi dengan `npm run models`** (lihat bagian terakhir).

---

## Groq — `groq`

Endpoint: `https://api.groq.com/openai/v1` · Key: <https://console.groq.com/keys> · Limit: ±30 RPM, ±1.000 req/hari per model, ±8K TPM

| Model ID | Konteks | Tool calling | Catatan |
|---|---|---|---|
| `openai/gpt-oss-120b` | 131K | ✅ | **Pilihan utama** — paling pintar di free tier Groq |
| `openai/gpt-oss-20b` | 131K | ✅ | Lebih cepat & ringan, cocok balasan pendek |
| `qwen/qwen3.8-27b` | 131K | ✅ | Multibahasa bagus, parallel tool call didukung |
| `openai/gpt-oss-safeguard-20b` | 131K | ⚠️ | Hanya 3 RPM — bukan untuk chat umum |

> Llama 3.3 70B, Llama 3.1 8B, Llama 4 Scout, Qwen3 32B, dan Groq Compound **sudah tidak gratis**.
> Kalau memakai ID lama itu, request akan gagal dengan pesan model/plan — bukan bug bot.

## Google Gemini — `gemini`

Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/` · Key: <https://aistudio.google.com/api-keys>

| Model ID | Tool calling | Catatan |
|---|---|---|
| `gemini-3.8-flash` | ✅ | **Pilihan utama** — Flash terbaru yang stabil & gratis |
| `gemini-3.6-flash` | ✅ | Generasi sebelumnya, masih gratis |
| `gemini-3.5-flash-lite` | ✅ | Paling longgar untuk volume tinggi |
| `gemini-3.1-flash-lite` | ✅ | Alternatif Flash-Lite |
| `gemini-3-flash-preview` | ✅ | Preview — jangan untuk produksi |
| `gemma-4-31b-it`, `gemma-4-26b-a4b-it` | ⚠️ | Model terbuka Google |

> `gemini-2.5-*` hanya terbuka untuk project yang sebelumnya sudah memakai model itu.
> Semua model **Pro** dan image/video/TTS butuh billing.

## OpenRouter — `openrouter`

Endpoint: `https://openrouter.ai/api/v1` · Key: <https://openrouter.ai/keys> · 20 RPM, 50 req/hari (<$10 kredit), 1.000 req/hari setelah top-up $10 sekali

| Model ID (akhiran `:free` wajib) | Catatan |
|---|---|
| `google/gemma-4-31b-it:free` | Serbaguna, function calling, 140+ bahasa |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 550B MoE, 1M konteks, penalaran kuat |
| `nvidia/nemotron-3.5-lightning:free` | Varian cepat, 1M konteks |
| `thinkingmachines/inkling:free` | 975B MoE, multimodal |
| `cohere/north-mini-code:free` | Fokus kode |
| `openrouter/free` | Router otomatis ke model gratis yang aktif |

> Model gratis OpenRouter **paling cepat berganti** (beberapa hilang dalam hitungan minggu).
> Selalu cek `npm run models`, dan jangan pakai untuk produksi dengan trafik nyata (batas 50 req/hari).

## NVIDIA NIM — `nvidia`

Endpoint: `https://integrate.api.nvidia.com/v1` · Key: <https://build.nvidia.com> (email saja, **tanpa kartu**) · ±40 RPM, kredit gratis ±1.000 call

| Model ID | Catatan |
|---|---|
| `openai/gpt-oss-120b` | Andal untuk chat & tool |
| `meta/llama-3.3-70b-instruct` | Klasik, stabil |
| `qwen/qwen3-235b-a22b` | Multibahasa kuat |

> Katalognya ±120 model open-weight dan paling cepat berubah. Jalankan `npm run models` untuk melihat
> ID yang benar-benar aktif di akunmu. Dukungan tool calling **bervariasi per model**.

## Cerebras — `cerebras` ⚠️ *kadang butuh kartu*

Endpoint: `https://api.cerebras.ai/v1` · Key: <https://cloud.cerebras.ai> · ±30 RPM, 1 juta token/hari

| Model ID | Tool calling | Catatan |
|---|---|---|
| `gpt-oss-120b` | ✅ | Tercepat + pintar, pilihan utama |
| `llama-3.3-70b` | ❌ | Cepat, tanpa tool (memori otomatis nonaktif) |
| `llama3.1-8b` | ❌ | Sangat cepat, untuk tugas ringan |
| `qwen-3-32b` | ✅ | Reasoning + tool |
| `qwen-3-235b-a22b-instruct-2507` | ⚠️ | Preview |

> Konteks di free tier lebih pendek (sekitar 8K). Turunkan `AI_HISTORY_LIMIT=10` kalau memakai Cerebras.
>
> **Penting:** beberapa akun diminta menambahkan kartu kredit sebelum key bisa dibuat. Kalau kamu kena
> syarat itu, lewati provider ini — bukan masalah kode bot.

## Mistral — `mistral` ⚠️ *kadang butuh kartu*

Endpoint: `https://api.mistral.ai/v1` · Key: <https://console.mistral.ai> · free "Experiment" tier (±1 miliar token/bulan, RPM rendah, verifikasi HP)

| Model ID | Catatan |
|---|---|
| `mistral-small-latest` | Seimbang, aman untuk chat umum |
| `open-mistral-nemo` | Ringan & cepat |
| `mistral-large-latest` | Kualitas tertinggi, kuota cepat habis |

## Ollama (lokal) — `ollama`

Butuh key: tidak (otomatis `ollama`). Endpoint: `http://localhost:11434/v1`

```bash
ollama pull qwen3
```

| Model ID | Catatan |
|---|---|
| `qwen3` | Multibahasa kuat, tool calling |
| `llama3.1` | Andal untuk chat |
| `gemma3` | Ringan, cepat di RAM kecil |

Model lain: <https://ollama.com/library> — ID-nya persis nama yang kamu `pull`.

---

## Kombinasi yang disarankan untuk bot ini

**Pemula (paling aman):**
```env
AI_MODEL=openai/gpt-oss-120b
AI_FALLBACKS=gemini:gemini-3.8-flash
```

**Tahan limit (4 key, semua tanpa kartu):**
```env
AI_MODEL=openai/gpt-oss-120b
AI_FALLBACKS=gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free,nvidia:openai/gpt-oss-120b
```

**Kalau Cerebras/Mistral menolak tanpa kartu:** jangan dipaksa. Tiga provider di atas sudah cukup
untuk bot komunitas, dan NVIDIA NIM menambah cadangan keempat yang juga tanpa kartu.

**Privasi maksimal (tanpa cloud):**
```env
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3
AI_API_KEY=ollama
```

---

## Verifikasi model yang benar-benar tersedia

```bash
npm run models            # semua provider yang key-nya terisi
npm run models -- gemini  # satu provider saja
```

Skrip ini memanggil endpoint `/models` milik provider (bukan daftar di dokumentasi), menyaring model
non-chat (whisper/embedding/image), menampilkan panjang konteks, dan menandai model yang sedang dipakai bot:

```
groq https://api.groq.com/openai/v1
  ● openai/gpt-oss-120b ← dipakai bot (131K konteks)
    openai/gpt-oss-20b (131K konteks)
    qwen/qwen3.8-27b (131K konteks)
```

Kalau muncul error 401/404 di skrip ini, berarti key atau nama modelnya yang salah — bukan kode bot.

Setelah yakin nama model benar, uji end-to-end (chat + streaming) ke provider sungguhan:

```bash
npm run doctor
```
