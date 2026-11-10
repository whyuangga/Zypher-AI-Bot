/**
 * Skema database disimpan sebagai string (bukan file .sql) supaya tetap
 * ikut ter-compile ke dist/ saat build — tanpa perlu copy asset.
 */
export const SCHEMA_SQLITE = /* sql */ `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id    TEXT PRIMARY KEY,
  name        TEXT,
  persona     TEXT,
  model       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (guild_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_unique ON memories (guild_id, user_id, content);

CREATE TABLE IF NOT EXISTS keywords (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  answer      TEXT NOT NULL,
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keywords_guild ON keywords (guild_id);

CREATE TABLE IF NOT EXISTS rooms (
  channel_id     TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_user ON rooms (guild_id, user_id);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, id);

-- ---------- RAG dokumen ----------
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'upload',
  chars       INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_guild ON documents (guild_id);

CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  guild_id    TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chunks_guild ON chunks (guild_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks (document_id, ordinal);

-- ---------- arsip transkrip room AI ----------
CREATE TABLE IF NOT EXISTS transcripts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  channel_name  TEXT NOT NULL DEFAULT '',
  user_id       TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  summary       TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  memory_count  INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  html          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcripts_guild ON transcripts (guild_id, created_at DESC);

-- ---------- moderasi otomatis ----------
CREATE TABLE IF NOT EXISTS moderation (
  guild_id        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  words           TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL DEFAULT 'delete',
  timeout_minutes INTEGER NOT NULL DEFAULT 10,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mod_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  content    TEXT NOT NULL,
  matched    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_logs_guild ON mod_logs (guild_id, created_at DESC);

-- ---------- panel room AI (satu channel per server) ----------
CREATE TABLE IF NOT EXISTS panels (
  guild_id   TEXT PRIMARY KEY,
  channel_id TEXT,
  message_id TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
`;

/**
 * DDL untuk Postgres.
 *
 * Bedanya dengan SQLite: ID memakai `SERIAL`, timestamp memakai `BIGINT`
 * (dibaca sebagai number oleh driver), dan flag boolean tetap `INTEGER` 0/1
 * supaya kode aplikasi tidak perlu dua jalur.
 */
export const SCHEMA_PG = /* sql */ `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id    TEXT PRIMARY KEY,
  name        TEXT,
  persona     TEXT,
  model       TEXT,
  created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id          SERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (guild_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_unique ON memories (guild_id, user_id, content);

CREATE TABLE IF NOT EXISTS keywords (
  id          SERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  answer      TEXT NOT NULL,
  created_by  TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keywords_guild ON keywords (guild_id);

CREATE TABLE IF NOT EXISTS rooms (
  channel_id     TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_user ON rooms (guild_id, user_id);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, id);

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'upload',
  chars       INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_guild ON documents (guild_id);

CREATE TABLE IF NOT EXISTS chunks (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  guild_id    TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chunks_guild ON chunks (guild_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks (document_id, ordinal);

CREATE TABLE IF NOT EXISTS transcripts (
  id            SERIAL PRIMARY KEY,
  guild_id      TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  channel_name  TEXT NOT NULL DEFAULT '',
  user_id       TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  summary       TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  memory_count  INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  html          TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcripts_guild ON transcripts (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation (
  guild_id        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  words           TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL DEFAULT 'delete',
  timeout_minutes INTEGER NOT NULL DEFAULT 10,
  updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS mod_logs (
  id         SERIAL PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  content    TEXT NOT NULL,
  matched    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_logs_guild ON mod_logs (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS panels (
  guild_id   TEXT PRIMARY KEY,
  channel_id TEXT,
  message_id TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);
`;
