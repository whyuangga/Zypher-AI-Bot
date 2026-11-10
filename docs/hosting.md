# ☁️ Hosting bot Discord gratis (dan mana yang benar-benar cocok)

Bot ini butuh tiga hal yang sering dilupakan hosting "gratis":

| Kebutuhan | Kenapa penting untuk bot ini |
|---|---|
| **Proses hidup 24/7** | Bot Discord konek lewat gateway. Kalau proses tidur/sleep, bot terlihat offline dan tidak merespons. |
| **Disk persisten** | Semua memori, keyword, dokumen RAG, dan riwayat chat ada di satu file SQLite (`data/zypher.db`). Disk sementara = semua data hilang setiap redeploy. |
| **Node.js ≥ 22 + RAM ± 256–512 MB** | `discord.js` + `node:sqlite` + streaming jawaban. 100 MB bisa jalan tapi mepet saat ada beberapa percakapan bersamaan. |

Kalau hosting-mu tidak memenuhi ketiganya, bot boleh jadi "gratis" tapi bikin repot: data hilang,
bot mati tiap beberapa menit, atau harus keep-alive hack.

---

## Ringkasan pilihan gratis (per November 2026)

| Opsi | 24/7? | Disk persisten | RAM | Repotnya | Cocok untuk |
|---|---|---|---|---|---|
| **Wispbyte (free)** | ✅ | ✅ 1 GB | **512 MB** | Login panel tiap 14 hari, node di Rumania | **Pilihan utama untuk mulai** — tanpa kartu, tanpa perpanjang |
| **Oracle Cloud Always Free** | ✅ | ✅ (block volume) | 1 GB (AMD) atau beberapa GB (ARM) | Perlu kartu saat daftar, setup Linux, stok ARM sering habis, mesin idle bisa ditarik | Resource paling besar, kontrol penuh |
| **Google Cloud Free Tier (e2-micro)** | ✅ | ✅ (30 GB) | 1 GB | Perlu billing account, region terbatas (AS) | Alternatif kalau Oracle ditolak |
| **Bot-Hosting.net (free)** | ✅ | ✅ 512 MB | 256 MB | Perpanjang manual tiap 4 hari | Cadangan cepat |
| **Discloud (free)** | ✅ | ✅ kecil | 100 MB | Sangat mepet; iklan di status bot | Bot kecil / coba-coba |
| Ada PC/laptop/Raspberry Pi nganggur | ✅ selama nyala | ✅ | bebas | Listrik & internet rumah, harus restart sendiri kalau mati | Testing jangka panjang tanpa kartu |
| Render (free web service) | ❌ tidur saat idle | ❌ | 512 MB | Bot offline saat sleep | **Tidak cocok** untuk bot |
| Railway (free) | ⚠️ kredit $5 habis | ❌ | — | Trial, lalu berbayar | Coba-coba singkat |
| Fly.io | ⚠️ berubah-ubah | ❌ volume berbayar | 256 MB | Tidak ada free tier permanen yang bisa diandalkan | — |

> Angka di atas cepat berubah. Selalu cek halaman resmi sebelum memutuskan.
> Untuk mulai cepat, panel hosting (Wispbyte) paling praktis; untuk jangka panjang dengan sumber daya
> paling lega, VPS gratis (Oracle) lebih unggul.

---

## Rekomendasi #1 — Wispbyte (paling cepat, benar-benar gratis)

<https://wispbyte.com/id/> — panel berbasis Pterodactyl yang memang dibuat untuk bot Discord.

| | Paket gratis |
|---|---|
| RAM | **512 MB** |
| Disk | **1 GB** (persisten — `data/zypher.db` aman saat restart) |
| CPU | **35%**, plus 1 core penuh di ~90 detik pertama (khusus `npm install`) |
| Harga | €0 — tanpa kartu, tanpa koin, **tanpa tombol perpanjang** |
| Uptime | 24/7, syarat **login panel minimal sekali setiap 14 hari** |
| Runtime | Node.js, Bun, Python, Java, C#, Rust, Lua + image database |
| Lokasi | Node gratis: Bacău, Rumania |
| Batas | Satu bot Discord per server, satu akun gratis per orang |

