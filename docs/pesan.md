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
| **Impor** | tarik dari Discohook, ekspor/impor JSON, payload JSON & generator kode |

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

### Aksi komponen: flow bergaya Discohook Actions

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
| **Tidak melakukan apa pun** | penanda "sengaja dikosongkan" saat menyusun flow bertahap |
| **Hentikan flow** | berhenti sekarang, opsional dengan pesan sendiri |

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
- **Kuota flow mengikuti Discohook** (`refineZodDraftFlowMax`): **40 aksi dihitung**
  per flow — `periksa syarat` dan `hentikan flow` tidak ikut dihitung, karena keduanya
  hanya mengatur alur — dan **15 aksi kirim pesan** per flow (kirim pesan + webhook).
  Isi cabang ikut dihitung. Di atas itu ada **jaring pengaman 120 aksi total** supaya
  satu cabang tidak bisa berisi ratusan aksi yang semuanya tak terhitung.
  Tingkat teratas (satu tombol/opsi/menu) tetap dibatasi **6 aksi**, dan satu pesan
  tetap dibatasi **40 aksi**. Semua kelebihan dilaporkan dengan alasannya, bukan
  dipotong diam-diam, dan kartu aksi menampilkan `12/40 dihitung` sambil menyusun.
- **Aksi "Tunggu" tahan restart.** Sisa aksinya disimpan ke tabel `post_flow_sessions` dan
  dilanjutkan timer 15 detik. Artinya: waktunya bisa mundur beberapa detik, dan kalau bot
  sedang mati saat waktunya tiba, aksinya berjalan begitu bot hidup lagi (bukan hilang).
- **Aksi "Periksa syarat" punya dua bentuk.** Kalau salah satu cabang diisi, flow bercabang
  seperti `Check` di Discohook: cabang "cocok" ATAU "tidak cocok" dijalankan, lalu flow
  **lanjut** ke aksi sesudahnya. Kalau kedua cabang kosong, perilakunya seperti versi lama —
  syarat yang tidak cocok menghentikan flow. Bentuk lama dipertahankan supaya aksi yang sudah
  tersimpan tidak berubah artinya diam-diam. Kedalaman cabang **5 tingkat**
  (`ACTION_LIMITS.branchDepth`), dan cabang boleh berisi aksi apa pun — termasuk `tunggu`,
  `thread`, `webhook`, atau `periksa syarat` lagi (lihat **Batch 12**).
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

Variabel bisa diisi tiga cara, sama seperti Discohook: **teks/template**, **hasil aksi
sebelumnya** (`messageId`, `channelId`, `threadId` — hanya nilai yang benar-benar ada), atau
**salinan variabel lain** (`var.nama`).

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
  - **`Wait` sub-detik** dan penjadwalan presisi: timer berjalan tiap 15 detik
    (Discohook sendiri membatasi `Wait` di 60 detik; di sini sampai 7 hari).
  - **Backup/shortlink Deluxe Discohook** — itu layanan berbayar milik mereka, bukan
    bentuk payload; padanannya di sini riwayat versi 20 terakhir + tautan `/bagi/<token>`.
  - **`SendModal`** — di kode sumber Discohook sendiri aksi ini dikomentari (tidak aktif).
  - **Thread forum** dalam arti "memilih forum dari daftar": tag forum sudah didukung
    dan channel forum dibuatkan postingan baru, tetapi pemilihan channel forum tujuan
    belum ada (thread selalu dibuat di channel pesan pemicu).

### Kenapa tombol role di baris paling bawah

Tombol ini yang paling sering diklik member, jadi posisinya tetap dan mudah
ditemukan walaupun admin mengubah isi teks di atasnya. Tombol link dari blok
**Tombol** tetap di tempatnya sesuai urutan blok.

### Kesetaraan dengan Discohook: apa yang sama, apa yang belum

Diukur langsung dari kode sumber Discohook (`packages/site/app/types/flows.ts` dan
`packages/site/app/types/QueryData-raw.ts`), bukan dari ingatan.

**Aksi flow**

| Discohook | Di sini | Catatan |
|---|---|---|
| Do nothing | ✅ Tanpa aksi | |
| Wait | ✅ Tunggu | Discohook maks 60 detik; di sini sampai 7 hari karena penantian disimpan di database |
| Check (pohon `then`/`else`, `and`/`or`/`not`/`in`/`equals`) | ✅ | cabang `then`/`else` **bertingkat sampai 5 tingkat**, isi cabang boleh aksi apa pun (termasuk `wait` yang tetap dilanjutkan timer sesudah bot restart), pohon `and`/`or`/`not`/`in` (maks 4 tingkat, 40 simpul), plus pembanding datar lama (`contains`, `empty`, …). `not` = NOR, sama dengan Discohook. Bentuk datar tetap didukung supaya aksi lama tidak berubah arti |
| Set variable (static / adaptive / get) | ✅ | ketiga jenisnya ada; nilai `adaptive` terbatas pada `messageId`, `channelId`, `threadId` |
| Stop (+ pesan) | ✅ Hentikan flow | |
| Add / Remove / Toggle role | ✅ | |
| Send message (dari backup) | ✅ Kirim pesan tersimpan | bisa ke channel lain lewat `channelId` per aksi, seperti channel per aksi di Discohook |
| Send webhook message | ✅ Kirim pesan lewat webhook | webhook dibuat/dipakai ulang per channel tujuan (tidak perlu daftar webhook per akun). Komponen role TIDAK ikut — dilaporkan ke pengklik, bukan hilang diam-diam |
| Send raw message | ✅ Kirim teks biasa | teks bebas + templat (`{member.name}`, `{var.*}`), boleh ke channel lain lewat `channelId`. Teks kosong setelah templat diisi dilewati & dilaporkan, bukan dikirim sebagai pesan kosong |
| Create thread (publik/privat, auto-archive, slowmode, tag forum) | ✅ | publik & privat, `autoArchiveMinutes` (1 jam/1 hari/3 hari/1 minggu), slowmode, `invitable`, tag forum (maks 5, channel diperlakukan sebagai forum), pesan pembuka |
| Delete message | ✅ Hapus pesan | dua sasaran: pesan pemilik komponen, atau pesan hasil aksi kirim sebelumnya (padanan penghapusan lewat `messageId` di Discohook). Kalau tidak ada yang bisa dihapus, pengklik diberi tahu dan flow berhenti |

**Pesan & komponen**

