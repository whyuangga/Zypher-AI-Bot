# 🌐 Web dashboard — kelola bot tanpa lewat Discord

Dashboard kecil berjalan **di dalam proses bot yang sama**: satu container, satu database, tanpa
framework tambahan. Semua halaman dirender dari server (tanpa bundler, tanpa build frontend), jadi
ringan dan tidak menambah dependensi.

Yang bisa dilakukan:

| Halaman | Isi |
|---|---|
| `/` | Statistik (room, dokumen, potongan, keyword, memori, pesan), status fitur, room terbaru, dokumen terbaru |
| `/dokumen` | Upload dokumen RAG (file atau tempel teks), daftar dokumen, hapus dokumen, **uji pencarian** |
| `/healthz` | JSON status untuk monitoring (tanpa login) |

---

## Menyalakan dashboard

Isi satu variabel di `.env`:

```env
DASHBOARD_TOKEN=rahasia-panjang-minimal-12-karakter
```

Buat token acak dengan:

```bash
openssl rand -hex 16
```

Lalu jalankan bot seperti biasa (`npm run dev`, `npm start`, atau `docker compose up -d`) dan buka:

```
http://localhost:3000
```

> **Token kosong = dashboard mati.** Port tidak dibuka sama sekali. Ini default yang aman,
> jadi bot bisa dipakai tanpa memikirkan dashboard.

### Tanpa bot Discord (khusus kelola data)

```bash
npm run dashboard
```

Mode ini hanya menyalakan dashboard (bot tidak login ke Discord). Berguna untuk:

- pratinjau tampilan sebelum deploy;
- upload dokumen saat bot sedang mati / kena rate limit;
- cek data SQLite dari mana saja (mis. lewat SSH tunnel).

Kalau `DASHBOARD_TOKEN` belum diisi, mode ini memakai token contoh `preview-token-1234` dan
menampilkannya di log. **Jangan pakai token contoh itu di server publik.**

---

## Pilih server

Dashboard menampilkan satu server pada satu waktu (query `?guild=<id>`). Pilih dari dropdown di kanan
atas, atau **tempel Server ID** di kotak sebelahnya — berguna untuk bot yang belum pernah join server
(database masih kosong).

Cara mendapatkan Server ID: Discord → Server Settings → Widget, atau klik kanan server (mode
developer) → *Copy Server ID*.

---

## Upload dokumen dari dashboard

1. Buka `/dokumen`.
2. **Upload dari komputer**: pilih `.txt`/`.md`/`.csv`/`.json`/… (maks 5 MB) → *Upload dokumen*.
3. **Atau tempel teks**: beri nama file, tempel isinya, simpan.

Setelah tersimpan, halaman menampilkan jumlah potongan. Nama yang sama akan menggantikan versi lama.

### Uji pencarian

Kotak *Uji pencarian* memanggil mesin pencari yang sama dengan yang dipakai AI. Hasilnya menampilkan
potongan + skor + sumber (`lexical`, `vector`, atau `hybrid`). Ini cara tercepat tahu apakah dokumen
kamu akan terpakai saat member bertanya.

---

## Keamanan — baca ini sebelum online

| Aturan | Alasan |
|---|---|
| Anggap `DASHBOARD_TOKEN` sebagai **password admin** | Siapa pun yang punya token bisa melihat data & menghapus dokumen |
| Jangan taruh token di channel Discord, screenshot, atau repo | Ganti token = cukup edit `.env` lalu restart |
| Untuk akses dari internet, pasang **HTTPS** (Caddy/Nginx/Cloudflare Tunnel) | Cookie sesi jadi tidak bisa disadap di jaringan publik |
| Jangan buka port ke publik kalau tidak perlu | Default `DASHBOARD_HOST=0.0.0.0` hanya agar bisa diakses dari host/Docker |
| Login dibatasi 8 percobaan / 10 menit per IP | Mencegah tebak-tebakan token |

Detail teknis: token dibandingkan dengan `timingSafeEqual`, sesi berupa cookie `HttpOnly; SameSite=Lax`
berlaku 12 jam, dan semua teks dari user di-escape sebelum dirender (tidak ada XSS dari nama dokumen).

### Contoh akses aman dari luar (Cloudflare Tunnel)

```bash
cloudflared tunnel --url http://localhost:3000
```

Dapat URL HTTPS acak, tanpa membuka port di router/firewall. Cocok untuk VPS rumahan atau Oracle
Cloud yang tidak mau membuka 3000 ke internet.

---

## Docker

`docker-compose.yml` sudah meneruskan port 3000:

```yaml
ports:
  - "3000:3000"
environment:
  DASHBOARD_HOST: 0.0.0.0
```

Jadi setelah `docker compose up -d --build`, dashboard langsung bisa dibuka di `http://IP-VPS:3000`
(asalkan firewall mengizinkan port 3000). Kalau tidak butuh dashboard di server, hapus blok `ports`
dan kosongkan `DASHBOARD_TOKEN`.

---

## Troubleshooting

| Gejala | Solusi |
|---|---|
| Port 3000 tidak bisa dibuka | Cek `DASHBOARD_TOKEN` terisi (min. 12 karakter) dan log menampilkan `🌐 Dashboard: …` |
| `EADDRINUSE` di log | Port dipakai proses lain → ubah `DASHBOARD_PORT=3001` |
| Login terus gagal | Token salah / ada spasi. Salin ulang dari `.env` tanpa tanda kutip |
| "Terlalu banyak percobaan" | Tunggu 10 menit, atau restart bot (menghapus hitungan di memori) |
| Halaman kosong padahal bot punya data | Server ID belum dipilih — tempel Server ID di kanan atas |
| Data hilang setelah redeploy | Hosting tanpa disk persisten. Lihat [hosting.md](hosting.md) |

---

Bagian dari panduan Zypher AI:

- [setup.md](setup.md) — dari nol sampai bot jalan
- [rag.md](rag.md) — dokumen pengetahuan AI
- [hosting.md](hosting.md) — hosting gratis 24/7
