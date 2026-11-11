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

Kartu digambar langsung ke bitmap memakai `@napi-rs/canvas` (Skia) — **tanpa
browser**. Paketnya membawa semua yang dibutuhkan, jadi tidak ada `apt install`
dan tidak ada yang perlu diatur di `.env`.

Dulu kartu dirender dari SVG lewat Chromium. Karena panel hosting seperti
Pterodactyl/Wispbyte tidak memasang Chromium, kartu **tidak pernah** jadi di
server sungguhan dan sambutan selalu jatuh ke embed teks. Sekarang kartu jadi di
hosting mana pun.

Susunan kartu: banner menutupi seluruh kartu sebagai latar, avatar bulat di
tengah, judul besar (`SELAMAT DATANG` / `SAMPAI JUMPA`), nama member, lalu baris
`nama server • member ke-N`. Tanpa banner, latar memakai gradasi tema.

**Dua bagian kartu bisa dimatikan sendiri-sendiri** (halaman Sambutan):

| Sakelar | Mati artinya |
|---|---|
| **Avatar member di tengah kartu** | kartu tanpa lingkaran avatar — hanya banner dan teks |
| **Teks di kartu** | kartu tanpa tulisan apa pun — hanya banner dan avatar |

Teks sapaan **tidak** ikut hilang saat teks kartu dimatikan: sapaan tetap
dikirim sebagai pesan Discord di atas gambar, dan itu juga yang membuat
mention-nya aktif. Yang dimatikan hanya tulisan di dalam gambarnya.

### Dua tab: Sambutan di kiri, Perpisahan di kanan

Halaman Sambutan dulu menampilkan **dua form panjang berdampingan**, lalu satu
blok "Pratinjau & tes" untuk keduanya di bagian paling bawah. Akibatnya, untuk
mengubah satu sakelar lalu melihat hasilnya, admin harus menggulir jauh dan
kehilangan konteks form yang sedang diubah.

Sekarang:

- **Tab** memisahkan Sambutan dan Perpisahan — hanya satu jenis pesan yang
  tampil sekaligus, dan pratinjau/tes ikut di dalam tab masing-masing.
- Di layar lebar, **pratinjau menempel di kanan** (`position: sticky`), jadi
  hasil tes terlihat tanpa menggulir sama sekali. Di layar sempit, pratinjau
  kembali mengalir normal di bawah form.
- Tab yang tidak aktif hanya **disembunyikan** (`hidden`), tidak dilepas dari
  DOM. Isian yang belum disimpan tidak hilang, dan tombol Simpan tetap mengirim
  nilai yang benar untuk tab mana pun.
- Tab terakhir yang dibuka diingat browser (`localStorage`), jadi admin yang
  sedang mengurus perpisahan tidak selalu mendarat di Sambutan.

Catatan teknis yang dijaga test: setiap tab punya kolom **Nama contoh** dan
status pratinjau sendiri (`welcomePreviewName`, `goodbyePreviewName`). Memakai
id yang sama untuk dua tab membuat `getElementById()` selalu mengembalikan
elemen pertama — status "Selesai" untuk perpisahan akan tertulis di panel
sambutan.

**Penanda "aktif" di tab.** Dulu berupa titik kecil berwarna hijau, dan dua hal
membuatnya disalahpahami:

1. Maksudnya tidak terbaca — di layar sempit titik itu tampak seperti bullet
   nyasar di samping teks tab, dan orang mengira penanda tab yang sedang dibuka.
2. Titik itu diikat ke "tab mana yang terbuka", sehingga selalu muncul di tab
   kiri dan hilang saat pindah tab. Tidak memberi informasi apa pun.

Sekarang bentuknya **teks "AKTIF"** dan isinya status sakelar yang sebenarnya —
tetap terlihat saat tab itu tidak dibuka, karena gunanya justru memberi tahu
tanpa harus membuka tab. Badge status di judul tab juga dipindah menempel pada
kartu **PENGATURAN**, bukan menggantung di baris judul tab (di HP badge itu
turun ke baris sendiri dan jauh dari teks yang diterangkannya).

