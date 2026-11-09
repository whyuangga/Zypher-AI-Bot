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
| **Oracle Cloud Always Free** | ✅ | ✅ (block volume) | 1 GB (AMD) atau beberapa GB (ARM) | Perlu kartu saat daftar, setup Linux, stok ARM sering habis | **Pilihan utama** — bot komunitas serius |
| **Google Cloud Free Tier (e2-micro)** | ✅ | ✅ (30 GB) | 1 GB | Perlu billing account, region terbatas (AS) | Alternatif kalau Oracle ditolak |
| **Bot-Hosting.net (free)** | ✅ | ✅ 512 MB | 256 MB | Perpanjang manual tiap 4 hari | Paling cepat mulai, tanpa kartu |
| **Discloud (free)** | ✅ | ✅ kecil | 100 MB | Sangat mepet; iklan di status bot | Bot kecil / coba-coba |
| Ada PC/laptop/Raspberry Pi nganggur | ✅ selama nyala | ✅ | bebas | Listrik & internet rumah, harus restart sendiri kalau mati | Testing jangka panjang tanpa kartu |
| Render (free web service) | ❌ tidur saat idle | ❌ | 512 MB | Bot offline saat sleep | **Tidak cocok** untuk bot |
| Railway (free) | ⚠️ kredit $5 habis | ❌ | — | Trial, lalu berbayar | Coba-coba singkat |
| Fly.io | ⚠️ berubah-ubah | ❌ volume berbayar | 256 MB | Tidak ada free tier permanen yang bisa diandalkan | — |

> Angka di atas cepat berubah. Selalu cek halaman resmi sebelum memutuskan — tapi urutan
> rekomendasinya (Oracle > GCP > panel bot > laptop sendiri) stabil sejak lama.

---

## Rekomendasi #1 — Oracle Cloud Always Free

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

## Rekomendasi #2 — Google Cloud e2-micro

Free tier permanen untuk **satu** `e2-micro` di region AS tertentu (1 GB RAM, 30 GB disk standar).
Cukup untuk bot ini. Setup mirip Oracle (Ubuntu + Docker Compose), bedanya:
- wajib punya **billing account** aktif (kartu), walau pemakaian di kuota free tidak ditagih;
- region terbatas → latensi ke Discord sedikit lebih jauh, tapi tidak berpengaruh untuk chat berbasis API.

Kalau Oracle terus menolak signup, ini jalur paling realistis.

---

## Rekomendasi #3 — panel bot hosting (paling cepat, tanpa kartu)

Cocok kalau kamu ingin **upload ZIP dan tekan Start**, tanpa menyentuh Linux.

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

---

## Checklist sebelum dianggap "sudah online"

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
