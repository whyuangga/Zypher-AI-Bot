import { randomBytes } from 'node:crypto';
import { all, get, insert, run } from './index.js';
import { errorMessage, logger } from '../lib/logger.js';
import { config } from '../config.js';
import { normalizeTimeZone } from '../lib/timezone.js';
import { parseBlocks, sanitizeBlocks, type PostBlock } from '../features/custom-post.js';
import { decryptSecret, encryptSecret } from '../features/webhook-secret.js';
import { sanitizeSeries, type SeriesMessage } from '../features/post-series.js';
import { sanitizeEmbedList, type EmbedExtra } from '../features/post-embed.js';
import { cronIntervalMinutes, nextCronTime, parseCron } from '../features/schedule-cron.js';
import { TIME_ZONES } from '../lib/timezone.js';
import {
  sanitizeRoleButtons,
  sanitizeRoleMenu,
  type RoleButtonInput,
  type RoleButtonMode,
  type RoleMenuInput,
} from '../features/role-buttons.js';
import {
  ACTION_LIMITS,
  sanitizeActions,
  type PostAction,
} from '../features/post-actions.js';
import {
  modeFromLegacySettings,
  normalizeDisplayMode,
  type DisplayMode,
} from '../features/display-mode.js';

/*
 * Semua fungsi di sini `async` karena database bisa berupa SQLite (sinkron)
 * atau Postgres (jaringan). SQL-nya sengaja ditulis dengan placeholder `?`
 * dan tanpa fungsi khusus SQLite, supaya satu kode jalan di dua engine.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GuildSettings {
  guildId: string;
  /** Nama server Discord, diisi bot saat login. `null` untuk database lama. */
  name: string | null;
  persona: string | null;
  model: string | null;
  /** Otomatis membalas jawaban chat dengan suara (TTS). `null` = memakai default `.env`. */
  ttsReplyInRoom: boolean | null;
  /** AI boleh jawab dari dokumen. `null` = memakai RAG_ENABLED dari .env. */
  ragEnabled: boolean | null;
  /** AI boleh ingat otomatis. `null` = memakai AUTO_MEMORY dari .env. */
  autoMemory: boolean | null;
  /** Hanya admin yang boleh memulai chat AI. `null` = memakai ADMIN_ONLY_ROOMS dari .env. */
  adminOnlyRooms: boolean | null;
  /**
   * Zona waktu server: `Asia/Jakarta` (WIB), `Asia/Makassar` (WITA), atau
   * `Asia/Jayapura` (WIT).
   *
   * `null` = memakai `TIMEZONE` dari .env; kalau itu juga kosong, WIB.
   */
  timezone: string | null;
  /**
   * Kuota disk container dalam MB, diisi admin. `null` = tidak diatur.
   *
   * cgroup tidak menyediakan kuota kapasitas disk, dan panel hosting tidak
   * mengekspornya ke dalam container — jadi angka ini harus dinyatakan, bukan
   * ditebak dari partisi mesin induk (dulu terbaca "353 GB dari 441 GB"
   * padahal jatah container 1 GB).
   */
  diskQuotaMb: number | null;
  createdAt: number;
}

/** Satu fakta jangka panjang tentang member. */
export interface Memory {
  id: number;
  guildId: string;
  userId: string;
  content: string;
  source: string;
  createdAt: number;
}

export interface Keyword {
  id: number;
  guildId: string;
  trigger: string;
  answer: string;
  createdBy: string | null;
  createdAt: number;
}

/**
 * Sesi chat DM milik member.
 *
 * Menggantikan konsep "room" (channel/thread) yang sudah dihapus: percakapan
 * berjalan di DM, `guildId` hanya menyimpan konteks server mana yang dipakai.
 */
