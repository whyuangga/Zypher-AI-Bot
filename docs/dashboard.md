# 🌐 Web dashboard — kelola bot tanpa lewat Discord

Dashboard kecil berjalan **di dalam proses bot yang sama**: satu container, satu database, tanpa
framework tambahan. Semua halaman dirender dari server (tanpa bundler, tanpa build frontend), jadi
ringan dan tidak menambah dependensi.

Yang bisa dilakukan:

| Halaman | Isi |
|---|---|
| `/` | 3 kartu statistik, **grafik aktivitas 7 hari**, status sistem, room terbaru, dokumen terbaru |
| `/panel` | Kelola panel "Buat Room AI": kirim ke satu channel, ganti channel, hapus, atau matikan tombolnya |
| `/dokumen` | Upload dokumen RAG (file atau tempel teks), daftar dokumen, hapus dokumen, **uji pencarian** |
| `/keyword` | Tambah & hapus template jawaban owner (FAQ, harga, aturan) |
| `/moderasi` | Filter kata terlarang per server, tindakan (hapus/tegur/timeout), log pelanggaran |
| `/pengaturan` | Persona AI & model per server, **toggle fitur AI** (RAG, Vision, Auto Memory, Admin Only Rooms, Suara di room), info server + salin Server ID |
| `/healthz` | JSON status untuk monitoring (tanpa login) — termasuk engine database |

Tampilan memakai gaya **editorial gelap** (hangat, bukan hitam-putih murni) dengan palet pemilik proyek:

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

- **Sidebar** berisi Ringkasan, Panel, Dokumen RAG, Keyword, Moderasi, Pengaturan,
  dan pintu ke Health check. Di layar HP sidebar jadi menu geser (tombol ☰ di kiri atas).
- **Topbar** berisi pemilih server, nama server aktif, dan tombol keluar.
- **Kartu statistik** dan **grafik 7 hari** dihitung per server yang dipilih.
- Aksi destruktif (hapus dokumen/keyword) memakai dialog konfirmasi, bukan `confirm()` bawaan browser.
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
Ringkasan (Room AI, Dokumen, Keyword, Pesan) juga **dihitung per server yang dipilih**, supaya
cocok dengan tabel di bawahnya.

**Nama server:** bot menyimpan nama server Discord ke tabel `guilds` saat login, saat masuk server baru,
dan saat server di-rename — jadi dropdown menampilkan nama, bukan deretan angka. Server yang belum
pernah dilihat bot (mis. Anda hanya membuka mode dashboard-saja) tampil sebagai `Server 577090`
(enam digit terakhir ID) sampai bot dijalankan sekali.

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

## Transkrip & memori: tidak ada di dashboard

Demi privasi member, dashboard **tidak** menyimpan dan **tidak** menampilkan:

- **Transkrip percakapan** — tidak ada tabel `transcripts`, tidak ada halaman `/transkrip`,
  tidak ada endpoint unduhan. Saat member menekan **Akhiri Sesi**, transkrip HTML hanya dikirim
  ke **DM member**. Kalau DM tertutup, file dilampirkan di room AI dan channel sengaja tidak
  dihapus supaya member bisa mengunduhnya sendiri.
- **Memori member** — tidak ada halaman `/memori`, tidak ada API baca/hapus memori, dan tidak ada
  kartu statistik memori di Ringkasan. Memori tetap berfungsi penuh di Discord (`/ingat`,
  `/lupakan`, `/memori`, `/konsolidasi`) dan tetap dipakai AI untuk menjawab.

Admin server tidak bisa membaca isi percakapan atau fakta pribadi member lewat dashboard.
Database dari versi lama akan otomatis **menghapus tabel `transcripts`** saat bot dijalankan ulang.

> Catatan: isi percakapan tetap dibaca AI untuk menjawab, dan tetap disimpan sementara di tabel
> `messages` per channel room selama sesi berjalan — baris itu dihapus saat sesi berakhir.

---

## Panel room AI (`/panel`)

Halaman ini menggantikan ketikan `/panel` di Discord untuk urusan sehari-hari.

| Aksi | Hasil |
|---|---|
| Pilih channel → **Kirim panel** | Panel dikirim ke channel itu; panel lama (kalau ada) dihapus otomatis |
| **Kirim ulang panel** | Panel di channel yang sama dikirim baru, pesan lama dihapus |
| **Hapus panel** | Pesan panel dihapus dari Discord, jadi tombol "Buat Room AI" tidak bisa diklik lagi |
| Centang "Izinkan member membuat room" | Tombol tetap terlihat, tapi kalau dimatikan member mendapat balasan *"sedang dinonaktifkan admin"* |

