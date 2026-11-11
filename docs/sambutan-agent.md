# Sambutan, perpisahan & AI Agent

Tiga fitur "kehadiran" di dua halaman dashboard:

| Halaman | Isi |
|---|---|
| **Sambutan** (`/sambutan`) | Sambutan member baru + salam perpisahan member keluar |
| **AI Agent** (`/agent`) | Bot nimbrung di channel ngobrol + mengomentari foto di channel galeri |

Semuanya **mati secara default** — server lama tidak berubah perilakunya sampai
admin menyalakannya.

---

## 1. Sambutan member baru

Bot mengirim satu pesan setiap ada member baru bergabung.

| Pengaturan | Arti |
|---|---|
| **Sapa setiap member baru** | sakelar utama |
| **Kirim ke** | `DM member` (disarankan) atau satu channel |
| **Tulis sapaan dengan AI** | kalau mati, teks template dipakai apa adanya |
| **Template** | `{user}` → nama panggilan, `{server}` → nama server, `{user.mention}` → tag member, `{user.tag}` → username, `{memberCount}` → jumlah member |
| **Gaya sapaan** | mis. `hangat, santai, sedikit bercanda` |
| **Contoh nada** | satu kalimat contoh; AI meniru nadanya, bukan isinya |
| **Kirim kartu sambutan** | gambar PNG berisi nama + sapaan (lihat di bawah) |
| **Tampilkan avatar** | avatar member di kartu |

### Kenapa terasa seperti manusia, bukan template

Nama temannya adalah hal pertama yang membedakan. Bot memakai **nama panggilan
(nickname)** di server, bukan username, lalu menyebut waktu setempat (pagi/siang/
sore/malam/malam). Prompt-nya melarang pembuka khas bot seperti "Halo! Selamat
datang di…" dan membatasi panjangnya jadi maksimal 2 kalimat pendek.

Kalau AI gagal (kuota habis, jaringan, provider menolak), sambutan **tetap
terkirim** memakai template. Member baru tidak pernah melihat error.

### Kartu sambutan (PNG)

Kartu dibuat dari SVG lalu dirender jadi PNG supaya terlihat rapi di semua klien
Discord. Karena Discord hanya menerima PNG/JPG, konversi ini butuh Chromium:

- Set `CHROMIUM_PATH` ke binary Chromium/Chrome, **atau**
- biarkan bot mencari sendiri di lokasi umum (`/usr/bin/chromium`, dll).

Kalau Chromium tidak ada, kartu dilewati dan sambutan dikirim sebagai embed teks
biasa — tidak ada error, hanya tanpa gambar.

**Banner di dashboard.** Halaman Sambutan tidak lagi menyisipkan banner sebagai data
URI ke HTML (dua banner 8 MB = HTML belasan MB, praktis mati di HP). Gambarnya diambil
dari `GET /api/banner/welcome|goodbye` dan bisa di-cache browser.

**Banner tanpa kartu.** Saat kartu dimatikan tapi banner diunggah, banner dipakai
sebagai gambar embed. Discord **menolak** gambar embed berisi data URI (balasannya
samar: `Received one or more errors`), jadi banner dikirim sebagai **lampiran**
lalu dirujuk lewat `attachment://nama-file`. Tanpa ini, setiap sambutan dengan
banner aktif gagal terkirim tanpa penjelasan. Dashboard menampilkan peringatan
**"Kartu PNG tidak akan terkirim"** di bagian atas form sambutan kalau hal ini
terdeteksi, supaya kamu tidak mengira kartunya rusak. Font General Sans
di-embed sebagai data URI supaya hasilnya sama di server mana pun.

> Catatan biaya: kartu dibuat ~0,7 detik per member. Kalau servermu ramai
> (ratusan member baru per hari), pertimbangkan mematikan kartu.

---

## 1b. Salam perpisahan (goodbye)

Kebalikan sambutan: saat member keluar, bot mengucapkan salam. Satu kesatuan
dengan sambutan, jadi pengaturannya ada di halaman yang sama.

