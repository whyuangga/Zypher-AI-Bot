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
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS vision_enabled BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN vision_enabled INTEGER',
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS auto_memory BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN auto_memory INTEGER',
    driver.dialect === 'pg'
      ? 'ALTER TABLE guilds ADD COLUMN IF NOT EXISTS admin_only_rooms BOOLEAN'
      : 'ALTER TABLE guilds ADD COLUMN admin_only_rooms INTEGER',
  ];

  for (const statement of statements) {
    try {
      await driver.exec(statement);
    } catch {
      // Kolom sudah ada (SQLite tidak punya IF NOT EXISTS untuk ALTER TABLE).
    }
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
