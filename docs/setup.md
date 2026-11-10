# 🚀 Panduan Setup — dari nol sampai bot jalan

Panduan ini khusus untuk **Groq sebagai provider utama** dengan Gemini/OpenRouter/NVIDIA sebagai cadangan.
Ikuti berurutan; total sekitar 10 menit.

> Sudah punya `.env`? Langsung ke [Langkah 3](#langkah-3--isi-env).

---

## Ringkasan cepat (yang sabar baca: lanjut ke bawah)

**Versi minimal — cukup 3 baris:**

```env
DISCORD_TOKEN=xxxxx.xxxxx.xxxxx
CLIENT_ID=123456789012345678
AI_API_KEY=gsk_xxxxxxxxxxxxxxxx
```

**Versi lengkap — Groq utama + 3 cadangan (disarankan):**

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

Dua contoh di atas **sudah cukup** — `AI_BASE_URL` dan `AI_MODEL` untuk Groq sudah punya nilai default
yang benar (`https://api.groq.com/openai/v1` dan `openai/gpt-oss-120b`).

---

## Langkah 1 — Buat aplikasi Discord

1. Buka <https://discord.com/developers/applications> → **New Application**, beri nama bebas.
2. Tab **General Information** → salin **Application ID** → ini `CLIENT_ID`.
3. Tab **Bot** → **Reset Token** → salin → ini `DISCORD_TOKEN`.
   *Token hanya ditampilkan sekali. Kalau hilang, reset lagi.*
4. Masih di tab **Bot**, scroll ke **Privileged Gateway Intents** → aktifkan:
   - ✅ **Message Content Intent** ← **wajib**, tanpa ini bot tidak bisa membaca isi chat
   - ✅ **Server Members Intent** *(opsional)*
5. Tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Manage Channels`, `View Channels`, `Send Messages`, `Manage Messages`,
     `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Use External Emojis`
   - Buka URL yang muncul → pilih server → **Authorize**

> URL siap pakai (ganti `YOUR_CLIENT_ID`):
> `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=388176&scope=bot%20applications.commands`

### Cara mendapatkan `DEV_GUILD_ID`

Di Discord: **Settings → Advanced → Developer Mode: ON** → klik kanan nama server → **Copy Server ID**.
Kalau diisi, slash command langsung muncul (instan). Kalau kosong, command didaftarkan global dan bisa
butuh sampai **1 jam** untuk tampil.

---

## Langkah 2 — Ambil API key

| Provider | Link | Tanpa kartu? | Peran |
|---|---|---|---|
| **Groq** | <https://console.groq.com/keys> | ✅ | utama |
| **Gemini** | <https://aistudio.google.com/api-keys> | ✅ | cadangan 1 |
| **OpenRouter** | <https://openrouter.ai/keys> | ✅ | cadangan 2 |
| **NVIDIA NIM** | <https://build.nvidia.com> → Get API Key | ✅ | cadangan 3 |

> Keempat provider di atas bisa didaftar **tanpa kartu kredit** — sudah diuji sendiri, bukan cuma
> klaim dokumentasi. Cerebras dan Mistral tidak dipakai karena keduanya meminta kartu.

Kamu **tidak wajib** mengisi semua cadangan. Yang kosong otomatis dilewati, bot tetap jalan.

---

## Langkah 3 — Isi `.env`

File `.env` sudah tersedia di root project (kalau belum: `cp .env.example .env`).

### Aturan penulisan yang perlu kamu tahu

| Penulisan | Hasil | Aman? |
|---|---|---|
| `AI_API_KEY=gsk_abc` | `gsk_abc` | ✅ |
| `AI_API_KEY=gsk_abc # Groq utama` | `gsk_abc` | ✅ komentar inline dihapus |
| `AI_API_KEY="gsk_abc"` | `gsk_abc` | ✅ tanda kutip dibuang otomatis |
| `AI_API_KEY = gsk_abc` | `gsk_abc` | ✅ spasi di sekitar `=` dipangkas |
| `AI_API_KEY=abc#def` | `abc` | ⚠️ `#` **tanpa spasi** memotong nilai |
| `GROQ_API_KEY=gsk_abc` (saat Groq jadi utama) | tidak terpakai | ❌ salah variabel |

Jadi snippet dengan komentar `# ← Groq (utama)` di kanan **valid**. Jangan beri spasi tambahan di
dalam nilai, dan jangan menaruh `#` di tengah nilai.

### Di variabel mana key-nya ditaruh?

| Variabel | Kapan dipakai |
|---|---|
| **`AI_API_KEY`** | Key **provider utama**. Kalau Groq utama → **key Groq di sini**. |
| `GEMINI_API_KEY` | Hanya jika `gemini` muncul di `AI_FALLBACKS` |
| `OPENROUTER_API_KEY` | Hanya jika `openrouter` muncul di `AI_FALLBACKS` |
| `NVIDIA_API_KEY` | Hanya jika `nvidia` muncul di `AI_FALLBACKS` |
| `GROQ_API_KEY` | **Hanya** jika `groq` muncul di `AI_FALLBACKS` (saat Groq jadi cadangan). Kalau Groq utama: **kosongkan**. |

> Kesalahan paling umum: menaruh key Groq di `GROQ_API_KEY` padahal Groq masih utama.
> Akibatnya bot berhenti dengan pesan `AI_API_KEY wajib diisi`.

### Isi yang disarankan

```env
# ---------- Discord ----------
DISCORD_TOKEN=xxxxx.xxxxx.xxxxx
CLIENT_ID=123456789012345678
DEV_GUILD_ID=123456789012345678

# ---------- Groq (utama) ----------
AI_API_KEY=gsk_xxxxxxxxxxxxxxxx
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b

# ---------- Cadangan ----------
AI_FALLBACKS=gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free,nvidia:openai/gpt-oss-120b
GEMINI_API_KEY=AIzaSy...
OPENROUTER_API_KEY=sk-or-v1-...
NVIDIA_API_KEY=nvapi-...

# ---------- Hemat kuota free tier ----------
AI_HISTORY_LIMIT=12
RATE_LIMIT_PER_MINUTE=8
```

---

## Langkah 4 — Verifikasi

```bash
npm run doctor
```

Contoh kalau semuanya benar:

```
groq (utama) · openai/gpt-oss-120b
  ✅ chat   412 ms → ok
  ✅ stream 388 ms → chunk pertama "Halo"

gemini (fallback 1) · gemini-3.8-flash
  ✅ chat   890 ms → ok
  ✅ stream 912 ms → chunk pertama "Hai"
```

Arti pesan error yang muncul:

| Pesan | Artinya |
|---|---|
| `key ditolak (401)` | API key salah/kedaluwarsa |
| `model tidak ditemukan (404)` | Nama model salah → jalankan `npm run models` |
| `rate limit (429)` | Kuota per menit habis — tunggu sebentar |
| `kredit/kuota habis (402)` | Kredit provider habis (umum di NVIDIA NIM) |
| `tidak bisa terhubung` | Jaringan / base URL salah |

Ingin melihat ID model yang benar-benar tersedia?

```bash
npm run models            # semua provider yang key-nya terisi
npm run models -- groq    # satu provider saja
```

---

## Langkah 5 — Jalankan bot

```bash
npm run dev
```

Kalau berhasil, log akan menampilkan:

```
INFO  Database siap: /app/data/zypher.db
INFO  Provider AI aktif (fallback berurutan): groq/gpt-oss-120b → gemini/gemini-3.8-flash → ...
INFO  🤖 Login sebagai NamaBot#1234 (1 server)
INFO  ✅ 10 slash command didaftarkan di guild "Server Kamu".
```

Di Discord:

```
/panel            → kirim panel tombol
```

Klik **Buat Room AI** → channel privat muncul → langsung tanya apa saja.

---

## Langkah 6 — (Opsional) Dokumen rujukan & dashboard

Dua fitur ini tidak wajib, tapi membuat bot jauh lebih berguna.

### Dokumen RAG — AI tahu isi FAQ server

```bash
# buat file contoh
cat > faq.txt <<'EOF'
## Jam operasional
Staff piket setiap hari 09.00–21.00 WIB.

## Aturan giveaway
Satu akun satu hadiah, pemenang wajib klaim dalam 24 jam.
EOF
```

Di Discord (kamu harus admin server):

```
/dokumen tambah file:faq.txt
/dokumen cari pertanyaan:jam operasional staff
```

Kalau pencarian menampilkan potongan yang benar, tanyakan hal yang sama di room AI — jawabannya akan
menyebut `-# 📚 Sumber: faq.txt`. Format yang didukung: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.log`.
Panduan lengkap: [rag.md](rag.md).

### Dashboard web — kelola dari browser

```bash
openssl rand -hex 16        # bikin token acak
```

Masukkan hasilnya ke `.env`:

```env
DASHBOARD_TOKEN=hasil-random-tadi
DASHBOARD_PORT=3000
```

Jalankan bot (atau `npm run dashboard` untuk dashboard saja), lalu buka <http://localhost:3000>.
Login memakai token tadi. Di sana ada statistik, upload dokumen, dan uji pencarian. Keamanan &
reverse proxy: [dashboard.md](dashboard.md).

---

## Langkah 7 — Supaya online 24/7

Bot hanya hidup selama terminalnya menyala. Untuk membuatnya online terus:

👉 **[hosting.md](hosting.md)** — perbandingan gratis (Oracle Cloud Always Free, Google Cloud e2-micro,
panel bot hosting) plus dua jebakan yang bikin data hilang.

---

## Mode alternatif

### NVIDIA NIM sebagai provider utama

```env
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=nvapi-xxxxxxxx
AI_FALLBACKS=groq:openai/gpt-oss-120b
GROQ_API_KEY=gsk_xxxxxxxx
```

Perhatikan: kini key NVIDIA di `AI_API_KEY`, dan key Groq pindah ke `GROQ_API_KEY`.

### Ollama lokal (gratis, tanpa internet)

```bash
ollama pull qwen3
ollama serve
```

```env
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3
AI_API_KEY=ollama
AI_FALLBACKS=
```

---

## FAQ

**Bot diam saja saat ditanya di room AI.**
Message Content Intent belum aktif → Developer Portal → Bot → Privileged Gateway Intents.

**`AI_API_KEY wajib diisi` padahal sudah diisi.**
Key-nya ada di variabel yang salah. Saat Groq utama, key Groq harus di `AI_API_KEY`, bukan `GROQ_API_KEY`.

**Slash command tidak muncul.**
Isi `DEV_GUILD_ID`, lalu restart bot. Pastikan undangan memakai scope `applications.commands`.

**Bot tidak bisa membuat room AI.**
Bot butuh izin **Manage Channels**. Cek juga role bot berada di atas role channel terkait.

**Transkrip tidak masuk DM.**
Member menutup DM. Isi `TRANSCRIPT_CHANNEL_ID` supaya transkrip tetap tersimpan di channel arsip.

**`.env` aman di-commit?**
Tidak pernah. `.env` sudah ada di `.gitignore` — jangan dihapus dari sana.

**Dashboard tidak bisa dibuka.**
`DASHBOARD_TOKEN` harus terisi minimal 12 karakter. Cek log: kalau tidak ada baris `🌐 Dashboard: ...`,
fitur itu belum menyala.

**Data hilang setelah redeploy di hosting.**
Hosting tanpa disk persisten. Pindah ke VPS/panel dengan storage, atau unduh backup `zypher.db`
secara berkala — lihat [hosting.md](hosting.md).

---

## Setelah semua jalan

- Sesuaikan kepribadian AI per server: `/persona set teks:...`
- Tambah jawaban acuan yang akan divariasikan AI: `/keyword tambah ...`
- Kirim panel ke channel permanen: `/panel channel:#tanya-ai`
- Upload FAQ/SOP dengan `/dokumen tambah` supaya jawaban AI tidak mengarang
- Nyalakan dashboard (`DASHBOARD_TOKEN`) untuk mengelola dokumen tanpa Discord

Panduan fitur lengkap ada di [README](../README.md). Dokumen lain:

- [rag.md](rag.md) — dokumen pengetahuan AI
- [dashboard.md](dashboard.md) — panel web
- [hosting.md](hosting.md) — hosting gratis 24/7
- [models.md](models.md) — model gratis per provider
- [providers.md](providers.md) — provider free tier