| Discohook | Di sini |
|---|---|
| Container / Text Display / Section / Separator / Media Gallery / File / Action Row | ✅ |
| Embed klasik (judul, penulis, footer, field, thumbnail, gambar) | ✅ judul, warna (**per embed**), isi, **thumbnail & sampai 4 gambar besar (per embed)**, **penulis, footer, bidang (maks 25), URL judul, stempel waktu**, dan **sampai 10 embed per pesan** dengan naik/turun/duplikat (lihat **Batch 9**, **13**, **14**, **15**, **21**, **24**) |
| Poll | ❌ di Discohook pun masih dinonaktifkan |
| Tombol link & tombol interaktif ber-flow | ✅ |
| Select menu: string (flow per opsi), user/role/mentionable/channel | ✅ |
| `default_values` pada select user/role/channel | ✅ (isian ID di kartu blok Select; select string ditolak Discord & dilaporkan) |
| `allowed_mentions` (ping role/user tertentu) | ✅ tiga centang di kartu "Tampilan & pengirim"; bawaannya **tanpa ping** |
| `thread_name` (pesan menjadi awal thread) | ✅ isian "Nama thread" di kartu pengaturan, berlaku untuk **Components V2 maupun embed klasik** (sebelumnya jalur embed mengabaikannya tanpa laporan) |
| Message flags: suppress embeds, suppress notifications | ✅ |
| Message flags: voice message, `IS_COMPONENTS_V2` manual | ❌ (v2 diurus pengirim) |
| Multi-pesan dalam satu backup (beberapa pesan, `reference`, `thread_id`) | ✅ tab **Multi-pesan** (`?tab=grup`): sampai 20 pesan per dokumen, `reference` antar pesan, nama thread per pesan, **tiap pesan bisa dibuka lagi di tab Susun, diduplikat, diurutkan, atau dihapus**, disimpan di `post_documents` |
| JSON editor dokumen | ✅ kartu **JSON dokumen** di tab Multi-pesan: ekspor/impor satu dokumen (semua pesan, rujukan balasan, nama thread, mode rangkaian) |
| JSON Data Editor **per pesan** | ✅ kartu **JSON Data Editor (satu pesan)** di tab Impor: tempel objek pesan Discord, payload REST, atau data Discohook |
| `targets[]` (satu pesan, beberapa channel) | ✅ **Kirim juga ke channel lain** di kartu pengaturan: sampai 5 channel tambahan, tiap channel punya ID pesan sendiri |
| Riwayat/undo revisi (padanan backup) | ✅ 20 versi terakhir per pesan, dibuat otomatis setiap pesan diubah; kartu "Riwayat & bagikan" (tab **Riwayat**) |
| Share link (tautan berbagi) | ✅ tautan `/bagi/<token>` bisa dibuka tanpa login, berisi blok **dan** embed pesan (bentuk pesan & seluruh gambar galeri ikut), bisa dicabut |
| Impor backup | ✅ JSON/URL Discohook di tab **Impor**; ekspor JSON juga ada, memakai nama field Discohook (`username`, `avatar_url`, `thread_name`, `flags`, `allowed_mentions`) supaya berkasnya bisa dibaca bolak-balik oleh alat lain |
| **Load** pesan Discord yang sudah terkirim | ✅ kartu **Muat pesan Discord** di tab **Impor**: tempel Message Link, pesan dibuka di editor (bot butuh *Read Message History*); galeri gambar yang di Discord tampil sebagai beberapa embed dibaca kembali sebagai **satu galeri** (lihat **Batch 24**) |
| Jadwal kirim (sekali / berulang / cron) | ✅ sekali, tiap N jam (min. 2 jam), dan **cron kalender** lima ruas (tiap hari, tiap Senin, tiap tanggal 1, …) memakai zona waktu server. Pola lebih rapat dari 2 jam ditolak dengan alasan |
| Trigger event (member masuk/keluar) | ✅ pilihan **Kirim otomatis saat**: `member_add` / `member_remove`; pesan yang sama diperbarui tiap kejadian, bukan dikirim ulang |
| Generator kode (payload → kode bot) | ✅ tab **Impor** → panel "JSON payload & generator kode": keluaran `discord.js` v14 & `discord.py` v2, diterjemahkan dari payload yang benar-benar dikirim |
| Melihat payload JSON mentah | ✅ panel yang sama menampilkan `components` persis seperti yang diterima Discord, siap ditempel ke REST API |
| Nama & avatar pengirim webhook | ✅ isian **Nama & avatar pengirim** di kartu pengaturan (bawaan: identitas server); berlaku di **semua jalur kirim** — manual, jadwal, pemicu member, dan aksi flow |
| Embed klasik (bukan Components V2) | ✅ pilihan **Bentuk pesan: Embed klasik**; judul dari nama pesan, warna dari aksen, teks jadi isi embed, sampai **4 gambar besar** per embed, tombol/menu tetap di luar embed, plus penulis/footer/bidang/URL judul/stempel waktu |
| Variabel teks (`{member.name}`, `{server.name}`, `{var.*}`, …) | ✅ daftar lengkap di kartu pengaturan; berlaku di teks blok, teks aksi, penulis/footer/bidang embed. Token asing dibiarkan apa adanya (lihat **Batch 13**) |
| Diff antar versi | ✅ tombol **Bandingkan** di tab **Riwayat**: tambah/hapus/ubah per blok, pengaturan, plus teks lama & baru berdampingan |

### Batch 26: identitas webhook berlaku di semua jalur kirim

Isian nama & avatar pengirim webhook hanya dipakai tombol **Kirim ke Discord**.
Pesan yang sama, kalau dikirim lewat **jadwal**, **pemicu member masuk/keluar**,
atau **aksi flow**, tampil atas nama server — pengaturan yang terlihat di
dashboard tidak berlaku, dan bedanya baru terlihat saat pesannya muncul.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Kirim manual | identitas per pesan | identitas per pesan |
| Kirim terjadwal | selalu identitas server | identitas per pesan |
| Pemicu member masuk/keluar | selalu identitas server | identitas per pesan |
| Aksi flow "kirim lewat webhook" | selalu identitas server | identitas per pesan |
| Penyaringan | di `server.ts` | satu fungsi `identitasPost`, dipakai semua jalur |

Catatan:

- Logika "isian kosong = identitas server" hidup di **satu** fungsi sekarang.
  Sebelumnya tiap jalur menuliskan sendiri, dan yang lupa menuliskan ulang
  adalah jalur otomatis.
- Yang kosong diisi identitas server **per field**: mengisi nama saja tidak
  menghapus avatar server.

### Batch 24: beberapa gambar besar per embed (galeri)

Discohook punya isian **Image URLs** berisi sampai empat gambar. Bot hanya punya
satu isian gambar besar, jadi tiga dari empat gambar yang ditempel tidak bisa
dikirim sama sekali.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Gambar besar per embed | satu | **sampai 4** (satu URL per baris) |
| Gambar ke-2 dst. | tidak terkirim | dikirim sebagai **embed pelengkap** berisi gambar itu saja |
| Impor Discohook `images` | dibuang | dipertahankan sebagai galeri |
| Impor gambar cadangan (embed `url` + `image` tanpa isi) | jadi embed kosong lalu dibuang | dilebur jadi satu galeri |
| Batas 10 embed | hanya dari daftar embed | berlaku untuk **semua** embed, termasuk hasil galeri |

Catatan:

- Discord hanya menerima satu `image` per embed. Discohook menyiasatinya dengan
  mengirim gambar sisanya sebagai embed tambahan — perilaku itu ditiru, jadi
  deretan gambar di Discord sama bentuknya.
- Embed pelengkap membawa `url` dan warna embed asalnya, tanpa judul/isi: kalau
  isinya disalin, teksnya muncul berulang di setiap gambar.
- Hanya `http/https` yang diterima, URL ganda dibuang, dan pemotongan di atas 4
  dilaporkan dengan alasan.
- Saat impor, hanya embed yang **benar-benar kosong selain gambar** dan berbagi
  `url` yang sama dengan embed sebelumnya yang dilebur. Embed bergambar yang
  punya judul tetap berdiri sendiri — itu embed tersendiri, bukan gambar lanjutan.
- Pratinjau menggambar gambar ke-2 dst. sebagai kartu sendiri, supaya yang
  terlihat sama dengan yang terkirim.
- **Load** membalik arah yang sama: beberapa embed bergambar tanpa isi dibaca
  sebagai satu galeri, jadi pesan yang dimuat lalu disunting lagi tidak memaksa
  admin menempel ulang semua URL.
- Halaman **`/bagi/<token>`** memakai urutan gambar yang sama (galeri menang atas
  gambar blok) dan menampilkan gambar ke-2 dst. sebagai kartu sendiri — pratinjau
  publik tidak boleh menghilangkan gambar yang akan terkirim.

### Batch 23: ekspor JSON membawa pengaturan tingkat pesan

Ekspor JSON dulu hanya membawa blok dan bagian embed. Nama pengirim webhook,
nama thread, flag pesan, dan izin ping **hilang** saat berkas itu diimpor
kembali — cadangan yang tampak lengkap tetapi diam-diam menghapus pengaturan.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Nama & avatar pengirim webhook | tidak diekspor | `username`, `avatar_url` |
| Nama thread | tidak diekspor | `thread_name` |
| Flag pesan | tidak diekspor | `flags` (bitmask Discord) |
| Izin ping | tidak diekspor | `allowed_mentions.parse` |
| Isian yang tidak ada di berkas | dibiarkan dari pesan sebelumnya | **dikosongkan** |

Catatan:

- Nama field mengikuti Discord/Discohook, bukan nama isian di halaman ini,
  supaya berkas ekspor bisa dipahami alat lain (dan sebaliknya).
- Channel, jadwal, dan tombol role tetap **tidak** ikut: semuanya menunjuk ID
  milik server ini dan akan salah di server lain.
- Saat impor, isian yang tidak ada di berkas dikosongkan, bukan dipertahankan:
  menyisakan nama webhook milik pesan sebelumnya membuat pesan hasil impor
  tampil atas nama orang lain tanpa admin menyadarinya. `avatar` juga diterima
  sebagai alias `avatar_url` (nama di Discohook).

### Batch 22: membuka kembali satu pesan di dalam dokumen

Sebelum ini, pesan yang sudah masuk dokumen multi-pesan hanya bisa **dilihat**
(diubah rujukan/thread-nya) atau **dihapus**. Untuk membetulkan satu salah tulis
di pesan ke-3, admin harus menyusun ulang semuanya. Di Discohook, tiap pesan
dalam daftar bisa dibuka kembali.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Menyunting pesan dokumen | hanya bisa menambah dari editor | tombol **✎** membuka ulang pesan itu di tab Susun |
| Menulis balik | — | tombol **Simpan ke dokumen** (bukan otomatis) |
| Duplikat pesan | — | tombol **⧉** menyalin pesan tepat di bawah aslinya |
| Penanda mode | — | bilah "Menyunting pesan N dari dokumen …" di atas editor |

