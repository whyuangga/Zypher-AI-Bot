# 📚 Dokumen RAG — AI menjawab dari file server-mu

Fitur ini membuat AI **tahu isi dokumen server**, bukan hanya mengarang dari pengetahuan umum.
Contoh pemakaian: FAQ komunitas, SOP staff, daftar harga, jadwal event, dokumentasi produk, materi kursus.

> **RAG** = *Retrieval-Augmented Generation*. Bot mengambil dulu potongan dokumen yang relevan
> dengan pertanyaan member, lalu menyelipkannya ke prompt AI sebagai rujukan. Jawaban jadi
> berdasarkan isi dokumen dan menyebut sumbernya.

---

## Tanpa API key tambahan

Pencarian dokumen memakai **BM25** — algoritma pencarian leksikal (sama keluarga dengan yang dipakai
mesin pencari) yang berjalan di dalam bot. Artinya:

- tidak ada biaya, tidak ada API key baru;
- tidak butuh internet keluar untuk pencarian;
- hasilnya bagus untuk dokumen berbahasa natural seperti FAQ dan SOP.

Kalau kamu punya endpoint *embeddings*, bot bisa menambah **pencarian semantik** dan menggabungkannya
(hybrid) — lihat bagian [Embeddings opsional](#embeddings-opsional).

---

## Format yang didukung

| Didukung | Tidak (belum) |
|---|---|
| `.txt` `.md` `.markdown` | `.doc` (Word 97-2003) |
| `.csv` `.tsv` `.json` `.jsonl` | `.xlsx` `.xls` |
| `.html` `.htm` `.xml` | `.pptx` |
| `.log` `.ini` `.yaml` `.yml` | `.odt` `.rtf` `.epub` |
| `.sql`, kode (`.ts`, `.js`, `.py`, dst.) | gambar, audio, video |
| **`.pdf`** (teks, bukan hasil scan) | PDF hasil scan (butuh OCR dulu) |
| **`.docx`** (Word modern) | |

### PDF & DOCX

- **PDF** dibaca dengan [`unpdf`](https://github.com/unjs/unpdf) (pdf.js versi server) — tanpa
  dependency native, jalan di panel 512 MB. PDF hasil **scan/gambar tidak punya lapisan teks**,
  jadi bot menolak dengan pesan "OCR dulu" daripada menyimpan teks kosong.
- **DOCX** dibaca dengan [`fflate`](https://github.com/101arrowz/fflate): cukup `word/document.xml`
  di-unzip lalu tag XML-nya dibuang. Tidak ada library konversi Word yang berat.
- Format lain tetap ditolak dengan pesan jelas (`.doc` lama, Excel, PowerPoint, dst.).
  Konversi dulu: buka di Word/Google Docs → **Save as .txt/.docx** atau export PDF.

**Batas default:** 8 MB per file (PDF/DOCX maupun teks), 200.000 karakter per dokumen
(`RAG_MAX_CHARS`). Dokumen besar sebaiknya dipecah per topik — hasil pencarian malah lebih akurat.

---

## Cara upload

### 1. Lewat Discord (paling cepat)

```
/dokumen tambah file:<lampiran .txt/.md>
```

Opsional beri nama lain:

```
/dokumen tambah file:faq.txt nama:FAQ Komunitas
```

> **Nama yang sama = mengganti versi lama.** Jadi memperbarui FAQ cukup upload ulang dengan nama
> yang sama, tidak akan menumpuk jadi dua.

### 2. Lewat dashboard web

Buka `/dokumen` di dashboard → pilih file atau tempel teks langsung → simpan.
Cocok untuk dokumen panjang atau saat bot sedang restart. Caranya ada di [dashboard.md](dashboard.md).

---

## Bagaimana AI memakainya

Setiap pertanyaan di room AI:

1. Bot mencari 5 potongan dokumen paling relevan (bisa diatur `RAG_TOP_K`).
2. Potongan itu diselipkan ke system prompt sebagai **dokumen rujukan** — sumber kebenaran tertinggi.
3. AI menjawab dengan bahasanya sendiri, **tanpa menyalin mentah** dan tanpa menulis ulang tag sumber.
4. Di bawah jawaban muncul baris kecil: `-# 📚 Sumber: faq.md`

Kalau tidak ada potongan yang cocok, AI menjawab seperti biasa (tidak memaksa memakai dokumen).
Artinya dokumen **tidak** mengganggu obrolan santai — hanya aktif saat relevan.

### Uji tanpa mengganggu member

```
/dokumen cari pertanyaan:jam operasional server
```

Bot menampilkan potongan yang **akan** dipakai AI beserta skornya. Ini cara tercepat memastikan
dokumen kamu benar-benar "kebaca" sebelum diumumkan ke member.

---

## Mengelola dokumen

```
/dokumen daftar                 # semua dokumen + jumlah potongan
/dokumen hapus id:3             # hapus satu dokumen
/dokumen tambah file:...        # tambah / ganti
```

Semua perintah di atas khusus **admin server** (izin Manage Server), kecuali `/dokumen cari`.

---

## Tips menulis dokumen yang "kebaca" AI

| Lakukan | Hindari |
|---|---|
| Satu topik per paragraf, pakai heading `##` | Satu paragraf raksasa berisi 10 topik |
| Tulis kalimat lengkap: "Server aktif pukul 09.00–21.00 WIB" | Tabel lebar penuh angka tanpa konteks |
| Sebut istilah yang dipakai member ("giveaway", "tiket", "room AI") | Singkatan internal yang tidak umum |
| Perbarui dengan upload ulang nama yang sama | Menambah file baru tiap revisi (jadi duplikat) |

---

## Embeddings opsional

Kalau kamu ingin pencarian yang paham makna (bukan hanya kecocokan kata), isi tiga variabel ini:

```env
EMBED_BASE_URL=http://localhost:11434/v1     # contoh: Ollama lokal
EMBED_MODEL=nomic-embed-text
EMBED_API_KEY=ollama                          # boleh kosong untuk Ollama
```

Butuh endpoint `/embeddings` yang kompatibel OpenAI. **Groq belum punya embeddings**, jadi kalau
provider utamamu Groq, biarkan variabel ini kosong — RAG tetap jalan dengan BM25.

Kalau embeddings gagal (key salah, model tidak ada), bot **tidak error**: ia mencatat satu peringatan
lalu kembali ke pencarian leksikal. Dokumen yang sudah terlanjur diindeks tanpa vektor tetap bisa dicari.

---

## Variabel `.env` terkait

| Variabel | Default | Fungsi |
|---|---|---|
| `RAG_ENABLED` | `true` | Matikan fitur tanpa menghapus data |
| `RAG_TOP_K` | `5` | Jumlah potongan yang masuk prompt |
| `RAG_CHUNK_SIZE` | `900` | Panjang potongan (karakter) |
| `RAG_CHUNK_OVERLAP` | `150` | Tumpang tindih antar potongan |
| `RAG_MAX_CHARS` | `200000` | Batas ukuran satu dokumen |
| `EMBED_BASE_URL` | *(kosong)* | Endpoint embeddings (opsional) |
| `EMBED_MODEL` | *(kosong)* | Nama model embeddings (opsional) |
| `EMBED_API_KEY` | *(kosong)* | Key embeddings (opsional) |

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `/dokumen cari` kosong padahal dokumen ada | Kata di pertanyaan tidak muncul di dokumen. Coba istilah yang persis ada di dokumen, atau tambahkan sinonim di dokumen ("jam operasional / jam buka"). |
| "PDF ini tidak bisa dibuka" | PDF terkunci password atau rusak — simpan ulang / export ulang. |
| "PDF ini tidak mengandung teks (scan)" | Jalankan OCR dulu, atau salin isinya ke `.txt`. |
| "Isinya terlalu pendek (minimal 20 karakter)" | File kosong / cuma berisi spasi. |
| "File ini sepertinya bukan teks UTF-8" | File biner (gambar/zip) dengan nama `.txt`. Simpan ulang sebagai teks. |
| AI tetap tidak menyebut sumber | Model mungkin mengabaikan potongan karena pertanyaannya tidak relevan. Uji dengan `/dokumen cari` untuk memastikan retrieval-nya benar. |
| Jawaban menyebut dokumen lama | Upload ulang dengan nama sama (otomatis menimpa), lalu `/dokumen cari` lagi. |
| Mau mulai bersih | `/dokumen hapus id:<semua id>`, atau set `RAG_ENABLED=false`. |

---

Dokumen ini bagian dari panduan Zypher AI:

- [setup.md](setup.md) — dari nol sampai bot jalan
- [dashboard.md](dashboard.md) — panel web untuk kelola dokumen
- [hosting.md](hosting.md) — hosting gratis 24/7
- [models.md](models.md) · [providers.md](providers.md) — pilihan model & provider