| Pengaturan | Arti |
|---|---|
| **Kirim salam saat ada member keluar** | sakelar utama |
| **Kirim ke** | channel — **wajib dipilih** |
| **Tulis salam dengan AI** | kalau mati, template dipakai |
| **Template** | `{user}` → nama panggilan, `{server}` → nama server, `{user.mention}` → tag member, `{user.tag}` → username, `{memberCount}` → jumlah member |
| **Gaya / contoh nada** | mis. `sopan, hangat, singkat` |

### Mencoba tanpa menunggu member

Menunggu ada orang join/keluar untuk menguji jelas tidak praktis. Halaman
Sambutan punya dua tingkat pengujian:

| Tombol | Mengirim? | Gunanya |
|---|---|---|
| **Tes sambutan / Tes salam perpisahan** | tidak | memeriksa teks + kartu dari isi form saat itu, termasuk sebelum disimpan |
| **Kirim tes sungguhan / Kirim tes ke channel** | ya, 1 pesan | membuktikan izin, channel, DM, dan kartu benar-benar jalan |

Pesan uji diawali penanda *"🧪 Pesan uji dari dashboard"* dan tidak memicu
mention, jadi aman dites di channel yang sudah dipakai member. Sambutan
default ke DM kamu (atau channel kalau dipilih); salam perpisahan selalu ke
channel. Kalau DM gagal karena privasi Discord, alasannya muncul dan kamu bisa
mengulang dengan target channel.

**Kenapa tidak bisa DM?** Member yang keluar sudah tidak berbagi server dengan bot,
jadi DM tidak mungkin dikirim. Kalau channel belum dipilih, salam **tidak dikirim
sama sekali** — lebih baik diam daripada menulis ke channel acak.

Nada AI-nya sengaja berbeda dari sambutan: tidak menanyakan alasan keluar, tidak
menyindir, dan tidak menyebut aturan server. Orang bisa keluar karena masalah
pribadi; bot tidak perlu mengomentari itu.

---

## 2. AI Agent: channel ngobrol + channel galeri

Agent punya **dua channel** dengan peran berbeda — keduanya opsional, dan bisa
hanya salah satu yang dipakai:

| Channel | Perilaku bot |
|---|---|
| **Channel ngobrol** | Nimbrung seperti anggota: balas mention/reply, tanggapi emoji/sticker, menyapa saat sepi |
| **Channel galeri** | **Hanya** menanggapi gambar & video. Teks biasa diabaikan |

Pemisahan ini penting: channel galeri biasanya tempat orang memamerkan foto, dan
kalau bot ikut mengomentari setiap teks di sana hasilnya berisik. Di galeri bot
mengomentari isi gambarnya (suasana, warna, objek) dengan maksimal 2 kalimat.

> Kalau satu channel diisi di kedua kolom, dashboard menolaknya — supaya tidak ada
> pengaturan yang diam-diam tidak pernah jalan.

> ⚠️ **Ini satu-satunya tempat AI membalas di depan publik.** Semua channel lain
> tetap tidak disentuh, dan percakapan pribadi tetap hanya di DM. Dashboard admin
> pun tidak pernah menampilkan isi obrolan channel — perhatikan bahwa isi channel
> sudah publik dengan sendirinya.

### Kapan bot membalas

| Situasi | Perilaku |
|---|---|
| Bot di-@mention atau balasannya di-reply | **selalu** dibalas (tunduk pada jatah per jam) |
| Satu member ngobrol sendiri | dibalas, dengan jeda minimum |
| Beberapa member aktif bersamaan | **diam** — bot tidak menyela |
| Channel sepi melewati batas waktu | menyapa sekali untuk mencairkan suasana |
| Pesan dari bot lain | tidak pernah dibalas |

### Pengaturan

