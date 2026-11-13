# 🧪 Uji Nyata di Discord — sebelum merge

Semua tes otomatis di repo ini memakai **tiruan** (`scripts/smoke.ts` dan
`scripts/ui-check.mts` tidak menyentuh gateway atau REST Discord). Ada perilaku
yang hanya bisa dibuktikan di server sungguhan, dan dokumen ini mengurutkannya
dari yang paling berisiko.

Tujuan: **bukan menguji semua fitur**, tapi menguji hal yang (a) baru berubah di
Batch 32–42, dan (b) tidak bisa ditiru tes karena jawabannya datang dari Discord.

Perkiraan waktu: 25–35 menit.

## Persiapan

```bash
npm ci
npm run verify     # 449 smoke + 140 ui-check, harus hijau
npm run build
npm start          # atau npm run dev
```

Siapkan di server uji:

- 1 channel teks, mis. `#uji-pesan`
- 1 thread **aktif** di channel itu, mis. `#uji-pesan › thread-aktif`
- 1 thread yang **diarsipkan** (klik kanan thread → Archive)
- Bot punya izin: View Channel, Send Messages, Embed Links, Attach Files,
  Manage Webhooks, Manage Threads, Manage Roles (untuk uji tombol role)

Centang kotak tiap butir. Kalau ada yang gagal, catat **butir nomornya** +
pesan galat yang muncul — itu cukup untuk saya telusuri.

---

## Grup A — yang paling berisiko (wajib)

### A1. Kirim ke thread yang sudah ada (Batch 40)

1. Buka `/pesan`, pilih pesan yang sudah tersimpan, tab **Susun**.
2. Isian **Channel tujuan** → buka daftar.

- [ ] Thread muncul di daftar dengan awalan induk: `🧵 uji-pesan › thread-aktif`
- [ ] Pilih thread aktif → **Simpan & kirim ulang**

- [ ] Pesan masuk **ke dalam thread**, bukan ke channel induk
- [ ] Tidak ada galat di dashboard

### A2. Thread terarsip dibuka otomatis (Batch 40)

1. Arsipkan thread tadi (klik kanan → Archive Thread).
2. Ulangi A1 dengan thread yang baru diarsipkan.

- [ ] Pesan tetap terkirim (bot membuka arsip lebih dulu)
- [ ] Kalau gagal, dashboard menyebut **Manage Threads**, bukan "Missing Permissions"

### A3. "Nama thread" saat tujuan sudah thread (Batch 40)

1. Isi **Nama thread**: `uji-thread-baru`.
2. Kirim ke thread yang sudah ada (A1).

- [ ] Pesan terkirim
- [ ] Muncul laporan **"nama thread diabaikan: pesan ini sudah dikirim ke dalam thread"**
- [ ] Tidak ada thread baru dibuat di dalam thread

### A4. Buka pesan lama → ubah satu kata → Simpan (Batch 42)

Ini bug senyap yang baru diperbaiki; ujinya harus pesan yang **sudah punya**
pengaturan, bukan pesan baru.

1. Buat pesan dengan: centang **ping role**, isi **Nama thread**, pilih **Nama
   pengirim webhook** = `Tim Uji`, bentuk **Embed klasik**. Simpan & kirim.
2. Tutup, lalu buka lagi pesannya lewat `?id=`.
3. **Periksa tanpa mengubah apa pun** — apakah isian editor sudah benar?

- [ ] Centang ping role masih tercentang
- [ ] Nama thread masih terisi
- [ ] Nama pengirim webhook masih `Tim Uji`
- [ ] Bentuk pesan masih **Embed klasik**
- [ ] Isi embed (penulis/footer/bidang) masih ada

4. Ubah **satu kata** di teks, lalu Simpan & kirim ulang.

- [ ] Pesan di Discord masih mem-ping role
- [ ] Pengaturan lain tidak kembali ke bawaan

### A5. Kembalikan versi (Batch 42)

1. Di pesan A4, ubah beberapa pengaturan (mis. matikan ping role, ubah nama
   thread), Simpan.
2. Tab **Riwayat** → pilih versi **sebelum** perubahan → **Kembalikan**.
3. Di editor, periksa isian **sebelum** menekan Simpan.