Catatan:

- Perubahan **tidak** ditulis otomatis. Editor yang sama dipakai tombol Kirim, dan
  menulis balik otomatis berarti membuka pesan lain sudah cukup untuk mengubah
  dokumen tanpa pernah menekan Simpan.
- Rujukan balasan **tidak** ikut disalin saat menduplikat: dua pesan ber-ID sama
  akan ditolak server, dan salinan yang membalas pesan aslinya hampir selalu
  bukan yang dimaksud.
- Tiap pesan disalin dalam (salinan mendalam), jadi menyunting dokumen tidak
  mengubah isi editor dan sebaliknya.
- Bila dokumen diganti (dibuka dokumen lain, diimpor, atau dihapus) sementara
  mode sunting masih menyala, mode itu dilepas — kalau tidak, tombol simpan akan
  menulis ke urutan pesan yang sudah bukan miliknya.

### Batch 21: thumbnail & gambar besar per embed

Discohook memberi tiap embed dua isian gambar: **Thumbnail** (kecil, kanan atas)
dan **Image** (besar, bawah). Bot sebelumnya hanya bisa mengambil keduanya dari
blok — jadi embed kedua dan seterusnya tidak pernah punya gambar.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Thumbnail | hanya dari section beraksesori | **isian per embed** |
| Gambar besar | hanya dari blok `image` pertama | **isian per embed** |
| Urutan menang | — | isian admin **menang** atas gambar dari blok |
| Impor Discohook | thumbnail & gambar dibuang | keduanya dipertahankan |

Catatan:

- Hanya `http/https` yang diterima; nilai lain dibuang saat disimpan dengan
  alasan yang bisa dibaca.
- Thumbnail saja **tidak** membuat embed tambahan bisa dikirim (Discord tetap
  menuntut judul/isi/gambar/bidang) — gambarnya hanya pelengkap.
- Pratinjau memakai urutan yang sama dengan server, supaya yang terlihat sama
  dengan yang terkirim.

### Batch 20: muat pesan lalu perbarui pesan asalnya (Load yang utuh)

Batch 16 bisa memuat pesan Discord, tetapi hasilnya menjadi pesan dashboard
**baru**: menekan Kirim mengirim salinan kedua, padahal tujuan tombol Load
adalah memperbaiki pesan yang sudah ada.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Setelah memuat & menyimpan | Kirim = pesan baru | Kirim **memperbarui pesan asal** |
| Channel tujuan | harus dipilih manual | ikut channel pesan asal |
| Tautan ke pesan asal | — | hanya dikirim saat pesan belum punya ID sendiri |

Catatan:

- `source` (channel + pesan asal) divalidasi ketat sebagai snowflake; bentuk
  yang tidak jelas dibaca sebagai `null` = kirim pesan baru. Salah ID berarti
  menimpa pesan orang lain, jadi tidak boleh ditebak.
- Setelah tersimpan, sumber dilepas di editor: pesan sudah punya `message_id`
  sendiri, dan mengirim `source` terus akan membuat tiap penyimpanan menimpa
  pesan Discord yang sama — padahal admin mungkin ingin memisahkannya.

### Batch 19: nama & avatar pengirim webhook per pesan

Di Discohook, pesan webhook punya isian **Username** dan **Avatar URL**: satu
pesan bisa tampil sebagai "Tim Pengumuman" walau webhook-nya milik server.
Sebelumnya bot selalu memakai nama & ikon server.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Nama pengirim | selalu nama server | isian per pesan (bawaan: nama server) |
| Avatar pengirim | selalu ikon server | URL per pesan (bawaan: ikon server) |
| Batas | — | nama 80 karakter, URL hanya `http/https` |
| Pesan lewat bot | tidak terpengaruh | tetap ditentukan Discord (isian tidak dipakai) |

Catatan:

- Kosong = **identitas server**, jadi pesan lama tidak berubah tampilannya.
- Nama & avatar hanya dipakai saat `sender = 'webhook'`. Lewat bot, nama
  pengirim ditentukan Discord dan isian ini tidak berpengaruh.
- URL avatar yang bukan `http/https` dibuang saat disimpan (bukan saat dikirim),
  supaya kesalahannya terlihat lebih awal.
- Field tidak dikirim saat menyimpan = **dipertahankan**; `null` = dikosongkan.

### Batch 18: halaman berbagi menampilkan embed & bentuk pesan

Tautan berbagi (`/bagi/<token>`) dulu hanya menggambar blok. Pesan berbentuk
**embed klasik** karena itu terbuka sebagai halaman **kosong**: isinya memang
tidak ada di blok, melainkan di pengaturan pesan.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Pesan berbentuk embed | halaman kosong | **kartu embed** dengan penulis, judul, isi, bidang, gambar, footer |
| Embed kedua dan seterusnya | tidak tampil | tampil sebagai kartu tambahan (penulis & bidang) |
| Warna embed | tidak terbawa | garis kiri mengikuti warna tiap embed |
| Bentuk pesan | tidak ikut dibagikan | `getSharedPost` mengembalikan `layout` + `embed` |

Yang tetap dijaga: halaman ini **terbuka tanpa login**, jadi semua teks
di-escape sebelum masuk HTML dan hanya URL `http/https` yang pernah dipasang
sebagai gambar. Tidak ada tombol yang bisa mengubah role, dan tidak ada data
server yang ditampilkan.

### Batch 17: JSON Data Editor per pesan

Discohook punya **JSON Data Editor** per pesan: tempel JSON mentah Discord,
lalu pesannya terbuka di editor. Bot sebelumnya hanya punya JSON dokumen
(ekspor/impor seluruh susunan), bukan JSON **satu pesan** yang ditempel dari
luar.

Kartu baru di tab **Impor** → *JSON Data Editor (satu pesan)*, dengan endpoint
`POST /api/posts/from-json { json }`.

Tiga bentuk yang diterima, semuanya diterjemahkan ke blok yang sama:

| Bentuk tempelan | Asal |
|---|---|
| `{ content, embeds, components }` | objek pesan Discord / dokumentasi API |
| `{ body: { … } }` atau `{ data: { … } }` | payload REST yang disalin utuh |
| `{ messages: [{ data: { … } }] }` | data Discohook |

Catatan:

- Endpoint ini **tidak butuh bot online**: tidak ada yang diambil dari Discord,
  jadi tidak ikut gagal hanya karena bot mati.
- Bentuk yang tidak punya `content`/`embeds`/`components` **ditolak** dengan
  pesan, bukan diterjemahkan jadi pesan kosong — pesan kosong akan membuat
  admin mengira JSON-nya berhasil.
- Penerjemahannya memakai `messageToDraft` yang sama dengan fitur **Muat pesan
  Discord**, jadi dua jalur itu tidak bisa berbeda hasil.

### Batch 16: memuat pesan Discord yang sudah terkirim (padanan tombol Load)

Discohook punya tombol **Load**: tempel *Message Link*, tekan Load, pesan yang
sudah ada di Discord terbuka di editor dan bisa dikirim ulang dalam bentuk
diperbaiki. Bot sekarang punya hal yang sama, di tab **Impor** →
**Muat pesan Discord yang sudah terkirim**.

| Aspek | Discohook | Di sini |
|---|---|---|
| Sumber | tautan pesan Discord | tautan yang sama (`Copy Message Link`) |
| Batas | pesan mana pun yang bisa dibaca | **hanya server ini** (bot tidak bisa membaca server lain) |
| Isi teks | `content` | **satu blok teks**, dipecah kalau lebih dari 3500 karakter |
| Embed | satu atau banyak | embed dipertahankan; bentuk pesan dipilih otomatis |
| Komponen V2 | diterjemahkan | **diterjemahkan balik ke blok** lewat penerjemah impor yang sama |
| Lampiran | dibawa kalau bisa | **dilaporkan** — tautan berkas Discord kedaluwarsa |
| Pesan campuran (V2 + embed) | — | embed jadi kartu teks, dengan alasan yang dijelaskan |

Kenapa begini:

1. **Tautan yang dikirim, bukan isinya.** Browser tidak punya token bot dan
   tidak boleh punya; server yang mengambil pesannya lewat bot.
2. **Hanya server sendiri.** Memuat pesan server lain berarti menyalin isi yang
   bukan milik admin ini ke database-nya.
3. **Pesan lama tidak berubah.** Hasil muat menjadi pesan **baru** di dashboard;
   pesan di Discord baru berubah kalau admin menekan Kirim.