| Pengaturan | Default | Arti |
|---|---|---|
| **Channel ngobrol** | *mati* | mengosongkannya mematikan obrolan |
| **Channel galeri** | *mati* | komentar gambar/video saja |
| **Batas balasan per jam** | gabungan kedua channel | supaya biaya API tidak meledak kalau dua-duanya aktif |
| **Sapa saat sepi setelah** | 45 menit | `0` = jangan pernah menyapa duluan |
| **Jeda minimum antar balasan** | 90 detik | supaya bot tidak mendominasi |
| **Diam saat ramai** | aktif | dianggap ramai bila ≥2 member bicara dalam 60 detik |
| **Tanggapi emoji & sticker** | aktif | |
| **Tanggapi gambar** | aktif | memakai `VISION_MODEL`, dan tetap menghormati toggle Vision |

### Riwayat percakapan: di memori, bukan database

Supaya obrolan terasa nyambung, bot mengingat **8 giliran percakapan terakhir**
(pertanyaan member + balasannya) di channel ngobrol.

Riwayat itu **hanya ada di memori bot** dan hilang saat restart. Alasannya: isi
channel publik memang sudah terbaca siapa saja, tapi menyimpannya permanen berarti
menumpuk data member tanpa manfaat — dan admin dashboard jadi bisa membacanya
kembali. Dengan cara ini tidak ada yang tersimpan.

Konkretnya, di memori hanya ada: waktu balasan terakhir, jejak pesan 10 menit
terakhir (untuk menghitung "sedang ramai"), dan 8 giliran percakapan tadi.

Yang tersimpan permanen di database hanya `agent_reactions`: **ID pesan** +
timestamp, tanpa teks apa pun, supaya bot tidak menanggapi pesan yang sama dua kali.

### Biaya API

Setiap balasan = satu panggilan model (kadang dua, kalau AI memakai tool memori).
Dengan batas 6/jam, maksimal ~144 panggilan per hari per server. Naikkan batasnya
dengan sadar; turunkan kalau kuota terasa cepat habis.

### Banner sendiri (unggahan)

Kedua fitur bisa memakai **gambar banner sendiri** — misalnya foto komunitas,
logo, atau ilustrasi. Unggah dari dashboard, tepat di bawah opsi kartu.

| | |
|---|---|
| Format | PNG, JPG, WebP |
| Ukuran file | maksimal 8 MB |
| Ukuran gambar | minimal 300px lebar; **disarankan 900×320** |
| Tempat penyimpanan | `data/banners/` (tidak ikut Git) |

**Bagaimana banner dipakai**

- **Kartu menyala** → banner menjadi **strip di bagian atas kartu**, dan teks
  (nama, sapaan) di area gelap di bawahnya. Kartu otomatis jadi lebih tinggi.
- **Kartu mati** → banner tetap dipakai sebagai **gambar embed**, jadi unggahan
  tidak sia-sia.
- **Belum ada banner** → kartu memakai latar gradien bawaan seperti sebelumnya.

Banner sengaja **tidak** dipasang sebagai latar penuh di belakang teks: hampir
semua gambar punya teks atau logo sendiri, dan hasilnya pasti bertabrakan dengan
nama member. Strip memberi batas jelas antara gambar dan teks.

**Kalau mengganti banner**, file lama dihapus otomatis setelah file baru
tersimpan — jadi tidak ada sampah menumpuk dan tidak ada kondisi "banner hilang"
kalau unggahan baru gagal. Tombol **Hapus** mengembalikan kartu ke latar bawaan.

**Keamanan unggahan**: format ditentukan dari **isi file** (magic bytes), bukan
dari ekstensi atau MIME yang dikirim browser; nama file dibuat acak oleh server;
gambar yang bukan PNG/JPG/WebP sah ditolak. Semua ini diuji otomatis.


---

## Pratinjau & tombol tes (tanpa menunggu member)

Menyalakan sambutan lalu menunggu ada orang bergabung itu lambat, dan tidak bisa
diulang kalau hasilnya kurang pas. Karena itu kedua halaman punya panel tes.

