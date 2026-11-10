# 🤖 Zypher AI Bot

Bot Discord dengan **AI sebagai fitur utama**: member mengobrol dengan AI lewat **DM yang benar-benar privat** — tidak bisa dibaca admin, staff, maupun pemilik server. Lengkap dengan **memori jangka panjang**, **jawaban keyword kustom yang divariasikan AI**, **dokumen rujukan (RAG)** yang membuat AI tahu isi FAQ server, **transkrip sesi** yang dikirim ke DM, dan **dashboard web** untuk mengelola dokumen.

Dibangun dengan **Node.js + TypeScript**, [discord.js v14](https://discord.js.org), dan LLM [Groq](https://console.groq.com) (bisa diganti provider lain tanpa menyentuh kode).

> 📖 **Baru pertama kali? Ikuti panduan langkah-demi-langkah di [docs/setup.md](docs/setup.md)** —
> dari membuat aplikasi Discord, mengisi `.env`, sampai bot benar-benar menjawab.
>
> ☁️ **Mau online 24/7 tanpa bayar?** Lihat [docs/hosting.md](docs/hosting.md) — perbandingan jujur
> hosting gratis (Oracle Cloud, GCP, panel bot) plus mana yang merusak data SQLite.

```
Member klik "Chat via DM" di panel
        ↓
Bot mengirim DM (tidak ada channel yang dibuat)
        ↓
Chat bebas → AI menjawab, mengingat fakta, memakai keyword admin
        ↓
"/akhiri" → transkrip HTML dikirim ke DM → riwayat dihapus
```

> **Kenapa DM?** Channel dan private thread di Discord tetap bisa dibaca pemilik server,
> role dengan izin Administrator, dan siapa pun yang punya `Manage Threads`. DM tidak bisa
> dibaca siapa pun selain member dan bot. Itu satu-satunya cara benar-benar privat di Discord.

---

## 🔒 Privasi member

Bot ini dirancang supaya **admin server tidak bisa membaca percakapan atau fakta pribadi member.**

| Data | Siapa yang bisa baca |
|---|---|
| Isi percakapan | Hanya member + bot (DM) |
| Memori member | Hanya member itu sendiri |
| Transkrip | Hanya member (dikirim ke DM saat `/akhiri`) |
| Cuplikan pesan di log moderasi | **Tidak disimpan** — hanya kata yang cocok + tindakan |

Yang **tetap** terlihat admin di dashboard: jumlah sesi DM, jumlah pesan, jumlah dokumen, keyword,
dan daftar pelanggaran moderasi (nama pelanggar + kata + tindakan).

Yang **tidak pernah** ditampilkan: isi percakapan, isi memori, isi transkrip.

### Kenapa bukan channel/thread?

| Media | Siapa yang bisa baca |
|---|---|
| Channel privat | Member, admin, **pemilik server**, role `Administrator` |
| Private thread | Member, **`Manage Threads`**, **pemilik server**, `Administrator` |
| **DM** | **Hanya member dan bot** |

Channel dan thread selalu bisa dibaca pemilik server dan pemegang `Administrator` — itu batas
platform Discord yang tidak bisa dilewati bot. Karena itu fitur room/thread dihapus dan diganti DM.

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 💬 **Chat privat via DM** | Tombol **Chat via DM** di panel mengirim DM ke member. **Tidak ada channel/thread yang dibuat**, jadi tidak ada yang bisa dibaca admin server. Konteksnya selalu server tempat bot ini dipasang (satu bot = satu server). Sesi ditutup dengan `/akhiri`. |
| ⚡ **Streaming jawaban** | Jawaban muncul bertahap (edit pesan tiap ±1,4 detik, menghormati rate limit Discord), bukan menunggu jeda panjang. Otomatis jatuh ke mode non-streaming kalau provider menolaknya. |
| 💬 **Chat AI** | Konteks percakapan (20 pesan terakhir), jawaban panjang otomatis dipecah ke beberapa pesan. **Multilingual** — otomatis mengikuti bahasa user (Indonesia/Inggris). |
| 🧠 **Memori jangka panjang** | AI otomatis menyimpan fakta penting lewat *tool calling*, plus perintah manual `/ingat`. Memori dipakai lagi di sesi berikutnya; `/konsolidasi` menggabungkan memori yang berulang. |
| 👋 **Sambutan & perpisahan** | Sapaan yang **digenerate AI per orang** — pakai nama panggilan + waktu setempat, jadi kalimatnya beda tiap member (bukan template seragam). Bisa disertai **kartu PNG** berisi nama & sapaan, dikirim lewat DM atau channel. Saat member keluar, bot mengucapkan **salam perpisahan** dengan nada sopan. Lihat [docs/sambutan-agent.md](docs/sambutan-agent.md). |
| 🗣️ **AI Agent di channel** | Di **dua** channel: bot ikut ngobrol seperti anggota komunitas di channel ngobrol (balas mention/reply, tanggapi emoji/sticker, menyapa saat sepi), dan **mengomentari gambar & video** di channel galeri. **Diam saat obrolan ramai**, dibatasi N balasan per jam, dan riwayat obrolannya **hanya di memori** — tidak ditulis ke database. |
| 🖥️ **Dashboard web** | `/`, `/panel`, `/sambutan`, `/agent`, `/dokumen`, `/keyword`, `/moderasi`, `/pengaturan` (8 halaman) — gaya editorial gelap ([pratinjau](docs/screenshots/README.md)), **toggle fitur AI per server** (RAG, Auto Memory, tombol chat DM khusus admin, Suara balasan AI). Sidebar kiri, grafik aktivitas 7 hari, kartu statistik per server. Nama server tampil di topbar (bukan ID mentah), dan panel "Chat via DM" bisa dikirim, dipindah, atau dimatikan dari `/panel`. **Dashboard tidak menyimpan isi percakapan maupun memori member.** |
| 📚 **Dokumen RAG** | Upload `.txt`/`.md`/`.csv`/`.json`/`.pdf`/`.docx` (maks 8 MB) lewat `/dokumen tambah` atau dashboard. AI menjawab dari isi dokumen dan menyebut sumbernya (`📚 Sumber: faq.md — bagian 3`). Pencarian BM25 bawaan — **tanpa API key tambahan**. |
| 🔑 **Keyword kustom** | Admin menulis jawaban acuan; AI memakainya sebagai **fakta** dan menyusun ulang kalimatnya agar **bervariasi setiap kali** (bukan copy-paste). |
| 🎭 **Persona per server** | Mis. "kamu guru bahasa Inggris yang sabar" — berlaku untuk semua chat yang memakai server itu sebagai konteks. |
| 📄 **Transkrip sesi** | HTML mandiri (dark mode, rapi, aman dari XSS) berisi percakapan + memori + ringkasan AI. **Hanya dikirim ke DM member** — tidak diarsipkan di dashboard. |
| 🛡️ **Moderasi otomatis** | Filter kata terlarang di semua channel teks: hapus pesan / tegur / timeout. Pola `k0nt0l` tetap tertangkap, staff dikecualikan, semua pelanggaran tercatat di dashboard `/moderasi`. Lihat [docs/moderation.md](docs/moderation.md). |
| 🖼️ **Vision (gambar)** | Member kirim gambar di DM → AI membacanya dengan model multimodal. Gambar dikirim sebagai data URI (tanpa storage). Lihat [docs/vision-voice.md](docs/vision-voice.md). |
| 🎙️ **Voice (STT/TTS)** | Voice note ditranskrip jadi pertanyaan, dan bot bisa membalas dengan pesan suara. Ada `/ucap` untuk mengubah teks jadi audio. **Suara otomatis** — jawaban AI dibacakan (TTS) bila `TTS_REPLY_IN_ROOM=true`. |
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
   - ✅ **Server Members Intent** ← *wajib untuk sambutan & salam perpisahan* (event `GuildMemberAdd`/`GuildMemberRemove` tidak terkirim tanpa ini). Kalau dimatikan, kedua fitur itu tidak akan pernah jalan.
5. **OAuth2 → URL Generator**, centang `bot` + `applications.commands`, izin yang dibutuhkan:
   `Manage Channels`, `Manage Threads`, `Create Private Threads`, `View Channels`, `Send Messages`, `Manage Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Use External Emojis`, `Moderate Members` *(untuk timeout moderasi — kalau tidak ada, timeout gagal dan hanya tercatat di log)*.
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
GUILD_ID=123456789012345678      # ← WAJIB: server tempat bot ini tinggal

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

Klik **Chat via DM** → bot mengirim DM ke kamu → mulai ngobrol di DM.

---

## ⚙️ Konfigurasi `.env`

| Variabel | Default | Fungsi |
|---|---|---|
| `DISCORD_TOKEN` | — | Token bot (**wajib**) — alias: `DISCORD_BOT_TOKEN` |
| `CLIENT_ID` | — | Application ID (**wajib**) — alias: `DISCORD_CLIENT_ID` |
| `GUILD_ID` | — | **Wajib.** ID server tempat bot ini tinggal. Bot menolak start kalau kosong. Alias: `DEV_GUILD_ID`, `DISCORD_GUILD_ID`, `SERVER_ID` |
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
| `MODLOG_CHANNEL_ID` | kosong | Channel log moderasi (opsional). Transkrip tidak diarsipkan ke sini. |
| `STAFF_ROLE_ID` | kosong | Role staff yang boleh melihat/menutup room member |
| `ADMIN_ONLY_ROOMS` | `false` | `true` = hanya admin yang bisa membuat room |
| `MODERATION_ENABLED` | `false` | Aktifkan filter kata terlarang (bisa juga dari `/moderasi`) — [docs](docs/moderation.md) |
| `MODERATION_WORDS` | kosong | Daftar kata terlarang, dipisah koma |
| `MODERATION_ACTION` | `delete` | `delete` · `warn` (hapus + tegur) · `timeout` (hapus + bisukan) |
| `MODERATION_TIMEOUT_MINUTES` | `10` | Durasi timeout moderasi (1–10080 menit) |
| `VISION_MODEL` | `meta-llama/llama-4-scout-17b-16e-instruct` | Model multimodal untuk gambar (vision selalu aktif, tidak ada sakelar) |
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

## 1️⃣ Satu bot, satu server

Bot ini **dirancang untuk satu server**. Server itu ditentukan oleh `GUILD_ID` di
`.env` — wajib diisi, bot menolak start kalau kosong atau bukan angka.

Kenapa dibuat begitu? Satu token bot membawa satu set API key (Groq, Gemini, dst).
Kalau bot yang sama dipakai di banyak server, biaya API dan pengaturan tiap server
tercampur dalam satu kuota, dan admin server lain ikut mengatur persona/dokumen
milikmu. Jadi batasnya dibuat tegas.

| Situasi | Yang terjadi |
|---|---|
| `GUILD_ID` kosong | Bot menolak start, `.env` disebut di log |
| Bot diundang ke server lain | Bot mengirim alasan (kalau boleh menulis), lalu **keluar sendiri** |
| Member DM bot tapi bukan anggota server itu | Ditolak dengan sopan + saran fork |
| Admin membuka dashboard | Tidak ada pilihan server — yang tampil selalu `GUILD_ID` |

### Mau memakai bot ini di servermu?

Fork atau clone repo ini, lalu jalankan dengan **token dan API key milikmu sendiri**:

```bash
git clone https://github.com/whyuangga/Zypher-AI-Bot-Discord.git
cd Zypher-AI-Bot-Discord
cp .env.example .env
# isi: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, AI_API_KEY
```

Server lain hanya bisa memakai bot versi mereka sendiri — bukan bot ini.

---

## 💬 Daftar perintah

| Perintah | Akses | Fungsi |
|---|---|---|
| `/panel [channel]` | Admin | Kirim panel tombol **Chat via DM** (alternatif: dashboard → **Panel**) |
| `/bantuan` | Semua | Panduan singkat (ephemeral) |
| `/ucap teks:` | Semua | Ubah teks jadi pesan suara (butuh `VOICE_ENABLED` + `TTS_ENABLED`) |
| `/ingat fakta:` | Semua | Simpan memori manual tentang diri sendiri |
| `/memori` | Semua | Lihat daftar memori **milik sendiri** (dengan id) |
| `/lupakan id:` / `semua:true` | Semua | Hapus satu / semua memori sendiri |
| `/akhiri` | Semua | Tutup sesi DM → transkrip HTML dikirim ke DM → riwayat dihapus |
| `/reset` | Semua (termasuk DM) | Lupakan obrolan sebelumnya, mulai topik baru. **Sesi tetap aktif**, memori jangka panjang tetap ada |
| `/dokumen tambah file:` | Admin | Upload dokumen teks sebagai pengetahuan AI |
| `/dokumen daftar\|hapus` | Admin | Kelola dokumen pengetahuan |
| `/dokumen cari pertanyaan:` | Semua | Uji potongan dokumen yang akan dipakai AI |
| `/keyword tambah\|daftar\|hapus` | Admin | Kelola jawaban acuan yang divariasikan AI |
| `/persona set\|lihat\|hapus` | Admin | Atur peran AI untuk seluruh server |

Lampiran di DM: **gambar** (JPG/PNG/WebP) langsung dibaca AI memakai
`VISION_MODEL`, **voice note** ditranskrip bila `VOICE_ENABLED=true`. Membaca
gambar tidak perlu dinyalakan — cukup pastikan modelnya multimodal.

Tombol di panel server: **Chat via DM** (mengirim DM pembuka) dan **Cara Kerja**.
Tidak ada channel/thread yang dibuat — tidak ada yang bisa dibaca admin.

### Sambutan, perpisahan & AI Agent (tanpa command)

Fitur-fitur ini diatur **dari dashboard**, bukan lewat slash command:

- **Sambutan** (`/sambutan`) — bot menyapa member baru (AI, template, atau
  keduanya) dengan kartu PNG opsional.
- **Salam perpisahan** (`/sambutan`, kartu kedua) — ucapan saat member keluar.
  Wajib memilih channel; tanpa channel salam tidak dikirim.
- **AI Agent** (`/agent`) — bot ikut menghidupkan obrolan di **channel ngobrol**,
  dan mengomentari **gambar/video di channel galeri**. Bot diam saat obrolan
  ramai dan dibatasi per jam.

Keduanya juga bisa memakai **banner sendiri** (PNG/JPG/WebP diunggah dari
dashboard) sebagai strip atas kartu atau gambar embed.

Semua default mati, dan **kedua halaman punya tombol tes**: hasil sapaan, salam
perpisahan, balasan agent, sampai kalimat pemecah sepi bisa dilihat langsung di
dashboard — tanpa menunggu ada member bergabung dan tanpa mengirim pesan apa pun.

Panduan lengkap: **[docs/sambutan-agent.md](docs/sambutan-agent.md)**.

### `/reset` atau `/akhiri`?

Dua-duanya menghapus riwayat, tapi hasilnya beda:

| | `/reset` | `/akhiri` |
|---|---|---|
| Sesi setelah dijalankan | **tetap aktif** | ditutup |
| Bisa langsung bertanya lagi | ✅ | perlu kirim pesan baru dulu |
| Transkrip dikirim ke DM | ❌ | ✅ |
| Riwayat dihapus | ✅ | ✅ |
| Memori jangka panjang | tetap | tetap |

Pakai **`/reset`** kalau mau ganti topik tapi masih ingin lanjut ngobrol.
Pakai **`/akhiri`** kalau sudah selesai dan ingin menyimpan transkrip. Keduanya
bisa dipakai di DM.

### Setelah `/akhiri`, apakah harus klik "Chat via DM" lagi?

**Tidak.** Setelah `/akhiri`, kamu cukup **menulis pesan lagi di DM yang sama** —
bot otomatis membuka sesi baru dan mengirim satu baris pemberitahuan:

> 💬 Sesi baru dimulai — konteks **Nama Server**.

Riwayat lama tetap terhapus (bot mulai dari nol), memori jangka panjang tetap ada.

Konteksnya tidak mungkin berpindah server, karena bot ini **hanya untuk satu
server** (lihat [Satu bot, satu server](#-satu-bot-satu-server)). Panel dengan
tombol **Chat via DM** hanya diperlukan **pertama kali**.

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

**5. Transkrip** — pesan channel diambil (hingga 600), di-escape, dirender jadi HTML mandiri bertema gelap, ditambah daftar memori dan **ringkasan sesi** dari AI. Dikirim ke **DM member saja** (tidak disimpan di database, tidak ke channel arsip), lalu channel dihapus.

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
npm run smoke          # 220 test logika inti (termasuk RAG, moderasi, agent, sambutan, banner)
npm run smoke:pg       # 14 test jalur Postgres (pg-mem, tanpa server database)
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
| Slash command tidak muncul | Command didaftarkan global (bisa sampai 1 jam) saat pertama start. Pastikan undangan memakai scope `applications.commands`, dan bot berada di server `GUILD_ID`. |
| Bot diam saja di room | **Message Content Intent** belum aktif di Developer Portal → Bot. |
| Tombol **Chat via DM** bilang DM tertutup | Member perlu mengaktifkan **Privasi & Keamanan → Izinkan pesan langsung dari server** untuk server itu. |
| Transkrip tidak masuk DM | User menutup DM. Bot **tidak** mengarsipkan transkrip di mana pun — file dilampirkan di room, lalu channel dihapus **60 detik** kemudian agar member sempat mengunduh. |
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
| AI menjawab "belum bisa membaca gambar" | `VISION_MODEL` bukan model **multimodal**. Vision selalu aktif, jadi yang perlu diperbaiki adalah modelnya (`npm run models -- groq --all`). |
| Error `model ... does not support image input` | `VISION_MODEL` bukan model vision, atau provider tidak mendukung `image_url`. Ganti `VISION_MODEL` ke model multimodal. |
| Voice note tidak ditranskrip | `VOICE_ENABLED` belum aktif, file > `VOICE_MAX_MB`, atau provider menolak endpoint `/audio/transcriptions`. Cek log: nama provider ikut dicatat. |
| Balasan suara tidak muncul | `TTS_ENABLED=false`, kuota TTS habis, atau model suara tidak ada di provider. Jawaban teks tetap dikirim — tidak ada yang hilang. |
| Panel "Chat via DM" masih muncul padahal ingin dimatikan | Dashboard → **Panel** → *Hapus panel* (menghapus pesannya) atau matikan centang *Izinkan member chat* (pesan tetap ada, tombol ditolak). Tanpa dashboard: hapus pesan panelnya di Discord — tombolnya ikut hilang. |
| Panel tidak bisa dikirim dari dashboard | Halaman Panel butuh bot hidup; mode dashboard-saja (`npm run dashboard`) hanya bisa menyimpan tombol aktif/nonaktif. Cek juga izin bot: View Channel, Send Messages, Embed Links, Manage Messages. |
| Dropdown server menampilkan `Server 577090` | Nama server diambil dari Discord saat bot login. Jalankan bot sekali; setelah itu nama (dan rename berikutnya) tersimpan otomatis. |
| Moderasi tidak bereaksi | Pastikan dulu: moderasi aktif di `/moderasi` (menang atas `.env`), daftar kata tidak kosong, dan pengirimnya bukan staff/Manage Messages. Bot juga perlu izin **Manage Messages** untuk menghapus dan **Moderate Members** untuk timeout. |
| `connect ECONNREFUSED` / `SSL required` (Postgres) | `DATABASE_URL` salah atau `sslmode=require` belum ditambahkan. Tes cepat: `DATABASE_URL=... npm run migrate:pg`. Lihat [docs/postgres.md](docs/postgres.md). |
| Mau ganti token dashboard | `npm run token -- --write`, lalu perbarui juga variabel di panel hosting dan restart. |
| Dashboard tidak bisa dibuka | `DASHBOARD_TOKEN` kosong atau kurang dari 12 karakter. Cek log: harus ada `🌐 Dashboard: …`. |
| `/akhiri` di DM tidak menutup sesi — bot malah membalas seperti ngobrol biasa | Slash command tidak terdaftar untuk DM. Log harus memuat `slash command global didaftarkan (termasuk untuk DM)`. Kalau log-nya menyebut pendaftaran **per-guild**, bot masih versi lama — update lalu restart. Lihat [setup](docs/setup.md#cara-mendapatkan-guild_id). |
| Bot keluar sendiri dari server yang baru mengundangnya | Memang begitu: bot ini untuk satu server (`GUILD_ID`). Mau versi sendiri? Fork repo, pakai token + API key sendiri. |
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
│   ├── dm.ts                # percakapan AI via DM (pengganti room) + transkrip
│   ├── chat.ts              # pipeline jawaban AI + tool calling + chunking
│   ├── rag.ts               # RAG: ingest dokumen, indeks BM25, pencarian hybrid
│   ├── rag-embed.ts         # embeddings opsional (endpoint /embeddings)
│   ├── memory.ts            # tool memori & format untuk prompt
│   ├── keywords.ts          # pencocokan keyword
│   ├── prompt.ts            # perakitan system prompt
│   ├── buttons.ts           # router button interaction
│   ├── moderation.ts        # filter kata terlarang + log pelanggaran
│   ├── vision.ts            # lampiran gambar → data URI untuk model multimodal
│   ├── panel.ts             # kirim/hapus panel "Chat via DM" (dipakai /panel & dashboard)
│   ├── welcome.ts           # sambutan member baru + salam perpisahan (kirim & fallback)
│   ├── welcome-card.ts      # render kartu PNG lewat Chromium (opsional, ada fallback)
│   ├── banner.ts            # banner unggahan admin: validasi, simpan, baca, hapus
│   ├── greeting-text.ts     # template {user}/{server} — dipakai bot & dashboard
│   ├── preview.ts           # pratinjau & prompt bersama (sambutan, perpisahan, agent)
│   ├── agent-core.ts        # logika murni AI Agent: kapan membalas, riwayat, sepi
│   ├── agent.ts             # lapisan Discord AI Agent (chat & galeri)
│   └── ui.ts                # embed & komponen
├── events/
│   ├── messageCreate.ts     # router pesan (DM, agent, moderasi)
│   ├── guildMemberAdd.ts    # sambutan member baru + salam perpisahan
│   └── interactionCreate.ts # router slash command & button
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
docs/dashboard.md            # dashboard web: setup, halaman, keamanan
docs/sambutan-agent.md       # sambutan, perpisahan, AI Agent, banner & pratinjau
docs/postgres.md             # Postgres, migrasi data, multi-shard
docs/moderation.md           # moderasi otomatis + log pelanggaran
docs/vision-voice.md         # vision gambar, STT/TTS, /ucap
docs/hosting.md              # hosting bot gratis 24/7 + backup
```

---

## 📜 Lisensi

MIT © 2026 Wahyu Angga Saputra — lihat [LICENSE](LICENSE).
