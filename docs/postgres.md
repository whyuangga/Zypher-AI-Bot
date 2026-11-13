# 🐘 Postgres & multi-shard

Default bot tetap **SQLite** (`node:sqlite`, satu file, tanpa server tambahan) — cukup untuk
satu server komunitas dan hosting panel gratis. Postgres baru perlu kalau:

- bot dipakai di **banyak instance** yang harus melihat data yang sama, atau
- data sudah besar dan kamu ingin backup/replikasi yang lebih nyaman, atau
- hosting-mu menyediakan Postgres (banyak PaaS) dan kamu tidak mau menyimpan file SQLite.

> Kedua engine memakai **kode yang sama**. Yang berubah hanya `DATABASE_URL` di `.env`;
> tidak ada fitur yang hilang saat pindah.

---

## 1. Menyalakan Postgres

```env
DATABASE_URL=postgres://user:password@host:5432/nama_db?sslmode=require
```

- `DATABASE_PATH` **diabaikan** selama `DATABASE_URL` terisi.
- Driver `pg` sudah ada di `dependencies`, jadi `npm install` biasa cukup.
- Skema (tabel + index) dibuat **otomatis** saat bot pertama kali menyentuh database.
- SSL: `sslmode=require` memakai sertifikat tanpa verifikasi ketat — cocok untuk Neon,
  Supabase, Aiven, Railway, dan Postgres terkelola lain yang memakai CA publik yang
  belum tentu ada di container panel. Kalau kamu punya CA sendiri, hapus `sslmode` dan
  pasang `PGSSLROOTCERT`.

Provider Postgres gratis yang umum: **Neon**, **Supabase**, **Aiven** (kuota kecil).
Tidak ada yang perlu diubah di kode — cukup salin connection string.

---

## 2. Pindahkan data dari SQLite

Sudah punya data di `data/zypher.db` dan tidak mau kehilangan memori/dokumen?

```bash
DATABASE_PATH=./data/zypher.db \
DATABASE_URL='postgres://user:pass@host:5432/db?sslmode=require' \
npm run migrate:pg
```

Yang dilakukan skrip ini:

1. Membuat skema Postgres kalau belum ada.
2. Menyalin tabel satu per satu: `guilds` → `memories` → `keywords` → `rooms` →
   `messages` → `documents` → `chunks` → `transcripts` → `moderation` → `mod_logs` → `panels`.
   Kolom yang belum ada di SQLite lama (mis. `guilds.name`) dilewati, dan tabel yang belum ada
   dicatat sebagai dilewati — data lain tetap tersalin.
3. **Idempotent**: baris yang sudah ada dilewati (`ON CONFLICT DO NOTHING`), jadi aman
   dijalankan ulang kalau migrasi terputus.
4. Menyetel ulang sequence ID (`setval`) supaya ID baru tidak bertabrakan dengan data lama.

Setelah selesai, tambahkan `DATABASE_URL` ke `.env`, restart bot, lalu cek dashboard:
jumlah room/dokumen/memori harus sama dengan sebelumnya.

> File SQLite **tidak dihapus** oleh skrip. Simpan sebagai cadangan sampai kamu yakin
> semuanya benar.

---

## 3. Multi-shard: banyak instance, satu database

Ada dua cara membagi beban, pilih sesuai kebutuhan.

### a. `ShardingManager` (satu token, banyak proses)

Discord mendukung *sharding* resmi: beberapa proses gateway dengan token yang sama,
masing-masing menangani sebagian server yang **ditentukan Discord**. Ini cara yang benar
untuk naik kapasitas dengan satu aplikasi bot:

```ts
// shard.ts (dijalankan: node shard.js)
import { ShardingManager } from 'discord.js';

const manager = new ShardingManager('./dist/index.js', { token: process.env.DISCORD_TOKEN });

manager.on('shardCreate', (shard) => console.log(`Shard ${shard.id} siap`));
await manager.spawn();
```

Dengan Postgres, semua shard menulis ke database yang sama, jadi memori/dokumen
konsisten di semua shard. Tidak ada env tambahan yang perlu diisi.

### b. Beberapa aplikasi bot + `SHARD_INDEX` / `SHARD_COUNT`

Kadang kamu ingin **token berbeda** (mis. kuota API key terpisah, atau dua bot untuk
komunitas berbeda) yang berbagi satu database. Supaya tidak ada dua instance yang
menjawab pesan yang sama:

```env
# instance A
SHARD_COUNT=2
SHARD_INDEX=0

# instance B
SHARD_COUNT=2
SHARD_INDEX=1
```

Pembagiannya memakai hash **FNV-1a** dari guild ID, jadi stabil: server yang sama selalu
jatuh ke instance yang sama, tanpa tabel koordinasi. Instance hanya memproses pesan,
command, dan tombol dari server porsinya; dashboard tetap bisa menampilkan semua server
di database (berguna untuk admin yang mau melihat keseluruhan).

`SHARD_COUNT=1` (default) = perilaku lama, semua server ditangani instance itu.

---

## 4. Catatan teknis

| Hal | Detail |
|---|---|
| Placeholder SQL | Kode menulis `?`; driver Postgres menerjemahkannya jadi `$1..$n` (aman terhadap `?` di dalam string literal). |
| ID baru | `INSERT ... RETURNING id` di Postgres, `lastInsertRowid` di SQLite — dikapsul di `insert()`. |
| Boolean | Disimpan sebagai `INTEGER` 0/1 di kedua engine, jadi tidak ada konversi tipe. |
| Timestamp | `BIGINT` (epoch ms) di Postgres, `INTEGER` di SQLite. Driver Postgres membaca `int8` sebagai `number`. |
| Aggregat | `COUNT(*)`/`MAX()` dikembalikan sebagai angka; grafik aktivitas mengelompokkan tanggal di JS supaya hasilnya identik di dua engine. |
| Pool | Maksimal 5 koneksi per instance (`max: 5`) — cukup untuk bot kecil, tidak menghabiskan kuota Postgres gratis. |
| Transaksi | Belum dipakai: operasi tulis bot bersifat kecil dan idempotent. Kalau nanti butuh (mis. import massal), tambahkan `BEGIN/COMMIT` di lapisan driver. |

### Uji tanpa server Postgres

```bash
npm run smoke # 436 test, jalur SQLite
npm run smoke:pg   # 21 test, jalur Postgres lewat pg-mem (in-memory)
```

`smoke:pg` membuat database Postgres palsu di memori, menjalankan skema asli, lalu menguji
repo yang sama (memori, keyword, sesi DM, RAG, moderasi). Jadi perubahan SQL yang
tidak kompatibel akan ketahuan tanpa perlu menyewa database.

---

## 5. Backup

- **SQLite**: salin `data/zypher.db` (hentikan bot dulu, atau pakai `sqlite3 zypher.db ".backup"`).
- **Postgres**: `pg_dump "$DATABASE_URL" > backup.sql` — bisa dijadwalkan dari panel hosting,
  dan biasanya sudah disediakan otomatis oleh provider (Neon: *branches*, Supabase: *backups*).