**Halaman Sambutan → panel "Pratinjau & tes"**

| Tombol | Yang terjadi |
|---|---|
| **Tes sambutan** | Teks sapaan dibuat untuk nama contoh di atas — persis seperti yang akan diterima member |
| **Tes tanpa AI** | Sama, tapi memakai template (untuk melihat teks cadangan) |
| **Tes salam perpisahan** | Sama untuk goodbye |

Hasilnya menampilkan **sumber teksnya**: `ditulis AI`, `dari template`, atau
`gagal` beserta alasannya. Kalau opsi kartu dicentang, kartu PNG ikut dirender
dan ditampilkan — sekaligus membuktikan Chromium di server benar-benar jalan.

Panel ini memakai **isi form saat itu**, bukan pengaturan tersimpan. Jadi kamu
bisa mencoba gaya lain, melihat hasilnya, baru menekan Simpan.

**Halaman AI Agent → panel "Tes percakapan"**

| Tombol | Yang terjadi |
|---|---|
| **Tes balasan** | Balasan untuk pesan contoh, bisa dipilih mode ngobrol atau mode galeri |
| **Tes pemecah sepi** | Kalimat yang akan dipakai saat channel sepi — sekaligus memberi tahu kalau fitur itu tidak akan jalan (channel belum dipilih / ambang 0 menit) |

Di halaman agent, pengaturan yang dipakai adalah yang **sudah tersimpan**, karena
hasilnya bergantung pada channel, jeda, dan batas per jam. Kalau channel yang
diuji belum diatur, hasilnya diberi catatan supaya tidak bingung kenapa di server
sungguhan bot diam.

### Yang penting: tidak ada yang dikirim

Semua tombol tes hanya **mengembalikan teks** ke browser. Tidak ada pesan ke
channel, tidak ada DM, tidak ada mention. Ini dijaga test otomatis
(`pratinjau: tidak ada modul pratinjau yang mengirim ke Discord`) yang membaca
kode `src/features/preview.ts` dan menolak adanya `.send(`.

Supaya hasil tes tidak pernah menyimpang dari perilaku bot, prompt sambutan,
prompt perpisahan, aturan gaya agent, dan prompt pemecah sepi **hanya ada di satu
tempat** (`src/features/preview.ts`) dan dipakai bersama oleh bot maupun
dashboard. Test `pratinjau: prompt hanya punya SATU sumber` menjaga ini.


---

## Menyalakan

1. Buka dashboard → **Sambutan**.
2. Sambutan: centang **Sapa setiap member baru**, pilih DM atau channel, simpan.
3. Perpisahan: centang **Kirim salam saat ada member keluar**, **pilih channel**
   (wajib), simpan.
4. Buka dashboard → **AI Agent**.
5. Isi **Channel ngobrol** (mis. `#ngobrol-ai`) dan/atau **Channel galeri**
   (mis. `#galeri`), lalu simpan. Cukup salah satu kalau hanya itu yang dipakai.

**Butuh intent tambahan di Developer Portal** (Discord → Applications → Bot →
Privileged Gateway Intents):

- **Server Members Intent** — **wajib** untuk sambutan **dan** perpisahan
  (`GuildMemberAdd` / `GuildMemberRemove` tidak dikirim tanpa intent ini).
  Ini satu-satunya intent tambahan yang dibutuhkan fitur di halaman ini.
- **Message Content Intent** — sudah dipakai; wajib untuk agent.

Tanpa Server Members Intent, bot tetap jalan tapi tidak pernah menerima event
member baru, sehingga sambutan tidak terkirim.

### Cara memastikan: baca log, jangan menebak

Sejak versi ini, bot **melaporkan statusnya sendiri** karena kehilangan intent
tidak pernah menghasilkan error — dulu sambutan diam total tanpa satu pun pesan.

Saat start, cari salah satu baris ini:

```
✓ Intent Server Members aktif — sambutan & perpisahan bisa menerima event.
✗ Intent Server Members NONAKTIF — event member join/leave TIDAK akan pernah diterima…
```

Saat ada member bergabung atau keluar, bot selalu mencatat **sebelum** penyaringan:

```
Event member masuk: bagas (bot) di Zypher Server
  ↳ sambutan tidak terkirim: member yang bergabung adalah bot
Event member masuk: rina di Zypher Server
  ↳ sambutan tidak terkirim: bot tidak punya izin "Send Message" di #join-leave
Sambutan untuk rina terkirim via channel (AI).
```

Artinya:

| Yang terlihat di log | Artinya |
|---|---|
| **Tidak ada** baris `Event member masuk` | Event tidak sampai → intent belum aktif / bot belum di-restart setelah toggle |
| `dilewati: member yang bergabung adalah bot` | Normal — bot lain memang tidak disambut |
| `dilewati (bot tidak punya izin …)` | Beri bot izin **View Channel** + **Send Messages** + **Embed Links** di channel tujuan |
| `Kartu sambutan tidak bisa dirender` | Chromium tidak ada di hosting; sambutan tetap terkirim sebagai embed teks |
| `terkirim via dm` padahal channel diatur | Channel tujuan tidak lolos pemeriksaan izin, jadi jatuh ke DM |

### Mode tampilan

Bentuk pesan sambutan & perpisahan bisa dipilih per server di dashboard:

| Mode | Bentuk pesan | Butuh Chromium? | Bisa me-ping? |
|---|---|---|---|
| **Card** | kartu PNG (banner + avatar + nama) sebagai lampiran | ya | tidak |
| **Container** | kartu Components V2 (blok berwarna aksen, gaya panel baru Discord) | tidak | **ya** |
| **Embed** | embed berwarna bertema server | tidak | tidak |
| **Text** | teks polos di `content` | tidak | **ya** |

Kenapa hanya **Text** & **Container** yang bisa me-ping: di Discord, mention di
dalam embed tidak memicu notifikasi. Kalau kamu ingin member baru benar-benar
mendapat notifikasi, pilih Text atau Container.

**Container** (Components V2) butuh discord.js ≥ 14.19 — di proyek ini
14.28.1. Kalau pustakanya lebih lama, bot otomatis mundur ke Embed dan
mencatat alasannya di log. Pesan ber-flag Components V2 tidak boleh memuat
`content`/`embeds`/`files` sama sekali; karena itu mention-nya ikut di dalam
teks komponen.

**Bawaan = Embed.** Server yang sudah berjalan tidak berubah tampilannya
setelah pembaruan ini: baris database lama yang belum punya kolom
`display_mode` diterjemahkan dari pengaturan lama (`imageEnabled` menyala →
Card, mati → Embed).

**Cadangan otomatis** kalau mode yang dipilih tidak bisa dipakai:

| Keadaan | Yang dikirim |
|---|---|
| Card tapi Chromium tidak ada | Embed |
| Card tapi bot tidak punya izin Attach Files | Embed |
| Embed tapi bot tidak punya izin Embed Links | Text |
| Container tapi pustaka tidak mendukung | Embed |
| Text | selalu bisa |

Alasan cadangan selalu ditulis ke log, mis.
`Mode tampilan sambutan "Card" tidak bisa dipakai (kartu tidak bisa dirender) — memakai Embed.`

Salam perpisahan **tidak pernah** me-ping siapa pun, bahkan di mode Text atau
Container: member-nya sudah keluar.

### Banner

Banner yang diunggah di dashboard dipakai di **semua mode kecuali Text**:

| Mode | Cara banner dikirim |
|---|---|
| **Card** | jadi latar kartu PNG |
| **Container** | Media Gallery di dalam komponen |
| **Embed** | gambar embed |
| **Text** | tidak bisa — teks murni |

