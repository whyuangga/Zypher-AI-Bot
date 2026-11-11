# Pesan container (`/pesan`)

Halaman untuk menyusun **pesan tampilan** sendiri — rules, ambil roles, pengumuman,
info server — tanpa harus menunggu bot punya menu khusus untuk tiap kebutuhan.

Ini lanjutan dari [Sambutan & perpisahan](sambutan-agent.md): di sana tampilannya
sudah diatur bot. Di sini **kamu yang menentukan isinya**.

---

## 1. Cara pakai

1. Buka **Pesan** di sidebar dashboard.
2. Isi **Nama pesan** (mis. `Rules`). Nama ini hanya untuk dashboard — tidak ikut
   terkirim ke Discord.
3. Pilih **Channel tujuan**.
4. Tambahkan blok: **Teks**, **Gambar**, **Tombol**, **Pemisah**.
5. **Simpan** dulu. Setelah tersimpan, **Kirim ke Discord**.

Urutan blok bisa diubah dengan panah ↑ ↓, dan setiap blok bisa dihapus dengan ×.

### Mengirim ulang vs memperbarui

Saat kamu menekan **Kirim ke Discord** untuk pesan yang **sudah pernah dikirim**,
bot **mengedit pesan yang lama**, bukan mengirim yang baru. Jadi:

- jumlah pesan di channel tidak bertambah,
- reaksi dan tautan yang sudah dibagikan member tetap menunjuk pesan yang sama,
- ID pesan disimpan di database (`custom_posts.message_id`).

Kalau pesan lama ternyata sudah dihapus seseorang di Discord, bot otomatis
mengirim pesan baru dan menyimpan ID yang baru.

---

## 2. Blok yang tersedia

| Blok | Isi | Catatan |
|---|---|---|
| **Teks** | teks biasa | mendukung format Discord (`**tebal**`, `_miring_`, `> kutipan`, `### judul`) |
| **Gambar** | URL `http(s)://…` **atau unggah dari komputer** | PNG/JPG/WebP, maksimal 4 MB |
| **Tombol** | label + URL tujuan + emoji | hanya **tombol link**; membuka tautan, tidak memberi role |
| **Pemisah** | garis, jarak rapat atau renggang | pemisah antar bagian |
| **Container** | warna aksen sendiri | memulai **kartu baru**; blok sesudahnya masuk ke kartu itu |
| **Section** | teks + gambar kecil **atau** tombol di kanan | Discord hanya mengizinkan satu aksesori |

Teks kecil: baris yang diawali `-#` (mis. `-# dibuat oleh admin`) tampil kecil dan
redup di Discord. Ini cara membuat catatan kaki.

### Container: beberapa kartu dalam satu pesan

Seperti contoh pesan Discohook, satu pesan bisa berisi **beberapa kartu** dengan
warna berbeda. Caranya: tambahkan blok **Container**, lalu semua blok sesudah
blok berikutnya masuk ke kartu itu sampai ada Container lagi.

```
Teks            "Hey, welcome to …"        → di luar kartu (polos)
Container       #58b9ff
Teks            "### What is this?"        → kartu 1
Teks            "At its core, …"           → kartu 1
Container       #ff8800
Teks            "### Get started"          → kartu 2
```

Aturan yang dipegang:

- **Tanpa blok Container, hasilnya tetap satu kartu** — pesan yang sudah ada
  tidak berubah tampilannya.
- Begitu pesan punya blok Container, blok isi **sebelum Container pertama**
  tampil **di luar kartu** (tanpa border warna), persis seperti pesan Discohook:
  teks pembuka polos di atas, baru kartu-kartunya. Ini yang membuat pesan tidak
  lagi terkurung dalam satu kotak besar.
- Container **kosong dibuang** sebelum dikirim. Admin yang menambah kartu lalu
  berubah pikiran tidak mendapat kartu kosong.
- Container **tidak bisa bersarang** di dalam container lain (aturan Discord).
- Maksimal **10** komponen teratas per pesan.

### Tutup kartu: teks & tombol di luar container

