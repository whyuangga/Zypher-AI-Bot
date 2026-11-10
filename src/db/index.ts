import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { SCHEMA } from './schema.js';

/**
 * Memakai `node:sqlite` bawaan Node 22 — tidak perlu dependensi native
 * (tanpa node-gyp / build tools saat deploy).
 */
const databasePath = config.database.path === ':memory:' ? ':memory:' : resolve(config.database.path);

if (databasePath !== ':memory:') {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export const db = new DatabaseSync(databasePath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(SCHEMA);

logger.info(`Database siap: ${databasePath}`);

export function closeDatabase(): void {
  try {
    db.close();
  } catch (error) {
    logger.warn('Gagal menutup database', error);
  }
}