Trade-off jujurnya: 512 MB cukup untuk bot ini (±120–200 MB saat jalan), tapi **jangan** menjalankan
`tsc`/`npm run dev` di server. Node Rumania berarti latensi WebSocket ±150 ms — tidak terasa untuk chat
teks, tapi jangan berharap bot musik/voice.

Kalau tidak login 14 hari, server **dimatikan**; setelah 30 hari filenya dipindah ke storage
(tidak dihapus, bisa dipulihkan). Perlakukan batas 14 hari ini serius.

### 1. Buat server

1. Daftar di <https://wispbyte.com/client> → **Create Server** → paket **Free**.
2. Pilih **egg: Node.js** → image **`nodejs_22`**.
   - **Jangan `nodejs_19`/`nodejs_20`** — bot ini butuh `node:sqlite` yang baru ada di Node 22.
     Di Node lama, `npm install` cuma memberi *warning*, lalu bot mati saat start.
   - `nodejs_26` sah-sah saja untuk project ini (tanpa modul native), tapi `nodejs_22` paling teruji.
3. Beri nama, buat, tunggu server muncul.

### 2a. Deploy lewat Git (disarankan)

Panel Wispbyte bisa menarik kode langsung dari GitHub. Di tab **Startup**:

| Kolom | Isi |
|---|---|
| **Git Repo Address** | `https://github.com/whyuangga/Zypher-AI-Bot` |
| **Install Branch** | `main` |
| **Auto Update** | nyala |
| **JS file** | `dist/index.js` |
| **Perintah startup** | **biarkan `Default`** |

Lalu **Reinstall Server** (atau **Mulai**).

> **Kenapa perintah startup tidak perlu diubah?** Repo ini punya hook `prepare` di `package.json`:
> setiap `npm install` otomatis menjalankan `tsc`, jadi `dist/index.js` sudah ada tepat sebelum panel
> memanggil `node ${JS_FILE}`. Log akan menampilkan:
>
> ```
> [prepare] TypeScript & sumber tersedia — membangun dist/ …
> [prepare] ✅ build selesai — dist/index.js siap dijalankan.
> ```
>
> Hook ini juga aman di dua situasi lain: `npm install --omit=dev` (paket ZIP) → build dilewati karena
> `tsc` tidak dipasang, dan `npm ci` di dalam Dockerfile → dilewati karena `tsconfig.json` belum di-COPY.

**Kalau panel-mu versi lama** dan `prepare` tidak jalan (log tidak menampilkan baris `[prepare]`),
pakai perintah startup manual ini (isi kolom **Perintah startup → Edit**):

```bash
cd /home/container; if [[ ! -d .git && "${USER_UPLOAD}" != "1" ]]; then git clone -b "${BRANCH}" "${GIT_ADDRESS}" .; fi; if [[ -d .git && "${AUTO_UPDATE}" == "1" ]]; then git pull; fi; if [ -f package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/npm run build && /usr/local/bin/node dist/index.js
```

Blok `git clone` sengaja dipertahankan supaya **Reinstall** tetap bisa menarik kode dari GitHub.

### 2b. Deploy lewat ZIP (kalau panel tidak punya opsi git)

```bash
npm install
npm run bundle        # menghasilkan zypher-deploy.zip (±0,1 MB: dist/ + package files)
```

Lalu **Files → Upload** → **Extract**, dan set:

| Kolom | Isi |
|---|---|
| **JS file** | `dist/index.js` |
| **User Uploaded Files** | nyala (supaya panel tidak meng-clone repo) |
| **Perintah startup** | `cd /home/container && /usr/local/bin/npm install --omit=dev && /usr/local/bin/node dist/index.js` |

Pastikan folder `dist/` ada di **root** server (bukan di dalam subfolder). Hook `prepare` akan
melewati build karena `tsc` tidak dipasang — memang begitu yang diinginkan: `dist/` sudah ikut di ZIP.