Di pesan Discohook, teks pembuka dan baris tombol berada **di luar** kartu.
Untuk itu ada blok **Tutup kartu**: semua blok sesudahnya tampil langsung di
pesan, sampai ada blok **Container** lagi.

```
Teks            "Hey, welcome to …"
Tutup kartu                                 → mulai menulis di luar kartu
Container       #58b9ff
Teks            "### What is this?"         → kartu 1
Container       #ff8800
Teks            "### Get started"           → kartu 2
Tutup kartu                                 → keluar dari kartu lagi
Tombol          "Support Server"  ┐
Tombol          "Invite Bot"      ┘         → satu baris tombol polos
```

Yang perlu diketahui:

| Hal | Perilaku |
|---|---|
| Blok di luar kartu | teks, pemisah, gambar, section, dan baris tombol |
| Tombol di luar kartu | satu ActionRow, maksimal 5 — sisanya jadi baris berikutnya |
| Container sesudah "Tutup kartu" | otomatis masuk ke kartu lagi |
| Dua "Tutup kartu" berurutan | diringkas jadi satu, tidak menggandakan apa pun |
| Tombol ambil role & menu | **selalu** menempel di kartu terakhir, bukan di luar |
| Penghitung komponen | komponen di luar kartu ikut dihitung sebagai komponen teratas (maks 10) |

Di pratinjau, area luar kartu diberi label kecil **di luar kartu** supaya batas
kartu terlihat jelas. Label itu hanya ada di dashboard — tidak ikut terkirim.

### Aksesori di komponen mana pun

Seperti Discohook, **teks dan gambar** juga bisa diberi aksesori — bukan hanya
blok Section. Tombol **Aksesori** di bawah editor teks/gambar punya dua isian:

| Aksesori | Hasil di Discord |
|---|---|
| **Teks tombol + URL** | tombol link di kanan teks/gambar |
| **Thumbnail** | gambar kecil 64×64 di kanan teks |

Keduanya **saling meniadakan**: Discord hanya menerima satu aksesori per
Section. Jadi begitu kamu mengisi teks tombol, kolom thumbnail otomatis mati —
lebih jelas daripada mengisi dua-duanya lalu diam-diam hanya satu yang dipakai.

Di balik layar, teks/gambar beraksesori dikirim sebagai **Section**. Itu satu-
satunya komponen Discord yang punya slot aksesori. Teks tanpa aksesori tetap
dikirim sebagai TextDisplay biasa, jadi pesan lama tidak berubah bentuknya.

### File: lampiran berkas

Blok **File** mengirim lampiran: PDF, zip, atau berkas lain. Dua sumber:

| Sumber | Perilaku |
|---|---|
| **URL** (`https://…/panduan.pdf`) | diunduh bot saat kirim (maks 8 MB), lalu dilampirkan |
| **Unggah dari perangkat** | dikirim apa adanya sebagai lampiran (maks 8 MB) |

Yang perlu diketahui:

- Berkas **selalu tampil di dasar pesan**, di luar kartu — sama seperti lampiran
  Discord biasa. Ia tidak pernah masuk ke dalam container.
- Maksimal **5 berkas** per pesan (Discord mengizinkan 10; 5 menyisakan ruang
  untuk gambar unggahan).
- **Spoiler** menyamarkan nama berkas dan gambarnya sampai diklik.
- Kalau unduhan gagal (URL mati, berkas terlalu besar), pesan **tetap terkirim**
  tanpa berkas itu, dan dashboard memberi tahu berkas mana yang gagal.

### Naik, turun, salin, hapus

Setiap blok punya empat tombol di kanan atas: **↑** naik, **↓** turun,
**⧉** duplikat, **×** hapus. Duplikat menyalin blok tepat di bawah aslinya —
berguna untuk menyusun beberapa kartu serupa tanpa mengetik ulang.

### Section: teks dengan aksesori

Section menaruh **teks di kiri** dan **satu aksesori di kanan** — gambar kecil
(64×64, dipotong rapi) atau satu tombol link. Ini yang membuat pesan terasa
seperti kartu sambutan.