4. **Tidak ada yang hilang diam-diam.** Lampiran, berkas, tombol interaktif, dan
   isi embed kedua dan seterusnya dilaporkan sebagai catatan setelah memuat.

Butuh izin **Read Message History** di channel asal; kalau tidak ada, dashboard
menjelaskan sebabnya alih-alih gagal tanpa pesan.

### Batch 15: warna per embed, pindah & duplikat embed

Dua hal kecil dari editor embed Discohook yang menentukan kenyamanan menyusun
pesan berisi banyak embed.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Warna embed | semua ikut aksen pesan | **warna sendiri per embed** (`#rrggbb`), bawaan tetap ikut aksen |
| Urutan embed | hanya bisa menambah & menghapus | **naik / turun** per embed |
| Menyalin embed | harus menyusun ulang | **duplikat** (salinan dalam, bukan berbagi objek) |
| Impor Discohook | warna embed dibuang | warna tiap embed dipertahankan |

Catatan:

- Warna yang bukan `#rrggbb` dibuang dengan alasan yang bisa dibaca; warna
  ditulis huruf kecil supaya dua nilai yang sama selalu dibandingkan sama.
- Warna saja **tidak** membuat embed tambahan bisa dikirim: Discord tetap
  menuntut judul, isi, gambar, atau bidang. Untuk embed pertama, warna tetap
  berguna karena isinya datang dari blok.
- Duplikat menyalin isinya secara dalam: menyunting bidang di salinan tidak
  mengubah embed aslinya.

### Batch 14: sampai 10 embed per pesan & impor embed yang setia

Discohook punya tombol **Add Embed** yang berhenti di 10. Bot sebelumnya hanya
bisa mengirim **satu** embed: embed kedua yang ditulis di sana hilang saat
diimpor.

| Aspek | Sebelum | Sekarang |
|---|---|---|
| Jumlah embed per pesan | 1 | **10** (batas Discord) |
| Embed kedua dan seterusnya | tidak ada | **penulis, footer, bidang, URL judul, stempel waktu** |
| Batas 6000 karakter | per embed | per embed **dan** total semua embed (aturan Discord) |
| Impor Discohook berisi embed | diterjemahkan jadi kartu teks | **embed asli**, bentuk pesan dipilih otomatis |
| Riwayat versi | tidak menyimpan bentuk & embed | ikut tersimpan, jadi pengembalian versi benar-benar memulihkan |
| Panel Bandingkan | tidak melihat embed | melihat bentuk pesan & ringkasan tiap embed |

Cara kerjanya:

1. **Embed pertama** dibangun dari blok seperti biasa (judul dari nama pesan,
   warna dari aksen, teks → isi, satu gambar), lalu dilengkapi bagian admin
   pertama.
2. **Embed kedua dan seterusnya** hanya berisi bagian yang ditulis admin. Blok
   pesan menggambarkan SATU pesan; menyalin isinya ke semua embed akan
   mengulang teks yang sama.
3. Embed tambahan **wajib punya judul, isi, gambar, atau bidang** — Discord
   menolak embed yang hanya berisi penulis/footer. Embed seperti itu dilewati
   dan alasannya muncul setelah Kirim, bukan hilang diam-diam.
4. Editor punya **pemilih embed** (Embed 1, Embed 2, …) dan tombol tambah/hapus.
   Isian yang sedang dibuka adalah embed yang disorot di daftar itu; pratinjau
   menggambar **semua** embed, seperti hasil akhirnya di Discord.

### Batch 13: variabel ala Discohook & bagian embed yang belum ada

Dua selisih ditutup di batch ini: penggantian variabel, dan bagian embed klasik
yang sebelumnya hanya bisa diisi lewat impor.

**Variabel.** Discohook mengganti token `{...}` di **semua** teks (isi blok, teks
aksi, nama penulis, footer, nama & isi bidang). Dulu bot hanya mengenal delapan
token di teks aksi, dan teks blok bahkan tidak diganti sama sekali.

| Token | Isi |
|---|---|
| `{member.name}`, `{member.display_name}` | nama tampilan member |
| `{member.username}`, `{member.tag}` | username; diskriminator `0` → username saja |
| `{member.id}`, `{member.mention}`, `{member.avatar_url}` | ID, sebutan, URL avatar |
| `{member.role_ids}` | daftar ID role sebagai JSON (sama seperti Discohook) |
| `{server.id}`, `{server.name}`, `{server.icon_url}` | identitas server |
| `{server.members}`, `{server.boosts}`, `{server.roles}` | jumlah member, boost, role |
| `{server.created}`, `{server.created_relative}`, `{server.created_long}` | kapan server dibuat |
| `{channel.id}`, `{channel.name}`, `{channel.mention}`, `{channel.link}` | channel tempat komponen diklik |
| `{role}`, `{role.name}`, `{effect}` | hasil aksi role (`ditambahkan`/`dilepas`) |
| `{selected}`, `{selected_value}`, `{selected_values.N}` | pilihan menu; `N` mulai 1, maks 25 |
| `{now}`, `{now_relative}`, `{now_long}`, `{now_short_date}` | waktu sekarang |
| `{var.nama}` | variabel flow yang disetel aksi sebelumnya |

Aturannya:

1. **Token asing dibiarkan.** Salah tulis terlihat di pesan (`{member.nmae}`),
   bukan hilang diam-diam. Di tab editor, sisa token juga bisa dilaporkan.
2. **Nilai kosong dibiarkan kosong.** Di teks aksi, delapan token lama tetap
   diisi string kosong supaya `{role}` pada tombol tanpa aksi role hilang dari
   balasan — bukan tercetak mentah.
3. **Kunci terpanjang menang.** `{member.name_x}` tidak lagi dirusak oleh
   penggantian `{member.name}` lebih dulu; dulu urutan objek menentukan hasil.
4. **Stempel waktu memakai gaya Discord** (`<t:…:d>`, `<t:…:R>`), jadi waktunya
   tampil sesuai zona pembaca, bukan zona server.

**Bagian embed.** Kartu pengaturan sekarang punya satu blok isian untuk URL
judul, penulis (nama/ikon/tautan), footer (teks/ikon), bidang (maks 25, tiap
bidang boleh `inline`), dan stempel waktu ISO 8601. Semuanya opsional; tidak ada
yang dikirim kalau kosong.

- Nilai yang bukan URL `http/https` dibuang dan alasannya muncul di `dropped`.
  Ini termasuk `javascript:` pada ikon — ikon yang sama tampil di pratinjau.
- Stempel waktu yang tidak bisa diurai ditolak, bukan diteruskan ke Discord
  (Discord akan menolak seluruh pesannya).
- Total panjang embed (judul + isi + penulis + footer + bidang) tetap dijaga di
  bawah 6000 karakter; yang dipotong adalah isi, dan pemotongan itu dilaporkan.
- Bagian ini **hanya** dipakai saat bentuk pesan = embed klasik. Mengubah bentuk
  pesan tidak menghapus tulisannya, jadi bisa dicoba bolak-balik.

Kolom baru: `custom_posts.embed` (TEXT, JSON). Disimpan sebagai `NULL` saat
semua isian kosong, jadi pesan lama tidak berubah perilakunya. `embed` yang tidak
dikirim saat menyimpan berarti **dipertahankan**; `null` berarti dikosongkan.

### Batch 12: flow bertingkat penuh (padanan Discohook Actions)

Batch ini menutup tiga selisih yang paling terasa saat memindahkan flow Discohook
ke sini, semuanya diukur dari kode sumber mereka (`packages/site/app/types/flows.ts`).

| Aspek | Discohook | Sebelum batch ini | Sekarang |
|---|---|---|---|
| Kedalaman cabang `Check` | pohon, tanpa batas tingkat tegas | 3 tingkat | **5 tingkat** (`ACTION_LIMITS.branchDepth`) |
| Isi cabang | aksi apa pun, termasuk `Wait` & `Check` lagi | hanya 6 jenis ringkas, tanpa syarat | **editor aksi penuh**, semua 12 jenis, `periksa syarat` boleh bersarang |
| `Wait` di dalam cabang | ditangani runner mereka | sisa cabang disimpan, **sisa aksi sesudah syarat hilang** | sesi menyimpan **sisa cabang + sisa flow** |
| Kuota aksi berhitung | 40 (10 non-premium), `Check`/`Stop` tidak dihitung | hanya 6/komponen + 40/pesan, cabang tidak dihitung | **40 dihitung per flow**, cabang ikut dihitung |
| Kuota aksi kirim pesan | 15 per flow | tidak ada | **15 per flow** |
| Angka batas di layar | dihitung dari skema | ditulis ulang di JavaScript | dikirim server (`aksiLimits`), satu sumber |

