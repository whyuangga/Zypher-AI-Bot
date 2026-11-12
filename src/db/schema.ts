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
  -- Zona waktu server: 'Asia/Jakarta' (WIB), 'Asia/Makassar' (WITA),
  -- 'Asia/Jayapura' (WIT). NULL = WIB (perilaku lama).
  timezone       TEXT,
  tts_reply_in_room INTEGER,
  rag_enabled    INTEGER,
  auto_memory    INTEGER,
  admin_only_rooms INTEGER,
  -- Kuota disk container (MB) yang diisi admin. NULL = tidak diatur.
  -- cgroup tidak menyediakan kuota kapasitas, jadi angkanya harus dinyatakan.
  disk_quota_mb  INTEGER,
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
  card_text       INTEGER NOT NULL DEFAULT 1,
  embed_avatar    INTEGER NOT NULL DEFAULT 0,
  -- Baris penulis embed: avatar + nama member di ATAS teks embed.
  -- Beda dari embed_avatar yang memasang thumbnail kecil di kanan atas.
  embed_author    INTEGER NOT NULL DEFAULT 0,
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
  card_text       INTEGER NOT NULL DEFAULT 1,
  embed_avatar    INTEGER NOT NULL DEFAULT 0,
  -- Baris penulis embed: avatar + nama member di ATAS teks embed.
  -- Beda dari embed_avatar yang memasang thumbnail kecil di kanan atas.
  embed_author    INTEGER NOT NULL DEFAULT 0,
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

-- ---------- pesan container buatan admin (halaman /pesan) ----------
-- Menyimpan pesan bertema yang disusun dari dashboard: rules, ambil roles,
-- pengumuman, dsb. Kolom blocks berisi JSON daftar blok berurutan, message_id
-- menyimpan ID pesan yang sudah dikirim supaya bisa DIPERBARUI (bukan kirim
-- ulang) saat isinya diubah.
CREATE TABLE IF NOT EXISTS custom_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  channel_id TEXT,
  blocks     TEXT NOT NULL,
  message_id TEXT,
  accent     TEXT,
  sender     TEXT,
  layout     TEXT,
  updated_at INTEGER NOT NULL
);

