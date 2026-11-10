# 🌐 Web dashboard — kelola bot tanpa lewat Discord

Dashboard kecil berjalan **di dalam proses bot yang sama**: satu container, satu database, tanpa
framework tambahan. Semua halaman dirender dari server (tanpa bundler, tanpa build frontend), jadi
ringan dan tidak menambah dependensi.

Yang bisa dilakukan:

| Halaman | Isi |
|---|---|
| `/` | 4 kartu statistik, **grafik aktivitas 7 hari**, status sistem, room terbaru, dokumen terbaru |
| `/dokumen` | Upload dokumen RAG (file atau tempel teks), daftar dokumen, hapus dokumen, **uji pencarian** |
| `/keyword` | Tambah & hapus template jawaban owner (FAQ, harga, aturan) |
| `/memori` | Fakta yang diingat AI per user, dikelompokkan per member, bisa dihapus |
| `/transkrip` | Arsip HTML tiap sesi AI yang sudah ditutup — unduh, lihat ringkasan, hapus |
| `/moderasi` | Filter kata terlarang per server, tindakan (hapus/tegur/timeout), log pelanggaran |
| `/pengaturan` | Persona AI & model per server, info server + salin Server ID |
| `/healthz` | JSON status untuk monitoring (tanpa login) |

Tampilan memakai gaya **editorial monokrom** dengan palet pemilik proyek:

| Peran | Warna | Hex |
|---|---|---|
| Latar | near-black | `#0D0D0F` |
| Teks utama | Wafer | `#E2D1CC` |
| Teks sekunder | Cold Turkey | `#D0B2B7` |
| Aksen (aktif, fokus, badge) | Kimberly | `#716C98` |
| Garis / permukaan gelap | Don Juan | `#55434E` (diturunkan jadi `rgba`) |

Hurufnya **General Sans** (Fontshare) yang di-*self-host* dari `assets/fonts/` —
tidak ada permintaan ke CDN, jadi panel tanpa akses internet keluar tetap tampil benar.
Garis rambut 1px, label kapital ber-spasi lebar, dan tombol solid (tanpa gradient).
Sidebar di kiri, grafik 7 hari tanpa library chart — semua CSS/SVG dibuat langsung dari server,
jadi tidak ada bundler yang harus jalan di panel hosting.

Pratinjau tampilan ada di [`docs/screenshots/`](screenshots/README.md) (desktop 1440px + mobile 390px).

---

## Menyalakan dashboard

Isi satu variabel di `.env`:

```env
DASHBOARD_TOKEN=rahasia-panjang-minimal-12-karakter
```

Buat token acak dengan salah satu cara:

```bash
npm run token -- --write      # tulis langsung ke .env (disarankan)
openssl rand -hex 16          # tulis manual
```

`npm run token` memakai `crypto.randomBytes` + rejection sampling (tanpa bias), dan bisa dipanggil
ulang kapan saja untuk rotasi:

```bash
npm run token                       # cetak token hex 48 karakter
npm run token -- --base64           # base64url, lebih rapat
npm run token -- --length=64        # atur panjang (16–128)
npm run token -- --write            # ganti DASHBOARD_TOKEN di .env secara otomatis
```

> **Soal generator token online:** sebagian besar berjalan lokal di browser (tidak mengirim token ke
> server) sehingga aman-aman saja, tapi banyak yang memakai `Math.random()` — bukan *cryptographic
> random*. Untuk password admin, `crypto.randomBytes` adalah pilihan yang benar. Dan apa pun
> generatornya: **jangan pernah menempelkan token ke chat publik atau issue.**

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

### Kalau panel hosting memberi nama variabel sendiri

Banyak panel (Wispbyte, Railway, Render) menyuntikkan `WEB_PORT`, `WEB_HOST`, atau `PORT`.
Bot menerima semuanya — tidak perlu rename:

| Prioritas | Variabel port | Variabel host |
|---|---|---|
| 1 | `DASHBOARD_PORT` | `DASHBOARD_HOST` |
| 2 | `WEB_PORT` | `WEB_HOST` |
| 3 | `PORT` | — |
| 4 | `SERVER_PORT` | — |
| default | `3000` | `0.0.0.0` |

Variabel tambahan yang juga dibaca:

| Variabel | Fungsi |
|---|---|
| `WEB_ENABLED` | `false` = matikan dashboard walau `DASHBOARD_TOKEN` terisi |
| `PUBLIC_URL` / `WEB_PUBLIC_URL` | Alamat publik lengkap (mis. `http://78.154.103.15:16954`) — dipakai apa adanya di log |

**Nilai `0` atau kosong dianggap "belum diisi"** (Wispbyte mengirim `WEB_PORT=0` sebagai default),
jadi bot otomatis memakai 3000 — bukan memilih port acak.

Di log kamu bisa memastikan port mana yang dipakai:

```
INFO  🌐 Dashboard: http://localhost:25566 (login pakai DASHBOARD_TOKEN)
INFO     Port diambil dari WEB_PORT=25566
```

Kalau panel menampilkan port tertentu (mis. `25566` di tab Startup/Network), tulis di
`DASHBOARD_PORT=25566` supaya bisa diakses dari luar container.

> **Catatan:** variabel dari panel **mengalahkan** isi `.env`, karena `dotenv` tidak menimpa
> variabel yang sudah ada. Jadi aman mengisi keduanya.

---

## Tampilan & navigasi

- **Sidebar** berisi Ringkasan, Dokumen RAG, Keyword, Memori, Pengaturan, dan pintu ke Health check.
  Di layar HP sidebar jadi menu geser (tombol ☰ di kiri atas).
- **Topbar** berisi pemilih server, chip Server ID aktif, dan tombol keluar.
- **Kartu statistik** dan **grafik 7 hari** dihitung per server yang dipilih.
- Aksi destruktif (hapus dokumen/keyword/memori) memakai dialog konfirmasi, bukan `confirm()` bawaan browser.
- Semua notifikasi muncul sebagai *toast* di kanan bawah.

> Grafik memakai zona waktu **Asia/Jakarta**, jadi batang "Hari ini" mengikuti tanggal WIB — bukan UTC server.

---

## Pilih server

Dashboard menampilkan satu server pada satu waktu (query `?guild=<id>`). Pilih dari dropdown di kanan
atas, atau **tempel Server ID** di kotak sebelahnya — berguna untuk bot yang belum pernah join server
(database masih kosong).

**Daftar server di dropdown datang dari dua sumber:**

1. server yang di-join bot (didaftarkan otomatis saat login, tiap kali bot masuk server baru, dan saat
   room AI pertama dibuat di server itu);
2. server yang sudah punya data di SQLite — room, dokumen, keyword, atau memori.

Jadi database lama tetap tampil walau tabel `guilds`-nya belum pernah terisi. Semua angka di halaman
Ringkasan (Room AI, Dokumen, Keyword, Memori, Pesan) juga **dihitung per server yang dipilih**, supaya
cocok dengan tabel di bawahnya.

Cara mendapatkan Server ID: Discord → Server Settings → Widget, atau klik kanan server (mode
developer) → *Copy Server ID*.

---

## Upload dokumen dari dashboard

