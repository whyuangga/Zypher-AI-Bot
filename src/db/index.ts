import { resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { createPostgresDriver, createSqliteDriver, type Driver, type SqlParam } from './driver.js';
import { SCHEMA_PG, SCHEMA_SQLITE } from './schema.js';

/**
 * Titik masuk database.
 *
 * Default: SQLite lewat `node:sqlite` (tanpa dependensi native).
 * Kalau `DATABASE_URL` diisi: Postgres (butuh `npm install pg`).
 *
 * Inisialisasi dilakukan **lazy** pada query pertama supaya modul ini bisa
 * diimpor oleh skrip yang hanya butuh tipe/utilitas, dan supaya pengujian bisa
 * menyuntikkan driver sendiri (`setDriverForTests`).
 */

let active: Promise<Driver> | null = null;
let activeLabel = '';

/**
 * Kolom yang ditambahkan setelah rilis pertama.
 *
 * `CREATE TABLE IF NOT EXISTS` tidak menyentuh tabel yang sudah ada, jadi
 * database lama (sebelum kolom `guilds.name` ada) perlu di-ALTER sekali.
 * Semuanya idempotent: kalau kolomnya sudah ada, error diabaikan.
 */
async function migrateExistingDatabase(driver: Driver): Promise<void> {
  const statements = [
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS name TEXT'
      : 'ALTER TABLE guilds ADD COLUMN name TEXT',
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tts_reply_in_room BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN tts_reply_in_room INTEGER',
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS rag_enabled BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN rag_enabled INTEGER',
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS auto_memory BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN auto_memory INTEGER',
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS admin_only_rooms BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN admin_only_rooms INTEGER',
    // Banner kartu sambutan/perpisahan (fitur unggah gambar sendiri).
    // Database lama belum punya kolom ini, jadi ditambahkan di sini.
    'ALTER TABLE welcome ADD COLUMN banner_path TEXT',
    'ALTER TABLE goodbye ADD COLUMN banner_path TEXT',
    'ALTER TABLE goodbye ADD COLUMN image_enabled INTEGER',
    'ALTER TABLE goodbye ADD COLUMN include_avatar INTEGER',
    // Mode tampilan (card/embed/text). Baris lama dibiarkan NULL dan
    // diterjemahkan dari `image_enabled` saat dibaca, jadi tampilan server
    // yang sudah berjalan tidak berubah karena pembaruan ini.
    'ALTER TABLE welcome ADD COLUMN display_mode TEXT',
    'ALTER TABLE goodbye ADD COLUMN display_mode TEXT',
  ];

  for (const statement of statements) {
    try {
      await driver.exec(statement);
    } catch {
      // Kolom sudah ada (SQLite tidak punya IF NOT EXISTS untuk ALTER TABLE).
    }
  }

  // Dashboard tidak lagi menyimpan transkrip percakapan. Tabel lama dihapus
  // supaya isi percakapan member tidak tertinggal di database setelah upgrade.
  // Transkrip sekarang hanya dikirim ke DM user (dan tidak diarsipkan).
  try {
    await driver.exec('DROP TABLE IF EXISTS transcripts');
    await driver.exec('DROP INDEX IF EXISTS idx_transcripts_guild');
  } catch {
    // Tabel memang belum ada — tidak apa-apa.
  }

  // Log moderasi tidak lagi menyimpan isi pesan member — hanya kata yang cocok
  // dan tindakan. Kolom `content` dihapus supaya cuplikan pesan lama tidak
  // tertinggal dan bisa dibaca dari dashboard.
  try {
    if (driver.dialect === 'pg') {
      await driver.exec('ALTER TABLE mod_logs DROP COLUMN IF EXISTS content');
    } else {
      await driver.exec('ALTER TABLE mod_logs DROP COLUMN content');
    }
  } catch {
    // Kolom sudah tidak ada — tidak apa-apa.
  }

  // Room AI (channel/thread) sudah diganti percakapan DM. Tabel `rooms` tidak
  // dipakai lagi, dan riwayat `messages` milik room lama ikut dibersihkan
  // supaya percakapan member tidak tertinggal di database.
  try {
    await driver.exec("DELETE FROM messages WHERE channel_id NOT LIKE 'dm:%'");
    await driver.exec('DROP TABLE IF EXISTS rooms');
    await driver.exec('DROP INDEX IF EXISTS idx_rooms_user');
  } catch {
    // Tabel memang belum ada — tidak apa-apa.
  }
}

async function initDriver(): Promise<Driver> {
  if (config.database.url) {
    logger.info('Menghubungkan database Postgres…');
    const driver = await createPostgresDriver({ url: config.database.url });
    await driver.exec(SCHEMA_PG);
    await migrateExistingDatabase(driver);
    activeLabel = driver.label;
    logger.info('Database siap: PostgreSQL (DATABASE_URL)');
    return driver;
  }

  const path = config.database.path === ':memory:' ? ':memory:' : resolve(config.database.path);
  const driver = createSqliteDriver(path);
  await driver.exec(SCHEMA_SQLITE);
  await migrateExistingDatabase(driver);
  activeLabel = driver.label;
  logger.info(`Database siap: ${path}`);
  return driver;
}

function driver(): Promise<Driver> {
  active ??= initDriver().catch((error: unknown) => {
    // Jangan simpan promise yang gagal: percobaan berikutnya harus bisa mengulang.
    active = null;
    throw error;
  });
  return active;
}

/** Engine yang sedang dipakai (`sqlite` / `pg`). */
export function dialect(): 'sqlite' | 'pg' {
  return config.database.url ? 'pg' : 'sqlite';
}

export async function dbLabel(): Promise<string> {
  await driver();
  return activeLabel;
}

/** Semua baris. */
export async function all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  return (await driver()).all<T>(sql, params);
}

/** Satu baris (atau `null`). */
export async function get<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
  return (await driver()).get<T>(sql, params);
}

/** Query tulis; hasil berisi jumlah baris terpengaruh. */
export async function run(sql: string, params: SqlParam[] = []) {
  return (await driver()).run(sql, params);
}

/** INSERT yang mengembalikan ID baris baru (portable SQLite ↔ Postgres). */
export async function insert(sql: string, params: SqlParam[] = []): Promise<number> {
  return (await driver()).insert(sql, params);
}

/** DDL / pragma. */
export async function exec(script: string): Promise<void> {
  return (await driver()).exec(script);
}

export async function closeDatabase(): Promise<void> {
  if (!active) return;
  const current = active;
  active = null;

  try {
    await (await current).close();
  } catch (error) {
    logger.warn('Gagal menutup database', error);
  }
}

/** Hanya untuk pengujian: pakai driver buatan sendiri (mis. pg-mem). */
export function setDriverForTests(fake: Driver): void {
  active = Promise.resolve(fake);
  activeLabel = fake.label;
}

export type { Driver, SqlParam };