**Kenapa `wait` di dalam cabang dulu kehilangan aksi.** Cabang dijalankan lewat
panggilan rekursif, dan saat `wait` ditemui, yang dikembalikan hanya
`steps.slice(i)` — sisa **cabang**. Aksi sesudah aksi syarat berada di daftar
pemanggil, jadi tidak ikut tersimpan; begitu bot restart, sapaan "sesudah syarat"
hilang tanpa jejak.

Sekarang cabang yang dipilih **disisipkan ke satu daftar kerja**
(`kerja.splice(i + 1, 0, ...cabang)`), sehingga:

- `wait` di cabang mana pun menyimpan sisa cabang **dan** sisa flow di luar cabang;
- `stop` di dalam cabang menghentikan **seluruh** flow, bukan hanya cabangnya;
- cabang bertingkat lima tingkat tidak menumpuk tumpukan panggilan rekursif;
- urutan yang dijalankan persis urutan yang dibaca admin di dasbor.

**Kenapa batas 6 tidak berlaku di dalam cabang.** Enam adalah batas untuk **satu
komponen** (satu tombol/opsi/menu) — jumlah aksi yang bisa dijelaskan ke pengklik
dalam satu klik. Cabang bukan komponen: isinya hanya berjalan pada satu jalur, dan
Discohook pun tidak membatasi panjang cabang selain lewat kuota flow. Jadi isi cabang
dibatasi kuota flow (40 dihitung, 120 total), bukan 6.

**Cabang yang habis karena kuota.** Kalau seluruh isi cabang terbuang oleh kuota,
aksi syaratnya **ikut dibuang** dengan alasan yang bisa dibaca admin. Syarat tanpa
cabang berarti "tidak cocok = hentikan flow" — menyimpannya dalam keadaan seperti itu
akan mengubah arti flow diam-diam, dan itu justru yang dihindari di seluruh halaman ini.

Di editor, tiap baris di dalam cabang memakai **editor aksi yang sama** dengan tingkat
atas (`barisAksiDalam`), jadi aksi di cabang bisa diatur selengkap aksi di luar: pilih
role, teks balasan, channel tujuan, arsip thread, jenis variabel — semuanya ada.

### Batch 11: `targets[]` — satu pesan, beberapa channel

Discohook bisa mengirim satu backup ke beberapa channel sekaligus. Di sini
padanannya **Kirim juga ke channel lain** di kartu pengaturan: sampai
`POST_TARGET_LIMITS.perPost` (5) channel tambahan per pesan.

| Aspek | Keputusan |
|---|---|
| Channel utama | tetap di `custom_posts.channel_id` — **bukan** baris di `post_targets` |
| Channel tambahan | tabel `post_targets` (satu baris per channel, dengan `message_id` sendiri) |
| Penggantian daftar | `PUT /api/posts/:id/targets` mengganti seluruh daftar, seperti tombol role |
| ID pesan | **dipertahankan** untuk channel yang masih ada di daftar |
| Kirim | tiap channel dikirim lewat penyusun payload yang sama; gagal di satu channel dilaporkan per channel |
| Hapus pesan | baris `post_targets` ikut dihapus |

Kenapa channel utama tidak ikut di tabel itu: dua sumber untuk hal yang sama
akan menyimpang — admin mengganti channel utama, salinan lamanya tertinggal, dan
pengumuman terkirim ke channel yang sudah tidak dipakai.

Penyaringan di repo (bukan hanya di dashboard, karena API bisa dipanggil
langsung): hanya ID channel Discord 17–20 digit, tanpa duplikat, maksimal lima.
Nilai lain dilaporkan di `dropped` dengan alasannya.

Pesan webhook juga bisa dikirim ke beberapa channel, tetapi **identitas webhook
diambil per channel** — nama & avatar servernya sama, webhook-nya berbeda.

### Batch 10: JSON editor dokumen multi-pesan

Discohook menaruh seluruh backup dalam satu kotak JSON yang bisa disunting
langsung. Di sini bentuk itu ada untuk **dokumen** (multi-pesan), karena di
sanalah ia paling berguna: menyunting rangkaian 12 pesan lewat kartu satu per
satu jauh lebih lambat daripada menyunting satu blok teks.

Bentuk berkasnya:

```json
{
  "format": "zypher-document",
  "version": 1,
  "name": "Pengumuman berurutan",
  "series": true,
  "messages": [
    { "id": "m1", "name": "Pembuka", "blocks": [{ "kind": "text", "value": "Halo" }] },
    { "id": "m2", "name": "Lanjutan", "blocks": [], "reference": "m1", "threadName": "Diskusi" }
  ]
}
```

Yang dijaga saat impor:

| Kasus | Perlakuan |
|---|---|
| `id` dipakai dua kali | pesan kedua dibuang, alasannya ditampilkan |
| `reference` menunjuk pesan yang tidak ada | rujukan dibuang — menyimpannya membuat kiriman gagal di tengah rangkaian |
| pesan membalas dirinya sendiri | rujukan dibuang |
| lebih dari 20 pesan | sisanya dibuang (batas `SERIES_LIMITS.messages`) |
| `format` bukan `zypher-document` | ditolak, dokumen yang sedang terbuka **tidak** dirusak |
| field kosong (`""`, `null`) | dibuang supaya berkasnya ringkas dan tidak mengirim nilai kosong |

Ekspor memakai keadaan **editor**, bukan salinan terakhir dari server: admin
menekan Ekspor justru untuk menyimpan perubahan yang belum disimpan. Blok pesan
dokumen diekspor apa adanya (tanpa dinormalkan ulang), supaya field hasil impor
Discohook yang tidak dikenal editor tidak hilang saat bolak-balik.

### Batch 9: embed klasik (bentuk lama, di samping Components V2)

Components V2 bukan satu-satunya bentuk yang dipakai server. Embed klasik masih
lebih baik untuk pengumuman: ia tampil rapi di notifikasi HP, tidak butuh flag
khusus, dan sudah dikenali semua bot lain. Discohook mendukung keduanya; di sini
pun, lewat **Bentuk pesan** di kartu pengaturan.

| Blok | Jadi apa di embed |
|---|---|
| teks & section | isi `description`, dipisah baris baru |
| pemisah | satu baris kosong |
| gambar (pertama) | `image` — gambar besar di bawah teks |
| gambar kedua dan seterusnya | **tidak muat**; dilaporkan sebagai `dropped` |
| section dengan thumbnail | `thumbnail` (gambar kecil di kanan atas) |
| tombol & menu | komponen **di luar** embed — tetap bisa diklik |
| berkas | lampiran, bukan bagian embed |
| nama pesan | `title` |
| warna aksen | garis warna di kiri embed |
| container/tutup kartu | penanda struktur V2, diabaikan |

Kenapa jalur kirimnya dipisah (`sendOrUpdateEmbedPost`, bukan cabang dari
`sendOrUpdatePost`): **embed dan Components V2 saling menolak di Discord.**
Pesan ber-flag `IsComponentsV2` tidak boleh punya `embeds`, dan pesan embed
tidak boleh membawa flag itu. Satu jalur kode untuk keduanya membuat aturan ini
mudah terlewat, dan galat yang muncul di Discord tidak menyebut penyebabnya.

Bentuknya disimpan per pesan (`custom_posts.layout`), bukan per server: satu
server sering punya pengumuman bergaya embed **dan** panel bergaya container.
NULL dibaca sebagai `container`, jadi pesan lama tidak berubah tampilan setelah
upgrade.

Di dashboard, pratinjau embed memakai `embedDariBlok()` — cerminan
`buildClassicEmbed()` di server — termasuk aturan "satu gambar" di atas. Peringatan
tentang bagian yang tidak muat muncul di tab **Pratinjau**, bukan hanya di log.

### Batch 8: pemicu event member masuk/keluar

Discohook punya "trigger" di samping jadwal: pesan dikirim saat event terjadi,
bukan saat jam tertentu. Di sini pilihannya di kartu pengaturan:

| Pilihan | Artinya |
|---|---|
| *Hanya saat saya klik Kirim* | bawaan; perilaku pesan biasa |
| *Ada member baru bergabung* | dikirim/diperbarui tiap `guildMemberAdd` |
| *Ada member keluar* | dikirim/diperbarui tiap `guildMemberRemove` |

Yang dijaga:

- **Pesan yang sama diperbarui, bukan dikirim ulang.** ID pesan Discord yang
  tersimpan dipakai lagi, jadi channel tidak dipenuhi salinan tiap ada orang
  bergabung. Kalau pesannya sudah dihapus seseorang, kirim baru lalu simpan ID
  yang baru — tanpa itu, tiap kejadian membuat pesan tambahan selamanya.
