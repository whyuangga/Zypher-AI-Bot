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
| **Teks** | teks biasa | mendukung format Discord (`**tebal**`, `_miring_`, `> kutipan`) |
| **Gambar** | satu URL `http(s)://…` | tampil selebar pesan |
| **Tombol** | label + URL tujuan | hanya **tombol link**; membuka tautan, tidak memberi role |
| **Pemisah** | garis | pemisah antar bagian |

Teks kecil: baris yang diawali `-#` (mis. `-# dibuat oleh admin`) tampil kecil dan
redup di Discord. Ini cara membuat catatan kaki.

### Batas yang dipakai bot

Discord punya batas keras. Bot memangkas isi agar kiriman tidak ditolak:

| Batas | Angka |
|---|---|
| Panjang satu blok teks | 4.000 karakter |
| Total teks satu pesan | 3.500 karakter |
| Jumlah blok | 40 |
| Tombol per baris | 5 |
| Baris tombol per pesan | 5 |
| Gambar galeri | 10 |

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
| Ambil role otomatis | ⏳ belum — butuh tombol role (tahap berikutnya) |
| Sambutan member baru | ❌ pakai `/sambutan` — butuh template & AI |

---

## 4. Yang belum ada

**Tombol ambil role.** Tombol di halaman ini hanya membuka tautan. Tombol yang
memberi role butuh:

- tabel pemetaan tombol → role,
- `customId` dinamis (bukan satu ID tetap per tombol),
- izin **Manage Roles** untuk bot, dan posisi role bot **di atas** role yang dibagi.

Rencananya dijadikan tahap lanjutan di halaman yang sama, bukan halaman baru.

---

## 5. Catatan teknis

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

Kalau bot sedang offline, tombol kirim dinonaktifkan dan permintaan kirim
dijawab `400` dengan pesan yang jelas — bukan `500`.