1. Buka `/dokumen`.
2. **Upload dari komputer**: pilih `.txt`/`.md`/`.csv`/`.json`/`.pdf`/`.docx`/… (maks 8 MB) → *Upload dokumen*.
   PDF dan DOCX diekstrak otomatis jadi teks (lihat [rag.md](rag.md#pdf--docx)).
3. **Atau tempel teks**: beri nama file, tempel isinya, simpan.

Setelah tersimpan, halaman menampilkan jumlah potongan. Nama yang sama akan menggantikan versi lama.

### Uji pencarian

Kotak *Uji pencarian* memanggil mesin pencari yang sama dengan yang dipakai AI. Hasilnya menampilkan
potongan + skor + sumber (`lexical`, `vector`, atau `hybrid`). Ini cara tercepat tahu apakah dokumen
kamu akan terpakai saat member bertanya.

---

## Riwayat transkrip (`/transkrip`)

Setiap kali member menekan **Akhiri Sesi**, transkrip HTML-nya bukan cuma dikirim ke DM dan channel
arsip — salinannya juga disimpan di tabel `transcripts` (SQLite), jadi tetap ada walau file di Discord
sudah tenggelam atau folder `transcripts/` di panel dibersihkan.

Halaman `/transkrip` menampilkan: user, channel asal, jumlah pesan, jumlah memori, ukuran file,
waktu sesi ditutup, cuplikan ringkasan AI, plus tombol **Unduh** dan **Hapus**.

| Endpoint | Fungsi |
|---|---|
| `GET /api/transkrip/<id>` | Unduh file HTML sebagai attachment (`content-disposition`) |
| `DELETE /api/transkrip/<id>` | Hapus satu arsip dari database |

Semua endpoint tetap butuh sesi login, dan `<id>` hanya bisa diakses oleh server (guild) pemiliknya.
Transkrip dikirim sebagai **attachment** dengan `x-content-type-options: nosniff`, jadi isi HTML dari
member tidak pernah dieksekusi di origin dashboard.

> Ukuran penyimpanan: transkrip ~30–100 KB per sesi. Seribu sesi kira-kira 50 MB, masih aman di
> disk 1 GB Wispbyte. Hapus arsip lama dari halaman ini kalau mulai menumpuk.

---

## Moderasi (`/moderasi`)

Semua yang bisa diatur lewat `.env` juga bisa diatur di sini — dan nilai dashboard **menang**
atas `.env` karena tersimpan per server. Halaman ini berisi:

- **Filter kata**: status aktif/nonaktif, daftar kata (koma atau baris baru), tindakan
  (`delete`/`warn`/`timeout`), durasi timeout 1–10080 menit.
- **Ringkasan**: jumlah kata terdaftar, tindakan aktif, jumlah log.
- **Log pelanggaran**: pelaku, kata yang cocok, cuplikan pesan, tindakan, waktu —
  bisa dihapus satu per satu atau dibersihkan sekaligus.

| Endpoint | Fungsi |
|---|---|
| `POST /api/moderasi` | Simpan pengaturan (JSON: `enabled`, `words[]`, `action`, `timeoutMinutes`) |
| `DELETE /api/moderasi/logs/<id>` | Hapus satu catatan pelanggaran |
| `DELETE /api/moderasi/logs` | Bersihkan semua catatan pelanggaran server ini |

Penjelasan cara pencocokan kata, pengecualian staff, dan pengiriman log ke channel ada di
[docs/moderation.md](moderation.md). Perubahan dari dashboard langsung dipakai pada pesan
berikutnya (cache pengaturan hanya 15 detik dan di-reset saat menyimpan).

---

## Login lewat link (`/masuk/<token>`)

Malas mengetik token di HP? Buka dashboard lewat address bar:

```
http://<alamat-panel>:<port>/masuk/<DASHBOARD_TOKEN>
```

Alurnya:

1. Server memeriksa token (tetap timing-safe, sama seperti form login).
2. Sesi 12 jam dibuat → cookie `zp_session` httpOnly dipasang.
3. Halaman perantara menjalankan `location.replace('/')`, sehingga **entri riwayat berisi token
   diganti** dengan `/` — tombol Back tidak membuka URL bertoken lagi.
4. Semua halaman dikirim dengan `Referrer-Policy: no-referrer`, jadi token tidak bocor ke situs lain
   lewat header Referer.

`/login/<token>` juga jalan (alias). Tanpa token → dialihkan ke form login biasa.

**Yang tetap perlu kamu waspadai:**

| Risiko | Mitigasi |
|---|---|
| Token terlihat di log proxy / panel hosting | Jangan pakai link di komputer bersama; ganti token bila ragu |
| Link tak sengaja terkirim ke orang lain | Siapa pun pemegang link = admin. Rotasi token: `npm run token -- --write` lalu perbarui env panel |
| Brute force lewat link | Batas 8 percobaan / 10 menit per IP, sama dengan form login |
| Browser menyimpan autocomplete | Tidak berlaku — token tidak pernah diketik di form |

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
| Server bot tidak muncul di dropdown | Restart bot (daftar server diperbarui saat login) atau tempel Server ID manual |
| Angka berbeda dengan daftar di bawah | Sudah diperbaiki: angka kini per server. Update ke versi terbaru |
| Data hilang setelah redeploy | Hosting tanpa disk persisten. Lihat [hosting.md](hosting.md) |

---

Bagian dari panduan Zypher AI:

- [setup.md](setup.md) — dari nol sampai bot jalan
- [rag.md](rag.md) — dokumen pengetahuan AI
- [hosting.md](hosting.md) — hosting gratis 24/7