- **Pemicu tidak jalan sendiri setelah upgrade.** Kolom `trigger` baru berisi
  NULL untuk semua pesan lama, dan NULL berarti manual.
- **Satu pesan gagal tidak menghentikan sisanya.** Tiap pesan punya try/catch
  sendiri; alasannya dicatat di log **dan** dikembalikan sebagai daftar
  `gagal` dari `runTriggers()`.
- **Pesan tanpa channel tujuan dilaporkan**, bukan dilewati diam-diam — itu
  kesalahan penyusunan yang membuat admin bertanya "kenapa tidak pernah muncul".
- **Nilai pemicu asing dibaca sebagai manual** (`parseTrigger`), bukan
  diteruskan: pemicu tak dikenal akan membuat pesan diam selamanya.

Order di event: sambutan AI (`welcome.ts`) lebih dulu, lalu pesan ber-pemicu.
Keduanya di try/catch terpisah, jadi kegagalan satu tidak menahan yang lain.
Sambutan & perpisahan ber-AI **tetap** berjalan sendiri — pemicu di sini tidak
menggantikannya, karena teks pesan /pesan dikirim apa adanya (template
`{member.name}` tidak diisi otomatis, sama seperti pengiriman manual).

### Batch 7: diff versi (apa yang berubah dari satu versi ke versi lain)

Discohook tidak punya ini — backup hanya bisa dibandingkan dengan mata. Karena
di sini riwayat versi tersimpan otomatis tiap kali pesan diubah, pertanyaan yang
sebenarnya muncul adalah **"versi itu bedanya apa dengan yang sekarang?"**, dan
jawabannya tidak seharusnya menuntut admin menatap dua blok JSON.

Di tab **Riwayat**, tiap versi punya tombol **Bandingkan**. Panelnya menampilkan:

| Bagian | Isi |
|---|---|
| Kepala | `5 perubahan (1 tambah, 2 ubah, 2 pengaturan)` |
| Rincian | `+ blok 7: tombol ditambahkan`, `− blok 3: gambar dihapus`, `~ blok 1: teks diubah`, `~ warna aksen: #111111 → #222222` |
| Teks | isi blok teks lama & baru berdampingan, berwarna − / + |

Keputusan yang dipegang:

- **Dibandingkan dengan isi editor, bukan versi tersimpan.** Admin bisa
  membandingkan versi lama dengan perubahan yang **belum ia simpan** — justru
  itu momen ia butuh membandingkan. Kalau pembanding memakai data server, ia
  hanya akan melihat "tidak ada perbedaan" sampai menekan Simpan.
- **Posisi, bukan LCS.** Blok ditata berurutan dan diubah di tempat, jadi
  "blok ke-3 berubah" lebih mudah dipahami daripada "satu elemen disisipkan,
  sisanya bergeser semua". Konsekuensinya jelas dan disebut di sini: menyisipkan
  satu blok di tengah akan tampil sebagai perubahan pada blok itu dan semua blok
  sesudahnya.
- **Blok dibandingkan utuh** (`JSON.stringify`), bukan per field. Field yang lupa
  dibandingkan membuat perubahan tidak terlihat — dan diff yang tidak bisa
  dipercaya lebih buruk daripada tidak ada diff.
- **Pengaturan ikut dihitung:** warna aksen, pengirim, izin ping, nama thread,
  mode rangkaian, flag pesan.

Snapshot satu versi diambil lewat `GET /api/posts/:id/revisions?revision=<id>`,
bukan ikut daftar: 20 versi × blok penuh membuat halaman berat, padahal yang
dibandingkan biasanya satu-dua. Pembandingnya sendiri
(`diffRingkas`/`ringkasDiff`) ada di JS bersama, fungsi murni tanpa DOM — jadi
bisa diuji langsung, bukan hanya lewat klik.

### Batch 6: generator kode (`discord.js` v14 & `discord.py` v2)

Discohook bisa mengubah pesan yang sedang disusun menjadi kode bot, supaya
tampilan yang sudah pas bisa dipakai di kode tanpa menyusun ulang. Di sini sama,
dengan satu perbedaan yang menentukan benar-salahnya hasil:

- **Diterjemahkan dari payload, bukan dari editor.** Alurnya
  `blok → buildPostPayload() → toJSON() → generateCodegen()`. Generator tidak
  pernah membaca state editor, jadi kode yang dihasilkan selalu menggambarkan
  pesan yang benar-benar terkirim — termasuk tombol role yang tersimpan di
  database dan komponen yang dilewati penyusun payload.
- **Yang dilewati dilaporkan, bukan dihilangkan.** Komponen yang belum dikenal
  generator muncul sebagai komentar di dalam kode
  (`# komponen tipe 99 belum didukung generator kode …`) dan id-nya masuk
  `dropped`. Tanpa itu, kode terlihat lengkap padahal satu bagian pesannya
  hilang.

Bentuk keluaran sama seperti Discohook: `imports`, `code`, `documentation`.

```ts
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

const view = new ContainerBuilder()
  .setAccentColor(5793266)
  .addComponents(
    new TextDisplayBuilder().setContent("Halo \"dunia\""),
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true),
  );

await channel.send({
  components: [view],
  // Components V2: pesan komponen wajib membawa flag ini
  flags: MessageFlags.IsComponentsV2,
});
```

Hal-hal kecil yang dijaga generator:

| Masalah | Perlakuan |
|---|---|
| Teks memuat `"`, `\`, baris baru, tab | Di-escape (`\"`, `\\`, `\n`, `\t`) — satu karakter saja lolos membuat kode hasil salin tidak bisa dijalankan |
| Import hanya yang terpakai | Dikumpulkan lewat satu himpunan saat menelusuri komponen; `MessageFlags` selalu ikut karena flag-nya ikut dikirim |
| Array kosong berakhir `,]` | Koma hanya ditempel di baris terakhir tiap blok, dan komentar tidak pernah diberi koma |
| Komentar di dalam kode `discord.js` | Ditulis `// …` dan berdiri di barisnya sendiri — `.addComponents(# …)` bukan JavaScript yang sah |
| `discord.py` memakai `ui.` | `ui.Container([...])`, `ui.TextDisplay(...)`, `discord.ui.Button/Select`, `discord.MediaGalleryItem` |
| Gaya tombol | `ButtonStyle.Primary/Secondary/Success/Danger/Link` (djs), angka `discord.ButtonStyle.*` (dpy) |
| Pesan tanpa komponen | Penjelasan singkat, bukan kode setengah jadi |

Di dashboard panel ini ada di tab **Impor** → **JSON payload & generator kode**.
Tombol **Muat payload** mengambil `/api/posts/:id/json?library=djs14|dpy2`, lalu
menampilkan dua kotak: payload JSON (untuk diperiksa/ditempel ke REST API) dan
kode. Pesannya harus **sudah tersimpan** — payload dihitung dari baris database,
bukan dari isian yang belum disimpan, karena itulah yang dikirim bot.

Endpoint-nya satu dan tidak mengirim apa pun ke Discord:

```http
GET /api/posts/12/json?library=dpy2
→ { "flags": 32768, "components": [ … ], "dropped": [],
    "codegen": { "imports": "…", "code": "…", "documentation": "…" } }
```

### Batch 4d: jadwal cron (per hari, per hari-pekan, per tanggal)

Discohook menjadwalkan backup dengan ekspresi cron lewat `cron-parser`, dengan
batas "paling rapat sekali per 2 jam". Yang ada di sini sama, dengan dua
perbedaan yang disengaja:

- **Parser ditulis sendiri** (`src/features/schedule-cron.ts`, ±250 baris) alih-alih
  menambah dependensi. Yang dibutuhkan hanya "kapan waktu berikutnya", dan bot
  ini hanya mengenal tiga zona Indonesia yang offsetnya tetap. Kesalahan pola
  bisa dijelaskan dalam bahasa manusia — "ruas menit bernilai 60 — harus 0-59",
  bukan sekadar "invalid cron".
- **Zona waktu server, bukan zona akun.** Discohook menyimpan `timezone` per
  backup karena penggunanya bisa di mana saja. Di sini jadwal selalu memakai
  zona server (WIB/WITA/WIT), karena pesan yang dikirim ke channel server
  dibaca orang-orang di server itu. Offsetnya **disimpan bersama jadwal**
  (`cron_offset`), jadi mengubah zona server tidak diam-diam menggeser jadwal
  yang sudah ada.

Format: lima ruas `menit jam tanggal bulan hari`. Didukung: angka, daftar
(`1,3,5`), rentang (`1-5`), langkah (`*/10`, `1-30/5`), `*`, serta singkatan
`mon..sun` dan `jan..dec`. Tidak didukung (dan ditolak dengan alasan): detik,
`?`, `L`, `W`, `#`.