### 3. Isi environment variable di panel

> ⚠️ **Nama variabel harus persis.** Salah nama = dianggap kosong, dan gejalanya "belum diisi"
> padahal kolomnya sudah terisi. Bot ini menerima beberapa alias untuk variabel Discord:
>
> | Nama utama | Alias yang juga dibaca |
> |---|---|
> | `DISCORD_TOKEN` | `DISCORD_BOT_TOKEN` |
> | `CLIENT_ID` | `DISCORD_CLIENT_ID` |
> | `DEV_GUILD_ID` | `DISCORD_GUILD_ID` |

Tempel blok ini sekaligus di **Startup → Environment → Tempel**, ganti tiga nilai pertama:

```env
DISCORD_TOKEN=ganti-dengan-token-bot
CLIENT_ID=ganti-dengan-angka-application-id
AI_API_KEY=ganti-dengan-key-groq
NODE_OPTIONS=--max-old-space-size=384
```

| Variabel | Kenapa penting |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=384` | Tanpa ini V8 mengambil heap lebih besar dari container 512 MB → proses dibunuh panel padahal RAM-nya cukup |
| `AI_FALLBACKS` | *(opsional)* mis. `gemini:gemini-3.8-flash` + `GEMINI_API_KEY` |
| `DEV_GUILD_ID` | *(opsional)* ID server untuk pendaftaran command instan |
| `DASHBOARD_TOKEN` | *(opsional)* menyalakan dashboard |

**Jangan upload file `.env`** ke folder repo: panel bisa menimpanya saat menarik ulang kode.
Semua variabel dari tab Startup.

> ⚠️ **Setelah menyimpan variabel, scroll dan periksa yang lain.** Pengalaman paling sering:
> menambah satu baris lalu menyimpan, dan baris lain ikut terhapus.

### 4. Dashboard (kalau panel memberi port publik)

Bot ini **sudah menerima nama variabel panel apa adanya** — tidak perlu rename:

```env
WEB_ENABLED=true
WEB_PORT=16954
WEB_HOST=0.0.0.0
DASHBOARD_TOKEN=ganti-dengan-token-48-karakter
PUBLIC_URL=http://78.154.103.15:16954
```

- **`WEB_PORT`** → angka setelah titik dua di **Console → Server info → Address**
  (contoh `78.154.103.15:16954` → port `16954`).
  `0` berarti "belum diisi" → bot memakai 3000 dan menulis port sebenarnya di log.
- **`PUBLIC_URL`** *(opsional)* → alamat yang sama dengan Address, diawali `http://`.
  Kalau diisi, log dashboard menampilkan URL persis ini.
- **`WEB_ENABLED=false`** → mematikan dashboard walau token terisi.

Buat tokennya di laptop, jangan di situs online:

```bash
npm run token            # crypto.randomBytes, 48 karakter hex
```

Setelah start, log menampilkan URL yang bisa dibuka:

```
INFO  🌐 Dashboard: http://78.154.103.15:16954 (login pakai DASHBOARD_TOKEN)
INFO     Port diambil dari WEB_PORT=16954
```

### 5. Start & verifikasi

**Console → Start**, lalu tunggu:

```
🤖 Login sebagai NamaBot#1234 (1 server)
✅ 11 slash command didaftarkan …
```

> **Konsol Wispbyte bukan shell.** Mengetik `npm run apa-saja` di sana hanya masuk ke stdin proses
> bot, bukan dijalankan. Tidak masalah di sini: bot mendaftarkan slash command otomatis setiap start.

> **Jalankan `npm run doctor` di laptop, bukan di panel.** Panel memblokir install-script npm
> (`npm warn install-scripts … esbuild … blocked`), dan `tsx` butuh esbuild. Akibatnya perintah
> berbasis `tsx` (`doctor`, `dev`, `token`, `bundle`) tidak jalan di panel. Bot sendiri tidak
> terpengaruh — ia berjalan dari `dist/` hasil `tsc`, yang tidak memerlukan esbuild.

