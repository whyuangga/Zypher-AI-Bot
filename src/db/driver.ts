import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../lib/logger.js';

/**
 * Lapisan driver database.
 *
 * Bot aslinya memakai `node:sqlite` (sinkron). Supaya bisa juga jalan di
 * **Postgres** (untuk deploy multi-instance/multi-shard), semua akses database
 * melewati interface async di bawah ini:
 *
 * - SQL ditulis dengan placeholder `?` (gaya SQLite). Driver Postgres
 *   menerjemahkannya jadi `$1..$n`.
 * - `insert()` dipakai untuk INSERT yang butuh ID baru: SQLite membaca
 *   `lastInsertRowid`, Postgres menambahkan `RETURNING id`.
 *
 * Konsekuensinya: semua fungsi di `repo.ts` jadi `async`, dan pemanggilnya
 * harus `await`. Itu harga yang wajar untuk mendukung dua engine.
 */

export type Dialect = 'sqlite' | 'pg';
export type SqlParam = string | number | bigint | boolean | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastId: number | null;
}

export interface Driver {
  readonly dialect: Dialect;
  /** Nama engine untuk log/dokumentasi, mis. "SQLite" atau "PostgreSQL". */
  readonly label: string;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  /** INSERT yang mengembalikan ID baris baru. */
  insert(sql: string, params?: SqlParam[]): Promise<number>;
  /** DDL / pragma; boleh berisi banyak statement. */
  exec(script: string): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  SQLite                                                             */
/* ------------------------------------------------------------------ */

export function createSqliteDriver(filePath: string): Driver {
  const target = filePath === ':memory:' ? ':memory:' : filePath;
  if (target !== ':memory:') mkdirSync(dirname(target), { recursive: true });

  const database = new DatabaseSync(target);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');

  return {
    dialect: 'sqlite',
    label: 'SQLite',

    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return database.prepare(sql).all(...(params as never[])) as unknown as T[];
    },

    async get<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      const row = database.prepare(sql).get(...(params as never[]));
      return (row as T | undefined) ?? null;
    },

    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      const info = database.prepare(sql).run(...(params as never[]));
      return { changes: Number(info.changes), lastId: info.lastInsertRowid === undefined ? null : Number(info.lastInsertRowid) };
    },

    async insert(sql: string, params: SqlParam[] = []): Promise<number> {
      const info = database.prepare(sql).run(...(params as never[]));
      return Number(info.lastInsertRowid);
    },

    async exec(script: string): Promise<void> {
      database.exec(script);
    },

    async close(): Promise<void> {
      database.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Postgres                                                           */
/* ------------------------------------------------------------------ */

/** Ubah `?` jadi `$1, $2, …` tanpa menyentuh isi string literal SQL. */
export function toPostgresPlaceholders(sql: string): string {
  let counter = 0;
  let result = '';
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;

    if (char === "'" && !inDouble) {
      // '' di dalam string literal bukan penutup.
      if (inSingle && sql[index + 1] === "'") {
        result += "''";
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      result += char;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      result += char;
      continue;
    }

    if (char === '?' && !inSingle && !inDouble) {
      counter += 1;
      result += `$${counter}`;
      continue;
    }

    result += char;
  }

  return result;
}

interface PoolLike {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  end: () => Promise<void>;
}

export interface PostgresDriverOptions {
  url?: string;
  /** Pool siap pakai (dipakai pengujian dengan pg-mem). */
  pool?: PoolLike;
  maxConnections?: number;
}

/**
 * Driver Postgres. `pg` diimpor dinamis supaya SQLite-only deployment tidak
 * perlu memuat (atau memasang) driver Postgres sama sekali.
 */
export async function createPostgresDriver(options: PostgresDriverOptions): Promise<Driver> {
  let pool: PoolLike;

  if (options.pool) {
    pool = options.pool;
  } else {
    interface PgPoolInstance extends PoolLike {
      on: (event: string, handler: (error: unknown) => void) => void;
    }
    interface PgModule {
      Pool?: new (config: unknown) => PgPoolInstance;
      types?: { setTypeParser: (oid: number, parse: (value: string) => unknown) => void };
      default?: {
        Pool?: new (config: unknown) => PgPoolInstance;
        types?: { setTypeParser: (oid: number, parse: (value: string) => unknown) => void };
      };
    }
    const pgModule = (await import('pg')) as unknown as PgModule;
    const Pool = pgModule.Pool ?? pgModule.default?.Pool;

    if (!Pool) throw new Error('Paket `pg` tidak bisa dimuat.');

    // BIGINT (int8) → number: COUNT()/SUM()/timestamp di Postgres dikembalikan
    // sebagai string, padahal seluruh kode menganggapnya angka.
    // int8 (BIGINT) → number. Akses `types` dibuat defensif karena `pg` adalah
    // paket CJS dan bentuk namespace-nya bisa berbeda antar versi/bundler.
    const pgTypes = (pgModule as { types?: { setTypeParser: (oid: number, parse: (value: string) => unknown) => void } }).types ??
      (pgModule.default as { types?: { setTypeParser: (oid: number, parse: (value: string) => unknown) => void } } | undefined)?.types;
    pgTypes?.setTypeParser(20, (value: string) => Number(value));

    const instance = new Pool({
      connectionString: options.url,
      max: options.maxConnections ?? 5,
      ssl: options.url && /sslmode=require/.test(options.url) ? { rejectUnauthorized: false } : undefined,
    });

    instance.on('error', (error: unknown) => logger.error('Koneksi Postgres error', error));
    pool = instance;
  }

  const query = (sql: string, params: SqlParam[] = []) =>
    pool.query(toPostgresPlaceholders(sql), params as unknown[]);

  return {
    dialect: 'pg',
    label: 'PostgreSQL',

    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      const result = await query(sql, params);
      return result.rows as T[];
    },

    async get<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      const result = await query(sql, params);
      return (result.rows[0] as T | undefined) ?? null;
    },

    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      const result = await query(sql, params);
      return { changes: result.rowCount ?? 0, lastId: null };
    },

    async insert(sql: string, params: SqlParam[] = []): Promise<number> {
      const result = await query(`${sql.replace(/;\\s*$/, '')} RETURNING id`, params);
      const row = result.rows[0] as { id?: number | string } | undefined;
      if (!row || row.id === undefined) throw new Error('INSERT tidak mengembalikan id.');
      return Number(row.id);
    },

    async exec(script: string): Promise<void> {
      await pool.query(script);
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