Aturan hari-vs-tanggal mengikuti cron klasik: kalau KEDUA ruas dibatasi, jadwal
cocok bila salah satunya cocok; kalau salah satu `*`, yang dibatasi harus cocok.
Tanpa aturan ini `0 9 * * 1` (tiap Senin) dan `0 9 1 * *` (tiap tanggal 1) tidak
bisa dibedakan.

Yang dilaporkan, bukan didiamkan:

| Kejadian | Yang terjadi |
|---|---|
| Pola salah ketik (`60 9 * * *`) | ditolak, alasan ditampilkan di dashboard |
| Lebih rapat dari 2 jam (`*/30 * * * *`) | ditolak, jarak sebenarnya disebut |
| Tanggal mustahil (`0 0 30 2 *`) | ditolak — jadwal itu tidak akan pernah berbunyi |
| Pola berhenti berbunyi setelah tersimpan (mis. 29 Feb) | baris jadwal dihapus + peringatan di log, bukan diperiksa selamanya |

`dueAt` untuk jadwal cron **dihitung server** dari ekspresinya. Klien yang
mengirim `dueAt` ngawur (tahun 2000, tahun 2099) tidak bisa memaksa jadwal —
nilai itu diabaikan.

Di dashboard: pemilih **Mode: kalender** di kartu jadwal, daftar pola siap pakai
(tiap hari 09:00, tiap Senin, Senin–Jumat, tanggal 1, tanggal 1 & 15, Minggu,
1 Januari), plus isian teks untuk pola lain. Pemeriksaan bentuk juga dilakukan di
browser supaya salah ketik ketahuan sebelum Simpan; keputusan akhir tetap di
server.

### Batch 4c: SendRawMessage & hapus pesan hasil aksi sebelumnya

**Kirim teks biasa (`raw`).** Padanan `SendRawMessage` Discohook. Isinya `content`
bebas (bukan blok container) dan boleh memakai templat yang sudah ada —
`{member.name}`, `{member.mention}`, `{server.name}`, `{selected}`, `{var.*}`.
Template diisi SEBELUM dikirim; kalau hasil akhirnya kosong (mis. variabel yang
dirujuk tidak ada), aksi dilewati dengan laporan alih-alih mengirim pesan kosong
yang pasti ditolak Discord. Channel tujuan opsional: kosong = channel pesan
pemicu, dan ID yang bukan angka dilaporkan sebagai `dropped`.

Kenapa tidak cukup memakai "kirim pesan tersimpan": pesan singkat seperti
"Sedang diproses…" tidak perlu disusun sebagai dokumen container, dan menyusun
dokumen baru hanya untuk satu baris teks membuat daftar pesan penuh oleh pesan
sekali pakai.

**Hapus pesan bertarget.** Aksi hapus kini punya dua sasaran:

| Sasaran | Yang dihapus |
|---|---|
| `pesan` (bawaan) | pesan yang memuat komponen pemicu — perilaku lama, tidak berubah |
| `sebelumnya` | pesan yang DIKIRIM aksi kirim terakhir di flow yang sama |

Discohook menghapus lewat variabel `messageId` yang disusun admin; di sini satu
pilihan itu cukup karena hasil aksi terakhir selalu yang paling masuk akal untuk
dihapus, dan tidak perlu menyuruh admin mengingat nama variabel. Sesudah
dihapus, `messageId` di hasil dikosongkan supaya aksi hapus berikutnya tidak
mencoba menghapus pesan yang sama (Discord menjawab 404) dan melaporkan "tidak
ada yang bisa dihapus".

Kalau tidak ada yang bisa dihapus (belum ada aksi kirim, atau pesan sudah hilang),
flow **berhenti** dengan penjelasan ke pengklik — sama seperti Discohook yang
menggagalkan flow saat `messageId` kosong, bedanya di sini alasannya
diberitahukan lebih dulu.

### Batch 4b: riwayat versi & tautan berbagi

Discohook punya tombol undo di editor dan tautan share untuk membuka backup di
browser lain. Keduanya sudah ada di sini, dengan dua perbedaan yang disengaja.

**Riwayat versi — dibuat otomatis, bukan tombol.** Setiap kali pesan disimpan
atau dikirim ulang, isi SEBELUM perubahan dicatat lebih dulu (tabel
`post_revisions`) — sampai 20 versi per pesan, versi terlama dibuang. Tombol
"simpan versi" tidak ada karena admin tidak akan ingat menekannya, dan riwayat
yang bolong lebih berbahaya daripada tidak punya riwayat: saat sadar salah ubah,
versi yang dibutuhkan justru tidak ada.

Mengembalikan versi lama **tidak menghapus versi terbaru** — isi sekarang ikut
tercatat sebagai versi baru, sehingga "kembalikan" bisa dibalik lagi. Yang
dikembalikan: blok, warna aksen, pengirim, flag, pengaturan multi-pesan, izin
ping, dan nama thread. Yang TIDAK dikembalikan: channel tujuan dan tombol/menu
role (keduanya tabel sendiri dengan alasan yang berbeda — lihat catatan di
bawah).

Kalau pencatatan versi gagal (mis. database penuh), penyimpanan pesannya tetap
jalan dan kegagalannya masuk log sebagai peringatan. Membatalkan penyimpanan
hanya karena riwayat gagal akan membuat admin kehilangan perubahannya.

**Tautan berbagi.** Tombol "Buat tautan" menghasilkan alamat
`/bagi/<token>` yang bisa dibuka **tanpa login**. Isinya sengaja dibatasi:
hanya nama dan blok pesan. Channel, ID pesan, daftar role, dan nama server
tidak ikut — tautan ini bisa diteruskan ke siapa saja. Token acak 22 karakter,
disimpan di tabel `post_shares`, dan bisa dicabut kapan saja (halaman langsung
404). Membuka tautan dua kali menghasilkan token yang sama, supaya admin tidak
menumpuk tautan untuk pesan yang sama.

Halaman `/bagi/…` juga menyusun HTML-nya sendiri, bukan memakai shell dashboard:
isi pesan di-escape, dan hanya URL `http(s)` yang dijadikan tautan — URL
`javascript:` tampil sebagai teks. Tanpa dua hal itu, tautan berbagi menjadi
jalan masuk script ke halaman tanpa login.

Yang belum: membandingkan dua versi berdampingan (diff), dan riwayat untuk
dokumen multi-pesan (baru untuk pesan tunggal).

### Batch 4a: allowed_mentions, thread_name, default_values

**Izin ping (`allowed_mentions`).** Tiga centang: pengguna, role, `@everyone`/
`@here`. Bawaannya **tanpa ping apa pun** (`parse: []`), dan itu keputusan yang
disengaja: pesan buatan admin paling sering berisi `@everyone` yang tidak
dimaksud, dan ping massal tidak bisa ditarik kembali. Kolom database yang
rusak/kosong juga dibaca sebagai "tanpa ping", bukan "semua boleh" — arah salah
yang dipilih sengaja: salah baca ke arah aman hanya membuat ping tidak terjadi.

Memperbarui pesan TANPA mengirim `allowedMentions` mempertahankan izin lama
(bukan meresetnya), dan mengirim `{parse: []}` mematikannya secara sengaja.

**`thread_name`.** Pesan bisa langsung membuka thread. Discord membuat thread
SESUDAH pesan terkirim, jadi nilainya dipakai lapisan pengirim, bukan payload
komponen. Kalau thread gagal dibuat, pesannya TETAP terkirim dan kegagalannya
dilaporkan — membuang pesan hanya karena thread gagal akan menghilangkan isi
yang sudah disusun admin.

**`default_values`.** Daftar ID pilihan bawaan untuk select user/role/
mentionable/channel. Discord menolak `default_values` pada select string, jadi
di sana isiannya tidak ditampilkan (bukan ditampilkan lalu diabaikan). Menu
single-select hanya menyimpan satu nilai bawaan — Discord menolak lebih dari
satu, dan yang dipakai yang pertama dengan alasan yang dilaporkan.

### Batch 3: multi-pesan (padanan `messages[]`)

Discohook menyimpan BEBERAPA pesan dalam satu backup; flow dan aksi bisa
mengirim salah satunya lewat `backupMessageIndex`, dan tiap pesan boleh
`reference` ke pesan lain serta membuka thread sendiri. Sebelumnya di sini satu
dokumen selalu satu pesan, sehingga dokumen hasil impor Discohook yang berisi
lima pesan hanya bisa dilihat di layar: begitu halaman ditutup, empat pesan
lainnya hilang.

