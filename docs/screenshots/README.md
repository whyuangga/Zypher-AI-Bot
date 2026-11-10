# Screenshot Dashboard

Pratinjau tampilan dashboard bergaya **editorial gelap** — latar `#0D0D0F`,
teks Wafer `#E2D1CC`, aksen Kimberly `#716C98`, garis rambut 1px, huruf **General Sans**
(self-host), tombol solid tanpa gradient.

Semua gambar diambil dari build terbaru dengan **data demo**:

| Data | Isi |
| --- | --- |
| Server | 1 server (`Komunitas Zypher`) |
| Sesi DM | 3 sesi, 84 pesan |
| Dokumen RAG | 5 dokumen (`.pdf`, `.docx`, `.md`, `.txt`), 20 potongan |
| Keyword | 5 template |
| Log moderasi | 4 catatan — **tanpa isi pesan member** |

> Gambar diambil dari data demo, bukan data produksi. Isi percakapan, memori
> member, dan cuplikan pesan member **tidak pernah** masuk ke screenshot, karena
> hal itu juga tidak pernah tampil di dashboard (lihat [Privasi member](../..#-privasi-member)).

## Daftar file

| File | Halaman | Ukuran layar |
| --- | --- | --- |
| `ringkasan-desktop.png` | Ringkasan | Desktop 1440px |
| `ringkasan-mobile.png` | Ringkasan | HP 390px |
| `panel-desktop.png` | Panel (kirim/hapus panel) | Desktop 1440px |
| `panel-mobile.png` | Panel | HP 390px |
| `sambutan-desktop.png` | Sambutan & perpisahan | Desktop 1440px |
| `sambutan-mobile.png` | Sambutan & perpisahan | HP 390px |
| `agent-desktop.png` | AI Agent (channel ngobrol + galeri) | Desktop 1440px |
| `agent-mobile.png` | AI Agent | HP 390px |
| `dokumen-desktop.png` | Dokumen RAG (upload PDF/DOCX) | Desktop 1440px |
| `dokumen-mobile.png` | Dokumen RAG | HP 390px |
| `keyword-desktop.png` | Keyword template | Desktop 1440px |
| `keyword-mobile.png` | Keyword template | HP 390px |
| `moderasi-desktop.png` | Moderasi (filter kata + log) | Desktop 1440px |
| `moderasi-mobile.png` | Moderasi (daftar log bertumpuk) | HP 390px |
| `pengaturan-desktop.png` | Pengaturan (persona, model, toggle fitur) | Desktop 1440px |
| `pengaturan-mobile.png` | Pengaturan | HP 390px |
| `login-mobile.png` | Login | HP 390px |

Total 15 file: 7 halaman × 2 ukuran layar + halaman login (hanya HP).

## Cara membuat ulang

Screenshot dibuat oleh skrip, bukan manual — jadi selalu bisa diperbarui saat
tampilan berubah.

```bash
# 1. Isi database demo (terpisah dari database asli)
DATABASE_PATH=./data/screenshot.db npm run screenshots:seed

# 2. Jalankan dashboard di port terpisah
DATABASE_PATH=./data/screenshot.db DASHBOARD_PORT=8899 npm run dashboard

# 3. Ambil screenshot (butuh Chromium)
npx playwright install chromium     # sekali saja
DASHBOARD_TOKEN=<token> npm run screenshots
```

Kalau tidak memakai Playwright, arahkan ke Chromium/Chrome yang sudah ada:

```bash
CHROMIUM_PATH=/usr/bin/chromium DASHBOARD_TOKEN=<token> npm run screenshots
```

Skrip menulis ke `docs/screenshots/` dan mencetak ukuran tiap file.

### Menguji tombol halaman (bukan hanya tampilannya)

```bash
DASHBOARD_TOKEN=... DASHBOARD_PORT=8899 CHROMIUM_PATH=/tmp/chromium \
LD_LIBRARY_PATH=/tmp/nsslib/lib npx tsx scripts/ui-test.mts
```

Skrip ini **mengklik** tombol "Tes sambutan", "Tes salam perpisahan", "Tes
balasan", "Tes pemecah sepi", dan "Simpan agent" di browser sungguhan, lalu
gagal kalau ada error JavaScript di console. Perlu karena bug di JS halaman
(contoh nyata: `postJson` tidak pernah didefinisikan) tidak terlihat oleh
typecheck maupun smoke test.

### Kenapa `screenshots:seed` menolak nama database lain

Skrip seed **menghapus dan membuat ulang** database yang ditunjuk `DATABASE_PATH`.
Supaya tidak ada risiko menghapus data produksi, skrip berhenti kalau path-nya
tidak memuat kata `screenshot`.

## Catatan tampilan

**Desktop.** Sidebar memuat 8 halaman: Ringkasan, Panel, Sambutan, AI Agent,
Dokumen RAG, Keyword, Moderasi, Pengaturan. Sambutan dan AI Agent sengaja
dipisah: yang pertama mengatur sapaan datang/pamit, yang kedua cara bot
mengobrol. Tidak ada lagi menu Memori atau Transkrip.

**Mobile.** Tiga kartu statistik diletakkan sejajar dalam satu baris.
Tabel bertumpuk memakai header tersembunyi + label per sel, nama file tidak
terpotong di tengah kata, dan tidak ada scroll horizontal. Tombol hapus menempel
di kanan baris terakhir, bukan turun ke baris sendiri.

**Toggle.** Sakelar fitur AI (Dokumen RAG, Auto Memory, tombol chat DM khusus
admin, Suara balasan AI) tampil sebagai switch di kanan label, sebaris. Tidak ada
sakelar Vision — membaca gambar selalu aktif.

**Badge status.** Badge "Aktif"/"Nonaktif" di judul kartu ikut di tengah tinggi
kartu, tidak turun ke baris kedua walau judul dan keterangannya dua baris di HP.
Di layar sempit `.card-head` memakai grid dua kolom untuk itu.

**Tombol kirim tes.** Di halaman Sambutan dan AI Agent ada tombol kirim tes
sungguhan di samping tombol pratinjau. Di screenshot tombol itu tampak redup
karena dashboard dijalankan **tanpa bot** (mode screenshot); di server asli
tombolnya aktif. Tombol pratinjau tetap berfungsi penuh tanpa bot.