Aturannya **satu panel per server**. Database hanya menyimpan satu baris di tabel `panels`
(`channel_id` + `message_id`), jadi tidak mungkin ada dua panel aktif tanpa sengaja.

Hal yang perlu diketahui:

- Halaman ini butuh **bot hidup** (`npm run dev` / `node dist/index.js`). Di mode dashboard-saja,
  daftar channel tidak bisa dibaca dan tombol kirim/hapus akan menolak dengan pesan jelas — tapi
  tombol aktif/nonaktif tetap bisa disimpan.
- Bot perlu izin **View Channel**, **Send Messages**, **Embed Links**, dan **Manage Messages**
  (untuk menghapus panel lama) di channel tujuan. Izin dicek sebelum mengirim.
- Mematikan tombol tidak menghapus pesan panel; member masih bisa membaca penjelasannya.
- Panel yang dikirim lewat `/panel` di Discord juga tercatat di halaman ini.

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

Endpoint halaman Panel:

| Endpoint | Fungsi |
|---|---|
| `POST /api/panel` `{action:'send',channelId}` | Kirim/kirim ulang panel ke channel itu (panel lama dihapus) |
| `POST /api/panel` `{action:'remove'}` | Hapus pesan panel dari Discord |
| `POST /api/panel` `{action:'toggle',enabled}` | Nyalakan/matikan tombol "Buat Room AI" tanpa menyentuh pesannya |

Penjelasan cara pencocokan kata, pengecualian staff, dan pengiriman log ke channel ada di
[docs/moderation.md](moderation.md). Perubahan dari dashboard langsung dipakai pada pesan
berikutnya (cache pengaturan hanya 15 detik dan di-reset saat menyimpan).

---

## Toggle fitur AI per server

Semua fitur AI bisa di-toggle per server dari dashboard `/pengaturan` — tidak perlu edit `.env`:

| Toggle | Arti | Default .env |
|---|---|---|
| **Dokumen RAG** | AI boleh jawab dari dokumen yang di-upload | `RAG_ENABLED=true` |
| **Vision (Gambar)** | AI boleh baca gambar yang dikirim member | `VISION_ENABLED=false` |
| **Auto Memory** | AI boleh ingat fakta otomatis dari percakapan | `AUTO_MEMORY=true` |
| **Admin Only Rooms** | Hanya admin yang boleh buat room AI | `ADMIN_ONLY_ROOMS=false` |
| **Suara di room** | Jawaban AI di room otomatis dibacakan (TTS) | `TTS_REPLY_IN_ROOM=true` |

Bila belum di-set (default), memakai nilai dari `.env`. Setelah di-set, nilai di database dipakai — overriding `.env`.

---

## Konsolidasi memori (`/konsolidasi`)

AI bisa meninjau memori user secara periodik: menggabungkan fakta yang berulang
("Namaku Bagas" × 3 → satu fakta), dan menghapus obrolan basi yang tidak berguna untuk
percakapan nanti. Di ruang privat (room AI), AI otomatis memanggil ini setelah 40 memori
terkumpul; admin juga bisa menjalankannya dari dashboard atau slash command:

**Discord**: `/konsolidasi [user]` — bisa dipakai member untuk dirinya sendiri, atau admin untuk member lain.
(Dashboard tidak lagi menyediakan konsolidasi, karena isi memori tidak lagi ditampilkan di sana.)

Keamanan: konsolidasi gagal (AI error, output tidak valid) → **tidak menghapus apa pun**. Memori lama
dihapus hanya setelah AI mengembalikan daftar fakta yang valid.

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
| Dropdown menampilkan `Server 577090` | Nama server diambil dari Discord saat bot login. Jalankan bot sekali (`npm run dev`) — di mode dashboard-saja nama belum diketahui |
| Panel tidak bisa dikirim dari dashboard | Halaman Panel butuh bot hidup; mode dashboard-saja hanya bisa menyimpan tombol aktif/nonaktif |
| Angka berbeda dengan daftar di bawah | Sudah diperbaiki: angka kini per server. Update ke versi terbaru |
| Data hilang setelah redeploy | Hosting tanpa disk persisten. Lihat [hosting.md](hosting.md) |

---

Bagian dari panduan Zypher AI:

- [setup.md](setup.md) — dari nol sampai bot jalan
- [rag.md](rag.md) — dokumen pengetahuan AI
- [hosting.md](hosting.md) — hosting gratis 24/7
