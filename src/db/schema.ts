/**
 * Skema database disimpan sebagai string (bukan file .sql) supaya tetap
 * ikut ter-compile ke dist/ saat build — tanpa perlu copy asset.
 */
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id    TEXT PRIMARY KEY,
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
`;
