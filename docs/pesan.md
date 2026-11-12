# Pesan container (`/pesan`)

Halaman untuk menyusun **pesan tampilan** sendiri — rules, ambil roles, pengumuman,
info server — tanpa harus menunggu bot punya menu khusus untuk tiap kebutuhan.

Ini lanjutan dari [Sambutan & perpisahan](sambutan-agent.md): di sana tampilannya
sudah diatur bot. Di sini **kamu yang menentukan isinya**.

---

## 1. Cara pakai

1. Buka **Pesan** di sidebar dashboard.
2. Di tab **Susun**: isi **Nama pesan** (mis. `Rules`). Nama ini hanya untuk
   dashboard — tidak ikut terkirim ke Discord.
3. Pilih **Channel tujuan**.
4. Tambahkan komponen: **Teks**, **Gambar**, **Tombol**, **Pemisah**,
   **Container**, **Section**, **File**, **Select menu**, **Baris baru**, dan
   **Tutup kartu**.
5. **Simpan** dulu. Setelah tersimpan, **Kirim ke Discord**.

Urutan komponen diubah dengan panah ↑ ↓; setiap komponen punya tombol **⧉**
duplikat dan **×** hapus di kanan atas, sama seperti editor Discohook.

### Tab: halaman tidak lagi memanjang ke bawah

Halaman dibagi empat tab, jadi yang tampil hanya bagian yang sedang dikerjakan:

| Tab | Isi |
|---|---|
| **Susun pesan** | editor komponen + pratinjau kecil yang **menempel** di kanan |
| **Pratinjau** | pratinjau besar selebar halaman |
| **Ambil role** | tombol & menu dropdown role |
| **Impor** | tarik dari Discohook, ekspor/impor JSON |

Tombol **Simpan** dan **Kirim ke Discord** ada di bilah bawah yang selalu
terlihat, dari tab mana pun. Berpindah tab **tidak menghilangkan isian** yang
belum disimpan: panel yang tidak aktif hanya disembunyikan, bukan dilepas.
Tab terakhir yang dibuka diingat, dan setelah menyimpan halaman tidak dimuat
ulang — jadi kamu tetap di tab yang sama.

### Editor bertumpuk ala Discohook

Komponen digambar **di dalam** kotak container-nya, bukan sebagai daftar datar.
Kotak container memakai warna aksen yang dipilih, jadi pewarnaan terlihat
sebelum pesan dikirim. Komponen yang berada di luar kartu diberi baris penanda
**"di luar kartu"**, sehingga batas antara isi kartu dan teks polos selalu
terlihat di editor.

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
| **Gambar** | URL `http(s)://…` **atau unggah dari komputer** | PNG/JPG/WebP, maksimal 4 MB. Ada isian **alt text** (deskripsi untuk pembaca layar) |
| **Tombol** | label + URL tujuan + emoji | hanya **tombol link**; membuka tautan, tidak memberi role. Bisa ditandai **nonaktif** |
| **Pemisah** | garis (bisa dimatikan) + jarak rapat/renggang | `tanpa garis` = hanya jarak kosong, seperti `divider: false` di Discohook |
| **Container** | warna aksen sendiri | memulai **kartu baru**; blok sesudahnya masuk ke kartu itu |
| **Section** | teks + gambar kecil **atau** tombol di kanan | Discord hanya mengizinkan satu aksesori |
| **Select menu** | dropdown: jenis, placeholder, min/maks, daftar pilihan | lima jenis seperti Discohook: String, User, Role, User & Role, Channel. **Tampilan saja** — pilihan tidak mengubah role |
| **Baris baru** | tidak punya isian | memotong deretan tombol: tombol sesudahnya dikirim di baris baru, seperti **Row** di Discohook |
| **Tutup kartu** | tidak punya isian | semua blok sesudahnya tampil **di luar** kartu |

Teks kecil: baris yang diawali `-#` (mis. `-# dibuat oleh admin`) tampil kecil dan
redup di Discord. Ini cara membuat catatan kaki.

### Select menu: semua jenis, seperti Discohook

Editor menyediakan **lima jenis** select menu yang sama dengan menu *Add
Component* di Discohook:

| Jenis | Isi pilihannya | Menyimpan pilihan? |
|---|---|---|
| **String** | daftar yang kamu tulis sendiri (label, nilai, keterangan, emoji) | tidak |
| **User** | anggota server | tidak |
| **Role** | role server | tidak |
| **User & Role** | anggota dan role | tidak |
| **Channel** | channel server | tidak |

Alasannya jujur: Discord hanya mengirim nilai pilihan ke **aplikasi pemilik
komponen**, dan bot tidak bisa membaca daftar anggota dari sebuah nilai. Menu di
sini karena itu berperilaku seperti di Discohook — tampil rapi dan bisa dibuka,
lalu saat member memilih, bot menjawab singkat bahwa menu itu tidak mengubah
apa pun. Untuk benar-benar memberi atau melepas role, pakai tombol/dropdown di
tab **Ambil role**.

Yang bisa diatur per menu: jenis, placeholder (maksimal 150 karakter), jumlah
**pilihan minimal** dan **maksimal** (0–25), serta sakelar **nonaktif**. Menu
jenis **String** juga punya daftar pilihan (maksimal 25) — menu String **tanpa
pilihan ditolak Discord**, jadi blok baru selalu membawa satu pilihan contoh.

Satu select menu selalu memakai **satu baris penuh** di Discord (lebarnya 5 dari
5 slot baris), jadi ia tidak pernah berbagi baris dengan tombol. Itu juga aturan
yang dipakai Discohook.

### Baris baru (Row): memotong deretan tombol

Discord menampilkan maksimal **5 tombol per baris**, dan tanpa penanda apa pun
tombol ke-6 otomatis turun. Blok **Baris baru** membuat pemotongan itu menjadi
pilihanmu: tombol sesudahnya dikirim di baris berikutnya, walaupun baris
sebelumnya belum penuh.

```
Tombol   "Umum"       ┐
Tombol   "Gaming"     ├ baris 1 (3 tombol)
Tombol   "Musik"      ┘
Baris baru                                 ← memotong di sini
Tombol   "Support"    ┐ baris 2 (2 tombol)
Tombol   "Situs"      ┘
```

Catatan:

- Row hanya berpengaruh **di antara tombol**. Kalau blok sesudahnya bukan
  tombol, Row tidak mengubah apa pun — editor memberi tahu hal ini di kartu Row.
- Dua Row berurutan diringkas menjadi satu saat disimpan.
- Saat tombol dipindah dengan panah ↑ ↓, Row yang tidak lagi memisahkan dua
  tombol otomatis diabaikan oleh editor, sehingga susunan tidak dipaksa
  melewati baris yang tidak perlu.

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
- Container punya centang **spoiler**: seluruh isi kartu tertutup sampai member
  mengkliknya (sama seperti Discohook).

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

### Kalau ada bagian yang tidak ikut terkirim

Pesan tetap dikirim, tetapi sebagian komponen bisa dilewati — misalnya select
menu tanpa pilihan, atau versi `discord.js` yang tidak mendukung salah satu
jenis menu. Daftar bagian yang dilewati **dikembalikan ke dashboard** dan
muncul sebagai peringatan tepat setelah menekan **Kirim**; pesannya tidak
pernah "hilang sebagian" tanpa penjelasan.

### Impor dari Discohook

