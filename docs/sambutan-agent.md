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
| **Template** | `{user}` → nama panggilan, `{server}` → nama server |
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
biasa — tidak ada error, hanya tanpa gambar. Font General Sans di-embed sebagai
data URI supaya hasilnya sama di server mana pun.

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
| **Template** | `{user}` → nama panggilan, `{server}` → nama server |
| **Gaya / contoh nada** | mis. `sopan, hangat, singkat` |

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

- **Server Members Intent** — wajib untuk sambutan **dan** perpisahan
  (`GuildMemberAdd` / `GuildMemberRemove`).
- **Message Content Intent** — sudah dipakai; wajib untuk agent.

Tanpa Server Members Intent, bot tetap jalan tapi tidak pernah menerima event
member baru, sehingga sambutan tidak terkirim.

---

## Uji tanpa Discord

```bash
npm run smoke     # 176 test, termasuk logika agent, sambutan & perpisahan
```

Test yang relevan: `agent:` (channel, ramai, jatah per jam, cooldown, sepi),
`galeri:` (peran channel, tanpa channel ngobrol), `riwayat:` (batas 8 giliran,
tidak menulis ke database), `sambutan:` dan `goodbye:` (template, prompt, kartu,
privasi).
