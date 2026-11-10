# Sambutan member baru & AI Agent

Dua fitur "kehadiran" di dashboard → **Sambutan & Agent**. Keduanya **mati secara
default** — server lama tidak berubah perilakunya sampai admin menyalakannya.

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

## 2. AI Agent di satu channel

Di **satu** channel pilihanmu, bot ikut ngobrol seperti anggota komunitas:
membalas sapaan, menanggapi emoji/sticker, mengomentari gambar, dan sesekali
menyapa saat channel sepi.

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
| **Channel** | *mati* | satu channel; mengosongkannya mematikan fitur |
| **Sapa saat sepi setelah** | 45 menit | `0` = jangan pernah menyapa duluan |
| **Batas balasan per jam** | 6 | pengaman biaya API (1–60) |
| **Jeda minimum antar balasan** | 90 detik | supaya bot tidak mendominasi |
| **Diam saat ramai** | aktif | dianggap ramai bila ≥2 member bicara dalam 60 detik |
| **Tanggapi emoji & sticker** | aktif | |
| **Tanggapi gambar** | aktif | memakai `VISION_MODEL`, dan tetap menghormati toggle Vision |

### Yang tidak pernah disimpan

Riwayat obrolan channel **tidak ditulis ke database**. Bot hanya menyimpan di
memori proses:

- waktu balasan terakhir (untuk jeda dan jatah per jam),
- jejak pesan 10 menit terakhir (untuk menghitung "sedang ramai").

Keduanya hilang saat bot restart. Yang tersimpan permanen hanya
`agent_reactions` — berisi **ID pesan** dan timestamp, tanpa teks apa pun, supaya
bot tidak menanggapi pesan yang sama dua kali.

### Biaya API

Setiap balasan = satu panggilan model (kadang dua, kalau AI memakai tool memori).
Dengan batas 6/jam, maksimal ~144 panggilan per hari per server. Naikkan batasnya
dengan sadar; turunkan kalau kuota terasa cepat habis.

---

## Menyalakan

1. Buka dashboard → **Sambutan & Agent**.
2. Pilih channel di kartu **AI Agent** (mis. `#ngobrol-ai`), lalu simpan.
3. Untuk sambutan: centang **Sapa setiap member baru**, pilih DM atau channel,
   lalu simpan.

**Butuh intent tambahan di Developer Portal** (Discord → Applications → Bot →
Privileged Gateway Intents):

- **Server Members Intent** — wajib untuk sambutan (`GuildMemberAdd`).
- **Message Content Intent** — sudah dipakai; wajib untuk agent.

Tanpa Server Members Intent, bot tetap jalan tapi tidak pernah menerima event
member baru, sehingga sambutan tidak terkirim.

---

## Uji tanpa Discord

```bash
npm run smoke     # 161 test, termasuk logika agent & sambutan
```

Test yang relevan: `agent:` (channel, ramai, jatah per jam, cooldown, sepi) dan
`sambutan:` (template, prompt, kartu, privasi).
