# 🤖 Zypher AI Bot

Bot Discord dengan **AI sebagai fitur utama**: member bisa membuka **room privat** dan mengobrol dengan AI seperti layanan tiket, lengkap dengan **memori jangka panjang**, **jawaban keyword kustom yang divariasikan AI**, **dokumen rujukan (RAG)** yang membuat AI tahu isi FAQ server, **transkrip sesi** yang bisa diunduh, dan **dashboard web** untuk mengelola dokumen.

Dibangun dengan **Node.js + TypeScript**, [discord.js v14](https://discord.js.org), dan LLM [Groq](https://console.groq.com) (bisa diganti provider lain tanpa menyentuh kode).

> 📖 **Baru pertama kali? Ikuti panduan langkah-demi-langkah di [docs/setup.md](docs/setup.md)** —
> dari membuat aplikasi Discord, mengisi `.env`, sampai bot benar-benar menjawab.
>
> ☁️ **Mau online 24/7 tanpa bayar?** Lihat [docs/hosting.md](docs/hosting.md) — perbandingan jujur
> hosting gratis (Oracle Cloud, GCP, panel bot) plus mana yang merusak data SQLite.

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
| 💬 **Chat AI** | Konteks percakapan (20 pesan terakhir), jawaban panjang otomatis dipecah ke beberapa pesan. **Multilingual** — otomatis mengikuti bahasa user (Indonesia/Inggris). |
| 🧠 **Memori jangka panjang** | AI otomatis menyimpan fakta penting lewat *tool calling*, plus perintah manual `/ingat`. Memori dipakai lagi di sesi berikutnya; `/konsolidasi` menggabungkan memori yang berulang. |
| 🖥️ **Dashboard web** | `/`, `/panel`, `/dokumen`, `/keyword`, `/memori`, `/transkrip`, `/moderasi`, `/pengaturan` — gaya editorial gelap, konsolidasi memori dari browser | (latar `#0D0D0F`, teks Wafer `#E2D1CC`, aksen Kimberly, tombol solid tanpa gradient): sidebar kiri, grafik aktivitas 7 hari, kartu statistik per server. Dropdown memakai **nama server** (bukan ID), dan panel "Buat Room AI" bisa dikirim, dipindah, atau dimatikan dari halaman `/panel`. Aktif kalau `DASHBOARD_TOKEN` diisi; tanpa framework, satu proses dengan bot. |
| 📚 **Dokumen RAG** | Upload `.txt`/`.md`/`.csv`/`.json`/`.pdf`/`.docx` (maks 8 MB) lewat `/dokumen tambah` atau dashboard. AI menjawab dari isi dokumen dan menyebut sumbernya (`📚 Sumber: faq.md — bagian 3`). Pencarian BM25 bawaan — **tanpa API key tambahan**. |
| 🔑 **Keyword kustom** | Admin menulis jawaban acuan; AI memakainya sebagai **fakta** dan menyusun ulang kalimatnya agar **bervariasi setiap kali** (bukan copy-paste). |
| 🎭 **Persona per server** | Mis. "kamu guru bahasa Inggris yang sabar" — berlaku untuk semua room di server itu. |
| 📄 **Transkrip sesi** | HTML mandiri (dark mode, rapi, aman dari XSS) berisi percakapan + memori + ringkasan AI. Dikirim ke DM dan/atau channel arsip. |
| 🛡️ **Moderasi otomatis** | Filter kata terlarang di semua channel teks: hapus pesan / tegur / timeout. Pola `k0nt0l` tetap tertangkap, staff dikecualikan, semua pelanggaran tercatat di dashboard `/moderasi`. Lihat [docs/moderation.md](docs/moderation.md). |
| 🖼️ **Vision (gambar)** | Member kirim gambar di room AI → AI membacanya dengan model multimodal. Gambar dikirim sebagai data URI (tanpa storage). Lihat [docs/vision-voice.md](docs/vision-voice.md). |
| 🎙️ **Voice (STT/TTS)** | Voice note ditranskrip jadi pertanyaan, dan bot bisa membalas dengan pesan suara. Ada `/ucap` untuk mengubah teks jadi audio. |
| 🔁 **Fallback multi-provider** | Provider utama kena limit/error → otomatis pindah ke provider cadangan (Groq → Gemini → OpenRouter), tanpa restart. |
| 🛡️ **Rate limit & guard** | Batas pesan per menit, validasi input, penanganan error yang ramah, tanpa membocorkan system prompt. |
| 🐳 **Siap deploy** | Docker multi-stage, volume SQLite, tanpa dependensi native (pakai `node:sqlite` bawaan Node 22). |
| 🐘 **Postgres & multi-shard** | Cukup isi `DATABASE_URL` untuk pindah dari SQLite ke Postgres (skema otomatis, migrasi data satu perintah). Beberapa instance bisa berbagi satu database lewat `SHARD_COUNT`/`SHARD_INDEX`. Lihat [docs/postgres.md](docs/postgres.md). |

---

## 🧰 Tech stack & alasan

```
Runtime   Node.js 22 LTS
Bahasa    TypeScript (strict)
Discord   discord.js v14
AI        Groq — openai/gpt-oss-120b (OpenAI-compatible API)
Database  node:sqlite (built-in Node 22) — tanpa node-gyp, tanpa build tools; Postgres opsional lewat `DATABASE_URL`
Validasi  zod + dotenv
Deploy    Docker multi-stage + docker-compose
```

**Kenapa Node.js, bukan Python?** Hampir seluruh fitur di atas adalah kerjaan **Discord API** (button, permission overwrite, lifecycle channel, transcript), bukan kerjaan ML. `discord.js` paling matang untuk komponen & permission, tutorial pola ticket-AI mayoritas juga JS. Akses LLM cukup HTTP call — tidak ada keuntungan Python di sini. Kalau nanti butuh embedding lokal/fine-tuning, itu lebih sehat dipecah jadi service Python terpisah.

**Kenapa `node:sqlite`?** `better-sqlite3` butuh compile native (node-gyp + build tools) yang sering gagal di VPS kecil/Alpine. Modul `node:sqlite` sudah tersedia di Node 22 sehingga image Docker cukup `node:22-slim` tanpa compiler. Skalanya lebih dari cukup untuk ribuan memori & transcript. Butuh Postgres atau beberapa instance sekaligus? Semua query sudah async dan portable — cukup isi `DATABASE_URL` (lihat [docs/postgres.md](docs/postgres.md)).

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
   `Manage Channels`, `View Channels`, `Send Messages`, `Manage Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Use External Emojis`, `Moderate Members` *(untuk timeout moderasi — kalau tidak ada, timeout gagal dan hanya tercatat di log)*.
6. Buka URL hasil generate, pilih server, authorize.

> URL siap pakai (ganti `YOUR_CLIENT_ID`):
> `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099909803952&scope=bot%20applications.commands`

### 2. Ambil API key Groq

Buat key di <https://console.groq.com/keys> → jadi `AI_API_KEY`. Free tier sudah cukup untuk bot komunitas.

### 3. Jalankan bot

```bash
git clone https://github.com/whyuangga/Zypher-AI-Bot.git
cd Zypher-AI-Bot
npm install
cp .env.example .env       # lalu isi nilainya
npm run doctor             # cek semua API key hidup
npm run dev                # mode development (auto-reload)
```

**Konteks penting:** dengan Groq sebagai provider utama, key Groq ditaruh di **`AI_API_KEY`**
(bukan `GROQ_API_KEY` — variabel itu hanya dipakai kalau Groq dijadikan cadangan).

Isi minimal `.env` (cukup 3 baris):

```env
DISCORD_TOKEN=xxxxx.xxxxx.xxxxx
CLIENT_ID=123456789012345678
AI_API_KEY=gsk_xxxxxxxx
```

Versi lengkap dengan 3 provider cadangan (disarankan):

```env
DISCORD_TOKEN=xxxxx.xxxxx.xxxxx
CLIENT_ID=123456789012345678
DEV_GUILD_ID=123456789012345678

AI_API_KEY=gsk_xxxxxxxxxxxxxxxx        # ← Groq (utama)
GEMINI_API_KEY=AIzaSy...               # ← cadangan 1
OPENROUTER_API_KEY=sk-or-v1-...        # ← cadangan 2
NVIDIA_API_KEY=nvapi-...               # ← cadangan 3

AI_FALLBACKS=gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free,nvidia:openai/gpt-oss-120b
```

Penjelasan tiap variabel (termasuk aturan penulisan seperti komentar inline & tanda kutip) ada di
**[docs/setup.md](docs/setup.md#langkah-3--isi-env)**.

Saat pertama jalan, bot otomatis mendaftarkan slash command. Lalu di Discord:

```
/panel            → kirim panel tombol ke channel ini
```

Klik **Buat Room AI** → channel privat muncul → mulai ngobrol.

---

## ⚙️ Konfigurasi `.env`

| Variabel | Default | Fungsi |
|---|---|---|
| `DISCORD_TOKEN` | — | Token bot (**wajib**) — alias: `DISCORD_BOT_TOKEN` |
| `CLIENT_ID` | — | Application ID (**wajib**) — alias: `DISCORD_CLIENT_ID` |
| `DEV_GUILD_ID` | kosong | ID server testing. Terisi = command didaftarkan per-guild (instan). Kosong = global (bisa sampai 1 jam). |
| `AI_API_KEY` | — | API key Groq (**wajib**) |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | Endpoint OpenAI-compatible. Ganti untuk pindah provider. |
| `AI_MODEL` | `openai/gpt-oss-120b` | Model yang dipakai (lihat [docs/models.md](docs/models.md)) |
| `AI_TEMPERATURE` | `0.8` | Kreativitas (0–2). Naikkan kalau variasi jawaban terasa monoton. |
| `AI_MAX_TOKENS` | `700` | Panjang maksimal jawaban |
| `AI_HISTORY_LIMIT` | `20` | Jumlah pesan terakhir sebagai konteks |
| `AI_FALLBACKS` | kosong | Provider cadangan, mis. `gemini:gemini-3.8-flash,openrouter:...` |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `GROQ_API_KEY` | kosong | Key untuk provider cadangan |
| `RAG_ENABLED` | `true` | Aktifkan dokumen rujukan (RAG) |
| `RAG_TOP_K` | `5` | Jumlah potongan dokumen yang masuk prompt |
| `RAG_MAX_CHARS` | `200000` | Batas ukuran satu dokumen |
| `EMBED_MODEL`, `EMBED_BASE_URL`, `EMBED_API_KEY` | kosong | Embeddings opsional untuk pencarian semantik (lihat [docs/rag.md](docs/rag.md)) |
| `DASHBOARD_TOKEN` | kosong | Token login dashboard web. **Kosong = dashboard mati** |
| `DASHBOARD_PORT` | `3000` | Port dashboard. Alias dari panel: `WEB_PORT`, `PORT`, `SERVER_PORT` (nilai `0` = belum diisi) |
| `WEB_ENABLED` | `true` | `false` = matikan dashboard walau token terisi |
| `WEB_HOST` | `0.0.0.0` | Alamat bind dashboard. Pakai `127.0.0.1` bila dashboard hanya diakses lewat reverse proxy |
| `PUBLIC_URL` | kosong | Alamat publik dashboard yang ditampilkan di log |
| `NODE_OPTIONS` | — | Set di **panel hosting** (bukan `.env`): `--max-old-space-size=384` untuk container 512 MB |
| `DATABASE_PATH` | `./data/zypher.db` | Lokasi file SQLite |
| `DATABASE_URL` | kosong | Postgres opsional. Terisi = SQLite diabaikan (lihat [docs/postgres.md](docs/postgres.md)) |
| `SHARD_COUNT` / `SHARD_INDEX` | `1` / `0` | Multi-shard: bagi server ke beberapa instance yang berbagi satu database |
| `AUTO_MEMORY` | `true` | Simpan memori otomatis lewat tool calling |
| `RATE_LIMIT_PER_MINUTE` | `12` | Batas request AI per user/menit |
| `MAX_INPUT_CHARS` | `2000` | Panjang pesan user yang diproses |
| `AI_CATEGORY_ID` | kosong | Kategori tempat room dibuat (kosong = bot buat "AI Lounge") |
| `TRANSCRIPT_CHANNEL_ID` | kosong | Channel arsip transkrip & ringkasan sesi |
| `STAFF_ROLE_ID` | kosong | Role staff yang boleh melihat/menutup room member |
| `ADMIN_ONLY_ROOMS` | `false` | `true` = hanya admin yang bisa membuat room |
| `MODERATION_ENABLED` | `false` | Aktifkan filter kata terlarang (bisa juga dari `/moderasi`) — [docs](docs/moderation.md) |
| `MODERATION_WORDS` | kosong | Daftar kata terlarang, dipisah koma |
| `MODERATION_ACTION` | `delete` | `delete` · `warn` (hapus + tegur) · `timeout` (hapus + bisukan) |
| `MODERATION_TIMEOUT_MINUTES` | `10` | Durasi timeout moderasi (1–10080 menit) |
| `VISION_ENABLED` | `false` | AI membaca gambar di room AI — [docs](docs/vision-voice.md) |
| `VISION_MODEL` | `meta-llama/llama-4-scout-17b-16e-instruct` | Model multimodal yang dipakai saat ada gambar |
| `VISION_MAX_MB` | `5` | Batas ukuran gambar yang diunduh bot |
| `VOICE_ENABLED` | `false` | Transkrip voice note jadi pertanyaan — [docs](docs/vision-voice.md) |
| `STT_MODEL` | `whisper-large-v3` | Model transkrip |
| `TTS_ENABLED` | `true` | Balas voice note dengan pesan suara — [docs](docs/vision-voice.md) |
| `TTS_MODEL` / `TTS_VOICE` | `playai-tts` / `Fritz-PlayAI` | Model & suara TTS |
| `VOICE_MAX_MB` | `20` | Batas ukuran audio yang ditranskrip |

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
| `/panel [channel]` | Admin | Kirim panel tombol pembuat room AI (alternatif: dashboard → **Panel**) |
| `/bantuan` | Semua | Panduan singkat (ephemeral) |
| `/tanya pertanyaan:` | Semua | Tanya AI cepat tanpa room, jawaban hanya terlihat oleh penanya |
| `/ucap teks:` | Semua | Ubah teks jadi pesan suara (butuh `VOICE_ENABLED` + `TTS_ENABLED`) |
| `/ingat fakta:` | Semua | Simpan memori manual tentang diri sendiri |
| `/memori [user]` | Semua / admin | Lihat daftar memori (dengan id) |
| `/lupakan id:` / `semua:true` | Semua | Hapus satu / semua memori |
| `/reset` | Pemilik room / staff | Hapus riwayat konteks, memori tetap |
| `/dokumen tambah file:` | Admin | Upload dokumen teks sebagai pengetahuan AI |
| `/dokumen daftar\|hapus` | Admin | Kelola dokumen pengetahuan |
| `/dokumen cari pertanyaan:` | Semua | Uji potongan dokumen yang akan dipakai AI |
| `/keyword tambah\|daftar\|hapus` | Admin | Kelola jawaban acuan yang divariasikan AI |
| `/persona set\|lihat\|hapus` | Admin | Atur peran AI untuk seluruh server |

Lampiran di room AI: **gambar** (JPG/PNG/WebP) dibaca AI bila `VISION_ENABLED=true`,
**voice note** ditranskrip bila `VOICE_ENABLED=true`.

Tombol di room: **Akhiri Sesi** (konfirmasi → transkrip → channel dihapus) dan **Bantuan**.

---

## 🧠 Bagaimana AI-nya bekerja

**1. System prompt** (`src/features/prompt.ts`) dirakit tiap request dari:
nama bot & server, nama member, tanggal, aturan gaya bahasa, persona server, memori user, dan keyword yang cocok.

**2. Memori otomatis** — model diberi dua tool: `simpan_memori` dan `hapus_memori`. Setelah user bicara, model memutuskan sendiri apakah ada fakta yang layak disimpan (nama, pekerjaan, preferensi). Hasilnya masuk tabel `memories` dan dipakai lagi di sesi berikutnya. Bisa juga manual via `/ingat`.

**3. Keyword bervariasi** — `/keyword tambah` menyimpan *jawaban acuan*. Saat pesan user cocok (bukan harus persis: pencocokan kata kunci + toleransi ≥60% kata), isi acuan masuk ke prompt sebagai **fakta resmi** dengan instruksi: jangan copy-paste, susun ulang bahasanya dengan variasi. Hasilnya: inti jawaban konsisten, kalimatnya selalu segar.

**4. Dokumen RAG** (`src/features/rag.ts`) — setiap pertanyaan, bot mencari potongan dokumen server
paling relevan (BM25, digabung embeddings kalau `EMBED_MODEL` diisi), lalu menyelipkannya ke system prompt
sebagai **rujukan tertinggi**. Potongan yang berdampingan ikut diambil agar konteks tidak terpotong, dan
nama dokumen muncul di bawah jawaban. Tidak ada hasil relevan = AI menjawab seperti biasa.

**5. Transkrip** — pesan channel diambil (hingga 600), di-escape, dirender jadi HTML mandiri bertema gelap, ditambah daftar memori dan **ringkasan sesi** dari AI. Dikirim ke DM + channel arsip, lalu channel dihapus.

**6. Streaming** — jawaban dikirim lewat SSE dari provider, ditampung, lalu `DiscordStreamer`
meng-edit pesan berkala (±1,4 detik, di bawah batas edit Discord) dan menyelesaikan sisanya sebagai
pesan lanjutan. Kalau koneksi putus setelah teks tampil, jawaban parsial dipertahankan dan diberi catatan —
bot **tidak** berpindah provider di tengah jalan agar jawaban tidak dobel.

**7. Guardrail** — rate limit sliding-window, potong input, `allowedMentions: parse []` (anti `@everyone`), escape HTML pada transkrip, larangan membocorkan system prompt, dan fallback ke pesan ramah saat AI error/timeout.

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

Dashboard web ikut menyala di port 3000 kalau `DASHBOARD_TOKEN` diisi. Login lewat form `/login`
atau link cepat `/masuk/<token>` (langsung masuk, URL-nya tidak tertinggal di riwayat browser).
`docker-compose.yml` sudah meneruskan portnya.

### Panel hosting (tanpa VPS, gratis)

Cocok untuk Wispbyte / Bot-Hosting / Pterodactyl. Build dulu di laptop, lalu upload hasilnya:

```bash
npm run bundle        # menghasilkan zypher-deploy.zip (dist/ + package.json)
```

Atau clone langsung dari GitHub: `npm install` sudah otomatis menjalankan `tsc` lewat hook
`prepare`, jadi panel Pterodactyl cukup diarahkan ke `dist/index.js` tanpa perintah build manual.

Panduan per-langkah (termasuk syarat **Node.js 22**): **[docs/hosting.md](docs/hosting.md)**.

### Platform PaaS

Railway / Fly.io / Render bisa langsung memakai Dockerfile, **tapi waspada**: bot Discord harus hidup 24/7
dan SQLite butuh disk persisten. Render free *sleep* saat idle (bot jadi offline) dan disk-nya sementara
(data hilang tiap redeploy).

Perbandingan lengkap + rekomendasi yang benar-benar gratis: **[docs/hosting.md](docs/hosting.md)**.

---

## 🧪 Uji cepat tanpa Discord

```bash
npm run doctor         # ping tiap provider (chat + streaming) dan laporkan hasilnya
npm run models         # daftar model yang benar-benar tersedia di provider kamu
npm run smoke          # 82 test logika inti (termasuk RAG, moderasi, vision/voice, panel)
npm run smoke:pg       # 12 test jalur Postgres (pg-mem, tanpa server database)
npm run test:fallback  # uji rantai fallback provider dengan server tiruan
npm run dashboard      # nyalakan dashboard web saja, tanpa bot Discord
npm run migrate:pg     # pindahkan data SQLite → Postgres
npm run bundle         # bikin zypher-deploy.zip untuk panel hosting
npm run token -- --write   # bikin & pasang DASHBOARD_TOKEN acak di .env
```

> `npm install` juga menjalankan `tsc` (hook `prepare`), jadi `dist/` selalu siap setelah install.

`npm run doctor` adalah langkah pertama saat ada masalah AI: ia mengirim request sungguhan ke provider
utama dan setiap fallback, lalu menampilkan latensi, isi balasan, dan dukungan streaming per provider.

`npm run models` menampilkan model yang **benar-benar tersedia** di providermu (memanggil endpoint `/models`,
menyaring model non-chat, menandai model yang dipakai bot) — lebih akurat daripada daftar di dokumentasi.

`npm run smoke` menguji CRUD memori, pencocokan keyword (termasuk kalimat yang dibalik), perakitan prompt,
riwayat room, escape XSS pada transkrip, chunking pesan, rate limit, parsing `AI_FALLBACKS`, pemotongan
dokumen RAG, tokenizer/BM25, ingest–cari–hapus dokumen di database sungguhan (in-memory), serta
rendering tiap halaman dashboard (sidebar, kartu statistik, grafik 7 hari, empty state, escape XSS).

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
| `AI_API_KEY wajib diisi` padahal sudah diisi | Key Groq tertaruh di `GROQ_API_KEY`. Saat Groq utama, taruh di `AI_API_KEY` — lihat [docs/setup.md](docs/setup.md). |
| `API key AI ditolak` | `AI_API_KEY` salah/kedaluwarsa di `.env`. Jalankan `npm run doctor` untuk memastikan provider mana yang bermasalah. |
| `Kuota AI sedang penuh` | Rate limit provider tercapai — turunkan `RATE_LIMIT_PER_MINUTE`, atau isi `AI_FALLBACKS` agar otomatis pindah provider. |
| `Semua provider AI sedang tidak tersedia` | Semua provider (utama + fallback) gagal. Cek log: biasanya kuota habis harian atau key salah. |
| Model tidak ditemukan / model butuh plan berbayar | Katalog gratis berubah (mis. Llama 3.3 sudah tidak gratis di Groq). Jalankan `npm run models`, lalu pakai ID yang muncul. |
| Mau provider lain di luar daftar | Hanya 5 nama yang dikenali: `groq`, `gemini`, `openrouter`, `nvidia`, `ollama`. Provider yang minta kartu (Cerebras, Mistral) sengaja tidak didukung. |
| `Cannot find module 'node:sqlite'` / `ERR_UNKNOWN_BUILTIN_MODULE` | Node.js di server masih v20 ke bawah. Bot butuh **v22+**; di panel hosting ganti Docker image ke Node 22/24, di VPS pasang Node 22 LTS. |
| Bot mati saat `npm install` di panel hosting | RAM hosting habis. Upload folder `node_modules` dari laptop, atau pakai image/hosting dengan RAM ≥512 MB. |
| Jawaban muncul sekaligus, bukan streaming | Normal bila provider/model menolak `stream: true` — bot otomatis memakai mode non-streaming di provider tersebut (lihat log). |
| AI tidak menjawab dari dokumen | Cek `/dokumen cari pertanyaan:...`. Kalau kosong, kata kuncinya tidak ada di dokumen — tambahkan sinonim atau pakai istilah yang dipakai member. |
| Upload PDF/DOCX gagal | Maksimal **8 MB**, PDF harus berisi teks (hasil scan perlu OCR dulu), dan file tidak boleh terkunci password. Lihat [docs/rag.md](docs/rag.md). |
| AI menjawab "belum bisa membaca gambar" | `VISION_ENABLED` masih `false`. Nyalakan dan pastikan `VISION_MODEL` benar-benar model **multimodal** (`npm run models -- groq --all`). |
| Error `model ... does not support image input` | `VISION_MODEL` bukan model vision, atau provider tidak mendukung `image_url`. Ganti model atau matikan `VISION_ENABLED`. |
| Voice note tidak ditranskrip | `VOICE_ENABLED` belum aktif, file > `VOICE_MAX_MB`, atau provider menolak endpoint `/audio/transcriptions`. Cek log: nama provider ikut dicatat. |
| Balasan suara tidak muncul | `TTS_ENABLED=false`, kuota TTS habis, atau model suara tidak ada di provider. Jawaban teks tetap dikirim — tidak ada yang hilang. |
| Panel "Buat Room AI" masih muncul padahal fitur room mau dimatikan | Dashboard → **Panel** → *Hapus panel* (menghapus pesannya) atau matikan centang *Izinkan member membuat room* (pesan tetap ada, tombol ditolak). Tanpa dashboard: hapus pesan panelnya di Discord — tombolnya ikut hilang. |
| Panel tidak bisa dikirim dari dashboard | Halaman Panel butuh bot hidup; mode dashboard-saja (`npm run dashboard`) hanya bisa menyimpan tombol aktif/nonaktif. Cek juga izin bot: View Channel, Send Messages, Embed Links, Manage Messages. |
| Dropdown server menampilkan `Server 577090` | Nama server diambil dari Discord saat bot login. Jalankan bot sekali; setelah itu nama (dan rename berikutnya) tersimpan otomatis. |
| Moderasi tidak bereaksi | Pastikan dulu: moderasi aktif di `/moderasi` (menang atas `.env`), daftar kata tidak kosong, dan pengirimnya bukan staff/Manage Messages. Bot juga perlu izin **Manage Messages** untuk menghapus dan **Moderate Members** untuk timeout. |
| `connect ECONNREFUSED` / `SSL required` (Postgres) | `DATABASE_URL` salah atau `sslmode=require` belum ditambahkan. Tes cepat: `DATABASE_URL=... npm run migrate:pg`. Lihat [docs/postgres.md](docs/postgres.md). |
| Mau ganti token dashboard | `npm run token -- --write`, lalu perbarui juga variabel di panel hosting dan restart. |
| Dashboard tidak bisa dibuka | `DASHBOARD_TOKEN` kosong atau kurang dari 12 karakter. Cek log: harus ada `🌐 Dashboard: …`. |
| Data hilang setelah redeploy | Hosting tanpa disk persisten. Lihat [docs/hosting.md](docs/hosting.md) + unduh backup `zypher.db`. |
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
│   ├── rag.ts               # RAG: ingest dokumen, indeks BM25, pencarian hybrid
│   ├── rag-embed.ts         # embeddings opsional (endpoint /embeddings)
│   ├── memory.ts            # tool memori & format untuk prompt
│   ├── keywords.ts          # pencocokan keyword
│   ├── prompt.ts            # perakitan system prompt
│   ├── buttons.ts           # router button interaction
│   ├── moderation.ts        # filter kata terlarang + log pelanggaran
│   ├── vision.ts            # lampiran gambar → data URI untuk model multimodal
│   ├── panel.ts             # kirim/hapus panel room AI (dipakai /panel & dashboard)
│   └── ui.ts                # embed & komponen
├── web/
│   ├── server.ts            # dashboard: node:http, auth token, API JSON
│   ├── ui/                  # theme, shell, ikon SVG, halaman (server-rendered)
│   └── standalone.ts        # npm run dashboard (tanpa bot Discord)
├── db/
│   ├── index.ts             # lazy init driver + helper all/get/run/insert
│   ├── driver.ts            # driver SQLite (node:sqlite) & Postgres (pg)
│   ├── schema.ts            # DDL SQLite + DDL Postgres
│   └── repo.ts              # semua query (async, portable dua engine)
└── lib/                     # llm, audio (STT/TTS), transcript, ratelimit, text, chunker, lexical, shard, logger
scripts/smoke.ts             # smoke test tanpa Discord (SQLite)
scripts/smoke-pg.ts          # smoke test jalur Postgres (pg-mem)
scripts/migrate-to-pg.ts     # migrasi data SQLite → Postgres
docs/setup.md                # panduan setup langkah-demi-langkah
docs/sample-transcript.html  # contoh hasil transkrip
docs/providers.md            # provider AI free tier + contoh .env
docs/models.md               # ID model gratis per provider + rekomendasi
docs/rag.md                  # dokumen pengetahuan AI (RAG)
docs/dashboard.md            # dashboard web: setup & keamanan
docs/postgres.md             # Postgres, migrasi data, multi-shard
docs/moderation.md           # moderasi otomatis + log pelanggaran
docs/vision-voice.md         # vision gambar, STT/TTS, /ucap
docs/hosting.md              # hosting bot gratis 24/7 + backup
```

---

## 🗺️ Roadmap ide berikutnya

- [x] Streaming jawaban (edit pesan bertahap)
- [x] RAG dokumen server (`.txt`/`.md`/`.csv`/`.json`, pencarian hybrid)
- [x] Web dashboard (statistik, grafik aktivitas, kelola dokumen/keyword/memori/persona, uji pencarian)
- [x] Dukungan PDF/DOCX (ekstraksi teks via `unpdf` + `fflate`, tanpa dependency native)
- [x] Riwayat transkrip dari dashboard (arsip di SQLite, unduh & hapus dari web)
- [x] Moderasi otomatis + logging (filter kata terlarang, halaman `/moderasi`, audit log)
- [x] Dukungan gambar (vision) & voice (STT Whisper + TTS PlayAI, `/ucap`)
- [x] Postgres untuk multi-shard (driver async SQLite ↔ Postgres, `npm run migrate:pg`, `SHARD_COUNT`/`SHARD_INDEX`)

---

## 📜 Lisensi

MIT © 2026 Wahyu Angga Saputra — lihat [LICENSE](LICENSE).