Kalau avatar diminta tapi gagal diunduh, kartu memakai lingkaran gradasi dengan
huruf awal nama — bukan lingkaran kosong.

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
Sambutan punya dua tingkat pengujian — dan berlaku **sama untuk sambutan maupun
perpisahan**:

| Tombol | Mengirim? | Gunanya |
|---|---|---|
| **Tes sambutan / Tes salam perpisahan** | tidak | memeriksa teks + kartu dari isi form saat itu, termasuk sebelum disimpan |
| **Kirim tes sungguhan / Kirim tes ke channel** | ya, 1 pesan | membuktikan izin, channel, DM, dan kartu benar-benar jalan |

Kartu perpisahan memakai renderer yang sama dengan sambutan, hanya judulnya
`SAMPAI JUMPA` dan baris bawahnya `Terima kasih dari <server>` — bukan
`member ke-N`, karena member yang keluar tidak lagi dihitung.

Pesan uji diawali penanda *"🧪 Pesan uji dari dashboard"* dan tidak memicu
mention, jadi aman dites di channel yang sudah dipakai member.

**Banner ikut terkirim di pesan uji.** Mode **Card** mengirim PNG kartu (banner
sudah menjadi latarnya) dan dibungkus embed supaya tampil besar — sama seperti
sambutan sungguhan. Kalau PNG benar-benar gagal dibuat, pesan jatuh ke **embed**
dan banner tetap dikirim sebagai lampiran `attachment://`, bukan dibuang.
Sebelumnya keputusan banner memakai mode yang **diinginkan** (`card`), bukan yang
**benar-benar dipakai**, sehingga sambutan uji terkirim tanpa gambar tanpa satu
pun error di log. Test
`banner: tetap terkirim saat mode card jatuh ke embed` mengunci perilaku ini.

> Kalau banner tetap tidak terlihat, periksa **izin `Attach Files`** bot di
> channel itu: tanpa izin tersebut banner tidak bisa dilampirkan, dan bot
> mengirim teks saja alih-alih gagal. Sambutan
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

## 1c. Panel "Pemakaian server" di Ringkasan

Kartu ini memperlihatkan CPU, memori, jaringan, dan disk **milik proses bot
ini**, bukan seluruh mesin — di hosting itulah yang relevan, karena admin
peduli seberapa dekat ke jatah 512 MB / 1 GB, bukan berapa RAM host.

### Angkanya sekarang hidup

Dulu halaman Ringkasan memotret sekali saat dimuat: angka CPU dan jaringan
tinggal diam sampai halaman di-refresh, sementara panel hosting terus bergerak.
Sekarang dashboard **polling `GET /api/resources` tiap 3 detik** dan
memperbarui panel tanpa memuat ulang halaman.

Kenapa polling, bukan SSE/WebSocket: dashboard ini dilayani lewat proxy panel
hosting (Pterodactyl/Wispbyte), dan proxy seperti itu sering **menahan respons
`text/event-stream`** sehingga angkanya justru membeku — persis masalah yang
ingin dihilangkan. `fetch` biasa paling tahan terhadap proxy.

Aturan yang dijaga:

- Polling **berhenti saat tab disembunyikan** (`document.hidden`) dan lanjut
  begitu tab terlihat lagi — tidak ada gunanya membebani server untuk halaman
  yang tidak dilihat.
- Respons memakai `cache-control: no-store`; tanpa itu proxy panel bisa
  menyimpan respons GET dan angkanya membeku lagi.
- Gagal jaringan sesaat **tidak menghapus angka terakhir**. Setelah 3 kegagalan
  berturut-turut penanda "langsung" berubah jadi "terputus", angka tetap ada.
- Angka awal sudah dirender server (`#resSeed`), jadi panel tidak berkedip
  kosong saat halaman dibuka.

### Disk: diukur tiap 5 menit, bukan tiap 3 detik (dan kenapa)

