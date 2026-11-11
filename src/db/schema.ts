/**
 * Skema database disimpan sebagai string (bukan file .sql) supaya tetap
 * ikut ter-compile ke dist/ saat build — tanpa perlu copy asset.
 */
export const SCHEMA_SQLITE = /* sql */ `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id       TEXT PRIMARY KEY,
  name           TEXT,
  persona        TEXT,
  model          TEXT,
  tts_reply_in_room INTEGER,
  rag_enabled    INTEGER,
  auto_memory    INTEGER,
  admin_only_rooms INTEGER,
  created_at     INTEGER NOT NULL
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

-- ---------- sesi chat DM per member ----------
-- Konteks server (persona, dokumen, memori) mengikuti GUILD_ID — bot ini satu server.
-- Tidak ada channel: percakapan berjalan di DM yang tidak bisa dibaca admin.
CREATE TABLE IF NOT EXISTS dm_sessions (
  user_id        TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0
);

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

-- ---------- (tabel transcripts sudah dihapus; transkrip hanya ke DM) ----------
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
  matched    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_logs_guild ON mod_logs (guild_id, created_at DESC);

-- ---------- AI Agent: nimbrung di satu channel publik ----------
-- channel_id NULL = fitur mati. Satu channel per server, sama seperti panel.
CREATE TABLE IF NOT EXISTS agent (
  guild_id           TEXT PRIMARY KEY,
  -- channel utama untuk ngobrol
  channel_id         TEXT,
  -- channel galeri: komentar gambar/video + reaksi saja
  gallery_channel_id TEXT,
  quiet_minutes    INTEGER NOT NULL DEFAULT 45,
  max_per_hour     INTEGER NOT NULL DEFAULT 6,
  react_emoji      INTEGER NOT NULL DEFAULT 1,
  react_images     INTEGER NOT NULL DEFAULT 1,
  busy_mute        INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER NOT NULL DEFAULT 90,
  -- 1 = jangan sapaan otomatis malam hari (23:00-06:00 WIB). Balasan ke
  -- mention tetap jalan; hanya sapaan pemecah sepi yang ditahan.
  quiet_hours      INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL
);

-- Reaksi AI terhadap emoji/sticker/gambar. Hanya disimpan id pesan dan
-- timestamp supaya bot tidak menanggapi pesan yang sama dua kali.
CREATE TABLE IF NOT EXISTS agent_reactions (
  message_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- ---------- Salam perpisahan member ----------
-- Melengkapi sambutan: pesan saat member keluar dengan sopan.
-- channel_id NULL = DM (kemungkinan gagal, karena member sudah keluar).
CREATE TABLE IF NOT EXISTS goodbye (
  guild_id        TEXT PRIMARY KEY,
  channel_id      TEXT,
  enabled         INTEGER NOT NULL DEFAULT 0,
  use_ai          INTEGER NOT NULL DEFAULT 1,
  template        TEXT,
  display_mode    TEXT NOT NULL DEFAULT 'embed',
  style           TEXT,
  example         TEXT,
  image_enabled   INTEGER NOT NULL DEFAULT 0,
  include_avatar  INTEGER NOT NULL DEFAULT 1,
  banner_path     TEXT,
  banner_mime     TEXT,
  banner_bytes    TEXT,
  updated_at      INTEGER NOT NULL
);

-- ---------- Sambutan member baru ----------
-- channel_id NULL = sambutan dikirim ke DM member (aman untuk privasi).
CREATE TABLE IF NOT EXISTS welcome (
  guild_id        TEXT PRIMARY KEY,
  channel_id      TEXT,
  enabled         INTEGER NOT NULL DEFAULT 0,
  use_ai          INTEGER NOT NULL DEFAULT 1,
  template        TEXT,
  display_mode    TEXT NOT NULL DEFAULT 'embed',
  image_enabled   INTEGER NOT NULL DEFAULT 1,
  style           TEXT,
  example         TEXT,
  include_avatar  INTEGER NOT NULL DEFAULT 1,
  banner_path     TEXT,
  banner_mime     TEXT,
  banner_bytes    TEXT,
  updated_at      INTEGER NOT NULL
);

-- ---------- panel chat DM (satu channel per server) ----------
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
  guild_id          TEXT PRIMARY KEY,
  name              TEXT,
  persona           TEXT,
  model             TEXT,
  tts_reply_in_room BOOLEAN,
  rag_enabled       BOOLEAN,
  auto_memory       BOOLEAN,
  admin_only_rooms  BOOLEAN,
  created_at        BIGINT NOT NULL
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

-- ---------- sesi chat DM per member ----------
-- Konteks server (persona, dokumen, memori) mengikuti GUILD_ID — bot ini satu server.
-- Tidak ada channel: percakapan berjalan di DM yang tidak bisa dibaca admin.
CREATE TABLE IF NOT EXISTS dm_sessions (
  user_id        TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0
);

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
  matched    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_logs_guild ON mod_logs (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent (
  guild_id           TEXT PRIMARY KEY,
  -- channel utama untuk ngobrol
  channel_id         TEXT,
  -- channel galeri: komentar gambar/video + reaksi saja
  gallery_channel_id TEXT,
  quiet_minutes    INTEGER NOT NULL DEFAULT 45,
  max_per_hour     INTEGER NOT NULL DEFAULT 6,
  react_emoji      INTEGER NOT NULL DEFAULT 1,
  react_images     INTEGER NOT NULL DEFAULT 1,
  busy_mute        INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER NOT NULL DEFAULT 90,
  quiet_hours      INTEGER NOT NULL DEFAULT 1,
  updated_at       BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_reactions (
  message_id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL
);

-- ---------- Salam perpisahan member ----------
-- Belum ada di dialek Postgres sebelum fitur goodbye; sekarang disamakan.
CREATE TABLE IF NOT EXISTS goodbye (
  guild_id        TEXT PRIMARY KEY,
  channel_id      TEXT,
  enabled         INTEGER NOT NULL DEFAULT 0,
  use_ai          INTEGER NOT NULL DEFAULT 1,
  template        TEXT,
  display_mode    TEXT NOT NULL DEFAULT 'embed',
  style           TEXT,
  example         TEXT,
  image_enabled   INTEGER NOT NULL DEFAULT 0,
  include_avatar  INTEGER NOT NULL DEFAULT 1,
  banner_path     TEXT,
  banner_mime     TEXT,
  banner_bytes    TEXT,
  updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS welcome (
  guild_id        TEXT PRIMARY KEY,
  channel_id      TEXT,
  enabled         INTEGER NOT NULL DEFAULT 0,
  use_ai          INTEGER NOT NULL DEFAULT 1,
  template        TEXT,
  display_mode    TEXT NOT NULL DEFAULT 'embed',
  image_enabled   INTEGER NOT NULL DEFAULT 1,
  style           TEXT,
  example         TEXT,
  include_avatar  INTEGER NOT NULL DEFAULT 1,
  banner_path     TEXT,
  banner_mime     TEXT,
  banner_bytes    TEXT,
  updated_at      BIGINT NOT NULL
);

-- ---------- panel chat DM (satu channel per server) ----------
CREATE TABLE IF NOT EXISTS panels (
  guild_id   TEXT PRIMARY KEY,
  channel_id TEXT,
  message_id TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);
`;
