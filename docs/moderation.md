# 🛡️ Moderasi otomatis + logging

Filter kata terlarang bawaan bot — tanpa bot moderasi terpisah, tanpa database eksternal.
Berjalan di **semua channel teks** server, sebelum AI memproses pesan.

```
Member kirim pesan
        ↓
Pesan dari bot / staff?  ── ya ──→ dilewati (tidak difilter)
        ↓ tidak
Ada kata terlarang?      ── tidak ──→ lanjut normal (AI tetap menjawab di room)
        ↓ ya
Tindakan sesuai pengaturan  →  hapus / hapus + tegur / hapus + timeout
        ↓
Catat ke tabel `mod_logs` → kirim ringkasan ke channel log (kalau diisi)
```

---

## Menyalakan

Paling praktis lewat **dashboard** → halaman **Moderasi** (`/moderasi`):

1. Centang **Aktifkan moderasi otomatis di server ini**.
2. Isi daftar kata (pisahkan koma atau baris baru).
3. Pilih tindakan: hapus pesan / hapus + peringatan / hapus + timeout.
4. **Simpan pengaturan**.

Pengaturan dashboard disimpan **per server** (tabel `moderation`) dan menang atas nilai `.env`.
Kalau server belum pernah menyimpan apa pun, bot memakai nilai `.env` sebagai cadangan:

```env
MODERATION_ENABLED=true
MODERATION_WORDS=katakasar1,katakasar2,frasa tiga kata
MODERATION_ACTION=delete        # delete | warn | timeout
MODERATION_TIMEOUT_MINUTES=10   # 1–10080 (maks 7 hari)
```

> Butuh izin **Manage Messages** di channel tersebut agar pesan bisa dihapus, dan
> **Moderate Members** agar timeout berjalan. Tanpa izin itu bot tetap mencatat
> pelanggaran di dashboard, lalu memberi tahu member secara sopan.

---

## Cara pencocokan kata

Ketiga tindakan sama-sama **menghapus pesan** lebih dulu; bedanya hanya apa yang terjadi
sesudahnya (`warn` = tegur publik, `timeout` = bisukan member). Kalau bot tidak punya izin
**Manage Messages**, pesan tidak bisa dihapus — bot memberi tahu member agar menghapus sendiri,
dan pelanggaran tetap tercatat di dashboard/log.

| Input member | Kata terlarang | Tertangkap? |
|---|---|---|
| `Dasar ANJING` | `anjing` | ✅ (tidak peduli huruf besar/kecil) |
| `dasar!!! anjing??` | `anjing` | ✅ (tanda baca diabaikan) |
| `k0nt0l banget` | `kontol` | ✅ (variasi angka/leetspeak) |
| `penipuan online nih` | `penipuan online` | ✅ (frasa multi-kata) |
| `saya pakai asuransi` | `asu` | ❌ (dicocokkan per kata utuh) |

Pencocokan dilakukan pada teks yang sudah dinormalisasi: huruf kecil, aksen dibuang,
tanda baca jadi spasi, dan substitusi umum (`4→a`, `0→o`, `1→i`, `3→e`, `@→a`, dst).

---

## Siapa yang dikecualikan

- **Bot** dan pesan sistem.
- **Staff**: pemegang role `STAFF_ROLE_ID`, atau member dengan izin **Manage Messages** /
  **Administrator**. Jadi moderator tidak ikut kena filter saat mengutip kata terlarang.
- Pesan di DM, thread, atau channel non-teks (voice, forum) tidak diperiksa.

---

## Log & audit

Setiap pelanggaran dicatat ke tabel `mod_logs` dan tampil di dashboard `/moderasi`:
pelaku, kata yang cocok, cuplikan pesan (maks 500 karakter), tindakan, waktu.

Kalau `MODLOG_CHANNEL_ID` diisi, ringkasannya juga dikirim ke channel itu:

```
🛡️ Moderasi · timeout 30 menit
• Pelanggar: Rina (900000000000000002)
• Channel: #room-ai-0001
• Kata: `bangsat`
• Pesan: dasar bangsat banget sih ini
```

Log bisa dihapus satu per satu atau dibersihkan semua dari dashboard
(`DELETE /api/moderasi/logs/:id`, `DELETE /api/moderasi/logs`).
Menghapus log **tidak** membatalkan tindakan yang sudah terjadi di Discord.

---

## Tips

- Mulai dari daftar pendek (5–10 kata) lalu tambah sesuai kebutuhan komunitas.
- Jangan menaruh kata yang terlalu umum (mis. `anjir`, `asu` tanpa batas kata) — bisa
  memicu false positive. Uji dulu di channel khusus staff.
- Untuk komunitas besar, pertimbangkan `MODERATION_ACTION=warn` lebih dulu: member diberi
  tahu, pelanggaran tercatat, dan kamu bisa melihat polanya sebelum mengaktifkan timeout.
