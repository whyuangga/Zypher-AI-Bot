/**
 * Pindahkan data dari SQLite ke Postgres.
 *
 *   DATABASE_PATH=./data/zypher.db \
 *   DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require \
 *   npm run migrate:pg
 *
 * Sifatnya **idempotent**: baris yang sudah ada (berdasarkan primary key /
 * unique index) dilewati, jadi aman dijalankan dua kali. Skema Postgres
 * dibuat otomatis kalau belum ada.
 *
 * Setelah migrasi, isi `DATABASE_URL` di `.env` dan bot otomatis memakai
 * Postgres (SQLite lama dibiarkan sebagai cadangan).
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { createPostgresDriver, createSqliteDriver, type Driver } from '../src/db/driver.js';
import { SCHEMA_PG } from '../src/db/schema.js';

interface TablePlan {
  name: string;
  columns: string[];
  /** true = punya kolom `id` (SERIAL) yang sequence-nya perlu disetel ulang */
  identity?: boolean;
}

/** Urutan penting: tabel induk dulu supaya foreign key tidak protes. */
const TABLES: TablePlan[] = [
  { name: 'guilds', columns: ['guild_id', 'name', 'persona', 'model', 'tts_reply_in_room', 'rag_enabled', 'vision_enabled', 'auto_memory', 'admin_only_rooms', 'created_at'] },
  {
    name: 'memories',
    columns: ['id', 'guild_id', 'user_id', 'content', 'source', 'created_at'],
    identity: true,
  },
  {
    name: 'keywords',
    columns: ['id', 'guild_id', 'trigger', 'answer', 'created_by', 'created_at'],
    identity: true,
  },
  {
    name: 'dm_sessions',
    columns: ['user_id', 'guild_id', 'created_at', 'last_active_at', 'message_count'],
  },
  {
    name: 'messages',
    columns: ['id', 'channel_id', 'role', 'content', 'created_at'],
    identity: true,
  },
  {
    name: 'documents',
    columns: ['id', 'guild_id', 'name', 'source', 'chars', 'chunk_count', 'created_by', 'created_at'],
    identity: true,
  },
  {
    name: 'chunks',
    columns: ['id', 'document_id', 'guild_id', 'ordinal', 'content', 'embedding'],
    identity: true,
  },
  { name: 'moderation', columns: ['guild_id', 'enabled', 'words', 'action', 'timeout_minutes', 'updated_at'] },
  {
    name: 'mod_logs',
    columns: ['id', 'guild_id', 'channel_id', 'user_id', 'user_name', 'content', 'matched', 'action', 'created_at'],
    identity: true,
  },
  { name: 'panels', columns: ['guild_id', 'channel_id', 'message_id', 'enabled', 'updated_at'] },
];

const sourcePath = resolve(process.env.DATABASE_PATH?.trim() || './data/zypher.db');
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl && process.env.PG_MEMORY !== '1') {
  console.error('❌ DATABASE_URL belum diisi. Contoh:\n   DATABASE_URL=postgres://user:pass@host:5432/db npm run migrate:pg');
  process.exit(1);
}

async function target(): Promise<Driver> {
  // Jalur uji: pg-mem, supaya skrip ini bisa dites tanpa server Postgres.
  if (process.env.PG_MEMORY === '1') {
    const { newDb } = await import('pg-mem');
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const { Pool } = memory.adapters.createPg();
    return createPostgresDriver({ pool: new Pool() });
  }
  return createPostgresDriver({ url: databaseUrl });
}

/**
 * Kolom yang benar-benar ada di tabel SQLite sumber.
 *
 * `PRAGMA table_info` mengembalikan daftar kolom (termasuk tipe & default).
 * Tabel yang belum ada → hasil kosong, dan pemanggil melewatinya.
 */
async function sourceColumns(driver: Driver, table: string): Promise<Set<string>> {
  try {
    const rows = await driver.all<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(rows.map((row) => String(row.name)));
  } catch {
    return new Set<string>();
  }
}

function normalize(value: unknown): string | number | bigint | boolean | Uint8Array | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  console.log('🔄 Migrasi SQLite → Postgres');
  console.log(`   sumber : ${sourcePath}`);
  console.log(`   tujuan : ${process.env.PG_MEMORY === '1' ? 'pg-mem (uji)' : databaseUrl?.replace(/:\/\/[^@]+@/, '://***@')}`);

  const source = createSqliteDriver(sourcePath);
  const destination = await target();

  await destination.exec(SCHEMA_PG);

  let total = 0;

  for (const table of TABLES) {
    // Database lama bisa belum punya kolom baru (mis. `guilds.name`). SQLite
    // menolak SELECT kolom yang tidak ada, jadi kolomnya disaring dulu —
    // tanpa ini seluruh tabel (termasuk persona) akan terlewat.
    const available = await sourceColumns(source, table.name);
    if (available.size === 0) {
      console.log(`   ${table.name.padEnd(12)} dilewati (tabel belum ada di sumber)`);
      continue;
    }
    const columns = table.columns.filter((column) => available.has(column));
    const skipped = table.columns.filter((column) => !available.has(column));

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await source.all<Record<string, unknown>>(`SELECT ${columns.join(', ')} FROM ${table.name}`);
    } catch (error) {
      console.warn(`⚠️  Tabel ${table.name} dilewati (${(error as Error).message})`);
      continue;
    }

    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const statement = `INSERT INTO ${table.name} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;

    let inserted = 0;
    for (const row of rows) {
      const values = columns.map((column) => normalize(row[column]));
      const result = await destination.run(statement, values);
      inserted += result.changes;
    }

    if (skipped.length > 0) {
      console.log(`   ${table.name.padEnd(12)} kolom baru tidak ada di sumber: ${skipped.join(', ')}`);
    }

    if (table.identity) {
      // Sequence harus digeser supaya ID baru tidak bertabrakan dengan data lama.
      // (pg-mem tidak punya pg_get_serial_sequence — cukup dilewati saat uji.)
      try {
        await destination.exec(
          `SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${table.name}), 1))`,
        );
      } catch (error) {
        console.warn(`⚠️  Sequence ${table.name} tidak bisa disetel: ${(error as Error).message.split('\n')[0]}`);
      }
    }

    total += inserted;
    console.log(`   ${table.name.padEnd(12)} ${inserted}/${rows.length} baris`);
  }

  await source.close();
  await destination.close();

  console.log(`\n✅ Selesai — ${total} baris dipindahkan.`);
  console.log('Langkah berikut: isi DATABASE_URL di .env lalu jalankan ulang bot.');
}

void main().catch((error: unknown) => {
  console.error('❌ Migrasi gagal:', error);
  process.exit(1);
});