**Banner tahan deploy.** File tetap disimpan di `data/banners/`, tapi salinannya
juga disimpan di database (`banner_mime` + `banner_bytes`). Kalau hosting
me-reset folder kerja saat `git pull` dan file-nya hilang, bot memulihkannya
otomatis dari database dan mencatatnya di log:

```
Banner "banner-abc.jpg" hilang dari disk — dipulihkan dari database (695313 B).
```

Kalau pemulihan tidak mungkin (salinan belum ada karena unggahan lama), log
memberi tahu dengan jelas alih-alih diam:

```
Banner "banner-abc.jpg" tidak ada di disk dan tidak punya salinan di database — banner dilewati.
```

Unggah ulang sekali lewat dashboard untuk membuat salinannya.

**Folder banner bisa dipindah** lewat `BANNER_DIR` — berguna kalau panel
hosting-mu punya volume persisten terpisah.

### Bot lain juga disapa

Bot yang ditambahkan ke server disambut dan diucapkan selamat jalan seperti
anggota biasa (mengikuti TitanBot). Dulu bot dilewati diam-diam. Kalau kamu
ingin bot diabaikan lagi, tambahkan satu kondisi `if (member.user.bot)` di
`welcomeMember()` dan `goodbyeMember()` — ada petunjuknya di komentar kode.

### Token template

Template teks (dipakai saat AI mati atau gagal) mengenal token berikut:

| Token | Diganti menjadi | Catatan |
|---|---|---|
| `{user}` | nama panggilan member | perilaku lama, **bukan** mention |
| `{user.mention}` | tag member (`@nama`) | hanya berpengaruh di teks biasa — mention di dalam embed tidak menjadi tag |
| `{user.tag}` | username lengkap | mis. `sky#0001` |
| `{server}` | nama server | |
| `{memberCount}` | jumlah member saat ini | ikut berubah tiap ada yang masuk/keluar |

Kalau sebuah token tidak punya nilai (mis. pratinjau lama), token itu diganti
nama biasa — tidak pernah muncul `<@undefined>` di pesan.

### Kalau bot kurang izin

Bot tidak berhenti bekerja hanya karena izin channel kurang; bentuk pesannya
yang menyesuaikan:

| Izin yang kurang | Akibatnya | Yang dikirim |
|---|---|---|
| **View Channel** | channel dilewati | tidak ada, alasannya masuk log |
| **Send Messages** | channel dilewati | tidak ada, alasannya masuk log |
| **Embed Links** | embed tidak bisa dipakai | teks biasa berisi sambutan |
| **Attach Files** | kartu/banner tidak bisa ditempel | embed teks, tanpa gambar |

Cukup beri **View Channel + Send Messages**, sambutan tetap sampai; dua izin
lain hanya memengaruhi tampilan.

### Kenapa dulu bisa hilang tanpa jejak

Tiga penyebab yang sudah diperbaiki:

1. **Channel bermasalah → jatuh ke DM dalam senyap.** `fetchChannel()` dulu
   mengembalikan `null` tanpa alasan, lalu pemanggil langsung beralih ke DM.
   Kalau DM member tertutup, sambutan hilang total dari channel yang sudah diatur.
2. **Kartu gagal dirender → pesan kosong.** Kalau "Kirim kartu sambutan"
   dicentang tapi Chromium tidak ada (umum di hosting panel), bot mengirim
   `embeds: []` + tanpa file. Discord menolak pesan kosong; sekarang otomatis
   mundur ke embed teks.
3. **Tidak ada log sama sekali.** Sekarang setiap event dan setiap alasan
   dilewati tercatat.

---

## Uji tanpa Discord

```bash
npm run smoke     # 267 test, termasuk logika agent, sambutan & perpisahan
```

Test yang relevan: `agent:` (channel, ramai, jatah per jam, cooldown, sepi),
`galeri:` (peran channel, tanpa channel ngobrol), `riwayat:` (batas 8 giliran,
tidak menulis ke database), `sambutan:` dan `goodbye:` (template, prompt, kartu,
privasi).