Ini bukan kelalaian, ini perbaikan setelah **server pemilik proyek dimatikan
panel Wispbyte** dengan pesan *"stopped due to high CPU usage. Average CPU:
22.03%"*.

Versi pertama panel ini memindai **seluruh folder server setiap 3 detik** untuk
menghitung pemakaian disk. Di proyek ini isinya ~7.300 berkas (7.001 di
antaranya `node_modules`). Hasil pengukuran di mesin nyata:

| | Sebelum | Sesudah |
|---|---|---|
| CPU per panggilan | **345 ms** | **5,7 ms** |
| Beban rata-rata (polling 3 dtk) | **11,5%** dari 1 inti | **0,56%** |
| Pemindaian folder | tiap 3 detik | tiap 5 menit |

Ukuran folder tidak berubah dalam hitungan detik. Pertanyaan yang sebenarnya
ingin dijawab admin adalah "apakah disk saya hampir penuh" — dan itu pertanyaan
jam-jaman. Jadi angka disk **dipakai ulang sampai 5 menit** (`FOLDER_TTL_MS`),
sementara CPU, memori, dan jaringan tetap segar tiap 3 detik.

Kompromi yang diambil:

- Panel menuliskan **kapan** disk terakhir diukur (`diukur 4 menit lalu`),
  bukan berpura-pura angkanya dari detik ini.
- Ada tombol **"ukur ulang disk"** di kaki panel untuk memaksa hitung sekarang
  — kalau tidak ada, admin yang baru menghapus sesuatu akan mengira tombol
  hapusnya gagal.
- Menyimpan kuota di Pengaturan juga membuang cache, karena admin baru
  mengubah angka dan ingin melihat hasilnya.
- `node_modules` **tetap dihitung**. Melewatinya akan membuat angka disk
  berbohong (pemakaian bisa tampak 14 MB padahal 174 MB) — yang salah cuma
  frekuensinya, bukan cakupannya.

Test mengunci ini dari dua arah: `shouldRescanFolder()` diuji sebagai fungsi
murni, dan satu test memastikan `readResourceUsage()` **tidak** memanggil
`folderBytes()` langsung — kalau seseorang mengembalikannya, beban 11% kembali
tanpa gejala lain.

### Ringkasan tidak menunggu pemindaian folder

Keluhan lanjutan: *"aku buka dashboard sekarang jadi lemot saat memasuki
Ringkasan. Untuk perpindahan halaman selain Ringkasan aman."*

Itu benar, dan penyebabnya berbeda dari beban CPU. Halaman Ringkasan merender
panel sumber daya saat **HTML-nya dibuat**, jadi ia menunggu pemindaian folder
selesai — ~580 ms sebelum optimasi. Halaman lain tidak menyentuh disk sama
sekali, karena itu terasa cepat.

Dua perbaikan:

1. **Pemindaian folder jadi paralel per folder.** Dulu ukuran tiap berkas
   diambil berurutan (`await` satu per satu) — 7.331 berkas = 7.331 giliran.
   Sekarang semua `stat()` dalam satu folder dijalankan bersamaan:
   **580 ms → 238 ms**, hasil angkanya identik.
2. **Render halaman tidak menunggu sama sekali** (`backgroundFolder: true`).
   Kalau cache kosong, pemindaian dimulai di latar belakang dan halaman
   langsung dikirim: **580 ms → 9 ms** untuk bagian itu, dan Ringkasan terukur
   **52 ms** saat pertama dibuka (halaman lain 12–19 ms).

Saat angka disk belum siap, panel menulis *"menghitung ukuran folder… angka
muncul beberapa detik lagi"* — bukan `— terpakai` yang terbaca seperti
kerusakan. Panel tetap terisi lewat polling 3 detik berikutnya, dan tidak ada
pemindaian ganda: penanda `folderScan` memastikan hanya satu yang berjalan
walau halaman di-refresh berkali-kali.

### CPU: dari `cpu.stat`, tanpa jeda