Kalau kamu mengisi **keduanya**, tombol yang dipakai: Discord menolak section
dengan dua aksesori, jadi bot memilih salah satu alih-alih mengirim payload
yang pasti gagal.

### Pratinjau, warna, dan pengirim

Di atas kartu pratinjau ada tiga hal yang bisa diubah:

| Kontrol | Arti |
|---|---|
| **Pratinjau** | kartu di atas kartu Tombol ambil role — ikut berubah saat kamu mengetik, lengkap dengan urutan blok dan batas 5 tombol per baris |
| **Warna aksen** | garis warna di kiri kartu; ada tombol **Bawaan** untuk kembali ke `#6d8cff` |
| **Pengirim** | **Bot** (bisa tombol role) atau **Atas nama server** (lewat webhook) |

Pratinjau digambar dari **data blok yang sama** yang dikirim ke Discord, jadi
yang kamu lihat bukan tebakan. Teks dimasukkan sebagai teks biasa (bukan HTML),
jadi isi pesan tidak bisa menyuntik elemen ke halaman dashboard.

### Batas yang dipakai bot

Discord punya batas keras. Bot memangkas isi agar kiriman tidak ditolak:

| Batas | Angka |
|---|---|
| **Komponen total per pesan** (termasuk bersarang) | **40** |
| **Komponen teratas per pesan** (container) | **10** |
| Total teks satu pesan | 3.500 karakter (jaring aman; Discord 4.000) |
| Teks per Section | 1–3 blok |
| Panjang satu blok teks | 4.000 karakter |
| Jumlah blok di editor | 120 |
| Tombol per baris | 5 |
| Baris tombol per pesan | 5 |
| Gambar galeri | 10 |
| Pilihan per menu role | 25 |

**Kenapa 40, bukan 25.** Banyak panduan di internet menyebut 25 komponen — itu
batas pesan **lama**. Components V2 memakai 40 komponen total dan 10 komponen
teratas. Memakai angka lama berarti menolak pesan yang sebenarnya sah.

**Penghitung di dashboard.** Di bawah daftar blok ada bilah kecil:

```
23/40 komponen · 2/10 container · 812/3500 karakter
```

Angkanya berubah saat kamu mengetik, dan berubah warna (kuning → merah) saat
mendekati batas. Server **menghitung ulang dengan aturan yang sama** saat
menyimpan dan mengirim: angka di dashboard hanya untuk kenyamanan, keputusan
boleh-kirim tetap di server.

Kalau ada blok yang tidak mungkin dikirim, dashboard **memberi tahu nama bloknya**
saat menyimpan — tidak dibuang diam-diam. Contoh: tombol yang URL-nya bukan
`http`/`https` akan muncul sebagai

```
Sebagian blok dibuang: tombol "Rusak" (URL tujuan harus http/https)
```

`javascript:` dan `data:` sengaja ditolak.

---

## 3. Kapan memakai halaman ini

| Kebutuhan | Cocok di `/pesan`? |
|---|---|
| Rules server | ✅ satu pesan teks + beberapa pemisah |
| Pengumuman sekali kirim | ✅ teks + gambar + tombol tautan |
| Info server & tautan penting | ✅ daftar tombol link |
| Ambil role otomatis | ✅ lihat bagian 4 di bawah |
| Sambutan member baru | ❌ pakai `/sambutan` — butuh template & AI |

---

## 4. Tombol & menu ambil role

Kartu **Tombol & menu ambil role** memberi member role hanya dengan mengklik
tombol atau memilih dari dropdown — tanpa admin turun tangan.

| Langkah | Keterangan |
|---|---|
| Pilih role → **Tambah tombol** | label bisa diubah bebas |
| **Mode** | `klik = pasang/lepas` (toggle) atau `hanya beri` (klik kedua tidak melepas) |
| **Emoji** | satu emoji di depan label, mis. `🎮` atau `<:kucing:1234567890123456789>` |
| **Warna** | Biru / Abu / Hijau / Merah (lihat catatan di bawah) |
| **Simpan** | tombol & menu tersimpan bersama pesannya, satu tombol untuk semuanya |
| **Kirim ke Discord** | tombol role muncul di **baris paling bawah** pesan, menu tepat di bawahnya |

