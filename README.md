# 🤖 Zypher AI Bot

Bot Discord dengan **AI sebagai fitur utama**: member bisa membuka **room privat** dan mengobrol dengan AI seperti layanan tiket, lengkap dengan **memori jangka panjang**, **jawaban keyword kustom yang divariasikan AI**, dan **transkrip sesi** yang bisa diunduh.

Dibangun dengan **Node.js + TypeScript**, [discord.js v14](https://discord.js.org), dan LLM [Groq](https://console.groq.com) (bisa diganti provider lain tanpa menyentuh kode).

```
Member klik "Buat Room AI"
        ↓
Channel privat dibuat (hanya member + staff + bot)
        ↓
Chat bebas → AI menjawab, mengingat fakta, memakai keyword admin
        ↓
"Akhiri Sesi" → transkrip HTML dikirim ke DM → channel dihapus
```

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🎟️ **AI Room (ticket-style)** | Tombol di panel membuat channel privat per member dengan permission overwrite. Satu room aktif per member. |
| ⚡ **Streaming jawaban** | Jawaban muncul bertahap (edit pesan tiap ±1,4 detik, menghormati rate limit Discord), bukan menunggu jeda panjang. Otomatis jatuh ke mode non-streaming kalau provider menolaknya. |
| 💬 **Chat AI** | Konteks percakapan (20 pesan terakhir), jawaban panjang otomatis dipecah ke beberapa pesan. |
| 🧠 **Memori jangka panjang** | AI otomatis menyimpan fakta penting lewat *tool calling*, plus perintah manual `/ingat`. Memori dipakai lagi di sesi berikutnya. |
| 🔑 **Keyword kustom** | Admin menulis jawaban acuan; AI memakainya sebagai **fakta** dan menyusun ulang kalimatnya agar **bervariasi setiap kali** (bukan copy-paste). |
| 🎭 **Persona per server** | Mis. "kamu guru bahasa Inggris yang sabar" — berlaku untuk semua room di server itu. |
| 📄 **Transkrip sesi** | HTML mandiri (dark mode, rapi, aman dari XSS) berisi percakapan + memori + ringkasan AI. Dikirim ke DM dan/atau channel arsip. |
| 🔁 **Fallback multi-provider** | Provider utama kena limit/error → otomatis pindah ke provider cadangan (Groq → Gemini → OpenRouter), tanpa restart. |
| 🛡️ **Rate limit & guard** | Batas pesan per menit, validasi input, penanganan error yang ramah, tanpa membocorkan system prompt. |
| 🐳 **Siap deploy** | Docker multi-stage, volume SQLite, tanpa dependensi native (pakai `node:sqlite` bawaan Node 22). |

---

## 🧰 Tech stack & alasan

```
Runtime   Node.js 22 LTS
Bahasa    TypeScript (strict)
Discord   discord.js v14
AI        Groq — openai/gpt-oss-120b (OpenAI-compatible API)
Database  node:sqlite (built-in Node 22) — tanpa node-gyp, tanpa build tools
Validasi  zod + dotenv
Deploy    Docker multi-stage + docker-compose
```

**Kenapa Node.js, bukan Python?** Hampir seluruh fitur di atas adalah kerjaan **Discord API** (button, permission overwrite, lifecycle channel, transcript), bukan kerjaan ML. `discord.js` paling matang untuk komponen & permission, tutorial pola ticket-AI mayoritas juga JS. Akses LLM cukup HTTP call — tidak ada keuntungan Python di sini. Kalau nanti butuh embedding lokal/fine-tuning, itu lebih sehat dipecah jadi service Python terpisah.

**Kenapa `node:sqlite`?** `better-sqlite3` butuh compile native (node-gyp + build tools) yang sering gagal di VPS kecil/Alpine. Modul `node:sqlite` sudah tersedia di Node 22 sehingga image Docker cukup `node:22-slim` tanpa compiler. Skalanya lebih dari cukup untuk ribuan memori & transcript.

---

## ✅ Prasyarat

- **Node.js 22+** (wajib — `node:sqlite` baru ada di Node 22)
- Akun Discord & server tempat bot diuji
- API key **Groq** (gratis): <https://console.groq.com/keys>
- Opsional: Docker + Docker Compose untuk deploy

---

## 🚀 Setup

### 1. Buat aplikasi Discord

1. Buka <https://discord.com/developers/applications> → **New Application**, beri nama.
2. **General Information** → salin **Application ID** → jadi `CLIENT_ID`.
3. **Bot** → **Reset Token** → salin → jadi `DISCORD_TOKEN` (jangan pernah dibagikan).
4. Masih di **Bot**, aktifkan:
   - ✅ **Message Content Intent** ← *wajib*, tanpa ini bot tidak bisa membaca isi chat
   - ✅ Server Members Intent *(opsional, untuk menampilkan nama tampilan member)*
5. **OAuth2 → URL Generator**, centang `bot` + `applications.commands`, izin yang dibutuhkan:
   `Manage Channels`, `View Channels`, `Send Messages`, `Manage Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Use External Emojis`.
6. Buka URL hasil generate, pilih server, authorize.

> URL siap pakai (ganti `YOUR_CLIENT_ID`):
> `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=388176&scope=bot%20applications.commands`

### 2. Ambil API key Groq

Buat key di <https://console.groq.com/keys> → jadi `AI_API_KEY`. Free tier sudah cukup untuk bot komunitas.

### 3. Jalankan bot

```bash
git clone https://github.com/whyuangga/Zypher-AI-Bot.git
cd Zypher-AI-Bot
npm install
cp .env.example .env       # lalu isi nilainya
npm run dev                # mode development (auto-reload)
```

Isi minimal `.env`:

```env
DISCORD_TOKEN=xxxxx.xxxxx.xxxxx
CLIENT_ID=123456789012345678
DEV_GUILD_ID=123456789012345678   # ID server testing (command langsung muncul)
AI_API_KEY=gsk_xxxxxxxx
```

Saat pertama jalan, bot otomatis mendaftarkan slash command. Lalu di Discord:

```
/panel            → kirim panel tombol ke channel ini
```

Klik **Buat Room AI** → channel privat muncul → mulai ngobrol.

---

## ⚙️ Konfigurasi `.env`

| Variabel | Default | Fungsi |
|---|---|---|
| `DISCORD_TOKEN` | — | Token bot (**wajib**) |
| `CLIENT_ID` | — | Application ID (**wajib**) |
| `DEV_GUILD_ID` | kosong | ID server testing. Terisi = command didaftarkan per-guild (instan). Kosong = global (bisa sampai 1 jam). |
| `AI_API_KEY` | — | API key Groq (**wajib**) |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | Endpoint OpenAI-compatible. Ganti untuk pindah provider. |
| `AI_MODEL` | `openai/gpt-oss-120b` | Model yang dipakai (lihat [docs/models.md](docs/models.md)) |
| `AI_TEMPERATURE` | `0.8` | Kreativitas (0–2). Naikkan kalau variasi jawaban terasa monoton. |
| `AI_MAX_TOKENS` | `700` | Panjang maksimal jawaban |
| `AI_HISTORY_LIMIT` | `20` | Jumlah pesan terakhir sebagai konteks |
| `AI_FALLBACKS` | kosong | Provider cadangan, mis. `gemini:gemini-3.8-flash,openrouter:...` |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY` | kosong | Key untuk provider cadangan |
| `DATABASE_PATH` | `./data/zypher.db` | Lokasi file SQLite |
| `AUTO_MEMORY` | `true` | Simpan memori otomatis lewat tool calling |
| `RATE_LIMIT_PER_MINUTE` | `12` | Batas request AI per user/menit |
| `MAX_INPUT_CHARS` | `2000` | Panjang pesan user yang diproses |
| `AI_CATEGORY_ID` | kosong | Kategori tempat room dibuat (kosong = bot buat "AI Lounge") |
| `TRANSCRIPT_CHANNEL_ID` | kosong | Channel arsip transkrip & ringkasan sesi |
| `STAFF_ROLE_ID` | kosong | Role staff yang boleh melihat/menutup room member |
| `ADMIN_ONLY_ROOMS` | `false` | `true` = hanya admin yang bisa membuat room |

### Ganti provider AI (opsional)

Kode memakai protokol OpenAI-compatible, jadi cukup ubah dua baris.
Daftar lengkap provider **free tier** + contoh `.env` siap tempel ada di **[docs/providers.md](docs/providers.md)**,
sedangkan **ID model gratis per provider** ada di **[docs/models.md](docs/models.md)**.

**Fallback otomatis:** isi `AI_FALLBACKS` agar bot pindah provider sendiri saat kena limit:

```env
AI_FALLBACKS=gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-v1-...
```

```env
# OpenAI
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini

# OpenRouter
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=meta-llama/llama-3.3-70b-instruct

# Ollama lokal (gratis total)
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3
AI_API_KEY=ollama
```

Kalau model tidak mendukung *tool calling*, bot otomatis lanjut tanpa fitur memori otomatis (tidak crash).

---

## 💬 Daftar perintah

| Perintah | Akses | Fungsi |
|---|---|---|
| `/panel [channel]` | Admin | Kirim panel tombol pembuat room AI |
| `/bantuan` | Semua | Panduan singkat (ephemeral) |
| `/tanya pertanyaan:` | Semua | Tanya AI cepat tanpa room, jawaban hanya terlihat oleh penanya |
| `/ingat fakta:` | Semua | Simpan memori manual tentang diri sendiri |
| `/memori [user]` | Semua / admin | Lihat daftar memori (dengan id) |
| `/lupakan id:` / `semua:true` | Semua | Hapus satu / semua memori |
| `/reset` | Pemilik room / staff | Hapus riwayat konteks, memori tetap |
| `/keyword tambah\|daftar\|hapus` | Admin | Kelola jawaban acuan yang divariasikan AI |
| `/persona set\|lihat\|hapus` | Admin | Atur peran AI untuk seluruh server |

Tombol di room: **Akhiri Sesi** (konfirmasi → transkrip → channel dihapus) dan **Bantuan**.

---

## 🧠 Bagaimana AI-nya bekerja

**1. System prompt** (`src/features/prompt.ts`) dirakit tiap request dari:
nama bot & server, nama member, tanggal, aturan gaya bahasa, persona server, memori user, dan keyword yang cocok.

**2. Memori otomatis** — model diberi dua tool: `simpan_memori` dan `hapus_memori`. Setelah user bicara, model memutuskan sendiri apakah ada fakta yang layak disimpan (nama, pekerjaan, preferensi). Hasilnya masuk tabel `memories` dan dipakai lagi di sesi berikutnya. Bisa juga manual via `/ingat`.

**3. Keyword bervariasi** — `/keyword tambah` menyimpan *jawaban acuan*. Saat pesan user cocok (bukan harus persis: pencocokan kata kunci + toleransi ≥60% kata), isi acuan masuk ke prompt sebagai **fakta resmi** dengan instruksi: jangan copy-paste, susun ulang bahasanya dengan variasi. Hasilnya: inti jawaban konsisten, kalimatnya selalu segar.

**4. Transkrip** — pesan channel diambil (hingga 600), di-escape, dirender jadi HTML mandiri bertema gelap, ditambah daftar memori dan **ringkasan sesi** dari AI. Dikirim ke DM + channel arsip, lalu channel dihapus.

**5. Streaming** — jawaban dikirim lewat SSE dari provider, ditampung, lalu `DiscordStreamer`
meng-edit pesan berkala (±1,4 detik, di bawah batas edit Discord) dan menyelesaikan sisanya sebagai
pesan lanjutan. Kalau koneksi putus setelah teks tampil, jawaban parsial dipertahankan dan diberi catatan —
bot **tidak** berpindah provider di tengah jalan agar jawaban tidak dobel.

**6. Guardrail** — rate limit sliding-window, potong input, `allowedMentions: parse []` (anti `@everyone`), escape HTML pada transkrip, larangan membocorkan system prompt, dan fallback ke pesan ramah saat AI error/timeout.

---

## 🐳 Deploy

### Docker Compose (VPS)

```bash
cp .env.example .env     # isi token, client id, API key
docker compose up -d --build
docker compose logs -f bot
```

Database tersimpan di volume Docker bernama `zypher-data` (mount ke `/app/data`), jadi aman saat container di-rebuild.

```bash
docker compose exec bot ls -lh /app/data          # cek file database
docker compose cp bot:/app/data/zypher.db ./backup.db   # backup
```

### Tanpa Docker

```bash
npm ci
npm run build
NODE_ENV=production node dist/index.js
```

Disarankan pakai **pm2** atau **systemd** supaya auto-restart:

```bash
pm2 start dist/index.js --name zypher-ai-bot
pm2 save
```

### Platform PaaS

Railway / Fly.io / Render bisa langsung memakai Dockerfile. Set env var yang sama, dan pastikan volume persistent dipasang di `/app/data` agar memori + transcript tidak hilang setiap redeploy.

---

## 🧪 Uji cepat tanpa Discord

```bash
npm run smoke          # 28 test logika inti
npm run test:fallback  # uji rantai fallback provider dengan server tiruan
```

`npm run models` menampilkan model yang **benar-benar tersedia** di providermu (memanggil endpoint `/models`,
menyaring model non-chat, menandai model yang dipakai bot) — lebih akurat daripada daftar di dokumentasi.

`npm run smoke` menguji CRUD memori, pencocokan keyword (termasuk kalimat yang dibalik), perakitan prompt,
riwayat room, escape XSS pada transkrip, chunking pesan, rate limit, dan parsing `AI_FALLBACKS`.

`npm run test:fallback` menyalakan dua server OpenAI-compatible tiruan (provider utama selalu 429) dan
memeriksa 10 hal: pindah provider, payload utuh, berhenti saat prompt kepanjangan, **delta streaming
diterima bertahap**, dan **tool call yang datang sebagai delta tetap terangkai utuh** (memori tetap jalan).

---

## 🩺 Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `ExperimentalWarning: SQLite is an experimental feature` | Normal di Node 22. Bisa diabaikan, atau jalankan dengan `NODE_OPTIONS=--disable-warning=ExperimentalWarning` (sudah di-set di Dockerfile). |
| Slash command tidak muncul | Isi `DEV_GUILD_ID` (instan), atau tunggu hingga 1 jam untuk command global. Pastikan undangan memakai scope `applications.commands`. |
| Bot diam saja di room | **Message Content Intent** belum aktif di Developer Portal → Bot. |
| `Gagal membuat room AI` + permission | Bot butuh **Manage Channels**; taruh role bot di atas role lain yang relevan. |
| Transkrip tidak masuk DM | User menutup DM. Set `TRANSCRIPT_CHANNEL_ID` sebagai arsip; bot juga tidak akan menghapus channel agar transkrip tidak hilang. |
| `API key AI ditolak` | `AI_API_KEY` salah/kedaluwarsa di `.env`. |
| `Kuota AI sedang penuh` | Rate limit provider tercapai — turunkan `RATE_LIMIT_PER_MINUTE`, atau isi `AI_FALLBACKS` agar otomatis pindah provider. |
| `Semua provider AI sedang tidak tersedia` | Semua provider (utama + fallback) gagal. Cek log: biasanya kuota habis harian atau key salah. |
| Model tidak ditemukan / model butuh plan berbayar | Katalog gratis berubah (mis. Llama 3.3 sudah tidak gratis di Groq). Jalankan `npm run models`, lalu pakai ID yang muncul. |
| Diminta kartu kredit saat membuat API key | Kebijakan provider (Cerebras/Mistral kerap begitu). Lewati saja; Groq, Gemini, OpenRouter, dan NVIDIA NIM tidak meminta kartu. |
| Jawaban muncul sekaligus, bukan streaming | Normal bila provider/model menolak `stream: true` — bot otomatis memakai mode non-streaming di provider tersebut (lihat log). |
| Jawaban terasa monoton | Naikkan `AI_TEMPERATURE` (mis. `0.9`) dan pastikan keyword punya jawaban acuan yang cukup detail. |

---

## 📁 Struktur project

```
src/
├── index.ts                 # bootstrap client, event wiring, graceful shutdown
├── config.ts                # validasi .env dengan zod
├── commands/                # slash command (panel, ingat, memori, keyword, persona, dll)
├── events/                  # interactionCreate, messageCreate, channelDelete
├── features/
│   ├── rooms.ts             # buat/hapus room privat + transkrip
│   ├── chat.ts              # pipeline jawaban AI + tool calling + chunking
│   ├── memory.ts            # tool memori & format untuk prompt
│   ├── keywords.ts          # pencocokan keyword
│   ├── prompt.ts            # perakitan system prompt
│   ├── buttons.ts           # router button interaction
│   └── ui.ts                # embed & komponen
├── db/                      # koneksi SQLite, skema, query
└── lib/                     # llm, transcript, ratelimit, text, logger, register
scripts/smoke.ts             # smoke test tanpa Discord
docs/sample-transcript.html  # contoh hasil transkrip
docs/providers.md            # provider AI free tier + contoh .env
docs/models.md               # ID model gratis per provider + rekomendasi
```

---

## 🗺️ Roadmap ide berikutnya

- [ ] Web dashboard (statistik sesi, editor keyword/persona)
- [ ] Streaming jawaban (edit pesan bertahap)
- [ ] RAG dokumen server (FAQ panjang, PDF, Notion)
- [ ] Moderasi otomatis + logging
- [ ] Dukungan gambar (vision) & voice
- [ ] Postgres untuk multi-shard

---

## 📜 Lisensi

MIT © 2026 Wahyu Angga Saputra — lihat [LICENSE](LICENSE).