CPU dihitung dari delta `usage_usec` di `cpu.stat` cgroup terhadap sampel
sebelumnya. Cara lama menunggu 120 ms (`setTimeout`) untuk menebak persentase —
itu membuat halaman Ringkasan lebih lambat tanpa manfaat. Sampel pertama belum
punya pembanding, jadi ditulis "—" (lebih baik daripada angka karangan).

Sampel lama **dibuang saat bot restart**: `cpu.stat` milik cgroup tidak kembali
ke nol saat proses lahir, sehingga delta terhadap sampel proses sebelumnya bisa
meledak. Penandanya `starttime` dari `/proc/<pid>/stat`.

### Memori: RSS proses, bukan `anon` cgroup

Ini kesalahan nyata yang dilaporkan: dashboard menulis **86,4 MB** sementara
panel hosting menulis **69 MB** untuk proses yang sama.

Penyebabnya dua lapis:

1. `memory.current` ikut menghitung page cache (`file`), bukan hanya memori
   proses.
2. Lebih parah: cgroup container di hosting **dipakai bersama beberapa proses**,
   jadi `anon`-nya menjumlahkan semuanya. Di sandbox nilainya terpantau berubah
   430 KB → 75 MB dalam hitungan detik karena proses lain ikut dihitung.

Yang dipakai sekarang adalah **RSS proses itu sendiri** (`/proc/<pid>/statm`).
Itu definisi yang paling dekat dengan angka panel hosting. Kalau `/proc` tidak
terbaca, urutannya: `anon` cgroup → `process.memoryUsage().rss`. Prioritasnya
ada di fungsi murni `pickMemoryUsed()` supaya bisa diuji dengan angka yang
sengaja jauh berbeda.

### Disk: kuota container harus dinyatakan

Dulu penyebut bar Disk adalah `statfs()` partisi folder kerja — di hosting itu
**partisi mesin induk**, dan hasilnya "353 GB dari 441 GB (80%)" padahal panel
hosting menulis 247 MB dari 1 GB. Angka itu tidak ada hubungannya dengan bot.

Sekarang:

- **Pemakaian** = jumlah byte isi folder server (termasuk `node_modules` dan
  database), bukan partisi.
- **Kuota** = angka yang dinyatakan, dari salah satu sumber:

| Sumber | Cara | Menang atas |
|---|---|---|
| `.env` → `DISK_LIMIT_MB=1024` | sekali, berlaku untuk semua | isian di Pengaturan |
| Halaman **Pengaturan** → "Kuota disk container" | per server, bisa diubah kapan saja | — |
| Tidak diisi | bar disk kosong, hanya "166 MB terpakai" | — |

Kuota **tidak bisa ditebak**: cgroup Linux tidak menyediakan kuota kapasitas
disk (`io.max` hanya membatasi kecepatan baca/tulis), dan panel hosting tidak
mengekspornya ke dalam container. Karena itu angkanya harus dinyatakan; lebih
jujur menampilkan "kuota belum diatur" daripada memakai kapasitas mesin induk.

### Jaringan & I/O disk: kecepatan, bukan total