-- ---------- tombol ambil role (tahap 3) ----------
-- Satu baris = satu tombol. Role disimpan di sini, BUKAN di dalam customId:
-- customId hanya membawa ID baris, jadi role bisa diganti tanpa mengirim ulang
-- pesan, dan customId tetap pendek (batas Discord 100 karakter).
CREATE TABLE IF NOT EXISTS post_role_buttons (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  post_id  INTEGER NOT NULL,
  role_id  TEXT NOT NULL,
  label    TEXT NOT NULL,
  mode     TEXT NOT NULL DEFAULT 'toggle',
  emoji    TEXT,
  style    TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

-- ---------- aksi komponen (versi ringkas flow Discohook) ----------
-- Satu baris = satu aksi pada satu komponen. Kolom target berisi tombol role
-- (button:n) atau opsi menu (option:n), jadi aksi tidak perlu kolom sendiri di
-- tabel tombol/opsi. Kolom payload berisi JSON aksi.
CREATE TABLE IF NOT EXISTS post_actions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL,
  post_id   INTEGER NOT NULL,
  target    TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  payload   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_actions_post ON post_actions (guild_id, post_id);

-- ---------- sesi flow yang sedang menunggu ----------
-- Satu baris = satu flow yang berhenti di aksi "Tunggu".
--
-- Kenapa disimpan di database, bukan di memori: bot bisa restart kapan saja,
-- dan penantian bisa sampai 7 hari. Tanpa tabel ini, semua penantian hilang
-- diam-diam saat deploy — admin sudah menjanjikan pengingat yang tidak pernah
-- datang.
--
-- payload menyimpan SISA langkah (JSON) supaya bentuk rencana aksi bisa
-- berubah tanpa migrasi kolom.
CREATE TABLE IF NOT EXISTS post_flow_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  post_id     INTEGER NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  server_name TEXT NOT NULL,
  variables   TEXT NOT NULL DEFAULT '{}',
  payload     TEXT NOT NULL,
  due_at      BIGINT NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_flow_due ON post_flow_sessions (due_at);

-- ---------- jadwal kirim pesan ----------
-- Satu baris = satu pesan yang dijadwalkan terkirim.
--
-- repeat_minutes = 0 berarti sekali kirim; lebih dari 0 diulang tiap sekian
-- menit. Batas bawah pengulangan 2 jam (120 menit) mengikuti Discohook: lebih
-- rapat dari itu, kanal dipenuhi pesan yang sama.
--
-- last_sent_at menyimpan waktu kirim terakhir supaya bot yang restart tidak
-- mengirim ulang pesan yang sudah terkirim, dan supaya jadwal berulang tidak
-- menumpuk saat bot lama mati.
CREATE TABLE IF NOT EXISTS post_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  post_id        INTEGER NOT NULL,
  channel_id     TEXT NOT NULL,
  due_at         BIGINT NOT NULL,
  repeat_minutes INTEGER NOT NULL DEFAULT 0,
  last_sent_at   BIGINT,
  created_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_schedules_due ON post_schedules (due_at);

-- ---------- webhook per channel (pesan atas nama server) ----------
-- Token menyimpan bagian RAHASIA dari URL webhook, dalam bentuk terenkripsi
-- (lihat src/features/webhook-secret.ts). Tidak pernah dikirim ke browser.
-- ---------- menu role (select menu) ----------
-- Satu baris = satu menu. Opsinya disimpan di post_role_options supaya
-- jumlah role per menu tidak terbatas kolom.
CREATE TABLE IF NOT EXISTS post_role_menus (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  post_id     INTEGER NOT NULL,
  placeholder TEXT NOT NULL,
  min_values  INTEGER NOT NULL DEFAULT 1,
  max_values  INTEGER NOT NULL DEFAULT 1,
  exclusive   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0
);

-- Satu baris = satu pilihan di dalam menu. role_id WAJIB: pilihan tanpa role
-- hanya akan menampilkan error saat diklik.
CREATE TABLE IF NOT EXISTS post_role_options (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  label   TEXT NOT NULL,
  emoji   TEXT,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_webhooks (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  token      TEXT NOT NULL,
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
  timezone          TEXT,
  tts_reply_in_room BOOLEAN,
  rag_enabled       BOOLEAN,
  auto_memory       BOOLEAN,
  admin_only_rooms  BOOLEAN,
  disk_quota_mb     INTEGER,
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
  card_text       INTEGER NOT NULL DEFAULT 1,
  embed_avatar    INTEGER NOT NULL DEFAULT 0,
  -- Baris penulis embed: avatar + nama member di ATAS teks embed.
  -- Beda dari embed_avatar yang memasang thumbnail kecil di kanan atas.
  embed_author    INTEGER NOT NULL DEFAULT 0,
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
  card_text       INTEGER NOT NULL DEFAULT 1,
  embed_avatar    INTEGER NOT NULL DEFAULT 0,
  -- Baris penulis embed: avatar + nama member di ATAS teks embed.
  -- Beda dari embed_avatar yang memasang thumbnail kecil di kanan atas.
  embed_author    INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS custom_posts (
  id         SERIAL PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  channel_id TEXT,
  blocks     TEXT NOT NULL,
  message_id TEXT,
  accent     TEXT,
  sender     TEXT,
  layout     TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_role_buttons (
  id       SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  post_id  INTEGER NOT NULL,
  role_id  TEXT NOT NULL,
  label    TEXT NOT NULL,
  mode     TEXT NOT NULL DEFAULT 'toggle',
  emoji    TEXT,
  style    TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_role_menus (
  id          SERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  post_id     INTEGER NOT NULL,
  placeholder TEXT NOT NULL,
  min_values  INTEGER NOT NULL DEFAULT 1,
  max_values  INTEGER NOT NULL DEFAULT 1,
  exclusive   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_role_options (
  id          SERIAL PRIMARY KEY,
  menu_id     INTEGER NOT NULL,
  role_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  emoji       TEXT,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_actions (
  id       SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  post_id  INTEGER NOT NULL,
  target   TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  payload  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_actions_post ON post_actions (guild_id, post_id);

-- Sesi flow yang menunggu (lihat versi SQLite untuk penjelasannya).
CREATE TABLE IF NOT EXISTS post_flow_sessions (
  id          SERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  post_id     INTEGER NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  server_name TEXT NOT NULL,
  variables   TEXT NOT NULL DEFAULT '{}',
  payload     TEXT NOT NULL,
  due_at      BIGINT NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_flow_due ON post_flow_sessions (due_at);

-- Jadwal kirim pesan (lihat versi SQLite untuk penjelasannya).
CREATE TABLE IF NOT EXISTS post_schedules (
  id             SERIAL PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  post_id        INTEGER NOT NULL,
  channel_id     TEXT NOT NULL,
  due_at         BIGINT NOT NULL,
  repeat_minutes INTEGER NOT NULL DEFAULT 0,
  last_sent_at   BIGINT,
  created_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_schedules_due ON post_schedules (due_at);

CREATE TABLE IF NOT EXISTS post_webhooks (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  token      TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

`;