### Menu dropdown (select menu)

Dipakai kalau role-nya **banyak** — satu dropdown memuat sampai 25 pilihan,
sehingga tidak berdesakan di baris tombol.

| Pengaturan | Arti |
|---|---|
| **Teks ajakan** (placeholder) | kalimat di dropdown sebelum member memilih, mis. "Pilih warna namamu" (maks 150 karakter) |
| **min / maks** | berapa pilihan yang boleh diambil sekaligus |
| **Hanya satu pilihan (eksklusif)** | memilih role baru **mencabut** role lain di menu yang sama |
| **Keterangan** per pilihan | teks kecil di bawah label (maks 100 karakter) |

**Mode eksklusif itu inti fiturnya.** Contoh pemakaiannya: menu warna nama,
menu platform (PC/PlayStation/Xbox), atau menu tingkat pengalaman. Tanpa
eksklusif, member bisa mengambil dua warna sekaligus dan pesannya jadi tidak
konsisten.

Satu hal yang penting dan sering disalahpahami: yang dicabut **hanya role di
menu itu**. Role staf, role booster, atau role lain di luar menu tidak pernah
disentuh — kalau tidak, satu dropdown warna bisa menghapus jabatan seseorang.

### Kenapa warna tombol tidak selalu sama dengan yang dipilih

Discord hanya mengizinkan **empat** gaya untuk tombol interaktif: Primary
(biru), Secondary (abu), Success (hijau), Danger (merah). Tombol **link**
(label + URL) selalu tampil abu-abu — itu aturan Discord, bukan pilihan bot.
Jadi pilihan warna hanya berlaku untuk tombol ambil role.

Role yang tidak bisa dibagikan sudah ditandai **sebelum** pesan dikirim, lengkap
dengan alasannya — bukan baru ketahuan saat member mengklik.

### Syarat agar tombol bekerja

1. **Izin Manage Roles** untuk bot (Server Settings → Roles → pilih role bot).
2. **Posisi role bot di ATAS role yang dibagikan.** Ini aturan Discord, bukan
   pilihan bot. Kalau role "Gamer" ada di atas role bot, Discord menolak
   walaupun bot punya izinnya.
3. Member yang mengklik juga harus berada **di atas** role tersebut. Tanpa ini,
   member biasa bisa memberi dirinya role moderator.

Kalau salah satu syarat tidak terpenuhi, member mendapat penjelasan singkat
(hanya dia yang melihatnya), dan bot mencatat alasannya di log.

### Kenapa customId-nya `post-role:<id>`

Role disimpan di **database**, bukan di dalam `customId`. CustomId hanya membawa
ID baris tombol, jadi:

- customId tetap pendek (batas Discord 100 karakter),
- role bisa diganti tanpa mengirim ulang pesan,
- tombol yang dihapus admin langsung berhenti berlaku — customId lama tidak
  ditemukan di database.

Konsekuensinya: **menyimpan ulang tombol role membatalkan customId lama.**
Kalau isi tombol berubah, kirim ulang pesannya supaya member melihat tombol baru.

### Kenapa tombol role di baris paling bawah

Tombol ini yang paling sering diklik member, jadi posisinya tetap dan mudah
ditemukan walaupun admin mengubah isi teks di atasnya. Tombol link dari blok
**Tombol** tetap di tempatnya sesuai urutan blok.

---

## 5. Mengirim atas nama server (webhook)

Memilih pengirim **Atas nama server** membuat pesan tampil dengan nama dan logo
server, bukan sebagai bot. Ini hanya bisa lewat **webhook** — bot tidak bisa
menyamarkan dirinya sebagai server.

**Yang dibutuhkan:** izin **Manage Webhooks** untuk bot di channel tujuan.