Yang sekarang ada (tab **Multi-pesan**):

- **Sampai 20 pesan per dokumen**, disimpan di tabel `post_documents`
  (payload JSON utuh, bukan kolom per field — bentuk blok dipakai bersama
  editor satu-pesan, dan menyalinnya ke kolom akan menjadi dua sumber
  kebenaran).
- **`reference` antar pesan**: pesan bisa membalas pesan lain DI DALAM dokumen
  yang sama. Rujukan ke pesan lain yang tidak ikut dikirim dilepas dengan
  alasan, karena rujukan seperti itu membuat pengiriman gagal di tengah
  rangkaian — pesan pertama terkirim, sisanya tidak.
- **Urutan kirim dijamin**: pesan yang membalas selalu dikirim sesudah pesan
  yang dibalas, walau urutannya terbalik di dokumen. Urutan yang sudah benar
  tidak diubah.
- **Rujukan melingkar** (A balas B, B balas A) dilepas dan dilaporkan: Discord
  menetapkan rujukan saat pesan dibuat, jadi salah satu harus lebih dulu ada.
- **Thread per pesan**: pesan yang menyebut nama thread langsung membuka thread
  sesudah pesan itu terkirim.
- **Kegagalan satu pesan tidak menghentikan sisanya**, tetapi dilaporkan per
  pesan (nama + alasan). Rangkaian yang berhenti di tengah meninggalkan cerita
  menggantung, dan admin tidak punya cara mengirim ulang satu pesan saja.
- **Kirim berurutan** (centang di tab): pesan pertama biasa, sisanya balasan —
  bentuk "postingan berantai" ala Discohook.

Endpoint-nya `/api/post-groups` (bukan `/api/documents`, yang sudah dipakai
dokumen RAG untuk halaman /dokumen — dua rute dengan nama sama berarti yang
kedua tidak akan pernah tercapai, dan halaman Multi-pesan akan menampilkan
daftar kosong tanpa satu pun error).

Yang **masih** belum setara dari model multi-pesan Discohook:

- `thread_id` untuk mengirim pesan KE thread yang sudah ada (di sini thread
  selalu dibuat baru).
- Mengirim satu pesan tertentu dari dokumen lewat aksi flow
  (`backupMessageIndex`): aksi `message` di sini selalu mengirim pesan
  `custom_posts`, bukan pesan ke-N sebuah dokumen.

### Batch 2 (tutup selisih berikutnya)

Yang ditambahkan sesudah tabel di atas disusun:

**Syarat bertingkat.** Bentuknya bukan JSON pohon-fungsi seperti Discohook,
melainkan objek dengan `type`: `leaf` (pembanding datar), `and`, `or`, `not`,
`in`. Alasannya: admin menulis di dashboard, bukan menempel JSON, dan bentuk
datar lebih mudah dibaca di kotak bersarang. Semantiknya sama:

- `and` — semua anak benar, minimal satu anak;
- `or` — sedikitnya satu anak benar;
- `not` — SEMUA anak salah (NOR). `not` berisi satu syarat = "bukan X";
- `in` — nilai ada di daftar (pencocokan persis, bukan "mengandung").

`and`/`or` tanpa anak DIBUANG dengan alasan; `not` tanpa anak dipertahankan
(vakum benar) karena begitulah Discohook, dan berguna untuk cabang "selain itu".

**CreateThread lengkap.** Lama arsip divalidasi terhadap daftar Discord (60,
1440, 4320, 10080) — angka lain dibuang dengan alasan, bukan dibulatkan
diam-diam. Tag forum membuat bot memperlakukan channel sebagai forum. Setelan
yang tidak sah tidak membatalkan aksinya: thread tetap dibuat dengan setelan
bawaan, dan admin diberi tahu.

**SendWebhookMessage.** Aksi `webhook` mengirim pesan tersimpan lewat webhook.
Bedanya dengan Discohook: webhook TIDAK dipilih per aksi dari daftar akun.
Webhook dibuat/dipakai ulang per channel tujuan (token terenkripsi di
`post_webhooks`), jadi tidak ada rahasia baru yang perlu admin salin. Kalau
pesannya punya tombol/menu role, komponennya tidak ikut dan itu dilaporkan.

**Bug yang ketahuan tes baru (dan sudah diperbaiki).** Balasan yang berada di
DALAM cabang bersyarat tidak dihitung sebagai balasan, sehingga member menerima
jawaban cabang lalu "✅ Selesai." sesudahnya. Pemeriksaannya sekarang rekursif.

Yang **sengaja berbeda** dan lebih ketat dari Discohook:

- Aksi role diperiksa lebih dulu (`roleBlocker`) dan kegagalannya menghentikan flow —
  Discohook menitipkan izin ke *responsible user*; di sini yang menentukan adalah izin bot
  plus hierarki role, dan alasannya disebutkan ke member.
- Setiap bagian yang dilewati (komponen, berkas, aksi tidak sah) dilaporkan, bukan hilang diam-diam.
- Aksi pada pesan webhook ditolak di muka, karena Discord mengirim interaksi ke aplikasi
  pemilik komponen — bukan ke bot kita.

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
| `GET` | `/api/posts/:id/revisions` | daftar versi lama (`{ revisions: [{ id, name, snapshot, createdAt }] }`) |
| `POST` | `/api/posts/:id/revisions` | kembalikan satu versi (`{ revisionId }`) |
| `POST` | `/api/posts/:id/share` | buat (atau pakai ulang) tautan berbagi (`{ token }`) |
| `DELETE` | `/api/posts/:id/share` | cabut semua tautan berbagi pesan itu |
| `GET` | `/bagi/:token` | **halaman publik** pratinjau pesan yang dibagikan (tanpa login) |
| `GET` | `/api/roles` | daftar role server + alasan tidak bisa dibagi |
| `POST` | `/api/posts/import/discohook` | terjemahkan tautan/JSON Discohook jadi blok (`{ url }` atau `{ json }`) |
| `POST` | `/api/posts/load` | muat pesan Discord yang sudah terkirim jadi blok (`{ url }` berisi Message Link) |
| `POST` | `/api/posts/from-json` | muat satu pesan dari JSON mentah (`{ json }`) — padanan JSON Data Editor |

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

`custom_posts.trigger` menyimpan pemicu event (`member_add`/`member_remove`,
NULL = hanya manual). Tidak ada tabel baru: pemicu adalah sifat pesannya.

`custom_posts.webhook_name` dan `webhook_avatar` menyimpan identitas pengirim
webhook per pesan (NULL = identitas server). Keduanya hanya dibaca saat pesan
dikirim lewat webhook; lewat bot, nama & avatar ditentukan Discord.

`custom_posts.embed` menyimpan bagian embed klasik (penulis, footer, bidang, URL
judul, stempel waktu) sebagai JSON **berisi daftar** sampai 10 elemen, NULL =
tidak ada. Data lama berisi satu objek dan tetap terbaca (penyaring menerima
keduanya), jadi tidak perlu migrasi isi. Bentuknya sengaja datar —
bukan tabel bidang terpisah — karena bagian ini selalu dibaca & ditulis sebagai
satu kesatuan bersama pesannya.

Tabel jadwal menyimpan tiga kolom tambahan: `cron` (ekspresi lima ruas, NULL =
jadwal lama tiap N menit), `cron_offset` (offset zona saat jadwal dibuat), dan
`due_at` yang untuk jadwal cron selalu dihitung ulang dari ekspresinya.

Tabel riwayat & tautan berbagi:

| Tabel | Isi |
|---|---|
| `post_revisions` | satu baris = satu versi isi pesan SEBELUM diubah (`payload` JSON: blok, aksen, pengirim, flag, series, izin ping, nama thread). Dibatasi 20 baris per pesan (`HISTORY_LIMITS.perPost`), dibuang saat menulis |
| `post_shares` | satu baris = satu tautan berbagi (`token` acak sebagai kunci utama) |

Keduanya ikut terhapus saat pesannya dihapus, dan keduanya memakai kolom
`guild_id` + `post_id` (bukan foreign key) supaya tetap berperilaku sama di
SQLite maupun Postgres.

| Tabel | Isi |
|---|---|
| `post_role_buttons` | satu baris per tombol role (`emoji`, `style` ikut disimpan) |
| `post_role_menus` | satu baris per dropdown (`placeholder`, `min_values`, `max_values`, `exclusive`) |
| `post_role_options` | satu baris per pilihan dropdown |

Opsi disimpan di tabel sendiri, bukan sebagai JSON di dalam menu: jumlahnya
sampai 25 per menu dan tiap opsi punya label, emoji, serta keterangan yang
masing-masing bisa diubah.