Kalau muncul `❌ Node.js kamu versi 20…` → kembali ke langkah 1 dan ganti image ke `nodejs_22`.

## Rekomendasi #2 — Oracle Cloud Always Free

Yang kamu dapat: VM Linux sungguhan, disk permanen, dan bisa dipakai Docker Compose persis seperti
di README. Ini satu-satunya opsi gratis yang benar-benar setara VPS kecil.

### Langkah ringkas

1. Daftar di <https://cloud.oracle.com/free> (perlu kartu untuk verifikasi, **tidak ditagih** selama
   tetap di Always Free).
2. **Compute → Instances → Create instance**
   - Shape: `VM.Standard.A1.Flex` (ARM, Always Free) — kalau muncul *out of capacity*, coba
     region lain atau shape `VM.Standard.E2.1.Micro` (AMD, 1 GB).
   - Image: **Ubuntu 24.04**.
   - Simpan SSH key yang diunduh.
3. Buka firewall Oracle: **Networking → VCN → Security List → Add Ingress Rule**
   (biasanya tidak perlu port apa pun untuk bot — hanya 22 untuk SSH; buka 3000 kalau mau dashboard).
4. Masuk dan pasang Docker:

```bash
ssh ubuntu@IP-VM
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

5. Ambil project & jalankan:

```bash
git clone https://github.com/whyuangga/Zypher-AI-Bot.git
cd Zypher-AI-Bot
cp .env.example .env
nano .env            # isi DISCORD_TOKEN, CLIENT_ID, AI_API_KEY
docker compose up -d --build
docker compose logs -f bot
```

6. Verifikasi: `docker compose logs -f bot` menampilkan `🤖 Login sebagai ...`, dan
   `curl localhost:3000/healthz` (kalau dashboard aktif) mengembalikan `{"ok":true,...}`.

### Tanpa Docker (systemd)

```bash
sudo apt install -y nodejs npm git    # pastikan node -v >= 22
npm ci && npm run build
sudo tee /etc/systemd/system/zypher.service >/dev/null <<'EOF'
[Unit]
Description=Zypher AI Bot
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/Zypher-AI-Bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/Zypher-AI-Bot/.env

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now zypher
journalctl -u zypher -f
```

### Dua jebakan Oracle yang harus kamu tahu

- **"Out of capacity"** saat membuat instance ARM: bukan salahmu, stok gratis memang terbatas.
  Coba beberapa hari berturut-turut, ganti availability domain, atau pakai shape AMD micro.
- **Reklamasi mesin idle:** Oracle boleh mengambil kembali mesin Always Free yang terlihat menganggur
  (CPU & jaringan sangat rendah selama ~7 hari). Bot yang cuma menunggu pesan bisa masuk kategori ini.
  Mitigasi: pindahkan database ke block volume, dan/atau jalankan sesuatu yang wajar (dashboard,
  cron backup harian). Jangan pakai trik "pura-pura sibuk" berlebihan — cukup buat mesin punya
  aktivitas nyata.

---

## Rekomendasi #3 — Google Cloud e2-micro

Free tier permanen untuk **satu** `e2-micro` di region AS tertentu (1 GB RAM, 30 GB disk standar).
Cukup untuk bot ini. Setup mirip Oracle (Ubuntu + Docker Compose), bedanya:
- wajib punya **billing account** aktif (kartu), walau pemakaian di kuota free tidak ditagih;
- region terbatas → latensi ke Discord sedikit lebih jauh, tapi tidak berpengaruh untuk chat berbasis API.

Kalau Oracle terus menolak signup, ini jalur paling realistis.

---

## Rekomendasi #4 — panel bot hosting lain (Bot-Hosting.net, Discloud)

Kalau Wispbyte penuh atau kamu ingin pembanding, ada opsi panel lain dengan pola yang sama
(upload ZIP → tekan Start, tanpa menyentuh Linux).

**Bot-Hosting.net** (free): 256 MB RAM, 25% CPU, 512 MB storage, tanpa kartu, tapi harus
**perpanjang manual tiap 4 hari** dari panel. Cara pakai:

1. Daftar → **New Server** → pilih **Node.js**.
2. Upload isi project (tanpa `node_modules`), lalu set:
   - Start command: `npm ci && npm run build && node dist/index.js`
   - Atau upload hasil build (`dist/`, `package.json`) dan start `npm install --omit=dev && node dist/index.js`.
3. Isi environment variables di panel (bukan file `.env` — banyak panel menyediakannya).
4. Pastikan `data/` tersimpan di storage panel, dan unduh backup `zypher.db` berkala.

**Discloud** (free, populer di Indonesia): 100 MB RAM. Bot ini bisa jalan, tapi `discord.js` + buffer
streaming jawaban gampang menyentuh batas RAM → risiko restart. Gunakan hanya untuk uji coba.

> Panel bot hosting biasanya **tidak meneruskan port HTTP**, jadi dashboard web tidak bisa diakses
> dari luar di sana. `DASHBOARD_TOKEN` boleh dikosongkan; fitur utama bot tetap jalan penuh.

---

## Kalau pakai hosting dengan disk sementara (Render, Railway, dsb.)

Masih memungkinkan, tapi **wajib** menyimpan database di luar container:

1. Unduh backup tiap hari:
   ```bash
   docker compose cp bot:/app/data/zypher.db ./backup-$(date +%F).db
   ```
2. Atau pindahkan ke layanan dengan disk permanen (Render Disk/Railway Volume berbayar).
3. Sadari bahwa Render free *web service* tidur saat idle → bot Discord **tidak bisa** memakai itu.
   Kalau tetap mau Render, pakai *background worker* (berbayar).
4. Pilihan paling rapi untuk hosting berdisk sementara: pakai **Postgres gratis** (Neon/Supabase)
   dan isi `DATABASE_URL` — data tidak lagi bergantung pada disk container.
   Lihat [postgres.md](postgres.md).

---

## Backup & pindah hosting

Satu file = seluruh data bot.

```bash
# backup
docker compose cp bot:/app/data/zypher.db ./zypher-$(date +%F).db