Kolom Jaringan dulu menampilkan total kumulatif ("↓ 228 KB · ↑ 277 KB sejak bot
hidup"), yang tidak bisa dibandingkan dengan panel hosting yang menampilkan
`0 B/s`. Sekarang yang ditampilkan **byte/detik** dari selisih antar-poll, dengan
total kumulatif tetap dicantumkan kecil di bawahnya.

`0 B/s` sah dan ditampilkan apa adanya — itu hasil pengukuran "tidak ada lalu
lintas", bukan "tidak tersedia". Kecepatan baca/tulis disk diambil dari cgroup
`io.stat`.

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
| **Tes salam perpisahan** | Sama untuk goodbye — termasuk kartu PNG-nya |

Hasilnya menampilkan **sumber teksnya**: `ditulis AI`, `dari template`, atau
`gagal` beserta alasannya. Kalau opsi kartu dicentang, kartu PNG ikut dirender
dan ditampilkan — sekaligus membuktikan mesin gambar di server benar-benar jalan.

### Pratinjau menggambar bentuk pesannya, bukan hanya teksnya

Kotak pratinjau menampilkan **mock pesan Discord**: garis aksen berwarna, baris
penulis (avatar + nama), thumbnail di kanan atas, banner, dan footer — sesuai
mode yang dipilih (Embed, Container, Card, atau Text). Mention ditampilkan
sebagai pil biru **di luar** embed, karena begitulah Discord menampilkannya.

Yang penting: mock itu dibangun dari **payload yang sama dengan produksi**.
`previewWelcome()`/`previewGoodbye()` memanggil `composePayload()` — fungsi yang
juga dipakai sambutan sungguhan — lalu `src/features/embed-mock.ts` membaca
hasilnya menjadi data mentah untuk digambar browser. Tidak ada aturan Discord
yang ditulis ulang di sisi pratinjau, jadi pratinjau tidak mungkin menjanjikan
tampilan yang tidak dikirim bot.

| Bagian mock | Sumbernya |
|---|---|
| Warna aksen | `setColor()` embed / `setAccentColor()` container |
| Baris penulis (avatar + nama) | `setAuthor()` — sakelar **Avatar + nama di atas teks** |
| Thumbnail kanan atas | `setThumbnail()` — sakelar **Avatar sebagai thumbnail** |
| Banner | `setImage()` / Media Gallery, dirujuk `attachment://` → diganti data URI |
| Teks kecil (`-#`) | footer container, digambar lebih kecil |

Banner yang dirujuk sebagai `attachment://nama.png` tampil sebagai label nama
file di pratinjau, bukan ikon gambar rusak — di browser file itu memang tidak
ada. Kalau bannernya ada di disk, server mengubahnya jadi data URI sehingga
gambarnya benar-benar terlihat.

**Kenapa pratinjau memakai penanda, bukan data URI langsung.** Discord
**menolak** data URI di Media Gallery maupun Thumbnail ("Received one or more
errors"), sama seperti `setImage()` embed. Karena itu komponen dibangun dengan
penanda `attachment://preview-banner` / `attachment://preview-avatar`, lalu
`preview.ts` menukarnya dengan gambar sungguhan **sebelum** dikirim ke browser.
Nama file asli di jalur produksi tetap dipertahankan — Discord mencocokkan
rujukan dengan lampiran yang ikut terkirim, jadi nama generik akan gagal.

Blok pratinjau disimpan **berurutan** (`ContainerMock.blocks`), bukan dipisah
antara "semua teks" dan "semua gambar". Sebelumnya pratinjau menggambar semua
teks lebih dulu baru semua gambar, sehingga urutannya berbeda dari yang dikirim
bot. Section juga satu blok (`{ kind: 'section', text, thumbnailUrl }`) supaya
avatar tidak pernah jatuh ke baris sendiri di bawah teks.

### Dua sakelar avatar yang berdiri sendiri

Di **Tampilan embed** ada dua centang, dan keduanya boleh menyala bersamaan:

| Sakelar | Hasil di Discord |
|---|---|
| **Avatar + nama member di atas teks** | `setAuthor()`: avatar bulat + nama tebal di baris pertama |
| **Avatar member sebagai thumbnail di kanan atas** | `setThumbnail()`: kotak kecil di sudut kanan |

Di mode **Container**, keduanya diperlakukan sama: avatar dikirim sebagai
lampiran lalu ditampilkan lewat **Section + Thumbnail** (tipe 9 & 11) — avatar
kecil **di kanan teks**, bukan kotak selebar kartu di tengah. Sakelar
"di atas teks" saja sudah cukup untuk menyalakannya.

Urutan blok container: **banner → teks (+ avatar kanan) → pemisah → baris kaki.**
Banner ada di paling atas karena ia yang memperkenalkan pesan. Sebelumnya banner
berada di bawah teks dan di bawah avatar, sehingga avatar tampil sebagai kotak
lebar berisi gambar kecil di tengah — terlihat seperti ruang kosong besar.

Catatan teknis: baris penulis **tidak** bergantung pada avatar. Kalau URL avatar
kosong (akun tanpa avatar, CDN gagal), nama tetap ditampilkan — dulu seluruh
baris hilang dan hasilnya dilaporkan sebagai "avatar tidak muncul" padahal
sakelarnya sudah benar.

Panel ini memakai **isi form saat itu**, bukan pengaturan tersimpan. Jadi kamu
bisa mencoba gaya lain, melihat hasilnya, baru menekan Simpan.

**Halaman AI Agent → panel "Tes percakapan"**

| Tombol | Yang terjadi |
|---|---|
| **Tes balasan** | Balasan untuk pesan contoh, bisa dipilih mode ngobrol atau mode galeri |
| **Tes pemecah sepi** | Kalimat yang akan dipakai saat channel sepi — sekaligus memberi tahu kalau fitur itu tidak akan jalan (channel belum dipilih / ambang 0 menit / masih jam tenang) |
| **Kirim tes ke channel** | Benar-benar mengirim **satu** pesan berisi kutipan pesan uji + balasan bot |
| **Kirim pemecah sepi ke channel** | Benar-benar mengirim kalimat pemecah sepi ke channel ngobrol |
| **Paksa tulis** (centang) | Menulis kalimat pemecah sepi walau timer belum waktunya |

Di halaman agent, pengaturan yang dipakai adalah yang **sudah tersimpan**, karena
hasilnya bergantung pada channel, jeda, dan batas per jam. Kalau channel yang
diuji belum diatur, hasilnya diberi catatan supaya tidak bingung kenapa di server
sungguhan bot diam.

### Pratinjau vs kirim nyata

Tombol **Tes ...** hanya **mengembalikan teks** ke browser: tidak ada pesan ke
channel, tidak ada DM, tidak ada mention. Ini dijaga test otomatis
(`pratinjau: tidak ada modul pratinjau yang mengirim ke Discord`) yang membaca
kode `src/features/preview.ts` dan menolak adanya `.send(`.

Tombol **Kirim ... ke channel** melakukan kebalikannya: memakai `channel.send()`
lewat `src/features/test-send.ts`, dengan penanda "pesan uji" dan
`allowedMentions: { parse: [] }` supaya tidak ada yang ter-tag. Butuh bot online
di proses yang sama — kalau dashboard berdiri sendiri, tombolnya dinonaktifkan.

**Pesan uji memakai `composePayload()` yang sama dengan produksi.** Dulu
`test-send.ts` menyusun `EmbedBuilder`-nya sendiri dan akibatnya kehilangan
fitur diam-diam: avatar thumbnail, baris penulis, warna, footer, dan gambar
banner tidak pernah ikut terkirim. Yang paling menipu, pesan uji tetap terlihat
normal — jadi admin mengira embed sungguhan memang begitu. Sekarang satu-satunya
perbedaan pesan uji dari pesan asli adalah penandanya. Test
`kirim tes: memakai composePayload, bukan embed buatan sendiri` menjaga ini.

### Pemecah sepi: pratinjau = timer sungguhan

`previewQuietBreak()` memakai `shouldBreakSilence()` dan `QUIET_SYSTEM_PROMPT`
yang **sama** dengan timer di `handleQuietChannel()`. Kalau belum waktunya,
dashboard menuliskan sisa waktunya (mis. "baru sunyi 5 menit, ambang 45 menit —
sekitar 40 menit lagi") alih-alih menghasilkan sapaan palsu.

Bot juga menyimpan kalimat sapaan terakhirnya di memori channel dan mengirimnya
ke prompt sebagai larangan mengulang (`buildAntiRepeatBlock`), ditambah **sudut
obrolan acak** (`QUIET_ANGLES`) supaya sapaan tidak selalu berbentuk
"Sepi banget ya…". Keduanya juga berlaku di pratinjau.

Prompt sapaan menyebut **jam setempat** ("Sekarang pukul 14:05 WITA") supaya
model tidak salah menebak pagi/siang/malam saat server berada di WITA atau WIT.

### Jam tenang malam

Sapaan otomatis ditahan antara **23:00–06:00 zona server** (`isQuietHour()`,
`quiet_hours` di tabel `agent`). Balasan ke mention/reply tetap jalan.

Zonanya mengikuti **Pengaturan → Zona waktu server** (WIB/WITA/WIT), bukan
dipaku ke Jakarta dan bukan zona mesin — hosting umumnya UTC. Server di
Makassar (WITA) jadi berhenti menyapa satu jam lebih awal daripada WIB, sesuai
jam dinding warganya. Lihat [dashboard.md](dashboard.md#zona-waktu-server-wib--wita--wit).

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
| `Gagal merender kartu sambutan` | Modul gambar gagal dimuat; sambutan tetap terkirim sebagai embed teks |
| `terkirim via dm` padahal channel diatur | Channel tujuan tidak lolos pemeriksaan izin, jadi jatuh ke DM |

### Mode tampilan

Bentuk pesan sambutan & perpisahan bisa dipilih per server di dashboard:

| Mode | Bentuk pesan | Butuh browser? | Bisa me-ping? |
|---|---|---|---|
| **Card** | teks sapaan + kartu PNG sebagai lampiran (**tanpa embed**) | **tidak** | **ya** |
| **Container** | kartu Components V2 (blok berwarna aksen, gaya panel baru Discord) | tidak | **ya** |
| **Embed** | embed berwarna bertema server (avatar member opsional sebagai thumbnail) | tidak | tidak |
| **Text** | teks polos di `content` | tidak | **ya** |

Kenapa **Embed** satu-satunya yang tidak bisa me-ping: di Discord, mention di
dalam embed tidak memicu notifikasi. **Card** dulu ikut tidak bisa karena
kartunya dibungkus embed; sekarang kartu dikirim sebagai lampiran biasa dengan
teks di `content`, jadi mention-nya aktif seperti bot besar.

Catatan jujur untuk perpisahan: membernya **sudah keluar** dari server, jadi
Discord tidak memicu notifikasi untuk mention itu — yang tampil hanya nama yang
bisa diklik. Teksnya tetap mention, bukan nama polos.

**Bagaimana mention dikirim per mode:**

| Mode | Tempat mention | Kenapa |
|---|---|---|
| Card | `content` bersama teks sapaan | teks di luar gambarlah yang bisa me-ping |
| Embed | `content`, **mention saja** | mention di dalam embed mati; teksnya sudah ada di deskripsi embed jadi tidak diulang |
| Text | `content` | memang teks biasa |
| Container | di dalam Text Display | Components V2 melarang `content` |

Dulu mode **Embed** mengirim `content: ''` sehingga member baru tidak pernah
menerima notifikasi sama sekali.

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
| Card tapi kartu gagal digambar | Embed |
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
| **Container** | Media Gallery di **paling atas** komponen |
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
| `{user.mention}` | tag member (`@nama`) | tidak menjadi tag di dalam embed; di mode Card/Text/Container benar-benar mention |
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
   dicentang tapi gambar gagal dibuat, bot mengirim `embeds: []` + tanpa file.
   Discord menolak pesan kosong; sekarang otomatis mundur ke embed teks.
3. **Tidak ada log sama sekali.** Sekarang setiap event dan setiap alasan
   dilewati tercatat.

---

## Uji tanpa Discord

```bash
npm run smoke # 385 test, termasuk logika agent, sambutan & perpisahan
```

Test yang relevan: `agent:` (channel, ramai, jatah per jam, cooldown, sepi),
`galeri:` (peran channel, tanpa channel ngobrol), `riwayat:` (batas 8 giliran,
tidak menulis ke database), `sambutan:` dan `goodbye:` (template, prompt, kartu,
privasi).