- [ ] Centang ping, nama thread, dan nama webhook ikut kembali ke versi itu
- [ ] Setelah Simpan, pesan di Discord benar-benar kembali seperti versi itu
      (bukan setengah kembali)

## Grup B — pemeriksaan tujuan (Batch 41)

### B1. Channel dihapus

1. Pilih channel tujuan, simpan pesan **tanpa** mengirim.
2. Hapus channel itu di Discord.
3. Tekan **Simpan & kirim ulang**.

- [ ] Muncul **"Channel tidak ditemukan…"** sebelum pengiriman
- [ ] Bukan "Missing Permissions" atau "Unknown Channel"

### B2. Izin dicabut

1. Cabut izin **Send Messages** bot di channel uji.
2. Kirim pesan ke channel itu.

- [ ] Muncul **"Bot kurang izin di #uji-pesan: Send Messages."**
- [ ] Nama channel & nama izinnya benar (bukan nama izin lain)

### B3. Channel tambahan (`targets[]`)

1. Tambahkan 5 channel tujuan tambahan; buat **satu** di antaranya tidak bisa
   dikirimi (hapus atau cabut izinnya).
2. Kirim.

- [ ] 4 channel lain tetap menerima pesan
- [ ] Galat hanya menyebut channel yang gagal, per channel

## Grup C — embed klasik & lampiran (Batch 36–37)

### C1. Flag dilepas pada pesan embed

1. Kirim pesan **Embed klasik** dengan **Flag 4** (`SUPPRESS_EMBEDS`) dicentang.

- [ ] Embed **tetap tampil** (flag 4 dilepas otomatis)
- [ ] Flag 4096 (`SUPPRESS_NOTIFICATIONS`) tetap berlaku bila dicentang
- [ ] Dashboard melaporkan flag yang dilepas

### C2. Lampiran di embed

1. Lampirkan 2 berkas ke blok **File** pada pesan embed.

- [ ] Kedua berkas terkirim sebagai lampiran
- [ ] Nama berkas aman (tanpa spasi/karakter aneh)
- [ ] Kirim ulang (edit) tidak menggandakan lampiran lama

## Grup D — impor Discohook (Batch 39, 39b)

### D1. Tautan berbagi

1. Buka Discohook, buat pesan, **Share** → salin tautannya.
2. Di dashboard: **Impor** → tempel tautan.

- [ ] Isi pesan masuk lengkap
- [ ] Nama thread, flag, nama/avatar webhook ikut masuk

### D2. Tautan `?data=` / `?message=`

- [ ] Tautan dengan `?data=` bisa diimpor
- [ ] Tautan editor `?message=` (camelCase) bisa diimpor — nama thread &
      avatar tidak jadi `undefined`
- [ ] Berkas backup `{version, backups:[…]}` mengimpor **backup pertama**
- [ ] Warning yang muncul menyebut nama backup-nya

## Grup E — setelah semua lolos (regresi cepat)

- [ ] Tombol role masih bekerja: klik tombol role di pesan → role bertambah
- [ ] Hapus role: klik lagi → role hilang
- [ ] **Simpan & kirim ulang** pada pesan bertombol → tombol **masih** bisa diklik
- [ ] Panjang pesan > 2000 karakter ditolak dengan pesan jelas, bukan galat mentah

---

## Kalau ada yang gagal

Tempel ini di komentar PR (atau kirim ke saya):

```
Butir: A4
Langkah: buka pesan ?id= lalu periksa isian
Harapan: centang ping role masih tercentang
Kenyataan: centang kosong, tanpa galat
```

Nomor butirnya sudah cukup — tiap butir memetakan ke satu perubahan batch, jadi
saya bisa langsung tahu bagian mana yang perlu diperbaiki tanpa menebak.

## Setelah lolos

PR 23 siap di-merge. Yang perlu diingat setelah merge: `docs/pesan.md` memuat
catatan tiap batch (32–42) beserta alasannya, jadi keputusan seperti "webhook URL
manual sengaja tidak dibuat" tidak perlu ditanyakan ulang di audit berikutnya.