# restore (hosting baru)
docker compose cp ./zypher-2026-11-09.db bot:/app/data/zypher.db
docker compose restart bot
```

Kalau tidak pakai Docker, file-nya ada di `./data/zypher.db`. Simpan salinannya di luar server
(Google Drive, laptop, dsb.) — SQLite sangat jarang korup, tapi disk hosting bisa hilang kapan saja.

Kalau memakai **Postgres**, backup tidak lagi berupa file:

```bash
pg_dump "$DATABASE_URL" > zypher-$(date +%F).sql
```

---

## Checklist sebelum dianggap "sudah online"

- [ ] `node -v` di server menunjukkan **v22.x / v24.x** (bukan v20)
- [ ] `npm run doctor` di server: semua provider di rantai menjawab ✅
- [ ] Log menunjukkan `🤖 Login sebagai <bot> (N server)`
- [ ] Slash command muncul di Discord (bisa butuh beberapa menit; restart bot kalau lama)
- [ ] `/panel` → klik **Buat Room AI** → channel privat muncul
- [ ] Tanya sesuatu, AI menjawab (streaming terlihat)
- [ ] `/dokumen tambah file:faq.txt` → `/dokumen cari pertanyaan:...` mengembalikan potongan
- [ ] (Kalau dashboard aktif) `curl https://domain-kamu/healthz` → `{"ok":true,...}`
- [ ] Backup `zypher.db` pertama sudah diunduh

---

Bagian dari panduan Zypher AI:

- [setup.md](setup.md) — setup dari nol
- [rag.md](rag.md) — dokumen pengetahuan AI
- [dashboard.md](dashboard.md) — panel web
- [models.md](models.md) · [providers.md](providers.md) — model & provider AI