| Hal | Bagaimana ditangani |
|---|---|
| Token webhook | **dienkripsi** (AES-256-GCM) sebelum disimpan; kuncinya diturunkan dari `DASHBOARD_TOKEN` |
| Token di browser | tidak pernah dikirim, bahkan tersamar |
| Webhook baru | dibuat sekali per channel, lalu dipakai ulang |
| Webhook dihapus orang | bot mendeteksi dan membuat yang baru, tidak gagal terus |
| Tombol & menu ambil role | **tidak bisa** dipakai di pesan webhook — ditolak dengan penjelasan |

**Kenapa tombol/menu role tidak bisa:** Discord mengirim interaksi komponen ke
aplikasi *pengirim* komponen. Kalau pesan dikirim webhook, tidak ada aplikasi
kita di sana, sehingga tombol dan dropdown-nya akan diam saat dipakai. Karena
itu bot menolaknya lebih awal, bukan mengirim komponen yang tidak berfungsi.

**Batas keamanan enkripsi, jujur:** enkripsi ini melindungi dari pembacaan file
atau cadangan database. Kalau `DASHBOARD_TOKEN` diganti, token webhook lama
tidak bisa dibuka lagi — bot akan membuat webhook baru otomatis.

## 6. Catatan teknis

- Isi disimpan sebagai JSON di tabel `custom_posts` (`blocks`), berlaku untuk
  SQLite maupun Postgres.
- Blok divalidasi di server (`sanitizeBlocks`) **sebelum** disimpan, bukan hanya
  di browser — jadi API tidak bisa dipakai menyelipkan blok mustahil.
- Teks dari admin selalu di-escape saat masuk HTML dashboard. JSON yang ditanam
  di `<script>` juga di-encode (`<` → `\u003c`) supaya `</script>` di isi pesan
  tidak bisa menyuntik HTML.
- Menghapus pesan dari dashboard **tidak** menghapus pesan yang sudah terkirim di
  Discord, kecuali diminta lewat `DELETE /api/posts/:id?withMessage=1`.

### Endpoint

| Metode | Jalur | Guna |
|---|---|---|
| `POST` | `/api/posts` | buat pesan baru |
| `POST` | `/api/posts/:id` | perbarui pesan |
| `POST` | `/api/posts/:id/send` | kirim, atau perbarui pesan Discord yang sudah ada |
| `DELETE` | `/api/posts/:id` | hapus dari dashboard |
| `DELETE` | `/api/posts/:id?withMessage=1` | hapus dari dashboard **dan** dari Discord |
| `PUT` | `/api/posts/:id/roles` | ganti seluruh tombol **dan** menu ambil role pesan (`{ buttons, menus }`) |
| `GET` | `/api/roles` | daftar role server + alasan tidak bisa dibagi |

Kalau bot sedang offline, tombol kirim dinonaktifkan dan permintaan kirim
dijawab `400` dengan pesan yang jelas — bukan `500`.

`PUT /api/posts/:id/roles` menerima dua kunci:

```json
{
  "buttons": [{ "label": "Gamer", "roleId": "123...", "mode": "toggle", "emoji": "🎮", "style": "success" }],
  "menus": [{
    "placeholder": "Pilih warna",
    "minValues": 1,
    "maxValues": 1,
    "exclusive": true,
    "options": [{ "label": "Merah", "roleId": "456...", "emoji": "🔴", "description": "Hangat" }]
  }]
}
```

Kalau `menus` **tidak dikirim**, menu yang sudah ada dibiarkan apa adanya —
supaya klien lama yang hanya mengirim `buttons` tidak menghapus dropdown tanpa
sengaja. Untuk menghapus semua menu, kirim `"menus": []`.

### Tabel database

| Tabel | Isi |
|---|---|
| `post_role_buttons` | satu baris per tombol role (`emoji`, `style` ikut disimpan) |
| `post_role_menus` | satu baris per dropdown (`placeholder`, `min_values`, `max_values`, `exclusive`) |
| `post_role_options` | satu baris per pilihan dropdown |

Opsi disimpan di tabel sendiri, bukan sebagai JSON di dalam menu: jumlahnya
sampai 25 per menu dan tiap opsi punya label, emoji, serta keterangan yang
masing-masing bisa diubah.