Panel **Impor dari Discohook** (dilipat, tepat di atas panel JSON) mengambil
pesan yang sudah kamu susun di [Discohook](https://discohook.app) lalu
menerjemahkannya menjadi blok `/pesan`.

Dua cara, kotak yang sama:

| Cara | Yang ditempel | Kapan dipakai |
|---|---|---|
| **Tautan share** | `https://discohook.app/?share=abcdefgh` atau ID-nya saja | Discohook bisa diakses dari server bot |
| **JSON** | salin dari Discohook (tombol berbagi → *Copy JSON*) | Server bot tidak punya akses internet, atau tautan sudah kedaluwarsa |

Yang perlu diketahui:

| Hal | Perilaku |
|---|---|
| **Siapa yang mengunduh** | **server bot**, bukan browser — Discohook tidak mengirim header CORS, jadi `fetch` dari halaman akan ditolak browser |
| **Host yang diterima** | hanya `discohook.app` / `discohook.org`. Host lain ditolak, supaya endpoint ini tidak bisa disuruh membaca alamat internal |
| **Masa berlaku tautan** | maksimal 4 minggu (aturan Discohook). Kalau kedaluwarsa, tempel JSON-nya |
| **Multi-pesan** | Discohook menyimpan beberapa pesan sekaligus; yang diimpor adalah **pesan pertama**, jumlah sisanya disebutkan |
| **Hasil** | selalu **pesan baru** di editor, belum tersimpan — periksa dulu, lalu **Simpan** |
| **Validasi** | hasil terjemahan dilewatkan `sanitizeBlocks` yang sama, jadi tidak bisa menyelipkan blok tidak sah |

Komponen Discohook yang diterjemahkan:

| Di Discohook | Jadi apa di `/pesan` |
|---|---|
| Text Display | blok **Teks** |
| Container (`accent_color`, `spoiler`) | blok **Container** dengan warna **dan spoiler**-nya |
| Separator (`divider`, `spacing`) | blok **Pemisah** — termasuk pemisah **tanpa garis** |
| Section + aksesori tombol/thumbnail | blok **Section** (emoji & tombol nonaktif ikut) |
| Media Gallery | blok **Gambar** (alt text & spoiler ikut) |
| File (`attachment://`) | dilaporkan — lampiran Discohook tidak bisa dibawa lewat tautan |
| Action Row + tombol **link** | blok **Tombol**, 5 per baris |
| Dua Action Row tombol berdampingan | blok **Baris baru** disisipkan di antaranya, jadi barisnya tetap terpisah |
| String Select Menu | blok **Select menu** jenis *String* (placeholder, min/maks, pilihan, emoji) |
| User / Role / User & Role / Channel Select | blok **Select menu** dengan jenis yang sama |
| Dua Action Row pilihan berdampingan | tetap tidak digabung: tiap select memakai baris penuh |
| Tombol/menu **interaktif** (customId) | dilaporkan — pakai tombol/menu **ambil role** dari dashboard |
| Embed | **kartu teks** (Components V2 tidak bisa membawa embed) + peringatan |

Batas kartu ditangani otomatis: kalau di Discohook ada teks/tombol **di luar**
container, blok `close` disisipkan di posisi yang tepat. Jadi susunan
"pembuka polos → kartu → tombol penutup" tetap sama seperti aslinya.

### Import / ekspor JSON

Panel **Import / ekspor JSON** (dilipat di bawah editor) memindahkan susunan
pesan ke server lain atau menyimpan cadangan sebelum mengubah banyak hal.

Contoh berkasnya:

```json
{
  "format": "zypher-post",
  "version": 1,
  "name": "Rules",
  "accent": "#6d8cff",
  "sender": "bot",
  "blocks": [
    { "kind": "text", "value": "Hey, welcome!" },
    { "kind": "container", "accent": "#58b9ff" },
    { "kind": "text", "value": "### What is this?" }
  ]
}
```

Yang perlu diketahui:

| Hal | Perilaku |
|---|---|
| **Channel tujuan** | sengaja **tidak** ikut — ID channel berbeda di tiap server |
| **Berkas unggahan** | data base64 tidak ikut (bisa puluhan MB); pakai URL agar portabel |
| **Hasil impor** | selalu jadi **pesan baru**, tidak menimpa pesan lama |
| **Blok tak dikenal** | dibuang, jumlahnya dilaporkan — bukan gagal senyap |
| **JSON rusak** | editor tidak berubah sama sekali, hanya muncul peringatan |

Server tetap menyaring ulang setiap kali pesan disimpan, jadi JSON yang diimpor
tidak bisa menyelipkan blok yang tidak sah.

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

Catatan: ID tombol **dipakai ulang** bila dashboard mengirimkannya kembali (itu
yang dilakukan editor). Aksi komponen menempel pada ID itu, jadi menyimpan ulang
tombol tidak membuang aksinya. Tombol yang benar-benar dihapus tetap berhenti
berlaku — customId lamanya tidak ditemukan di database.

### Aksi komponen: versi ringkas "flow" Discohook

Setiap tombol role, setiap **pilihan** dropdown role, dan setiap blok **Select
menu** punya kartu **Aksi**. Isinya deretan tindakan yang dijalankan bot saat
komponen itu dipakai — padanan sederhana dari *flow* Discohook.

| Aksi | Yang dilakukan |
|---|---|
| **Role — beri / lepas** | ubah role pengklik: pasang/lepas bergantian, hanya beri, atau hanya lepas |
| **Balas pengklik** | kirim teks sendiri, bisa hanya terlihat oleh yang menekan (ephemeral) |
| **Kirim pesan tersimpan** | kirim salah satu pesan di daftar (mis. pesan aturan), lalu opsional satu kalimat susulan |
| **Tunggu** | hentikan sisa aksi sekarang, lanjutkan otomatis setelah durasi tertentu (1 detik – 7 hari) |
| **Periksa syarat** | bandingkan sebuah nilai; kalau tidak cocok, sisa aksi dihentikan |
| **Simpan variabel** | simpan teks (boleh template) ke variabel `{var.nama}` untuk aksi berikutnya |
| **Buat thread** | buat thread publik atau privat dari pesan ini |
| **Hapus pesan ini** | hapus pesan yang memuat komponen itu (butuh *Manage Messages*) |

Yang perlu diketahui:

- **Urutan dijalankan apa adanya.** Tombol naik/turun mengatur urutannya.
- **Kalau aksi role gagal, sisa aksi dihentikan** dan member melihat alasannya
  (izin *Manage Roles* belum ada, posisi role bot di bawah role target, role
  sudah dihapus, dsb). Ini padanan aksi **Stop** di Discohook, dijalankan
  otomatis — lebih jujur daripada mengirim balasan "berhasil" untuk perubahan
  yang tidak terjadi.
- **Satu balasan per interaksi.** Discord hanya menerima satu jawaban, jadi
  balasan pertama yang dipakai; balasan kedua dilewati dan dicatat di log.
  Karena itu aksi **kirim pesan** mengirim ke channel, bukan sebagai balasan.
- **Maksimal 6 aksi per komponen** dan 40 aksi per pesan.
- **Aksi "Tunggu" tahan restart.** Sisa aksinya disimpan ke tabel `post_flow_sessions` dan
  dilanjutkan timer 15 detik. Artinya: waktunya bisa mundur beberapa detik, dan kalau bot
  sedang mati saat waktunya tiba, aksinya berjalan begitu bot hidup lagi (bukan hilang).
- **Aksi "Periksa syarat" hanya punya satu jalur.** Kalau syarat tidak cocok, flow berhenti
  dengan penjelasan. Percabangan dua jalur ("kalau A lakukan X, kalau bukan lakukan Y")
  belum ada — itu butuh langkah bertingkat, dan setengah jadi lebih membingungkan.
- **Tanpa aksi, perilaku lama tetap jalan.** Tombol role yang belum diberi aksi
  masih memberi/melepas role dengan balasan baku, jadi pesan yang sudah
  terkirim tidak mendadak mati.

#### Template di dalam teks

Balasan dan kalimat susulan bisa memakai nilai dari saat tombol ditekan:

| Token | Isi |
|---|---|
| `{member.name}` | nama tampilan pengklik |
| `{member.mention}` | sebutan, mis. `@Wahyu` |
| `{member.id}` | ID pengklik |
| `{server.name}` | nama server |
| `{role}` / `{role.name}` | nama role yang baru saja diubah |
| `{effect}` | `ditambahkan` atau `dilepas` |
| `{selected}` | pilihan yang dipilih di menu (satu pilihan; kosong untuk tombol) |
| `{var.nama}` | variabel yang disimpan aksi **Simpan variabel** |

Nama-nama ini sengaja sama dengan Discohook. Token yang tidak dikenal dibiarkan apa adanya.

Nilai yang sama juga bisa dipakai di **teks pesan** yang dikirim sebagai aksi lanjutan
(nesting) — jadi tombol "Buka aturan" bisa mengirim pesan yang menyapa `{member.name}`.
Pesan biasa yang dikirim admin dari dashboard **tidak** diubah: tanpa konteks member, token
dibiarkan apa adanya.

Token yang tidak dikenal **dibiarkan apa adanya** (bukan dihapus), supaya salah
tulis terlihat — bukan menghilang diam-diam seperti di template yang "pintar".

Contoh balasan paling sering dipakai:

```
✅ Role {role} sudah {effect}, {member.mention}!
```

#### Batas yang perlu diketahui

- Aksi menempel pada **ID komponen** yang baru ada setelah pesan disimpan
  pertama kali. Tombol yang baru ditambahkan menampilkan "Simpan pesan dulu".
- Aksi untuk blok **Select menu** memakai kunci `select:<jenis>` dan berlaku
  untuk semua select berjenis sama **di pesan itu**. Setiap pilihan di dalamnya
  belum bisa diberi aksi berbeda seperti di Discohook (di sana tiap opsi punya
  flow sendiri); untuk aksi per pilihan, pakai **dropdown role**. Aksi per opsi
  pada select string butuh ID opsi tersimpan — itu pekerjaan lanjutan.
- **Aksi per pilihan menu** bisa disusun untuk menu string: setiap pilihan punya kartu
  aksi sendiri (kunci `sel:<nilai>`). Pilihan yang tidak punya aksi sendiri memakai aksi
  `select:<jenis>` milik seluruh menu. Untuk menu user/role/channel tidak tersedia — nilainya
  ID Discord yang berubah-ubah, jadi tidak bisa dijadikan kunci yang stabil.
- **Aksi pada menu multi-pilih** hanya memakai aksi seluruh menu: satu klik bisa membawa
  beberapa nilai, dan menjalankan beberapa aksi sekaligus tidak bisa dijelaskan urutannya.
- Aksi **tidak bisa dipakai di pesan webhook**: Discord mengirim interaksi ke
  aplikasi pemilik komponen, dan pemilik pesan webhook adalah webhook itu
  sendiri. Bot menolaknya lebih awal dengan penjelasan.
- Yang **belum** ada dan alasannya:
  - **Percabangan dua jalur** (Discohook: `Check` dengan jalur "kalau cocok / kalau tidak").
    Saat ini syarat yang tidak cocok menghentikan flow. Percabangan butuh langkah
    bertingkat + batas kedalaman yang bisa dijelaskan.
  - **`Wait` sub-detik** dan penjadwalan presisi: timer berjalan tiap 15 detik.
  - **Kirim pesan webhook dari flow** dan **backup/shortlink** (fitur Deluxe Discohook).
  - **Thread forum** (hanya thread biasa yang didukung).

### Kenapa tombol role di baris paling bawah

Tombol ini yang paling sering diklik member, jadi posisinya tetap dan mudah
ditemukan walaupun admin mengubah isi teks di atasnya. Tombol link dari blok
**Tombol** tetap di tempatnya sesuai urutan blok.

### Jadwal kirim

Tab **Role** punya panel **Jadwal kirim otomatis** untuk pesan yang sedang dibuka.

| Hal | Bagaimana ditangani |
|---|---|
| Sekali / berulang | pilih "Sekali kirim" atau ulang tiap 2 jam – 7 hari; pengulangan lebih rapat dari 2 jam dinaikkan ke batas dan dilaporkan |
| Pesan baru | jadwal **selalu** mengirim pesan baru, bukan memperbarui yang lama |
| Jam | memakai jam komputermu (`datetime-local` dibaca sebagai waktu lokal, bukan UTC) |
| Bot mati saat waktunya tiba | dikirim begitu bot hidup lagi |
| Bot mati berhari-hari | jadwal berulang digeser dari waktu **kirim sekarang**, jadi tidak memuntahkan puluhan pesan susulan |
| Pesan/channel hilang | jadwal dihentikan dan alasannya dicatat di log |
| Batas | 10 jadwal per pesan; jadwal di masa lampau ditolak |

Jadwal ikut terhapus saat pesannya dihapus, jadi tidak ada jadwal yatim yang mencoba
mengirim pesan yang sudah tidak ada.

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
| Select menu (blok **Select menu**) | **tampil**, tetapi pilihannya tidak dijawab bot — Discord mengirim interaksi ke pemilik komponen, yaitu webhook itu sendiri. Dashboard memberi catatan setelah mengirim |

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
- Select menu dari blok **Select menu** memakai customId
  `post-ctx:<postId>:<jenis>`. ID pesan disertakan supaya aksi komponen bisa
  dicari pasti — tanpa itu, dua pesan yang sama-sama punya select berjenis
  `role` tidak bisa dibedakan. Pesan lama yang masih memakai bentuk pendek
  `post-ctx:<jenis>` tetap dikenali. Kalau menunya tidak punya aksi, router
  menjawab ephemeral ("menu ini hanya tampilan"), sehingga memilih tidak pernah
  memunculkan "interaksi gagal". Prefix ini sengaja dipisah dari `post-menu:`
  milik dropdown role.
- Respons `POST /api/posts/:id/send` ikut membawa `dropped` (komponen yang
  dilewati penyusun payload) dan `droppedFiles` (berkas yang gagal diunduh),
  kalau ada. Dashboard memakainya untuk memberi peringatan setelah kirim.

### Endpoint

| Metode | Jalur | Guna |
|---|---|---|
| `POST` | `/api/posts` | buat pesan baru |
| `POST` | `/api/posts/:id` | perbarui pesan |
| `POST` | `/api/posts/:id/send` | kirim, atau perbarui pesan Discord yang sudah ada |
| `DELETE` | `/api/posts/:id` | hapus dari dashboard |
| `DELETE` | `/api/posts/:id?withMessage=1` | hapus dari dashboard **dan** dari Discord |
| `PUT` | `/api/posts/:id/roles` | ganti seluruh tombol, menu ambil role, **dan** aksi komponen pesan (`{ buttons, menus, actions }`) |
| `PUT` | `/api/posts/:id/schedules` | ganti seluruh jadwal kirim pesan (`{ schedules: [{ dueAt, repeatMinutes }] }`) |
| `GET` | `/api/roles` | daftar role server + alasan tidak bisa dibagi |
| `POST` | `/api/posts/import/discohook` | terjemahkan tautan/JSON Discohook jadi blok (`{ url }` atau `{ json }`) |

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

Kunci `actions` memakai bentuk yang sama: tidak dikirim = aksi dibiarkan,
dikirim sebagai objek = mengganti seluruh aksi pesan itu.

```json
{
  "actions": {
    "button:12": [
      { "kind": "role", "roleId": "456...", "op": "toggle" },
      { "kind": "reply", "text": "✅ Role {role} sudah {effect}!", "hidden": true }
    ],
    "option:30": [{ "kind": "role", "roleId": "789...", "op": "give" }],
    "select:role": [{ "kind": "reply", "text": "Menu role dipakai", "hidden": true }],
    "sel:gamer": [{ "kind": "reply", "text": "Kamu memilih gamer" }],
    "button:40": [
      { "kind": "variable", "name": "kode", "value": "{member.id}" },
      { "kind": "condition", "value": "var.kode", "comparator": "notEmpty" },
      { "kind": "wait", "seconds": 300 },
      { "kind": "reply", "text": "Pengingat untuk {member.name}" }
    ]
  }
}
```

Target yang dikenali:

| Kunci | Arti |
|---|---|
| `button:<id>` | satu tombol role |
| `option:<id>` | satu pilihan dropdown role |
| `select:<jenis>` | semua blok Select berjenis itu (cadangan) |
| `sel:<nilai>` | satu pilihan blok Select string, berdasarkan nilainya |

Aksi yang tidak sah dibuang dan alasannya muncul di `dropped`.

### Tabel database

| Tabel | Isi |
|---|---|
| `post_role_buttons` | satu baris per tombol role (`emoji`, `style` ikut disimpan) |
| `post_role_menus` | satu baris per dropdown (`placeholder`, `min_values`, `max_values`, `exclusive`) |
| `post_role_options` | satu baris per pilihan dropdown |

Opsi disimpan di tabel sendiri, bukan sebagai JSON di dalam menu: jumlahnya
sampai 25 per menu dan tiap opsi punya label, emoji, serta keterangan yang
masing-masing bisa diubah.