export interface DmSession {
  userId: string;
  guildId: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

export interface DocumentRecord {
  id: number;
  guildId: string;
  name: string;
  source: string;
  chars: number;
  chunkCount: number;
  createdBy: string | null;
  createdAt: number;
}

export interface ChunkRecord {
  id: number;
  documentId: number;
  guildId: string;
  ordinal: number;
  content: string;
  embedding: string | null;
}

export interface ChunkWithDocument extends ChunkRecord {
  documentName: string;
}

export type ChatRole = 'user' | 'assistant';

export interface StoredMessage {
  id: number;
  channelId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/*  Row mappers                                                        */
/* ------------------------------------------------------------------ */

interface GuildRow {
  guild_id: string;
  name: string | null;
  persona: string | null;
  model: string | null;
  timezone: string | null;
  tts_reply_in_room: number | boolean | null;
  rag_enabled: number | boolean | null;
  auto_memory: number | boolean | null;
  admin_only_rooms: number | boolean | null;
  disk_quota_mb: number | null;
  created_at: number;
}
interface MemoryRow {
  id: number;
  guild_id: string;
  user_id: string;
  content: string;
  source: string;
  created_at: number;
}
interface KeywordRow {
  id: number;
  guild_id: string;
  trigger: string;
  answer: string;
  created_by: string | null;
  created_at: number;
}
interface DocumentRow {
  id: number;
  guild_id: string;
  name: string;
  source: string;
  chars: number;
  chunk_count: number;
  created_by: string | null;
  created_at: number;
}
interface ChunkRow {
  id: number;
  document_id: number;
  guild_id: string;
  ordinal: number;
  content: string;
  embedding: string | null;
}
interface MessageRow {
  id: number;
  channel_id: string;
  role: string;
  content: string;
  created_at: number;
}

const toGuild = (row: GuildRow): GuildSettings => ({
  guildId: row.guild_id,
  diskQuotaMb: row.disk_quota_mb ?? null,
  name: row.name ?? null,
  persona: row.persona,
  model: row.model,
  timezone: row.timezone ?? null,
  ttsReplyInRoom:
    row.tts_reply_in_room === null || row.tts_reply_in_room === undefined
      ? null
      : Boolean(row.tts_reply_in_room),
  ragEnabled:
    row.rag_enabled === null || row.rag_enabled === undefined ? null : Boolean(row.rag_enabled),
  autoMemory:
    row.auto_memory === null || row.auto_memory === undefined ? null : Boolean(row.auto_memory),
  adminOnlyRooms:
    row.admin_only_rooms === null || row.admin_only_rooms === undefined ? null : Boolean(row.admin_only_rooms),
  createdAt: Number(row.created_at),
});

const toMemory = (row: MemoryRow): Memory => ({
  id: Number(row.id),
  guildId: row.guild_id,
  userId: row.user_id,
  content: row.content,
  source: row.source,
  createdAt: Number(row.created_at),
});

const toKeyword = (row: KeywordRow): Keyword => ({
  id: Number(row.id),
  guildId: row.guild_id,
  trigger: row.trigger,
  answer: row.answer,
  createdBy: row.created_by,
  createdAt: Number(row.created_at),
});

const toDocument = (row: DocumentRow): DocumentRecord => ({
  id: Number(row.id),
  guildId: row.guild_id,
  name: row.name,
  source: row.source,
  chars: Number(row.chars),
  chunkCount: Number(row.chunk_count),
  createdBy: row.created_by,
  createdAt: Number(row.created_at),
});

const toChunk = (row: ChunkRow): ChunkRecord => ({
  id: Number(row.id),
  documentId: Number(row.document_id),
  guildId: row.guild_id,
  ordinal: Number(row.ordinal),
  content: row.content,
  embedding: row.embedding,
});

const toMessage = (row: MessageRow): StoredMessage => ({
  id: Number(row.id),
  channelId: row.channel_id,
  role: row.role === 'assistant' ? 'assistant' : 'user',
  content: row.content,
  createdAt: Number(row.created_at),
});

/* ------------------------------------------------------------------ */
/*  Guild settings                                                     */
/* ------------------------------------------------------------------ */

export async function ensureGuild(guildId: string): Promise<void> {
  await run('INSERT INTO guilds (guild_id, created_at) VALUES (?, ?) ON CONFLICT (guild_id) DO NOTHING', [
    guildId,
    Date.now(),
  ]);
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  const row = await get<GuildRow>('SELECT * FROM guilds WHERE guild_id = ?', [guildId]);
  return row ? toGuild(row) : null;
}

export async function setPersona(guildId: string, persona: string | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET persona = ? WHERE guild_id = ?', [persona, guildId]);
}

export async function setGuildModel(guildId: string, model: string | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET model = ? WHERE guild_id = ?', [model, guildId]);
}

/**
 * Simpan zona waktu server (WIB/WITA/WIT).
 *
 * Nilai dinormalisasi di sini, bukan hanya di UI: endpoint JSON bisa dipanggil
 * langsung, dan satu nilai ngawur di DB akan membuat semua jam meleset tanpa
 * error. `null` dikembalikan sebagai "ikuti default .env".
 */
export async function setGuildTimeZone(guildId: string, timeZone: string | null): Promise<void> {
  await ensureGuild(guildId);
  const clean = timeZone === null ? null : normalizeTimeZone(timeZone);
  await run('UPDATE guilds SET timezone = ? WHERE guild_id = ?', [clean, guildId]);
}

/**
 * Simpan kuota disk container (MB). `null` = tidak diatur.
 *
 * Divalidasi di sini juga, bukan hanya di UI: endpoint JSON bisa dipanggil
 * langsung, dan angka ngawur (negatif / terlalu besar) akan membuat bar disk
 * menampilkan persentase yang tidak masuk akal.
 */
export async function setGuildDiskQuota(guildId: string, megabytes: number | null): Promise<void> {
  await ensureGuild(guildId);
  const clean =
    megabytes === null || !Number.isFinite(megabytes) || megabytes <= 0
      ? null
      : Math.min(Math.round(megabytes), 10_485_760);
  await run('UPDATE guilds SET disk_quota_mb = ? WHERE guild_id = ?', [clean, guildId]);
}

/**
 * Zona waktu yang **benar-benar dipakai** untuk server ini.
 *
 * Urutan: kolom `guilds.timezone` → `TIMEZONE` dari .env → WIB. Semua pemanggil
 * (prompt, jam tenang, dashboard) harus lewat fungsi ini supaya tidak ada
 * tempat yang masih memakai WIB saat server disetel WITA.
 */
export async function resolveTimeZone(guildId: string | null | undefined): Promise<string> {
  if (guildId) {
    const row = await get<{ timezone: string | null }>('SELECT timezone FROM guilds WHERE guild_id = ?', [guildId]);
    if (row?.timezone) return normalizeTimeZone(row.timezone);
  }
  return normalizeTimeZone(config.features.timeZone);
}

/**
 * Simpan toggle "suara pada balasan AI" per server.
 * `null` = pakai default dari .env (TTS_REPLY_IN_ROOM).
 */
export async function setGuildTtsReplyInRoom(guildId: string, enabled: boolean | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET tts_reply_in_room = ? WHERE guild_id = ?', [enabled === null ? null : enabled ? 1 : 0, guildId]);
}

/** AI boleh jawab dari dokumen. `null` = pakai RAG_ENABLED dari .env. */
export async function setGuildRagEnabled(guildId: string, enabled: boolean | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET rag_enabled = ? WHERE guild_id = ?', [enabled === null ? null : enabled ? 1 : 0, guildId]);
}

/** AI boleh ingat otomatis. `null` = pakai AUTO_MEMORY dari .env. */
export async function setGuildAutoMemory(guildId: string, enabled: boolean | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET auto_memory = ? WHERE guild_id = ?', [enabled === null ? null : enabled ? 1 : 0, guildId]);
}

/** Hanya admin yang boleh memulai chat AI. `null` = pakai ADMIN_ONLY_ROOMS dari .env. */
export async function setGuildAdminOnlyRooms(guildId: string, enabled: boolean | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET admin_only_rooms = ? WHERE guild_id = ?', [enabled === null ? null : enabled ? 1 : 0, guildId]);
}

/**
 * Simpan nama server Discord.
 *
 * Dashboard memakai nama ini supaya dropdown tidak menampilkan deretan angka.
 * Dipanggil bot saat login, saat masuk server baru, dan saat server di-rename.
 */
export async function setGuildName(guildId: string, name: string | null): Promise<void> {
  await ensureGuild(guildId);
  const clean = name?.trim().slice(0, 100) || null;
  await run('UPDATE guilds SET name = ? WHERE guild_id = ?', [clean, guildId]);
}

/* ------------------------------------------------------------------ */
/*  Memory                                                             */
/* ------------------------------------------------------------------ */

export async function addMemory(
  guildId: string,
  userId: string,
  content: string,
  source: 'manual' | 'auto' = 'manual',
): Promise<{ inserted: boolean; id: number | null }> {
  const cleaned = content.trim();
  if (!cleaned) return { inserted: false, id: null };

  const existing = await get<{ id: number }>(
    'SELECT id FROM memories WHERE guild_id = ? AND user_id = ? AND content = ?',
    [guildId, userId, cleaned],
  );
  if (existing) return { inserted: false, id: Number(existing.id) };

  const id = await insert(
    'INSERT INTO memories (guild_id, user_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, cleaned, source, Date.now()],
  );

  return { inserted: true, id };
}

export async function listMemories(guildId: string, userId: string, limit = 50): Promise<Memory[]> {
  const rows = await all<MemoryRow>(
    'SELECT * FROM memories WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?',
    [guildId, userId, limit],
  );
  return rows.map(toMemory);
}

export async function deleteMemory(guildId: string, userId: string, id: number): Promise<boolean> {
  const info = await run('DELETE FROM memories WHERE guild_id = ? AND user_id = ? AND id = ?', [guildId, userId, id]);
  return info.changes > 0;
}

export async function clearMemories(guildId: string, userId: string): Promise<number> {
  const info = await run('DELETE FROM memories WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return info.changes;
}

/* ------------------------------------------------------------------ */
/*  Keywords                                                           */
/* ------------------------------------------------------------------ */

export async function addKeyword(
  guildId: string,
  trigger: string,
  answer: string,
  createdBy: string | null,
): Promise<{ ok: boolean; id?: number; reason?: 'duplicate' }> {
  const cleanTrigger = trigger.trim().toLowerCase();
  const cleanAnswer = answer.trim();
  if (!cleanTrigger || !cleanAnswer) return { ok: false };

  const existing = await get<{ id: number }>('SELECT id FROM keywords WHERE guild_id = ? AND trigger = ?', [
    guildId,
    cleanTrigger,
  ]);
  if (existing) return { ok: false, reason: 'duplicate' };

  const id = await insert(
    'INSERT INTO keywords (guild_id, trigger, answer, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    [guildId, cleanTrigger, cleanAnswer, createdBy ?? null, Date.now()],
  );

  return { ok: true, id };
}

export async function listKeywords(guildId: string, limit = 100): Promise<Keyword[]> {
  const rows = await all<KeywordRow>('SELECT * FROM keywords WHERE guild_id = ? ORDER BY id DESC LIMIT ?', [
    guildId,
    limit,
  ]);
  return rows.map(toKeyword);
}

export async function deleteKeyword(guildId: string, id: number): Promise<boolean> {
  const info = await run('DELETE FROM keywords WHERE guild_id = ? AND id = ?', [guildId, id]);
  return info.changes > 0;
}

/* ------------------------------------------------------------------ */
/*  Sesi chat DM                                                       */
/* ------------------------------------------------------------------ */

interface DmSessionRow {
  user_id: string;
  guild_id: string;
  created_at: number;
  last_active_at: number;
  message_count: number;
}

const toDmSession = (row: DmSessionRow): DmSession => ({
  userId: row.user_id,
  guildId: row.guild_id,
  createdAt: Number(row.created_at),
  lastActiveAt: Number(row.last_active_at),
  messageCount: Number(row.message_count),
});

/**
 * Simpan sesi DM member. Kalau sudah ada, perbarui server konteksnya.
 *
 * `ensureGuild` dipanggil supaya server baru tetap muncul di dropdown dashboard
 * walau belum pernah punya dokumen atau keyword.
 */
export async function setDmSession(userId: string, guildId: string, _ignored?: string): Promise<void> {
  const now = Date.now();
  await ensureGuild(guildId);
  await run(
    `INSERT INTO dm_sessions (user_id, guild_id, created_at, last_active_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET guild_id = excluded.guild_id, last_active_at = excluded.last_active_at`,
    [userId, guildId, now, now],
  );
}

export async function getDmSession(userId: string): Promise<DmSession | null> {
  const row = await get<DmSessionRow>('SELECT * FROM dm_sessions WHERE user_id = ?', [userId]);
  return row ? toDmSession(row) : null;
}

export async function listDmSessions(guildId: string): Promise<DmSession[]> {
  const rows = await all<DmSessionRow>(
    'SELECT * FROM dm_sessions WHERE guild_id = ? ORDER BY last_active_at DESC',
    [guildId],
  );
  return rows.map(toDmSession);
}

export async function touchDmSession(userId: string, messagesAdded = 2): Promise<void> {
  await run('UPDATE dm_sessions SET last_active_at = ?, message_count = message_count + ? WHERE user_id = ?', [
    Date.now(),
    messagesAdded,
    userId,
  ]);
}

export async function deleteDmSession(userId: string): Promise<void> {
  await run('DELETE FROM dm_sessions WHERE user_id = ?', [userId]);
}

/* ------------------------------------------------------------------ */
/*  Conversation history                                               */
/* ------------------------------------------------------------------ */

export async function appendMessage(channelId: string, role: ChatRole, content: string): Promise<void> {
  await run('INSERT INTO messages (channel_id, role, content, created_at) VALUES (?, ?, ?, ?)', [
    channelId,
    role,
    content,
    Date.now(),
  ]);
}

/** Ambil N pesan terakhir, dikembalikan urut lama -> baru. */
export async function getHistory(channelId: string, limit: number): Promise<StoredMessage[]> {
  if (limit <= 0) return [];
  const rows = await all<MessageRow>(
    'SELECT sub.* FROM (SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?) sub ORDER BY sub.id ASC',
    [channelId, limit],
  );
  return rows.map(toMessage);
}

export async function clearHistory(channelId: string): Promise<number> {
  const info = await run('DELETE FROM messages WHERE channel_id = ?', [channelId]);
  return info.changes;
}

export async function countHistory(channelId: string): Promise<number> {
  const row = await get<{ total: number }>('SELECT COUNT(*) AS total FROM messages WHERE channel_id = ?', [channelId]);
  return Number(row?.total ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Dokumen (RAG)                                                      */
/* ------------------------------------------------------------------ */

export async function insertDocument(input: {
  guildId: string;
  name: string;
  source?: string;
  chars: number;
  createdBy?: string | null;
}): Promise<number> {
  return insert(
    `INSERT INTO documents (guild_id, name, source, chars, chunk_count, created_by, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [input.guildId, input.name, input.source ?? 'upload', input.chars, input.createdBy ?? null, Date.now()],
  );
}

export async function insertChunks(
  documentId: number,
  guildId: string,
  chunks: Array<{ content: string; embedding?: number[] | null }>,
): Promise<void> {
  for (const [index, chunk] of chunks.entries()) {
    await run('INSERT INTO chunks (document_id, guild_id, ordinal, content, embedding) VALUES (?, ?, ?, ?, ?)', [
      documentId,
      guildId,
      index,
      chunk.content,
      chunk.embedding && chunk.embedding.length > 0 ? JSON.stringify(chunk.embedding) : null,
    ]);
  }

  await run('UPDATE documents SET chunk_count = ? WHERE id = ?', [chunks.length, documentId]);
}

export async function listDocuments(guildId: string): Promise<DocumentRecord[]> {
  // LEFT JOIN + GROUP BY (bukan subquery berkorelasi) supaya SQL-nya sama-sama
  // didukung SQLite dan Postgres.
  const rows = await all<DocumentRow>(
    `SELECT d.id, d.guild_id, d.name, d.source, d.chars, d.created_by, d.created_at,
            COUNT(c.id) AS chunk_count
     FROM documents d
     LEFT JOIN chunks c ON c.document_id = d.id
     WHERE d.guild_id = ?
     GROUP BY d.id, d.guild_id, d.name, d.source, d.chars, d.created_by, d.created_at
     ORDER BY d.id DESC`,
    [guildId],
  );
  return rows.map(toDocument);
}

export async function getDocument(guildId: string, id: number): Promise<DocumentRecord | null> {
  const row = await get<DocumentRow>('SELECT * FROM documents WHERE guild_id = ? AND id = ?', [guildId, id]);
  return row ? toDocument(row) : null;
}

export async function findDocumentByName(guildId: string, name: string): Promise<DocumentRecord | null> {
  const row = await get<DocumentRow>('SELECT * FROM documents WHERE guild_id = ? AND lower(name) = lower(?)', [
    guildId,
    name.trim(),
  ]);
  return row ? toDocument(row) : null;
}

export async function deleteDocument(guildId: string, id: number): Promise<boolean> {
  // Hapus potongan lebih dulu supaya tetap aman walau foreign_keys dimatikan.
  await run('DELETE FROM chunks WHERE guild_id = ? AND document_id = ?', [guildId, id]);
  const info = await run('DELETE FROM documents WHERE guild_id = ? AND id = ?', [guildId, id]);
  return info.changes > 0;
}

/** Semua potongan satu server, lengkap dengan nama dokumennya (untuk indeks pencarian). */
export async function listChunks(guildId: string, limit = 5000): Promise<ChunkWithDocument[]> {
  const rows = await all<ChunkRow & { document_name: string }>(
    `SELECT c.*, d.name AS document_name
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.guild_id = ? ORDER BY c.document_id DESC, c.ordinal ASC LIMIT ?`,
    [guildId, limit],
  );

  return rows.map((row) => ({ ...toChunk(row), documentName: row.document_name }));
}

export async function countChunks(guildId: string): Promise<number> {
  const row = await get<{ total: number }>('SELECT COUNT(*) AS total FROM chunks WHERE guild_id = ?', [guildId]);
  return Number(row?.total ?? 0);
}

/**
 * Daftar server untuk dropdown dashboard.
 *
 * Sumbernya bukan hanya tabel `guilds`: database lama (atau bot yang baru saja
 * dipasang) bisa sudah punya room/dokumen/keyword/memori tanpa baris `guilds`.
 * Kalau kita hanya membaca `guilds`, dashboard menampilkan "(belum ada server)"
 * padahal data bot jelas ada. UNION membuat data itu tetap muncul.
 */
/**
 * Nama tampilan server (bila bot sudah pernah melihatnya).
 *
 * Dashboard hanya mengelola satu server, jadi tidak perlu lagi daftar server —
 * cukup satu nama untuk ditampilkan di topbar.
 */
export async function getGuildName(guildId: string): Promise<string | null> {
  const row = await get<{ name: string | null }>('SELECT name FROM guilds WHERE guild_id = ?', [guildId]);
  return row?.name?.trim() || null;
}

/* ------------------------------------------------------------------ */
/*  AI Agent (nimbrung di channel) & sambutan member                   */
/* ------------------------------------------------------------------ */

/** Pengaturan AI Agent. `channelId` null = fitur mati. */
export interface AgentSettings {
  guildId: string;
  /** Channel ngobrol utama. null = fitur agent mati. */
  channelId: string | null;
  /** Channel galeri: bot hanya mengomentari gambar/video + memberi reaksi. */
  galleryChannelId: string | null;
  /** Dianggap "sepi" setelah sekian menit tanpa pesan. 0 = jangan menyapa sendiri. */
  quietMinutes: number;
  /** Batas balasan AI per jam — pengaman biaya API. */
  maxPerHour: number;
  /** Ikut menanggapi emoji & sticker. */
  reactEmoji: boolean;
  /** Ikut menanggapi gambar di channel. */
  reactImages: boolean;
  /** Diam saat obrolan sedang ramai (bot tidak menyela). */
  busyMute: boolean;
  /** Jeda minimum antar balasan, supaya bot tidak mendominasi. */
  cooldownSeconds: number;
  /**
   * Tahan sapaan otomatis malam hari (23:00–06:00 WIB).
   *
   * Balasan ke mention/reply tetap jalan — yang ditahan hanya sapaan
   * "pemecah sepi", karena menyapa channel kosong jam 3 pagi tidak ada
   * gunanya dan mengganggu notifikasi.
   */
  quietHours: boolean;
  updatedAt: number;
}

export const AGENT_DEFAULTS = {
  quietMinutes: 45,
  maxPerHour: 6,
  reactEmoji: true,
  reactImages: true,
  busyMute: true,
  cooldownSeconds: 90,
  quietHours: true,
} as const;

interface AgentRow {
  guild_id: string;
  channel_id: string | null;
  gallery_channel_id: string | null;
  quiet_minutes: number;
  max_per_hour: number;
  react_emoji: number | boolean;
  react_images: number | boolean;
  busy_mute: number | boolean;
  cooldown_seconds: number;
  quiet_hours: number | boolean | null;
  updated_at: number;
}

/** Pengaturan agent (default kalau server belum pernah menyimpan). */
export async function getAgentSettings(guildId: string): Promise<AgentSettings> {
  const row = await get<AgentRow>('SELECT * FROM agent WHERE guild_id = ?', [guildId]);
  if (!row) {
    return {
      guildId,
      channelId: null,
      galleryChannelId: null,
      ...AGENT_DEFAULTS,
      updatedAt: 0,
    };
  }

  return {
    guildId: row.guild_id,
    channelId: row.channel_id?.trim() || null,
    galleryChannelId: row.gallery_channel_id?.trim() || null,
    quietMinutes: Number(row.quiet_minutes),
    maxPerHour: Number(row.max_per_hour),
    reactEmoji: Boolean(row.react_emoji),
    reactImages: Boolean(row.react_images),
    busyMute: Boolean(row.busy_mute),
    cooldownSeconds: Number(row.cooldown_seconds),
    // NULL = database lama sebelum kolom ini ada; anggap mati supaya
    // pembaruan tidak diam-diam mengubah perilaku server yang sudah jalan.
    quietHours: row.quiet_hours === null ? false : Boolean(row.quiet_hours),
    updatedAt: Number(row.updated_at),
  };
}

export async function saveAgentSettings(
  guildId: string,
  patch: Partial<Omit<AgentSettings, 'guildId' | 'updatedAt'>>,
): Promise<void> {
  const current = await getAgentSettings(guildId);
  const next = { ...current, ...patch };
  await run(
    `INSERT INTO agent (guild_id, channel_id, gallery_channel_id, quiet_minutes, max_per_hour, react_emoji, react_images, busy_mute, cooldown_seconds, quiet_hours, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       gallery_channel_id = excluded.gallery_channel_id,
       quiet_minutes = excluded.quiet_minutes,
       max_per_hour = excluded.max_per_hour,
       react_emoji = excluded.react_emoji,
       react_images = excluded.react_images,
       busy_mute = excluded.busy_mute,
       cooldown_seconds = excluded.cooldown_seconds,
       quiet_hours = excluded.quiet_hours,
       updated_at = excluded.updated_at`,
    [
      guildId,
      next.channelId,
      next.galleryChannelId,
      next.quietMinutes,
      next.maxPerHour,
      next.reactEmoji ? 1 : 0,
      next.reactImages ? 1 : 0,
      next.busyMute ? 1 : 0,
      next.cooldownSeconds,
      next.quietHours ? 1 : 0,
      Date.now(),
    ],
  );
}

/** Sudah pernah ditanggapi? Dipakai supaya satu pesan tidak dibalas dua kali. */
export async function hasAgentReaction(messageId: string): Promise<boolean> {
  const row = await get<{ message_id: string }>('SELECT message_id FROM agent_reactions WHERE message_id = ?', [
    messageId,
  ]);
  return Boolean(row);
}

export async function markAgentReaction(messageId: string): Promise<void> {
  await run(
    'INSERT INTO agent_reactions (message_id, created_at) VALUES (?, ?) ON CONFLICT (message_id) DO NOTHING',
    [messageId, Date.now()],
  );
}

/** Buang catatan reaksi lama supaya tabelnya tidak tumbuh tanpa batas. */
export async function pruneAgentReactions(olderThanMs: number): Promise<void> {
  await run('DELETE FROM agent_reactions WHERE created_at < ?', [Date.now() - olderThanMs]);
}

/** Pengaturan sambutan member baru. `enabled` false = tidak mengirim apa pun. */
export interface WelcomeSettings {
  guildId: string;
  /** null = kirim lewat DM (default, aman untuk privasi). */
  channelId: string | null;
  enabled: boolean;
  /** Kalau false, pakai `template` apa adanya tanpa memanggil AI. */
  useAi: boolean;
  template: string | null;
  /**
   * Bentuk pesan: `card`, `embed`, atau `text`.
   *
   * Ini pengganti cara pandang lama `imageEnabled`. Keduanya tetap disimpan
   * supaya dashboard dan kode lama tetap jalan; `displayMode` yang menentukan.
   */
  displayMode: DisplayMode;
  /** Kartu sambutan PNG (nama + avatar) — dipakai mode `card`. */
  imageEnabled: boolean;
  /** Gaya sapaan, mis. "hangat dan santai". */
  style: string | null;
  /** Contoh kalimat yang ditiru nada bicaranya. */
  example: string | null;
  includeAvatar: boolean;
  /**
   * Tampilkan avatar member di dalam gambar kartu.
   *
   * Terpisah dari `includeAvatar` (yang juga dipakai embed) supaya admin bisa
   * mengatur dua tampilan itu sendiri-sendiri: kartu PNG dan embed punya
   * bentuk yang sangat berbeda, jadi satu sakelar untuk dua-duanya menyulitkan.
   */
  cardAvatar: boolean;
  /** Tampilkan teks di dalam kartu (nama server + jumlah member). */
  cardText: boolean;
  /** Tampilkan avatar member di dalam embed (mode `embed`). */
  embedAvatar: boolean;
  /**
   * Pasang baris penulis embed: avatar + nama member di ATAS teks embed.
   *
   * Beda dari `embedAvatar` yang menaruh thumbnail kecil di kanan atas. Yang
   * ini meniru bentuk bot besar: avatar bulat + nama tebal di baris pertama,
   * lalu teks sapaan di bawahnya. Keduanya bisa dinyalakan bersamaan.
   */
  embedAuthor: boolean;
  /** Nama file banner di data/banners (null = pakai latar bawaan). */
  bannerPath: string | null;
  /**
   * Salinan banner di database (base64). Dipakai untuk memulihkan file yang
   * hilang — hosting panel sering me-reset folder kerja saat deploy.
   * `null` = server ini belum pernah mengunggah banner, atau unggahan lama
   * (sebelum kolom ini ada).
   */
  bannerData: { mime: string; base64: string } | null;
  updatedAt: number;
}

interface WelcomeRow {
  guild_id: string;
  channel_id: string | null;
  enabled: number | boolean;
  use_ai: number | boolean;
  template: string | null;
  display_mode: string | null;
  image_enabled: number | boolean;
  style: string | null;
  example: string | null;
  include_avatar: number | boolean;
  /** NULL pada baris lama = aktif (lihat migrasi di db/index.ts). */
  card_text: number | boolean | null;
  /** NULL pada baris lama = mati. */
  embed_avatar: number | boolean | null;
  /** NULL pada baris lama = mati (lihat migrasi di db/index.ts). */
  embed_author: number | boolean | null;
  banner_path: string | null;
  banner_mime: string | null;
  banner_bytes: string | null;
  updated_at: number;
}

export const WELCOME_DEFAULTS = {
  channelId: null,
  enabled: false,
  useAi: true,
  template: null,
  displayMode: 'embed' as const,
  imageEnabled: true,
  style: null,
  example: null,
  includeAvatar: true,
  cardAvatar: true,
  cardText: true,
  // Embed lama tidak pernah punya avatar; menyalakannya otomatis akan
  // mengubah tampilan server yang sudah berjalan.
  embedAvatar: false,
  embedAuthor: false,
  bannerPath: null,
  bannerData: null,
} as const;

export async function getWelcomeSettings(guildId: string): Promise<WelcomeSettings> {
  const row = await get<WelcomeRow>('SELECT * FROM welcome WHERE guild_id = ?', [guildId]);
  if (!row) {
    return { guildId, ...WELCOME_DEFAULTS, updatedAt: 0 };
  }

  return {
    guildId: row.guild_id,
    channelId: row.channel_id?.trim() || null,
    enabled: Boolean(row.enabled),
    useAi: Boolean(row.use_ai),
    template: row.template,
    // Baris lama belum punya `display_mode`. Kalau kosong, terjemahkan dari
    // `image_enabled` supaya tampilan server lama tidak berubah diam-diam.
    displayMode: row.display_mode
      ? normalizeDisplayMode(row.display_mode)
      : modeFromLegacySettings(Boolean(row.image_enabled)),
    imageEnabled: Boolean(row.image_enabled),
    style: row.style,
    example: row.example,
    includeAvatar: Boolean(row.include_avatar),
    // undefined/NULL = baris lama: teks kartu aktif, avatar embed mati.
    cardAvatar: row.include_avatar === null || row.include_avatar === undefined
      ? true
      : Boolean(row.include_avatar),
    cardText: row.card_text === null || row.card_text === undefined ? true : Boolean(row.card_text),
    embedAvatar: Boolean(row.embed_avatar),
    embedAuthor: Boolean(row.embed_author),
    bannerPath: row.banner_path ?? null,
    bannerData:
      row.banner_mime && row.banner_bytes
        ? { mime: row.banner_mime, base64: row.banner_bytes }
        : null,
    updatedAt: Number(row.updated_at),
  };
}

export async function saveWelcomeSettings(
  guildId: string,
  patch: Partial<Omit<WelcomeSettings, 'guildId' | 'updatedAt'>>,
): Promise<void> {
  const current = await getWelcomeSettings(guildId);
  const next = { ...current, ...patch };
  await run(
    `INSERT INTO welcome (guild_id, channel_id, enabled, use_ai, template, display_mode, image_enabled, style, example, include_avatar, card_text, embed_avatar, embed_author, banner_path, banner_mime, banner_bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       enabled = excluded.enabled,
       use_ai = excluded.use_ai,
       template = excluded.template,
       display_mode = excluded.display_mode,
       image_enabled = excluded.image_enabled,
       style = excluded.style,
       example = excluded.example,
       include_avatar = excluded.include_avatar,
       card_text = excluded.card_text,
       embed_avatar = excluded.embed_avatar,
       embed_author = excluded.embed_author,
       banner_path = excluded.banner_path,
       banner_mime = excluded.banner_mime,
       banner_bytes = excluded.banner_bytes,
       updated_at = excluded.updated_at`,
    [
      guildId,
      next.channelId,
      next.enabled ? 1 : 0,
      next.useAi ? 1 : 0,
      next.template,
      normalizeDisplayMode(next.displayMode),
      next.imageEnabled ? 1 : 0,
      next.style,
      next.example,
      next.includeAvatar ? 1 : 0,
      next.cardText ? 1 : 0,
      next.embedAvatar ? 1 : 0,
      next.embedAuthor ? 1 : 0,
      next.bannerPath,
      next.bannerData?.mime ?? null,
      next.bannerData?.base64 ?? null,
      Date.now(),
    ],
  );
}

/** Pengaturan salam perpisahan. `enabled` false = tidak mengirim apa pun. */
export interface GoodbyeSettings {
  guildId: string;
  /** null = kirim ke channel default (member sudah keluar, DM tidak mungkin). */
  channelId: string | null;
  enabled: boolean;
  useAi: boolean;
  template: string | null;
  style: string | null;
  example: string | null;
  /** Bentuk pesan: `card`, `embed`, atau `text`. Lihat `WelcomeSettings`. */
  displayMode: DisplayMode;
  /** Kartu perpisahan PNG (opsional) — dipakai mode `card`. */
  imageEnabled: boolean;
  includeAvatar: boolean;
  /** Tampilkan avatar member di dalam gambar kartu — lihat `WelcomeSettings`. */
  cardAvatar: boolean;
  /** Tampilkan teks di dalam kartu (nama server + kalimat penutup). */
  cardText: boolean;
  /** Tampilkan avatar member di dalam embed. */
  embedAvatar: boolean;
  /** Baris penulis embed (avatar + nama member di atas teks) — lihat `WelcomeSettings`. */
  embedAuthor: boolean;
  /** Nama file banner di data/banners (null = pakai latar bawaan). */
  bannerPath: string | null;
  /** Salinan banner di database — lihat catatan di `WelcomeSettings`. */
  bannerData: { mime: string; base64: string } | null;
  updatedAt: number;
}

interface GoodbyeRow {
  guild_id: string;
  channel_id: string | null;
  enabled: number | boolean;
  use_ai: number | boolean;
  template: string | null;
  display_mode: string | null;
  style: string | null;
  example: string | null;
  image_enabled: number | boolean;
  include_avatar: number | boolean;
  /** NULL pada baris lama = aktif (lihat migrasi di db/index.ts). */
  card_text: number | boolean | null;
  /** NULL pada baris lama = mati. */
  embed_avatar: number | boolean | null;
  /** NULL pada baris lama = mati (lihat migrasi di db/index.ts). */
  embed_author: number | boolean | null;
  banner_path: string | null;
  banner_mime: string | null;
  banner_bytes: string | null;
  updated_at: number;
}

export const GOODBYE_DEFAULTS = {
  channelId: null,
  enabled: false,
  useAi: true,
  template: null,
  displayMode: 'embed' as const,
  style: null,
  example: null,
  imageEnabled: false,
  includeAvatar: true,
  cardAvatar: true,
  cardText: true,
  embedAvatar: false,
  embedAuthor: false,
  bannerPath: null,
  bannerData: null,
} as const;

export async function getGoodbyeSettings(guildId: string): Promise<GoodbyeSettings> {
  const row = await get<GoodbyeRow>('SELECT * FROM goodbye WHERE guild_id = ?', [guildId]);
  if (!row) return { guildId, ...GOODBYE_DEFAULTS, updatedAt: 0 };

  return {
    guildId: row.guild_id,
    channelId: row.channel_id?.trim() || null,
    enabled: Boolean(row.enabled),
    useAi: Boolean(row.use_ai),
    template: row.template,
    displayMode: row.display_mode
      ? normalizeDisplayMode(row.display_mode)
      : modeFromLegacySettings(Boolean(row.image_enabled)),
    style: row.style,
    example: row.example,
    imageEnabled: Boolean(row.image_enabled),
    includeAvatar: Boolean(row.include_avatar),
    cardAvatar: row.include_avatar === null || row.include_avatar === undefined
      ? true
      : Boolean(row.include_avatar),
    cardText: row.card_text === null || row.card_text === undefined ? true : Boolean(row.card_text),
    embedAvatar: Boolean(row.embed_avatar),
    embedAuthor: Boolean(row.embed_author),
    bannerPath: row.banner_path ?? null,
    bannerData:
      row.banner_mime && row.banner_bytes
        ? { mime: row.banner_mime, base64: row.banner_bytes }
        : null,
    updatedAt: Number(row.updated_at),
  };
}

export async function saveGoodbyeSettings(
  guildId: string,
  patch: Partial<Omit<GoodbyeSettings, 'guildId' | 'updatedAt'>>,
): Promise<void> {
  const current = await getGoodbyeSettings(guildId);
  const next = { ...current, ...patch };
  await run(
    `INSERT INTO goodbye (guild_id, channel_id, enabled, use_ai, template, display_mode, style, example, image_enabled, include_avatar, card_text, embed_avatar, embed_author, banner_path, banner_mime, banner_bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       enabled = excluded.enabled,
       use_ai = excluded.use_ai,
       template = excluded.template,
       display_mode = excluded.display_mode,
       style = excluded.style,
       example = excluded.example,
       image_enabled = excluded.image_enabled,
       include_avatar = excluded.include_avatar,
       card_text = excluded.card_text,
       embed_avatar = excluded.embed_avatar,
       embed_author = excluded.embed_author,
       banner_path = excluded.banner_path,
       banner_mime = excluded.banner_mime,
       banner_bytes = excluded.banner_bytes,
       updated_at = excluded.updated_at`,
    [
      guildId,
      next.channelId,
      next.enabled ? 1 : 0,
      next.useAi ? 1 : 0,
      next.template,
      normalizeDisplayMode(next.displayMode),
      next.style,
      next.example,
      next.imageEnabled ? 1 : 0,
      next.includeAvatar ? 1 : 0,
      next.cardText ? 1 : 0,
      next.embedAvatar ? 1 : 0,
      next.embedAuthor ? 1 : 0,
      next.bannerPath,
      next.bannerData?.mime ?? null,
      next.bannerData?.base64 ?? null,
      Date.now(),
    ],
  );
}

export async function countRows(
  table: 'memories' | 'keywords' | 'dm_sessions' | 'messages' | 'documents' | 'chunks',
): Promise<number> {
  const row = await get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
  return Number(row?.total ?? 0);
}

/** Jumlah baris milik satu server — dipakai dashboard agar angka cocok dengan daftar di bawahnya. */
export async function countGuildRows(
  guildId: string,
  table: 'memories' | 'keywords' | 'dm_sessions' | 'documents' | 'chunks',
): Promise<number> {
  const row = await get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE guild_id = ?`, [guildId]);
  return Number(row?.total ?? 0);
}

/**
 * Tabel `messages` tidak menyimpan `guild_id` — hitung lewat sesi DM yang
 * memakai server itu sebagai konteks.
 *
 * Catatan privasi: angka ini hanya jumlah pesan, bukan isinya. Isi percakapan
 * DM member tidak pernah dibaca dashboard.
 */
export async function countGuildMessages(guildId: string): Promise<number> {
  const row = await get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM messages m
     JOIN dm_sessions d ON m.channel_id = 'dm:' || d.user_id
     WHERE d.guild_id = ?`,
    [guildId],
  );
  return Number(row?.total ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Statistik dashboard                                                */
/* ------------------------------------------------------------------ */

/**
 * Jumlah pesan per hari (zona waktu WIB) selama `days` hari terakhir.
 * Dipakai grafik aktivitas di dashboard.
 *
 * Pengelompokan tanggal dilakukan di JS (bukan fungsi tanggal SQL) supaya
 * hasilnya sama di SQLite maupun Postgres.
 */
export async function messagesPerDay(
  guildId: string,
  days = 7,
  timeZone = 'Asia/Jakarta',
): Promise<Array<{ day: string; count: number }>> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const dayKey = (ms: number): string => formatter.format(new Date(ms));

  // Susun 7 tanggal terakhir (termasuk hari ini) sebagai kerangka grafik.
  const buckets: Array<{ day: string; count: number }> = [];
  const index = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = dayKey(Date.now() - offset * 24 * 60 * 60 * 1000);
    index.set(key, buckets.length);
    buckets.push({ day: key, count: 0 });
  }

  const since = Date.now() - (days + 1) * 24 * 60 * 60 * 1000;
  const rows = await all<{ created_at: number }>(
    `SELECT m.created_at AS created_at FROM messages m
     JOIN dm_sessions d ON m.channel_id = 'dm:' || d.user_id
     WHERE d.guild_id = ? AND m.created_at >= ?`,
    [guildId, since],
  );

  for (const row of rows) {
    const slot = index.get(dayKey(Number(row.created_at)));
    if (slot !== undefined) buckets[slot]!.count += 1;
  }

  return buckets;
}

/* ------------------------------------------------------------------ */
/*  Moderasi otomatis                                                  */
/* ------------------------------------------------------------------ */

export type ModerationAction = 'delete' | 'warn' | 'timeout';

export interface ModerationSettings {
  guildId: string;
  enabled: boolean;
  words: string[];
  action: ModerationAction;
  timeoutMinutes: number;
  updatedAt: number;
}

export interface ModerationLog {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  userName: string;
  matched: string;
  action: ModerationAction;
  createdAt: number;
}

interface ModerationRow {
  guild_id: string;
  enabled: number;
  words: string;
  action: string;
  timeout_minutes: number;
  updated_at: number;
}

const splitWords = (raw: string): string[] =>
  raw
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

/** Pengaturan moderasi tersimpan per server; `null` = belum pernah diatur dari dashboard. */
export async function getModerationSettings(guildId: string): Promise<ModerationSettings | null> {
  const row = await get<ModerationRow>('SELECT * FROM moderation WHERE guild_id = ?', [guildId]);
  if (!row) return null;

  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    words: splitWords(row.words),
    action: (row.action === 'warn' || row.action === 'timeout' ? row.action : 'delete') as ModerationAction,
    timeoutMinutes: Number(row.timeout_minutes),
    updatedAt: Number(row.updated_at),
  };
}

export async function setModerationSettings(input: {
  guildId: string;
  enabled: boolean;
  words: string[] | string;
  action: ModerationAction;
  timeoutMinutes: number;
}): Promise<void> {
  const words = Array.isArray(input.words) ? input.words : splitWords(input.words);
  const timeout = Math.min(10080, Math.max(1, Math.round(input.timeoutMinutes)));

  await run(
    `INSERT INTO moderation (guild_id, enabled, words, action, timeout_minutes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       enabled = excluded.enabled,
       words = excluded.words,
       action = excluded.action,
       timeout_minutes = excluded.timeout_minutes,
       updated_at = excluded.updated_at`,
    [input.guildId, input.enabled ? 1 : 0, words.join(','), input.action, timeout, Date.now()],
  );
}

/**
 * Catat satu pelanggaran moderasi.
 *
 * **Isi pesan sengaja TIDAK disimpan.** Hanya kata yang cocok dan tindakan yang
 * dicatat, supaya dashboard moderasi tidak bisa dipakai membaca pesan member.
 * Cuplikan pesan hanya dikirim ke channel log Discord (`MODLOG_CHANNEL_ID`).
 */
export async function addModerationLog(input: {
  guildId: string;
  channelId: string;
  userId: string;
  userName: string;
  matched: string;
  action: ModerationAction;
}): Promise<number> {
  return insert(
    `INSERT INTO mod_logs (guild_id, channel_id, user_id, user_name, matched, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.guildId, input.channelId, input.userId, input.userName, input.matched, input.action, Date.now()],
  );
}

export async function listModerationLogs(guildId: string, limit = 50): Promise<ModerationLog[]> {
  const rows = await all<{
    id: number;
    guild_id: string;
    channel_id: string;
    user_id: string;
    user_name: string;
    matched: string;
    action: string;
    created_at: number;
  }>('SELECT * FROM mod_logs WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [guildId, limit]);

  return rows.map((row) => ({
    id: Number(row.id),
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    userName: row.user_name,
    matched: row.matched,
    action: (row.action as ModerationAction) ?? 'delete',
    createdAt: Number(row.created_at),
  }));
}

export async function deleteModerationLog(guildId: string, id: number): Promise<boolean> {
  const info = await run('DELETE FROM mod_logs WHERE guild_id = ? AND id = ?', [guildId, id]);
  return info.changes > 0;
}

export async function clearModerationLogs(guildId: string): Promise<number> {
  const info = await run('DELETE FROM mod_logs WHERE guild_id = ?', [guildId]);
  return info.changes;
}

export async function countModerationLogs(guildId: string): Promise<number> {
  const row = await get<{ total: number }>('SELECT COUNT(*) AS total FROM mod_logs WHERE guild_id = ?', [guildId]);
  return Number(row?.total ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Panel chat AI (satu channel per server)                            */
/* ------------------------------------------------------------------ */

export interface PanelState {
  guildId: string;
  /** Channel tempat panel dikirim terakhir kali (`null` = belum pernah). */
  channelId: string | null;
  /** ID pesan panel, dipakai untuk menghapus/mengganti panel lama. */
  messageId: string | null;
  /** `false` = tombol "Chat via DM" ditolak walau pesan panelnya masih ada. */
  enabled: boolean;
  updatedAt: number | null;
}

interface PanelRow {
  guild_id: string;
  channel_id: string | null;
  message_id: string | null;
  enabled: number;
  updated_at: number;
}

const toPanel = (guildId: string, row: PanelRow | null): PanelState => ({
  guildId,
  channelId: row?.channel_id ?? null,
  messageId: row?.message_id ?? null,
  // Baris belum ada = perilaku lama: panel aktif.
  enabled: row ? Number(row.enabled) === 1 : true,
  updatedAt: row ? Number(row.updated_at) : null,
});

export async function getPanel(guildId: string): Promise<PanelState> {
  const row = await get<PanelRow>('SELECT * FROM panels WHERE guild_id = ?', [guildId]);
  return toPanel(guildId, row);
}

/** Simpan/hapus referensi pesan panel. `messageId = null` = tidak ada panel aktif. */
export async function setPanelMessage(
  guildId: string,
  channelId: string | null,
  messageId: string | null,
): Promise<void> {
  const now = Date.now();
  await run(
    `INSERT INTO panels (guild_id, channel_id, message_id, enabled, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id = ?, message_id = ?, updated_at = ?`,
    [guildId, channelId, messageId, now, channelId, messageId, now],
  );
}

/** Nyalakan/matikan tombol "Chat via DM" tanpa menghapus pesan panelnya. */
export async function setPanelEnabled(guildId: string, enabled: boolean): Promise<PanelState> {
  const now = Date.now();
  await run(
    `INSERT INTO panels (guild_id, channel_id, message_id, enabled, updated_at)
     VALUES (?, NULL, NULL, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET enabled = ?, updated_at = ?`,
    [guildId, enabled ? 1 : 0, now, enabled ? 1 : 0, now],
  );
  return getPanel(guildId);
}

/* ------------------------------------------------------------------ */
/*  Pesan container buatan admin (halaman /pesan)                      */
/* ------------------------------------------------------------------ */

export interface CustomPost {
  id: number;
  /** Blok berurutan; sudah dirapikan oleh `parseBlocks()`. */
  blocks: PostBlock[];
  name: string;
  channelId: string | null;
  /** ID pesan Discord yang sudah dikirim (null = belum pernah dikirim). */
  messageId: string | null;
  /** Warna aksen `#rrggbb`; null = bawaan. */
  accent: string | null;
  /** `webhook` = tampil atas nama server; selain itu lewat bot. */
  sender: 'bot' | 'webhook';
  /**
   * Flag pesan Discord (bitmask): 1<<2 suppress embed, 1<<12 suppress
   * notifikasi. 0 = tidak ada flag.
   */
  flags: number;
  /**
   * true = dokumen ini dikirim sebagai RANGKAIAN: pesan pertama biasa,
   * sisanya jadi balasan berurutan. Padanan multi-pesan Discohook.
   */
  series: boolean;
  /**
   * Izin ping (`allowed_mentions`) — `parse` kosong berarti TANPA ping apa pun.
   *
   * Disimpan sebagai data, bukan dibiarkan kosong: pesan yang disusun untuk
   * menyebut role tertentu tidak boleh diam-diam kehilangan izinnya saat
   * diperbarui.
   */
  allowedMentions: { parse: Array<'users' | 'roles' | 'everyone'> };
  /** Nama thread yang dibuka pesan ini (null = tanpa thread). */
  threadName: string | null;
  /**
   * Pemicu kirim otomatis (padanan trigger event Discohook).
   *
   * `null` = hanya dikirim manual. Nilai yang dikenal:
   *   - `member_add`    — pesan dikirim ke channel tujuannya tiap ada member baru;
   *   - `member_remove` — idem untuk member keluar.
   *
   * Yang dikirim adalah pesan yang SAMA (bukan salinan): ID pesan Discord yang
   * sudah ada diperbarui, jadi channel tidak dipenuhi pesan lama tiap ada
   * orang bergabung.
   */
  trigger: PostTrigger | null;
  /**
   * Bentuk pesan: `container` (Components V2, bawaan) atau `embed` (klasik).
   *
   * Disimpan per pesan, bukan per server: satu server sering punya pengumuman
   * bergaya embed DAN panel bergaya container, dan memaksa satu bentuk untuk
   * semuanya berarti admin harus memilih salah satu.
   */
  layout: PostLayout;
  /**
   * Bagian embed klasik yang diisi admin (penulis, footer, bidang, stempel
   * waktu, URL judul), sampai 10 embed per pesan seperti Discohook.
   *
   * Elemen pertama melengkapi embed yang dibangun dari blok; sisanya menjadi
   * embed tambahan yang hanya berisi bagian admin. Kosong = tidak ada.
   *
   * Disimpan walau `layout = 'container'`: admin bisa berpindah bentuk tanpa
   * kehilangan penulis/footer yang sudah ditulis. Embed hanya DIPAKAI saat
   * `layout = 'embed'`.
   */
  embed: EmbedExtra[];
  /**
   * Identitas pengirim webhook khusus pesan ini (padanan isian Username &
   * Avatar URL di Discohook). Kosong = pakai nama & ikon server.
   *
   * Hanya berpengaruh saat `sender = 'webhook'`; pada pengiriman lewat bot,
   * nama & avatar pesan ditentukan Discord sendiri.
   */
  webhookName: string | null;
  webhookAvatar: string | null;
  updatedAt: number;
}

/** Bentuk tampilan pesan. */
export const POST_LAYOUTS = ['container', 'embed'] as const;
export type PostLayout = (typeof POST_LAYOUTS)[number];

/** Nilai asing dibaca sebagai `container` — perilaku lama tidak berubah. */
export function parseLayout(raw: string | null | undefined): PostLayout {
  return raw === 'embed' ? 'embed' : 'container';
}

/**
 * Baca kolom `embed` menjadi daftar bagian embed.
 *
 * Kolom ini dulu hanya berisi SATU objek. Data lama tetap terbaca karena
 * `sanitizeEmbedList` menerima objek maupun daftar — tidak perlu migrasi isi.
 *
 * Nilai rusak dibaca sebagai "tidak ada bagian admin": embed tetap bisa
 * dikirim dari blok, jadi satu kolom rusak tidak boleh membuat pesannya gagal
 * tampil. Penyaringan ulang juga membuat nilai yang disunting langsung di
 * database tidak bisa menyelipkan yang tidak sah.
 */
function parseEmbedExtra(raw: string | null | undefined): EmbedExtra[] {
  if (!raw) return [];
  try {
    return sanitizeEmbedList(JSON.parse(raw)).list;
  } catch {
    return [];
  }
}

/** Nilai `trigger` yang dikenal. Selain ini dibaca sebagai `null`. */
export const POST_TRIGGERS = ['member_add', 'member_remove'] as const;
export type PostTrigger = (typeof POST_TRIGGERS)[number];

/** Ubah nilai kolom `trigger` jadi bentuk yang aman dipakai kode. */
export function parseTrigger(raw: string | null | undefined): PostTrigger | null {
  const nilai = (raw ?? '').trim();
  return (POST_TRIGGERS as readonly string[]).includes(nilai) ? (nilai as PostTrigger) : null;
}

interface CustomPostRow {
  id: number | string;
  guild_id: string;
  name: string;
  channel_id: string | null;
  blocks: string;
  message_id: string | null;
  accent?: string | null;
  sender?: string | null;
  flags?: number | string | null;
  series?: number | string | null;
  mentions?: string | null;
  thread_name?: string | null;
  trigger?: string | null;
  layout?: string | null;
  embed?: string | null;
  webhook_name?: string | null;
  webhook_avatar?: string | null;
  updated_at: number | string;
}

/**
 * Baca izin ping dari kolom teks.
 *
 * Nilai rusak/kosong dibaca sebagai "tanpa ping" — bukan sebagai "semua
 * boleh". Arah salahnya sengaja dipilih: salah membaca ke arah aman hanya
 * membuat ping tidak terjadi, sedangkan arah sebaliknya bisa memicu ping
 * massal yang tidak bisa dibatalkan.
 */
function parseMentions(raw: string | null | undefined): { parse: Array<'users' | 'roles' | 'everyone'> } {
  if (!raw) return { parse: [] };
  try {
    const isi = JSON.parse(raw) as { parse?: unknown };
    const daftar = Array.isArray(isi.parse) ? isi.parse : [];
    const sah: Array<'users' | 'roles' | 'everyone'> = [];
    for (const satu of daftar) {
      if (satu === 'users' || satu === 'roles' || satu === 'everyone') {
        if (!sah.includes(satu)) sah.push(satu);
      }
    }
    return { parse: sah };
  } catch {
    return { parse: [] };
  }
}

/**
 * Saring lalu ubah bagian embed jadi teks JSON untuk database.
 *
 * `null` dikembalikan kalau tidak ada isinya: kolom kosong lebih jujur
 * daripada `{}` yang harus dibaca ulang sebagai "kosong" di setiap tempat.
 */
function simpanEmbed(input: unknown): string | null {
  const { list } = sanitizeEmbedList(input);
  return list.length === 0 ? null : JSON.stringify(list);
}

/**
 * Nama pengirim webhook: batas Discord 80 karakter.
 *
 * Kosong / hanya spasi dibaca sebagai NULL supaya "kosongkan isian" benar-benar
 * mengembalikan pesan ke identitas server, bukan mengirim nama kosong yang
 * ditolak Discord.
 */
export function parseWebhookName(raw: string | null | undefined): string | null {
  const teks = (raw ?? '').trim();
  return teks ? teks.slice(0, 80) : null;
}

/** Avatar pengirim webhook: hanya http/https, batas Discord 2048 karakter. */
export function parseWebhookAvatar(raw: string | null | undefined): string | null {
  const teks = (raw ?? '').trim().slice(0, 2048);
  if (!teks) return null;
  try {
    const url = new URL(teks);
    return url.protocol === 'http:' || url.protocol === 'https:' ? teks : null;
  } catch {
    return null;
  }
}

function toCustomPost(row: CustomPostRow): CustomPost {
  return {
    id: Number(row.id),
    name: row.name,
    channelId: row.channel_id,
    blocks: parseBlocks(row.blocks),
    messageId: row.message_id,
    accent: row.accent ?? null,
    sender: row.sender === 'webhook' ? 'webhook' : 'bot',
    flags: Number(row.flags ?? 0) || 0,
    series: Number(row.series ?? 0) === 1,
    allowedMentions: parseMentions(row.mentions),
    threadName: row.thread_name?.trim() ? row.thread_name.trim().slice(0, 100) : null,
    trigger: parseTrigger(row.trigger),
    layout: parseLayout(row.layout),
    embed: parseEmbedExtra(row.embed),
    webhookName: parseWebhookName(row.webhook_name),
    webhookAvatar: parseWebhookAvatar(row.webhook_avatar),
    updatedAt: Number(row.updated_at),
  };
}

/** Semua pesan milik satu server, terbaru lebih dulu. */
export async function listCustomPosts(guildId: string): Promise<CustomPost[]> {
  // Dibatasi: pesan container adalah dokumen panjang, dan halaman /pesan
  // menanam semua isinya ke HTML. 200 pesan x 3500 karakter sudah ~700 KB —
  // batas ini menjaga halaman tetap ringan tanpa memotong pemakaian wajar.
  const rows = await all<CustomPostRow>(
    'SELECT * FROM custom_posts WHERE guild_id = ? ORDER BY updated_at DESC LIMIT 200',
    [guildId],
  );
  return rows.map(toCustomPost);
}

export async function getCustomPost(guildId: string, id: number): Promise<CustomPost | null> {
  const row = await get<CustomPostRow>('SELECT * FROM custom_posts WHERE guild_id = ? AND id = ?', [
    guildId,
    id,
  ]);
  return row ? toCustomPost(row) : null;
}

/**
 * Buat pesan baru.
 *
 * Blok dirapikan LEBIH DULU lewat `sanitizeBlocks()`, jadi yang tersimpan
 * selalu bentuk yang mungkin dikirim Discord — bukan input mentah dashboard.
 */
export async function createCustomPost(
  guildId: string,
  input: {
    name: string;
    channelId: string | null;
    blocks: unknown;
    accent?: string | null;
    sender?: 'bot' | 'webhook';
    flags?: number;
    series?: boolean;
    allowedMentions?: { parse?: Array<'users' | 'roles' | 'everyone'> };
    threadName?: string | null;
    trigger?: PostTrigger | null;
    layout?: PostLayout | null;
    /** Bagian embed klasik yang diisi admin (hanya dipakai bila layout=embed). */
    embed?: unknown;
    /** Nama & avatar pengirim webhook khusus pesan ini (null = identitas server). */
    webhookName?: string | null;
    webhookAvatar?: string | null;
  },
): Promise<CustomPost> {
  const blocks = sanitizeBlocks(input.blocks).blocks;
  const id = await insert(
    `INSERT INTO custom_posts (guild_id, name, channel_id, blocks, message_id, accent, sender, flags, series, mentions, thread_name, trigger, layout, embed, webhook_name, webhook_avatar, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      input.name.slice(0, 120),
      input.channelId,
      JSON.stringify(blocks),
      input.accent ?? null,
      input.sender ?? 'bot',
      input.flags ?? 0,
      input.series === true ? 1 : 0,
      JSON.stringify(parseMentions(JSON.stringify({ parse: input.allowedMentions?.parse ?? [] }))),
      input.threadName?.trim() ? input.threadName.trim().slice(0, 100) : null,
      parseTrigger(input.trigger ?? null),
      parseLayout(input.layout ?? null),
      simpanEmbed(input.embed),
      parseWebhookName(input.webhookName),
      parseWebhookAvatar(input.webhookAvatar),
      Date.now(),
    ],
  );
  return (await getCustomPost(guildId, id))!;
}

/** Perbarui isi pesan. `message_id` dipertahankan supaya bisa diedit di Discord. */
export async function updateCustomPost(
  guildId: string,
  id: number,
  input: {
    name?: string;
    channelId?: string | null;
    blocks?: unknown;
    accent?: string | null;
    sender?: 'bot' | 'webhook';
    flags?: number;
    series?: boolean;
    allowedMentions?: { parse?: Array<'users' | 'roles' | 'everyone'> };
    threadName?: string | null;
    trigger?: PostTrigger | null;
    layout?: PostLayout | null;
    embed?: unknown;
    webhookName?: string | null;
    webhookAvatar?: string | null;
  },
): Promise<CustomPost | null> {
  const current = await getCustomPost(guildId, id);
  if (!current) return null;

  /*
   * Versi SEBELUM diubah disimpan lebih dulu. Kalau `simpanRevisi` melempar,
   * perubahan tetap dilanjutkan: riwayat yang gagal dicatat tidak boleh
   * menghalangi admin menyimpan pekerjaannya.
   */
  await simpanRevisi(guildId, current).catch((error: unknown) =>
    logger.warn(`Gagal menyimpan revisi pesan ${id}`, errorMessage(error)),
  );

  const blocks = input.blocks === undefined ? current.blocks : sanitizeBlocks(input.blocks).blocks;
  await run(
    'UPDATE custom_posts SET name = ?, channel_id = ?, blocks = ?, accent = ?, sender = ?, flags = ?, series = ?, mentions = ?, thread_name = ?, trigger = ?, layout = ?, embed = ?, webhook_name = ?, webhook_avatar = ?, updated_at = ? WHERE guild_id = ? AND id = ?',
    [
      (input.name ?? current.name).slice(0, 120),
      input.channelId === undefined ? current.channelId : input.channelId,
      JSON.stringify(blocks),
      input.accent === undefined ? current.accent : input.accent,
      input.sender ?? current.sender,
      input.flags === undefined ? current.flags : input.flags,
      input.series === undefined ? (current.series ? 1 : 0) : input.series ? 1 : 0,
      JSON.stringify(
        parseMentions(
          input.allowedMentions === undefined
            ? JSON.stringify(current.allowedMentions)
            : JSON.stringify({ parse: input.allowedMentions.parse ?? [] }),
        ),
      ),
      input.threadName === undefined
        ? current.threadName
        : input.threadName?.trim()
          ? input.threadName.trim().slice(0, 100)
          : null,
      input.trigger === undefined ? current.trigger : parseTrigger(input.trigger ?? null),
      input.layout === undefined ? current.layout : parseLayout(input.layout ?? null),
      input.embed === undefined ? simpanEmbed(current.embed) : simpanEmbed(input.embed),
      input.webhookName === undefined ? current.webhookName : parseWebhookName(input.webhookName),
      input.webhookAvatar === undefined ? current.webhookAvatar : parseWebhookAvatar(input.webhookAvatar),
      Date.now(),
      guildId,
      id,
    ],
  );
  return getCustomPost(guildId, id);
}

/**
 * Pesan /pesan yang terpasang pada satu pemicu event.
 *
 * Dipakai event `guildMemberAdd`/`guildMemberRemove`. Urutannya tetap
 * (`updated_at DESC`) supaya kalau admin memasang dua pesan pada pemicu yang
 * sama, keduanya terkirim dengan urutan yang sama tiap kali — bukan acak.
 */
export async function listPostsByTrigger(guildId: string, trigger: PostTrigger): Promise<CustomPost[]> {
  const rows = await all<CustomPostRow>(
    'SELECT * FROM custom_posts WHERE guild_id = ? AND trigger = ? ORDER BY updated_at DESC LIMIT 20',
    [guildId, trigger],
  );
  return rows.map(toCustomPost);
}

/* ------------------------------------------------------------------ */
/*  Tujuan kirim tambahan (targets[])                                  */
/* ------------------------------------------------------------------ */

/** Satu channel tambahan tempat pesan yang sama dikirim. */
export interface PostTarget {
  id: number;
  channelId: string;
  /** ID pesan Discord di channel itu (null = belum pernah terkirim). */
  messageId: string | null;
}

interface PostTargetRow {
  id: number | string;
  channel_id: string;
  message_id: string | null;
}

/** Batas jumlah channel tambahan per pesan. */
export const POST_TARGET_LIMITS = { perPost: 5 } as const;

/**
 * Daftar channel tambahan untuk satu pesan.
 *
 * Channel UTAMA tidak ada di sini — ia tetap di `custom_posts.channel_id`.
 * Dua sumber untuk hal yang sama akan menyimpang cepat atau lambat (mis.
 * admin mengubah channel utama, salinan lamanya tertinggal).
 */
export async function listPostTargets(guildId: string, postId: number): Promise<PostTarget[]> {
  const rows = await all<PostTargetRow>(
    'SELECT id, channel_id, message_id FROM post_targets WHERE guild_id = ? AND post_id = ? ORDER BY position ASC, id ASC',
    [guildId, postId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    channelId: row.channel_id,
    messageId: row.message_id,
  }));
}

/**
 * Ganti seluruh channel tambahan satu pesan.
 *
 * Penggantian utuh (bukan tambah/hapus satu per satu) mengikuti pola tombol
 * role: dashboard mengirim keadaan akhir, jadi tidak ada urutan operasi yang
 * bisa membuat daftar setengah jadi.
 *
 * `message_id` LAMA DIPERTAHANKAN untuk channel yang masih ada di daftar:
 * menghapus lalu menambah lagi akan membuat pesan baru dikirim di channel itu
 * padahal pesan lamanya masih tampil.
 */
export async function replacePostTargets(
  guildId: string,
  postId: number,
  channelIds: unknown,
): Promise<{ targets: PostTarget[]; dropped: string[] }> {
  const dropped: string[] = [];
  const lama = await listPostTargets(guildId, postId);
  const idPesanLama = new Map(lama.map((satu) => [satu.channelId, satu.messageId]));
  const bersih: string[] = [];

  const daftar = Array.isArray(channelIds) ? channelIds : [];
  if (daftar.length > POST_TARGET_LIMITS.perPost) {
    dropped.push(
      `channel tambahan dibatasi ${POST_TARGET_LIMITS.perPost}; ${daftar.length - POST_TARGET_LIMITS.perPost} sisanya tidak disimpan`,
    );
  }
  for (const satu of daftar.slice(0, POST_TARGET_LIMITS.perPost)) {
    const id = typeof satu === 'string' ? satu.trim() : '';
    // ID channel Discord: 17-20 digit. Nilai lain ditolak, bukan disimpan
    // sebagai channel yang tidak akan pernah bisa dikirimi.
    if (!/^\d{17,20}$/.test(id)) {
      dropped.push(`channel "${id || '(kosong)'}" bukan ID channel Discord yang sah`);
      continue;
    }
    if (bersih.includes(id)) {
      dropped.push(`channel ${id} disebut dua kali`);
      continue;
    }
    bersih.push(id);
  }

  await run('DELETE FROM post_targets WHERE guild_id = ? AND post_id = ?', [guildId, postId]);
  let posisi = 0;
  for (const channelId of bersih) {
    await run(
      'INSERT INTO post_targets (guild_id, post_id, channel_id, message_id, position) VALUES (?, ?, ?, ?, ?)',
      [guildId, postId, channelId, idPesanLama.get(channelId) ?? null, posisi],
    );
    posisi += 1;
  }
  return { targets: await listPostTargets(guildId, postId), dropped };
}

/** Simpan ID pesan Discord di satu channel tambahan. */
export async function setPostTargetMessage(
  guildId: string,
  postId: number,
  channelId: string,
  messageId: string | null,
): Promise<void> {
  await run('UPDATE post_targets SET message_id = ? WHERE guild_id = ? AND post_id = ? AND channel_id = ?', [
    messageId,
    guildId,
    postId,
    channelId,
  ]);
}

/** Simpan ID pesan Discord setelah berhasil dikirim. */
export async function setCustomPostMessage(
  guildId: string,
  id: number,
  messageId: string | null,
): Promise<void> {
  await run('UPDATE custom_posts SET message_id = ?, updated_at = ? WHERE guild_id = ? AND id = ?', [
    messageId,
    Date.now(),
    guildId,
    id,
  ]);
}

export async function deleteCustomPost(guildId: string, id: number): Promise<void> {
  /*
   * Aksi, jadwal, dan sesi flow ikut dibersihkan. Tanpa ini, barisnya
   * tertinggal menunjuk tombol/pesan yang sudah tidak ada, dan
   * `copyPostActions`/daftar aksi bisa memuat data hantu kalau server memakai
   * ulang ID pesan. Jadwal yang tertinggal juga akan mencoba mengirim pesan
   * yang sudah dihapus pada tiap putaran timer.
   */
  await run('DELETE FROM post_actions WHERE guild_id = ? AND post_id = ?', [guildId, id]);
  await run('DELETE FROM post_schedules WHERE guild_id = ? AND post_id = ?', [guildId, id]);
  await run('DELETE FROM post_flow_sessions WHERE guild_id = ? AND post_id = ?', [guildId, id]);
  // Riwayat & tautan berbagi ikut dibersihkan: keduanya menunjuk pesan yang
  // sudah tidak ada, dan tautan yang tertinggal akan membuka halaman kosong.
  await run('DELETE FROM post_revisions WHERE guild_id = ? AND post_id = ?', [guildId, id]);
  await run('DELETE FROM post_shares WHERE guild_id = ? AND post_id = ?', [guildId, id]);
  // Tujuan tambahan ikut dibersihkan: barisnya menunjuk channel & pesan yang
  // sudah tidak ada, dan akan dikirimi ulang kalau ID pesannya dipakai lagi.
  await run('DELETE FROM post_targets WHERE guild_id = ? AND post_id = ?', [guildId, id]);
  await run('DELETE FROM custom_posts WHERE guild_id = ? AND id = ?', [guildId, id]);
}

/* ------------------------------------------------------------------ */
/*  Dokumen multi-pesan (`?grup=`)                                     */
/* ------------------------------------------------------------------ */

/**
 * Satu dokumen berisi beberapa pesan.
 *
 * Kenapa disimpan sebagai JSON utuh: isinya memakai bentuk blok yang SAMA
 * dengan pesan satu-dokumen (`PostBlock`), dan memecahnya ke kolom per field
 * berarti dua sumber kebenaran yang cepat menyimpang begitu bentuk blok
 * berubah. Yang disaring tetap di aplikasi (`sanitizeSeries`), bukan di SQL.
 */
export interface PostDocument {
  id: number;
  name: string;
  /** true = pesan-pesannya dikirim sebagai rangkaian balasan. */
  series: boolean;
  messages: SeriesMessage[];
  updatedAt: number;
}

interface PostDocumentRow {
  id: number | string;
  guild_id: string;
  name: string;
  series: number | string;
  payload: string;
  updated_at: number | string;
}

function toPostDocument(row: PostDocumentRow): PostDocument {
  let messages: SeriesMessage[] = [];
  try {
    const isi = JSON.parse(row.payload) as unknown;
    if (Array.isArray(isi)) messages = isi as SeriesMessage[];
  } catch {
    // Payload rusak (mis. sunting manual di database) tidak boleh membuat
    // seluruh halaman /pesan gagal dibuka. Dokumen tampil kosong, dan admin
    // bisa mengimpornya ulang.
    messages = [];
  }
  return {
    id: Number(row.id),
    name: row.name,
    series: Number(row.series) === 1,
    messages,
    updatedAt: Number(row.updated_at),
  };
}

/** Semua dokumen milik satu server, terbaru lebih dulu. */
export async function listPostDocuments(guildId: string): Promise<PostDocument[]> {
  // Dibatasi seperti daftar pesan: dokumen panjang ikut ditanam ke HTML.
  const rows = await all<PostDocumentRow>(
    'SELECT * FROM post_documents WHERE guild_id = ? ORDER BY updated_at DESC LIMIT 100',
    [guildId],
  );
  return rows.map(toPostDocument);
}

export async function getPostDocument(guildId: string, id: number): Promise<PostDocument | null> {
  const row = await get<PostDocumentRow>('SELECT * FROM post_documents WHERE guild_id = ? AND id = ?', [
    guildId,
    id,
  ]);
  return row ? toPostDocument(row) : null;
}

/**
 * Simpan dokumen multi-pesan (baru atau perbarui).
 *
 * `sanitizeSeries` dijalankan DI SINI, bukan hanya di API: repo adalah pintu
 * terakhir sebelum data tersimpan, dan dokumen yang tidak sah akan membuat
 * pengiriman gagal di tengah rangkaian — pesan pertama sudah terkirim,
 * sisanya tidak.
 */
export async function savePostDocument(
  guildId: string,
  input: {
    id?: number;
    name: string;
    series?: boolean;
    messages: unknown;
  },
): Promise<{ document: PostDocument; dropped: string[]; warnings: string[] } | null> {
  const bersih = sanitizeSeries(input.messages);
  const nama = input.name.trim().slice(0, 120) || 'Dokumen';
  const series = input.series === true ? 1 : 0;
  const payload = JSON.stringify(bersih.messages);

  if (input.id) {
    const ada = await getPostDocument(guildId, input.id);
    if (!ada) return null;
    await run(
      'UPDATE post_documents SET name = ?, series = ?, payload = ?, updated_at = ? WHERE guild_id = ? AND id = ?',
      [nama, series, payload, Date.now(), guildId, input.id],
    );
    const dokumen = await getPostDocument(guildId, input.id);
    return dokumen
      ? { document: dokumen, dropped: bersih.dropped, warnings: bersih.warnings }
      : null;
  }

  const id = await insert(
    'INSERT INTO post_documents (guild_id, name, series, payload, updated_at) VALUES (?, ?, ?, ?, ?)',
    [guildId, nama, series, payload, Date.now()],
  );
  const dokumen = await getPostDocument(guildId, id);
  return dokumen
    ? { document: dokumen, dropped: bersih.dropped, warnings: bersih.warnings }
    : null;
}

export async function deletePostDocument(guildId: string, id: number): Promise<void> {
  await run('DELETE FROM post_documents WHERE guild_id = ? AND id = ?', [guildId, id]);
}

/* ------------------------------------------------------------------ */
/*  Riwayat revisi pesan                                               */
/* ------------------------------------------------------------------ */

/**
 * Batas riwayat.
 *
 * Disimpan per pesan: 20 versi cukup untuk "kembalikan seperti tadi", dan
 * mencegah satu pesan yang sering disunting menelan ruang database. Versi
 * terlama dibuang saat batas terlampaui — bukan menolak simpanan baru, karena
 * menyimpan perubahan terbaru selalu lebih penting daripada menyimpan yang
 * lama.
 */
export const HISTORY_LIMITS = {
  perPost: 20,
} as const;

export interface PostRevision {
  id: number;
  postId: number;
  name: string;
  /** Isi pesan saat versi ini dibuat (blok + pengaturan tampilan). */
  snapshot: {
    blocks: PostBlock[];
    accent: string | null;
    sender: 'bot' | 'webhook';
    flags: number;
    series: boolean;
    allowedMentions: { parse: string[] };
    threadName: string | null;
    /**
     * Bentuk pesan & bagian embed saat versi dibuat.
     *
     * Opsional karena versi yang tersimpan sebelum kolom `embed` ada tidak
     * memilikinya — pembaca lama tidak boleh menganggapnya "container tanpa
     * embed" lalu menimpa pengaturan sekarang saat versi itu dikembalikan.
     */
    layout?: PostLayout;
    embed?: EmbedExtra[];
  };
  createdAt: number;
}

interface PostRevisionRow {
  id: number | string;
  post_id: number | string;
  name: string;
  payload: string;
  created_at: number | string;
}

function toRevision(row: PostRevisionRow): PostRevision {
  let snapshot: PostRevision['snapshot'];
  try {
    snapshot = JSON.parse(row.payload) as PostRevision['snapshot'];
  } catch {
    /*
     * Payload rusak (sunting manual di database) tetap ditampilkan sebagai
     * versi kosong. Melempar di sini akan membuat SELURUH daftar riwayat
     * gagal dibuka hanya karena satu baris lama rusak.
     */
    snapshot = {
      blocks: [],
      accent: null,
      sender: 'bot',
      flags: 0,
      series: false,
      allowedMentions: { parse: [] },
      threadName: null,
    };
  }
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    name: row.name,
    snapshot,
    createdAt: Number(row.created_at),
  };
}

/**
 * Simpan versi SEBELUM pesan diubah.
 *
 * Dipanggil dari `updateCustomPost` dan dari jalur "kirim ulang", bukan dari
 * API: kalau pemanggil harus ingat menyimpannya sendiri, cepat atau lambat ada
 * jalur yang lupa dan riwayatnya bolong tanpa tanda.
 */
async function simpanRevisi(guildId: string, current: CustomPost): Promise<void> {
  await run(
    'INSERT INTO post_revisions (guild_id, post_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    [
      guildId,
      current.id,
      current.name,
      JSON.stringify({
        blocks: current.blocks,
        accent: current.accent,
        sender: current.sender,
        flags: current.flags,
        series: current.series,
        allowedMentions: current.allowedMentions,
        threadName: current.threadName,
        layout: current.layout,
        embed: current.embed,
      }),
      Date.now(),
    ],
  );
  /*
   * Buang versi terlama di luar batas. Dua langkah (id yang disisakan, lalu
   * hapus sisanya) dipakai karena SQLite dan Postgres sama-sama tidak
   * mendukung DELETE ... LIMIT secara portabel.
   */
  const baris = await all<{ id: number | string }>(
    'SELECT id FROM post_revisions WHERE guild_id = ? AND post_id = ? ORDER BY created_at DESC, id DESC',
    [guildId, current.id],
  );
  if (baris.length <= HISTORY_LIMITS.perPost) return;
  const buang = baris.slice(HISTORY_LIMITS.perPost).map((satu) => Number(satu.id));
  for (const id of buang) {
    await run('DELETE FROM post_revisions WHERE id = ?', [id]);
  }
}

/** Riwayat revisi satu pesan, terbaru lebih dulu. */
export async function listPostRevisions(
  guildId: string,
  postId: number,
  limit = HISTORY_LIMITS.perPost,
): Promise<PostRevision[]> {
  const rows = await all<PostRevisionRow>(
    'SELECT id, post_id, name, payload, created_at FROM post_revisions WHERE guild_id = ? AND post_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [guildId, postId, Math.min(Math.max(1, limit), 100)],
  );
  return rows.map(toRevision);
}

/**
 * Kembalikan pesan ke satu versi.
 *
 * Versi yang dikembalikan TIDAK dihapus: admin mungkin ingin kembali lagi ke
 * versi sesudahnya. Yang terjadi hanyalah isi pesan diganti, dan versi
 * "sekarang" otomatis tersimpan sebagai revisi baru oleh `updateCustomPost`.
 */
export async function restorePostRevision(
  guildId: string,
  postId: number,
  revisionId: number,
): Promise<{ post: CustomPost | null; error?: string }> {
  const baris = await get<PostRevisionRow>(
    'SELECT id, post_id, name, payload, created_at FROM post_revisions WHERE guild_id = ? AND post_id = ? AND id = ?',
    [guildId, postId, revisionId],
  );
  if (!baris) return { post: null, error: 'Versi itu tidak ada (mungkin sudah terhapus karena batas riwayat).' };
  const revisi = toRevision(baris);
  const post = await updateCustomPost(guildId, postId, {
    name: revisi.name,
    blocks: revisi.snapshot.blocks,
    accent: revisi.snapshot.accent,
    sender: revisi.snapshot.sender,
    flags: revisi.snapshot.flags,
    series: revisi.snapshot.series,
    allowedMentions: revisi.snapshot.allowedMentions as { parse: Array<'users' | 'roles' | 'everyone'> },
    threadName: revisi.snapshot.threadName,
    /*
     * Versi lama (sebelum batch embed) tidak punya dua field ini. Jangan kirim
     * `undefined` yang berarti "kosongkan": kembalikan versi seharusnya hanya
     * mengubah yang memang tercatat di versi itu.
     */
    ...(revisi.snapshot.layout !== undefined ? { layout: revisi.snapshot.layout } : {}),
    ...(revisi.snapshot.embed !== undefined ? { embed: revisi.snapshot.embed } : {}),
  });
  return post ? { post } : { post: null, error: 'Pesan sudah tidak ada.' };
}

/* ------------------------------------------------------------------ */
/*  Tautan berbagi                                                     */
/* ------------------------------------------------------------------ */

/**
 * Buat tautan berbagi untuk satu pesan.
 *
 * Token dibuat ACak dan disimpan, bukan menyandikan isi pesan di URL: isi
 * pesan container bisa jauh melewati batas panjang URL, dan tautan yang sudah
 * dibagikan harus bisa DICABUT. Token yang sama dipakai ulang kalau sudah ada,
 * supaya admin tidak menumpuk tautan untuk pesan yang sama.
 */
export async function createPostShare(guildId: string, postId: number): Promise<string> {
  const ada = await get<{ token: string }>(
    'SELECT token FROM post_shares WHERE guild_id = ? AND post_id = ? ORDER BY created_at ASC LIMIT 1',
    [guildId, postId],
  );
  if (ada) return ada.token;
  const token = randomBytes(16).toString('base64url');
  await run('INSERT INTO post_shares (token, guild_id, post_id, created_at) VALUES (?, ?, ?, ?)', [
    token,
    guildId,
    postId,
    Date.now(),
  ]);
  return token;
}

/** Hapus tautan berbagi milik satu pesan (semua tokennya). */
export async function deletePostShare(guildId: string, postId: number): Promise<void> {
  await run('DELETE FROM post_shares WHERE guild_id = ? AND post_id = ?', [guildId, postId]);
}

/**
 * Baca pesan dari token berbagi.
 *
 * Sengaja TIDAK memeriksa guild pemanggil: tautan ini memang untuk dibagikan,
 * termasuk ke orang yang tidak punya akses dashboard. Yang dikembalikan hanya
 * isi pesan (blok + nama), bukan ID channel atau ID pesan Discord — tautan
 * berbagi tidak boleh membocorkan struktur server.
 */
export async function getSharedPost(
  token: string,
): Promise<{ name: string; blocks: PostBlock[]; layout: PostLayout; embed: EmbedExtra[] } | null> {
  const bersih = token.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(bersih)) return null;
  const baris = await get<{ post_id: number | string; guild_id: string }>(
    'SELECT post_id, guild_id FROM post_shares WHERE token = ?',
    [bersih],
  );
  if (!baris) return null;
  const post = await getCustomPost(baris.guild_id, Number(baris.post_id));
  if (!post) return null;
  return { name: post.name, blocks: post.blocks, layout: post.layout, embed: post.embed };
}

/* ------------------------------------------------------------------ */
/*  Tombol ambil role (halaman /pesan)                                 */
/* ------------------------------------------------------------------ */

export interface RoleButton {
  id: number;
  postId: number;
  roleId: string;
  label: string;
  mode: RoleButtonMode;
  /** Emoji tombol (unicode atau `<:nama:id>`), atau null. */
  emoji: string | null;
  /** primary/secondary/success/danger. */
  style: string;
  position: number;
}

interface RoleButtonRow {
  id: number | string;
  guild_id: string;
  post_id: number | string;
  role_id: string;
  label: string;
  mode: string;
  emoji: string | null;
  style: string | null;
  position: number | string;
}

function toRoleButton(row: RoleButtonRow): RoleButton {
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    roleId: row.role_id,
    label: row.label,
    mode: row.mode === 'give' ? 'give' : 'toggle',
    // Baris lama (sebelum kolom ini ada) bernilai NULL. Tombolnya tetap
    // berfungsi, hanya tanpa emoji dan dengan warna bawaan.
    emoji: row.emoji ?? null,
    style: row.style ?? 'primary',
    position: Number(row.position),
  };
}

/** Tombol role milik satu pesan, urut sesuai posisi di pesan. */
export async function listRoleButtons(guildId: string, postId: number): Promise<RoleButton[]> {
  const rows = await all<RoleButtonRow>(
    'SELECT * FROM post_role_buttons WHERE guild_id = ? AND post_id = ? ORDER BY position ASC, id ASC',
    [guildId, postId],
  );
  return rows.map(toRoleButton);
}

/**
 * Ganti SELURUH tombol role satu pesan.
 *
 * Kenapa hapus-lalu-tulis, bukan sinkronisasi per baris: urutan tombol adalah
 * hal yang admin atur, dan mencocokkan "baris lama mana yang jadi baris baru"
 * hanya menambah kerumitan tanpa manfaat. Jumlahnya paling banyak 25.
 *
 * SATU pengecualian: `id` dikirim balik oleh dashboard (dari tombol tersimpan)
 * dipakai ulang, karena aksi komponen menempel pada `button:<id>`. Tombol tanpa
 * `id` mendapat ID baru — tombol yang dihapus dari dashboard memang tidak boleh
 * bisa memberi role lagi walaupun pesan lamanya masih dipegang orang.
 */
export async function replaceRoleButtons(
  guildId: string,
  postId: number,
  input: unknown,
): Promise<{ buttons: RoleButton[]; dropped: string[] }> {
  const { buttons, dropped } = sanitizeRoleButtons(input);
  const lama = new Set((await listRoleButtons(guildId, postId)).map((button) => button.id));
  await run('DELETE FROM post_role_buttons WHERE guild_id = ? AND post_id = ?', [guildId, postId]);

  let position = 0;
  for (const button of buttons) {
    const pertahankan = button.id !== undefined && lama.has(button.id);
    const kolom = 'guild_id, post_id, role_id, label, mode, emoji, style, position';
    const nilai = [
      guildId,
      postId,
      button.roleId,
      button.label,
      button.mode,
      button.emoji ?? null,
      button.style ?? 'primary',
      position,
    ];
    if (pertahankan) {
      await run(`INSERT INTO post_role_buttons (id, ${kolom}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        button.id!,
        ...nilai,
      ]);
    } else {
      await insert(`INSERT INTO post_role_buttons (${kolom}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, nilai);
    }
    position += 1;
  }

  return { buttons: await listRoleButtons(guildId, postId), dropped };
}

/** Cari tombol role dari customId — dipakai bot saat tombol diklik. */
export async function findRoleButton(
  guildId: string,
  buttonId: number,
): Promise<RoleButton | null> {
  const row = await get<RoleButtonRow>(
    'SELECT * FROM post_role_buttons WHERE guild_id = ? AND id = ?',
    [guildId, buttonId],
  );
  return row ? toRoleButton(row) : null;
}

/* ------------------------------------------------------------------ */
/*  Select menu role (halaman /pesan)                                  */
/* ------------------------------------------------------------------ */

export interface RoleMenu {
  id: number;
  postId: number;
  placeholder: string;
  minValues: number;
  maxValues: number;
  exclusive: boolean;
  options: RoleMenuOption[];
}

export interface RoleMenuOption {
  id: number;
  roleId: string;
  label: string;
  emoji: string | null;
  description: string | null;
}

interface RoleMenuRow {
  id: number | string;
  post_id: number | string;
  placeholder: string;
  min_values: number | string;
  max_values: number | string;
  exclusive: number | string;
}

interface RoleOptionRow {
  id: number | string;
  menu_id: number | string;
  role_id: string;
  label: string;
  emoji: string | null;
  description: string | null;
}

/** Semua dropdown role milik satu pesan, lengkap dengan pilihannya. */
export async function listRoleMenus(guildId: string, postId: number): Promise<RoleMenu[]> {
  const menus = await all<RoleMenuRow>(
    'SELECT * FROM post_role_menus WHERE guild_id = ? AND post_id = ? ORDER BY position ASC, id ASC',
    [guildId, postId],
  );
  if (menus.length === 0) return [];

  /*
   * Kenapa satu query untuk semua pilihan, bukan satu query per menu: jumlah
   * menu paling banyak beberapa, tapi halaman /pesan memuat SEMUA pesan.
   * Pola N+1 di sini akan terasa saat daftar pesan panjang.
   */
  const options = await all<RoleOptionRow>(
    `SELECT * FROM post_role_options
      WHERE menu_id IN (${menus.map(() => '?').join(', ')})
      ORDER BY position ASC, id ASC`,
    menus.map((menu) => Number(menu.id)),
  );

  const byMenu = new Map<number, RoleMenuOption[]>();
  for (const row of options) {
    const menuId = Number(row.menu_id);
    const list = byMenu.get(menuId) ?? [];
    list.push({
      id: Number(row.id),
      roleId: row.role_id,
      label: row.label,
      emoji: row.emoji,
      description: row.description,
    });
    byMenu.set(menuId, list);
  }

  return menus.map((row) => ({
    id: Number(row.id),
    postId: Number(row.post_id),
    placeholder: row.placeholder,
    minValues: Number(row.min_values),
    maxValues: Number(row.max_values),
    exclusive: Number(row.exclusive) === 1,
    options: byMenu.get(Number(row.id)) ?? [],
  }));
}

/**
 * Ganti dropdown role satu pesan.
 *
 * Sama seperti `replaceRoleButtons`: hapus lalu tulis ulang. Kalau input tidak
 * menghasilkan menu yang sah, semua menu pesan itu ikut terhapus — itu memang
 * yang diinginkan, karena admin barusan menghapus menunya di dashboard.
 */
export async function replaceRoleMenus(
  guildId: string,
  postId: number,
  input: unknown,
): Promise<{ menus: RoleMenu[]; dropped: string[] }> {
  const dropped: string[] = [];
  const source = Array.isArray(input) ? input : input == null ? [] : [input];
  const menus: RoleMenuInput[] = [];

  for (const raw of source) {
    const menu = sanitizeRoleMenu(raw);
    if (menu) {
      menus.push(menu);
    } else if (raw && typeof raw === 'object') {
      dropped.push('menu role tanpa pilihan yang sah');
    }
  }
  if (menus.length > 5) {
    dropped.push(`${menus.length - 5} menu role dilewati (maksimal 5 per pesan)`);
    menus.length = 5;
  }

  /*
   * ID opsi lama dikumpulkan SEBELUM dihapus: `RoleOptionInput.id` hanya
   * dipakai ulang kalau barisnya memang milik pesan ini, supaya klien tidak
   * bisa "mencuri" ID milik pesan lain lewat input.
   */
  const opsiLama = new Set(
    (
      await all<{ id: number | string }>(
        `SELECT o.id FROM post_role_options o
           JOIN post_role_menus m ON m.id = o.menu_id
          WHERE m.guild_id = ? AND m.post_id = ?`,
        [guildId, postId],
      )
    ).map((row) => Number(row.id)),
  );

  await run('DELETE FROM post_role_options WHERE menu_id IN (SELECT id FROM post_role_menus WHERE guild_id = ? AND post_id = ?)', [
    guildId,
    postId,
  ]);
  await run('DELETE FROM post_role_menus WHERE guild_id = ? AND post_id = ?', [guildId, postId]);

  let position = 0;
  for (const menu of menus) {
    const menuId = await insert(
      `INSERT INTO post_role_menus (guild_id, post_id, placeholder, min_values, max_values, exclusive, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        postId,
        menu.placeholder,
        menu.minValues,
        menu.maxValues,
        menu.exclusive ? 1 : 0,
        position,
      ],
    );
    let optionPosition = 0;
    for (const option of menu.options) {
      const pertahankan = option.id !== undefined && opsiLama.has(option.id);
      const kolom = 'menu_id, role_id, label, emoji, description, position';
      const nilai = [
        menuId,
        option.roleId,
        option.label,
        option.emoji ?? null,
        option.description ?? null,
        optionPosition,
      ];
      if (pertahankan) {
        await run(`INSERT INTO post_role_options (id, ${kolom}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
          option.id!,
          ...nilai,
        ]);
      } else {
        await insert(`INSERT INTO post_role_options (${kolom}) VALUES (?, ?, ?, ?, ?, ?)`, nilai);
      }
      optionPosition += 1;
    }
    position += 1;
  }

  return { menus: await listRoleMenus(guildId, postId), dropped };
}

/** Cari dropdown dari customId — dipakai bot saat member memilih opsi. */
export async function findRoleMenu(guildId: string, menuId: number): Promise<RoleMenu | null> {
  const row = await get<RoleMenuRow>(
    'SELECT * FROM post_role_menus WHERE guild_id = ? AND id = ?',
    [guildId, menuId],
  );
  if (!row) return null;
  const menus = await listRoleMenus(guildId, Number(row.post_id));
  return menus.find((menu) => menu.id === menuId) ?? null;
}

export type { RoleButtonInput, RoleMenuInput };

/* ------------------------------------------------------------------ */
/*  Aksi komponen (flow ringkas)                                       */
/* ------------------------------------------------------------------ */

/**
 * Kunci komponen pemilik aksi.
 *
 * Tombol dan opsi menu disimpan di tabel berbeda, jadi butuh penanda jenis.
 * Formatnya sederhana dan stabil: `button:<id>` / `option:<id>`.
 */
export type ActionTarget = string;

interface ActionRow {
  id: number | string;
  target: string;
  payload: string;
}

/** Buang aksi yang targetnya sudah tidak ada (tombol/menu dihapus). */
function rakitAksi(rows: ActionRow[]): Map<ActionTarget, PostAction[]> {
  const byTarget = new Map<ActionTarget, PostAction[]>();
  for (const row of rows) {
    let isi: unknown;
    try {
      isi = JSON.parse(row.payload);
    } catch {
      // Payload rusak bukan alasan menggagalkan seluruh halaman: aksi itu
      // dilewati saja, sama seperti blok yang tidak dikenal.
      continue;
    }
    const { actions } = sanitizeActions([isi]);
    const action = actions[0];
    if (!action) continue;
    const list = byTarget.get(row.target) ?? [];
    list.push(action);
    byTarget.set(row.target, list);
  }
  return byTarget;
}

/**
 * Semua aksi milik satu pesan, dikelompokkan per komponen.
 *
 * Satu query untuk semua aksi: halaman /pesan memuat SEMUA pesan, jadi pola
 * "satu query per tombol" akan terasa saat daftar pesan panjang.
 */
export async function listPostActions(
  guildId: string,
  postId: number,
): Promise<Record<ActionTarget, PostAction[]>> {
  const rows = await all<ActionRow>(
    'SELECT id, target, payload FROM post_actions WHERE guild_id = ? AND post_id = ? ORDER BY position ASC, id ASC',
    [guildId, postId],
  );
  return Object.fromEntries(rakitAksi(rows));
}

/**
 * Aksi untuk SATU komponen — dipakai bot saat tombol/opsi diklik.
 *
 * `postId` disertakan supaya bot tahu pesan PEMILIK aksi: aksi "kirim pesan"
 * yang menunjuk pesan itu sendiri harus dicegah (kalau tidak, satu klik
 * mengirim pesan yang sama terus-menerus).
 *
 * `null` = komponen ini belum punya aksi. Itu bukan kesalahan: tombol role
 * lama memang belum punya aksi, dan perilakunya dipertahankan.
 */
export async function findActions(
  guildId: string,
  target: ActionTarget,
  /** Batasi ke satu pesan — dipakai bila customId membawa ID pesan. */
  postId?: number | null,
): Promise<{ postId: number; actions: PostAction[] } | null> {
  const rows = await all<ActionRow & { post_id: number | string }>(
    postId
      ? 'SELECT id, post_id, target, payload FROM post_actions WHERE guild_id = ? AND post_id = ? AND target = ? ORDER BY position ASC, id ASC'
      : 'SELECT id, post_id, target, payload FROM post_actions WHERE guild_id = ? AND target = ? ORDER BY position ASC, id ASC',
    postId ? [guildId, postId, target] : [guildId, target],
  );
  if (rows.length === 0) return null;
  const actions = rakitAksi(rows).get(target) ?? [];
  if (actions.length === 0) return null;
  return { postId: Number(rows[0]!.post_id), actions };
}

/**
 * Ganti SELURUH aksi satu pesan.
 *
 * Hapus-lalu-tulis, sama seperti tombol & menu: tombol/opsi dibuat ulang setiap
 * simpan, jadi aksi lama pasti menunjuk ID yang sudah tidak ada. Menyisakannya
 * hanya menumpuk sampah di database.
 */
export async function replacePostActions(
  guildId: string,
  postId: number,
  input: unknown,
): Promise<{ actions: Record<ActionTarget, PostAction[]>; dropped: string[] }> {
  const dropped: string[] = [];
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

  await run('DELETE FROM post_actions WHERE guild_id = ? AND post_id = ?', [guildId, postId]);

  let total = 0;
  for (const target of Object.keys(source)) {
    /*
     * Target harus mengikuti bentuk yang dikenal; selain itu diabaikan supaya
     * data asing tidak bisa menyelipkan baris yatim.
     *
     * `select:<jenis>` dipakai blok Select di /pesan, yang tidak punya ID baris
     * (customId-nya hanya membawa jenis menu). Konsekuensinya aksi untuk jenis
     * yang sama dipakai bersama oleh semua select jenis itu di satu pesan —
     * itu disengaja: menunya memang tidak bisa dibedakan dari customId.
     *
     * `sel:<nilai>` menambahkan aksi per PILIHAN untuk menu string. Pilihan
     * yang tidak punya aksi sendiri jatuh ke `select:<jenis>`.
     */
    if (
      !/^(button|option):\d+$/.test(target) &&
      !/^select:[a-z]{2,20}$/.test(target) &&
      /*
       * `sel:<nilai>` = aksi untuk SATU pilihan menu string.
       *
       * Kuncinya nilai pilihan (bukan ID baris), karena itu yang dikirim balik
       * Discord saat dipilih. Nilai panjang dipotong di 100 karakter — sama
       * dengan batas nilai select Discord.
       */
      !/^sel:[\x20-\x7e]{1,100}$/.test(target)
    ) continue;
    const { actions, dropped: buang } = sanitizeActions(source[target]);
    for (const alasan of buang) dropped.push(`${target}: ${alasan}`);
    let position = 0;
    for (const action of actions) {
      if (total >= ACTION_LIMITS.perMessage) {
        dropped.push(`aksi melebihi batas ${ACTION_LIMITS.perMessage} per pesan`);
        return { actions: await listPostActions(guildId, postId), dropped };
      }
      await insert(
        'INSERT INTO post_actions (guild_id, post_id, target, position, payload) VALUES (?, ?, ?, ?, ?)',
        [guildId, postId, target, position, JSON.stringify(action)],
      );
      position += 1;
      total += 1;
    }
  }

  return { actions: await listPostActions(guildId, postId), dropped };
}

/**
 * Salin aksi saat pesan DIDUPLIKASI (impor / tombol duplikat pesan).
 *
 * Peta `petaTarget` menerjemahkan target lama ke target baru; target yang
 * tidak ada di peta dilewati, karena komponennya memang tidak ikut tersalin.
 */
export async function copyPostActions(
  guildId: string,
  fromPostId: number,
  toPostId: number,
  petaTarget: Record<string, string>,
): Promise<void> {
  const perTarget = await listPostActions(guildId, fromPostId);
  let total = 0;
  for (const [target, actions] of Object.entries(perTarget)) {
    const baru = petaTarget[target];
    if (!baru) continue;
    let position = 0;
    for (const action of actions) {
      if (total >= ACTION_LIMITS.perMessage) return;
      await insert(
        'INSERT INTO post_actions (guild_id, post_id, target, position, payload) VALUES (?, ?, ?, ?, ?)',
        [guildId, toPostId, baru, position, JSON.stringify(action)],
      );
      position += 1;
      total += 1;
    }
  }
}

/** Hapus semua aksi satu pesan (dipanggil saat pesan dihapus). */
export async function clearPostActions(guildId: string, postId: number): Promise<void> {
  await run('DELETE FROM post_actions WHERE guild_id = ? AND post_id = ?', [guildId, postId]);
}

/* ------------------------------------------------------------------ */
/*  Sesi flow yang menunggu                                            */
/* ------------------------------------------------------------------ */

/**
 * Satu flow yang berhenti di aksi "Tunggu".
 *
 * `steps` adalah SISA langkah sesudah penantian, sudah dalam bentuk rencana
 * (`ActionStep[]`) — bukan aksi mentah. Dengan begitu perubahan bentuk aksi di
 * database tidak mengubah arti sesi yang sedang berjalan.
 */
export interface FlowSession {
  id: number;
  guildId: string;
  postId: number;
  channelId: string;
  messageId: string | null;
  userId: string;
  userName: string;
  serverName: string;
  variables: Record<string, string>;
  steps: unknown[];
  dueAt: number;
  createdAt: number;
}

interface FlowSessionRow {
  id: number | string;
  guild_id: string;
  post_id: number | string;
  channel_id: string;
  message_id: string | null;
  user_id: string;
  user_name: string;
  server_name: string;
  variables: string;
  payload: string;
  due_at: number | string;
  created_at: number | string;
}

function bacaSesi(row: FlowSessionRow): FlowSession {
  let variables: Record<string, string> = {};
  let steps: unknown[] = [];
  try {
    const v = JSON.parse(row.variables);
    if (v && typeof v === 'object' && !Array.isArray(v)) variables = v as Record<string, string>;
  } catch {
    // Variabel rusak bukan alasan membuang sesi: langkahnya mungkin masih sah.
  }
  try {
    const p = JSON.parse(row.payload);
    if (Array.isArray(p)) steps = p;
  } catch {
    // Payload rusak = sesi tidak bisa dilanjutkan; pemanggil membuangnya.
  }
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    postId: Number(row.post_id),
    channelId: row.channel_id,
    messageId: row.message_id,
    userId: row.user_id,
    userName: row.user_name,
    serverName: row.server_name,
    variables,
    steps,
    dueAt: Number(row.due_at),
    createdAt: Number(row.created_at),
  };
}

/** Simpan flow yang berhenti menunggu. Mengembalikan ID sesinya. */
export async function createFlowSession(input: {
  guildId: string;
  postId: number;
  channelId: string;
  messageId: string | null;
  userId: string;
  userName: string;
  serverName: string;
  variables: Record<string, string>;
  steps: unknown[];
  dueAt: number;
}): Promise<number> {
  return insert(
    'INSERT INTO post_flow_sessions (guild_id, post_id, channel_id, message_id, user_id, user_name, server_name, variables, payload, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      input.guildId,
      input.postId,
      input.channelId,
      input.messageId,
      input.userId,
      input.userName,
      input.serverName,
      JSON.stringify(input.variables),
      JSON.stringify(input.steps),
      input.dueAt,
      Date.now(),
    ],
  );
}

/**
 * Sesi yang sudah waktunya dijalankan.
 *
 * `limit` kecil (bawaan 20) supaya satu putaran timer tidak memblokir event
 * loop saat banyak penantian selesai bersamaan — mis. sesudah bot mati lama.
 */
export async function listDueFlowSessions(now: number, limit = 20): Promise<FlowSession[]> {
  const rows = await all<FlowSessionRow>(
    'SELECT * FROM post_flow_sessions WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?',
    [now, limit],
  );
  return rows.map(bacaSesi);
}

/** Hapus sesi — dipanggil SEBELUM menjalankan sisa langkah. */
export async function deleteFlowSession(id: number): Promise<void> {
  await run('DELETE FROM post_flow_sessions WHERE id = ?', [id]);
}

/** Jumlah sesi yang sedang menunggu (dipakai dasbor). */
export async function countFlowSessions(guildId: string): Promise<number> {
  const row = await get<{ jumlah: number | string }>(
    'SELECT COUNT(*) AS jumlah FROM post_flow_sessions WHERE guild_id = ?',
    [guildId],
  );
  return Number(row?.jumlah ?? 0);
}

/** Buang sesi milik pesan yang sudah dihapus. */
export async function clearFlowSessionsForPost(guildId: string, postId: number): Promise<void> {
  await run('DELETE FROM post_flow_sessions WHERE guild_id = ? AND post_id = ?', [guildId, postId]);
}

/**
 * Buang sesi yang menunggu terlalu lama karena bot jarang hidup.
 *
 * Batas 30 hari: lebih dari itu, pengingatnya sudah tidak berguna dan
 * menjalankannya mendadak justru membingungkan member.
 */
export async function pruneFlowSessions(olderThan: number): Promise<number> {
  const hasil = await run('DELETE FROM post_flow_sessions WHERE due_at < ?', [olderThan]);
  return Number((hasil as { changes?: number })?.changes ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Jadwal kirim pesan                                                 */
/* ------------------------------------------------------------------ */

/** Batas jadwal, dipakai sanitizer dan dasbor. */
/**
 * Offset jam (dari UTC) untuk satu zona waktu server.
 *
 * Dipakai jadwal cron: "tiap Senin 09:00" harus berarti 09:00 WIB, bukan 09:00
 * UTC. Zona Indonesia tidak memakai DST, jadi offsetnya tetap.
 */
export function zoneOffsetHours(timeZone: string | null | undefined): number {
  const bersih = normalizeTimeZone(timeZone);
  return TIME_ZONES.find((zona) => zona.id === bersih)?.offset ?? 7;
}

export const SCHEDULE_LIMITS = {
  /** Pengulangan paling rapat: 2 jam (mengikuti Discohook). */
  minRepeatMinutes: 120,
  /** Jumlah jadwal per pesan — jaring pengaman. */
  perPost: 10,
} as const;

export interface PostSchedule {
  id: number;
  postId: number;
  channelId: string;
  dueAt: number;
  repeatMinutes: number;
  /** Ekspresi cron (lima ruas), atau null untuk pengulangan tiap N menit. */
  cron: string | null;
  /** Offset zona jadwal (jam dari UTC), dibaca dari zona waktu server saat disimpan. */
  cronOffset: number;
  lastSentAt: number | null;
}

interface ScheduleRow {
  id: number | string;
  post_id: number | string;
  channel_id: string;
  due_at: number | string;
  repeat_minutes: number | string;
  cron: string | null;
  cron_offset: number | string | null;
  last_sent_at: number | string | null;
}

function bacaJadwal(row: ScheduleRow): PostSchedule {
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    channelId: row.channel_id,
    dueAt: Number(row.due_at),
    repeatMinutes: Number(row.repeat_minutes),
    cron: typeof row.cron === 'string' && row.cron.trim() ? row.cron.trim() : null,
    cronOffset: Number.isFinite(Number(row.cron_offset)) && row.cron_offset !== null
      ? Number(row.cron_offset)
      : 7,
    lastSentAt: row.last_sent_at === null ? null : Number(row.last_sent_at),
  };
}

/**
 * Rapikan satu jadwal dari input dasbor.
 *
 * Tidak pernah melempar: jadwal yang tidak masuk akal DIBUANG dengan alasan,
 * sama seperti blok dan aksi. `null` = tolak.
 */
export function sanitizeSchedule(
  input: unknown,
  cronOffset = 7,
): { dueAt: number; repeatMinutes: number; cron: string | null; cronOffset: number } | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Record<string, unknown>;

  /*
   * Dua bentuk jadwal, tidak pernah dua-duanya:
   *   - cron      : pengulangan mengikuti kalender; `dueAt` DIHITUNG dari
   *                 ekspresinya, bukan dipercaya dari klien (klien bisa
   *                 mengirim waktu lampau atau tahun 2099);
   *   - menit     : pengulangan tiap N menit seperti sebelumnya.
   */
  const cronTeks = typeof item.cron === 'string' ? item.cron.trim() : '';
  if (cronTeks) {
    let jadwalCron: ReturnType<typeof parseCron>;
    try {
      jadwalCron = parseCron(cronTeks);
    } catch (error) {
      droppedCron.push(errorMessage(error));
      return null;
    }
    const berikut = nextCronTime(jadwalCron, Date.now(), cronOffset);
    if (berikut === null) {
      droppedCron.push(`cron "${cronTeks}" tidak akan pernah berbunyi (tanggal mustahil)`);
      return null;
    }
    // Batas kerapatan sama dengan jadwal berulang: sekali per 2 jam.
    const jarak = cronIntervalMinutes(jadwalCron, Date.now(), cronOffset);
    if (jarak !== null && jarak < SCHEDULE_LIMITS.minRepeatMinutes) {
      droppedCron.push(
        `cron "${cronTeks}" terlalu rapat (tiap ${jarak} menit) — paling rapat sekali per ${SCHEDULE_LIMITS.minRepeatMinutes} menit`,
      );
      return null;
    }
    return { dueAt: berikut, repeatMinutes: 0, cron: jadwalCron.ekspresi, cronOffset };
  }

  const dueAt = Number(item.dueAt);
  if (!Number.isFinite(dueAt) || dueAt <= Date.now() - 60_000) return null;
  const ulang = Math.trunc(Number(item.repeatMinutes) || 0);
  const repeatMinutes = ulang <= 0 ? 0 : Math.max(SCHEDULE_LIMITS.minRepeatMinutes, ulang);
  return { dueAt, repeatMinutes, cron: null, cronOffset };
}

/**
 * Alasan terakhir kenapa sebuah jadwal cron ditolak.
 *
 * `sanitizeSchedule` mengembalikan `null` (bukan melempar) supaya pemanggil
 * lama tidak berubah, tetapi alasan seperti "menit 60 tidak ada" terlalu
 * berguna untuk dibuang — tanpa itu admin hanya melihat "jadwal tanpa waktu
 * yang sah" dan tidak tahu ruas mana yang salah.
 */
const droppedCron: string[] = [];

/** Ambil (dan kosongkan) alasan penolakan cron terakhir. */
export function ambilAlasanCron(): string[] {
  return droppedCron.splice(0, droppedCron.length);
}

/** Semua jadwal satu pesan. */
export async function listSchedules(guildId: string, postId: number): Promise<PostSchedule[]> {
  const rows = await all<ScheduleRow>(
    'SELECT * FROM post_schedules WHERE guild_id = ? AND post_id = ? ORDER BY due_at ASC',
    [guildId, postId],
  );
  return rows.map(bacaJadwal);
}

/** Ganti seluruh jadwal satu pesan (dashboard mengirim daftar penuh). */
export async function replaceSchedules(
  guildId: string,
  postId: number,
  channelId: string,
  input: unknown,
  timeZone?: string | null,
): Promise<{ schedules: PostSchedule[]; dropped: string[] }> {
  const dropped: string[] = [];
  const daftar = Array.isArray(input) ? input : [];
  const cronOffset = zoneOffsetHours(timeZone);
  await run('DELETE FROM post_schedules WHERE guild_id = ? AND post_id = ?', [guildId, postId]);

  let jumlah = 0;
  for (const raw of daftar) {
    if (jumlah >= SCHEDULE_LIMITS.perPost) {
      dropped.push(`jadwal melebihi batas ${SCHEDULE_LIMITS.perPost} per pesan`);
      break;
    }
    const bersih = sanitizeSchedule(raw, cronOffset);
    const alasanCron = ambilAlasanCron();
    if (!bersih) {
      dropped.push(
        alasanCron[0] ??
          'jadwal tanpa waktu yang sah (harus di masa depan, atau cron yang bisa berbunyi)',
      );
      continue;
    }
    await insert(
      'INSERT INTO post_schedules (guild_id, post_id, channel_id, due_at, repeat_minutes, cron, cron_offset, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      [
        guildId,
        postId,
        channelId,
        bersih.dueAt,
        bersih.repeatMinutes,
        bersih.cron,
        bersih.cronOffset,
        Date.now(),
      ],
    );
    jumlah += 1;
  }
  return { schedules: await listSchedules(guildId, postId), dropped };
}

/** Jadwal yang sudah waktunya dikirim. */
export async function listDueSchedules(now: number, limit = 10): Promise<PostSchedule[]> {
  const rows = await all<ScheduleRow>(
    'SELECT * FROM post_schedules WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?',
    [now, limit],
  );
  return rows.map(bacaJadwal);
}

/**
 * Tandai jadwal sudah dikirim.
 *
 * Untuk jadwal sekali-kirim, barisnya DIHAPUS (tidak ada gunanya disimpan).
 * Untuk jadwal berulang, `due_at` digeser dan `last_sent_at` diisi — memakai
 * waktu SEKARANG sebagai dasar, bukan jadwal lama, supaya bot yang mati
 * berhari-hari tidak mengirim puluhan pesan susulan sekaligus.
 */
export async function markScheduleSent(schedule: PostSchedule, now = Date.now()): Promise<void> {
  /*
   * Jadwal cron TIDAK dihapus setelah dikirim: pengulangannya mengikuti
   * kalender, dan waktu berikutnya dihitung dari ekspresinya. Kalau ekspresinya
   * ternyata sudah tidak berbunyi lagi (mis. 29 Februari tahun lalu), barisnya
   * dihapus supaya bot tidak memeriksanya selamanya.
   */
  if (schedule.cron) {
    const berikut = nextCronTime(schedule.cron, now, schedule.cronOffset);
    if (berikut === null) {
      await run('DELETE FROM post_schedules WHERE id = ?', [schedule.id]);
      logger.warn(
        `Jadwal cron "${schedule.cron}" pesan ${schedule.postId} tidak akan berbunyi lagi — jadwalnya dihapus.`,
      );
      return;
    }
    await run('UPDATE post_schedules SET due_at = ?, last_sent_at = ? WHERE id = ?', [
      berikut,
      now,
      schedule.id,
    ]);
    return;
  }
  if (schedule.repeatMinutes <= 0) {
    await run('DELETE FROM post_schedules WHERE id = ?', [schedule.id]);
    return;
  }
  await run('UPDATE post_schedules SET due_at = ?, last_sent_at = ? WHERE id = ?', [
    now + schedule.repeatMinutes * 60_000,
    now,
    schedule.id,
  ]);
}

/** Hapus semua jadwal satu pesan (dipanggil saat pesan dihapus). */
export async function clearSchedulesForPost(guildId: string, postId: number): Promise<void> {
  await run('DELETE FROM post_schedules WHERE guild_id = ? AND post_id = ?', [guildId, postId]);
}

/* ------------------------------------------------------------------ */
/*  Webhook per channel (pesan atas nama server)                       */
/* ------------------------------------------------------------------ */

export interface StoredWebhook {
  channelId: string;
  webhookId: string;
  /** URL lengkap hasil dekripsi. HANYA untuk memanggil Discord. */
  url: string;
}

interface WebhookRow {
  channel_id: string;
  guild_id: string;
  webhook_id: string;
  token: string;
  updated_at: number | string;
}

/**
 * Webhook yang tersimpan untuk satu channel, atau null.
 *
 * Token didekripsi di sini; pemanggil bertanggung jawab TIDAK mengirim URL ini
 * ke browser. Dashboard hanya butuh tahu "sudah ada / belum", bukan isinya.
 */
export async function getChannelWebhook(guildId: string, channelId: string): Promise<StoredWebhook | null> {
  const row = await get<WebhookRow>(
    'SELECT * FROM post_webhooks WHERE guild_id = ? AND channel_id = ?',
    [guildId, channelId],
  );
  if (!row) return null;

  const token = decryptSecret(row.token);
  // Token tidak bisa didekripsi (DASHBOARD_TOKEN diganti): perlakukan sebagai
  // belum ada supaya bot membuat webhook baru, bukan gagal terus-menerus.
  if (!token) return null;

  return {
    channelId: row.channel_id,
    webhookId: row.webhook_id,
    url: `https://discord.com/api/webhooks/${row.webhook_id}/${token}`,
  };
}

/** Simpan/ganti webhook untuk satu channel. Token dienkripsi lebih dulu. */
export async function saveChannelWebhook(options: {
  guildId: string;
  channelId: string;
  webhookId: string;
  token: string;
}): Promise<void> {
  const encrypted = encryptSecret(options.token);
  await run(
    `INSERT INTO post_webhooks (channel_id, guild_id, webhook_id, token, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (channel_id) DO UPDATE SET
       guild_id = excluded.guild_id,
       webhook_id = excluded.webhook_id,
       token = excluded.token,
       updated_at = excluded.updated_at`,
    [options.channelId, options.guildId, options.webhookId, encrypted, Date.now()],
  );
}

/** Lupakan webhook (mis. sudah dihapus di Discord). */
export async function deleteChannelWebhook(channelId: string): Promise<void> {
  await run('DELETE FROM post_webhooks WHERE channel_id = ?', [channelId]);
}
