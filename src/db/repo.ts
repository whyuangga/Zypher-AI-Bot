import { all, get, insert, run } from './index.js';

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
  /** Otomatis membalas jawaban room dengan suara (TTS). `null` = memakai default `.env`. */
  ttsReplyInRoom: boolean | null;
  /** AI boleh jawab dari dokumen. `null` = memakai RAG_ENABLED dari .env. */
  ragEnabled: boolean | null;
  /** AI boleh baca gambar. `null` = memakai VISION_ENABLED dari .env. */
  visionEnabled: boolean | null;
  /** AI boleh ingat otomatis. `null` = memakai AUTO_MEMORY dari .env. */
  autoMemory: boolean | null;
  /** Hanya admin yang boleh buat room. `null` = memakai ADMIN_ONLY_ROOMS dari .env. */
  adminOnlyRooms: boolean | null;
  createdAt: number;
}

/** Satu pilihan server di dropdown dashboard. */
export interface GuildChoice {
  id: string;
  name: string | null;
}

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

export interface Room {
  channelId: string;
  guildId: string;
  userId: string;
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

/* ------------------------------------------------------------------ */
/*  Arsip transkrip                                                    */
/* ------------------------------------------------------------------ */

/** Ringkasan satu sesi AI yang sudah ditutup (tanpa HTML-nya). */
export interface TranscriptSummary {
  id: number;
  guildId: string;
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
  fileName: string;
  summary: string | null;
  messageCount: number;
  memoryCount: number;
  sizeBytes: number;
  createdAt: number;
}

/** Satu arsip transkrip lengkap, termasuk file HTML yang bisa diunduh. */
export interface TranscriptRecord extends TranscriptSummary {
  html: string;
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
  tts_reply_in_room: number | boolean | null;
  rag_enabled: number | boolean | null;
  vision_enabled: number | boolean | null;
  auto_memory: number | boolean | null;
  admin_only_rooms: number | boolean | null;
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
interface RoomRow {
  channel_id: string;
  guild_id: string;
  user_id: string;
  created_at: number;
  last_active_at: number;
  message_count: number;
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
  name: row.name ?? null,
  persona: row.persona,
  model: row.model,
  ttsReplyInRoom:
    row.tts_reply_in_room === null || row.tts_reply_in_room === undefined
      ? null
      : Boolean(row.tts_reply_in_room),
  ragEnabled:
    row.rag_enabled === null || row.rag_enabled === undefined ? null : Boolean(row.rag_enabled),
  visionEnabled:
    row.vision_enabled === null || row.vision_enabled === undefined ? null : Boolean(row.vision_enabled),
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

const toRoom = (row: RoomRow): Room => ({
  channelId: row.channel_id,
  guildId: row.guild_id,
  userId: row.user_id,
  createdAt: Number(row.created_at),
  lastActiveAt: Number(row.last_active_at),
  messageCount: Number(row.message_count),
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
 * Simpan toggle "RAG suara di room" per server.
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

/** AI boleh baca gambar. `null` = pakai VISION_ENABLED dari .env. */
export async function setGuildVisionEnabled(guildId: string, enabled: boolean | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET vision_enabled = ? WHERE guild_id = ?', [enabled === null ? null : enabled ? 1 : 0, guildId]);
}

/** AI boleh ingat otomatis. `null` = pakai AUTO_MEMORY dari .env. */
export async function setGuildAutoMemory(guildId: string, enabled: boolean | null): Promise<void> {
  await ensureGuild(guildId);
  await run('UPDATE guilds SET auto_memory = ? WHERE guild_id = ?', [enabled === null ? null : enabled ? 1 : 0, guildId]);
}

/** Hanya admin yang boleh buat room. `null` = pakai ADMIN_ONLY_ROOMS dari .env. */
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
/*  Rooms                                                              */
/* ------------------------------------------------------------------ */

export async function createRoom(channelId: string, guildId: string, userId: string): Promise<void> {
  const now = Date.now();
  // Setiap room menyiratkan server: pastikan baris `guilds` ada supaya server
  // muncul di dropdown dashboard (kalau tidak, dashboard tampak kosong).
  await ensureGuild(guildId);
  await run(
    `INSERT INTO rooms (channel_id, guild_id, user_id, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (channel_id) DO UPDATE SET guild_id = excluded.guild_id, user_id = excluded.user_id`,
    [channelId, guildId, userId, now, now],
  );
}

export async function getRoomByChannel(channelId: string): Promise<Room | null> {
  const row = await get<RoomRow>('SELECT * FROM rooms WHERE channel_id = ?', [channelId]);
  return row ? toRoom(row) : null;
}

export async function getRoomByUser(guildId: string, userId: string): Promise<Room | null> {
  const row = await get<RoomRow>('SELECT * FROM rooms WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return row ? toRoom(row) : null;
}

export async function listRooms(guildId: string): Promise<Room[]> {
  const rows = await all<RoomRow>('SELECT * FROM rooms WHERE guild_id = ? ORDER BY last_active_at DESC', [guildId]);
  return rows.map(toRoom);
}

export async function touchRoom(channelId: string, messagesAdded = 1): Promise<void> {
  await run('UPDATE rooms SET last_active_at = ?, message_count = message_count + ? WHERE channel_id = ?', [
    Date.now(),
    messagesAdded,
    channelId,
  ]);
}

export async function deleteRoom(channelId: string): Promise<void> {
  await run('DELETE FROM rooms WHERE channel_id = ?', [channelId]);
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
 * Server yang punya data + nama tampilannya (bila sudah diketahui bot).
 *
 * Dipakai dashboard: dropdown menampilkan nama, bukan ID mentah. Server yang
 * belum pernah dilihat bot (mode dashboard saja) tetap muncul dengan `name: null`
 * supaya datanya tidak "hilang" dari dashboard.
 */
export async function listGuilds(): Promise<GuildChoice[]> {
  const rows = await all<{ guild_id: string; name: string | null }>(
    `SELECT ids.guild_id AS guild_id, guilds.name AS name
     FROM (
       SELECT guild_id FROM guilds
       UNION SELECT guild_id FROM rooms
       UNION SELECT guild_id FROM documents
       UNION SELECT guild_id FROM keywords
       UNION SELECT guild_id FROM memories
     ) AS ids
     LEFT JOIN guilds ON guilds.guild_id = ids.guild_id
     ORDER BY ids.guild_id`,
  );
  return rows.map((row) => ({ id: row.guild_id, name: row.name?.trim() || null }));
}

export async function countRows(
  table: 'memories' | 'keywords' | 'rooms' | 'messages' | 'documents' | 'chunks',
): Promise<number> {
  const row = await get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
  return Number(row?.total ?? 0);
}

/** Jumlah baris milik satu server — dipakai dashboard agar angka cocok dengan daftar di bawahnya. */
export async function countGuildRows(
  guildId: string,
  table: 'memories' | 'keywords' | 'rooms' | 'documents' | 'chunks',
): Promise<number> {
  const row = await get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE guild_id = ?`, [guildId]);
  return Number(row?.total ?? 0);
}

/** Tabel `messages` tidak menyimpan `guild_id` — hitung lewat room milik server itu. */
export async function countGuildMessages(guildId: string): Promise<number> {
  const row = await get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM messages m
     JOIN rooms r ON r.channel_id = m.channel_id
     WHERE r.guild_id = ?`,
    [guildId],
  );
  return Number(row?.total ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Arsip transkrip                                                    */
/* ------------------------------------------------------------------ */

interface TranscriptRow {
  id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  file_name: string;
  summary: string | null;
  message_count: number;
  memory_count: number;
  size_bytes: number;
  created_at: number;
}

function toTranscriptSummary(row: TranscriptRow): TranscriptSummary {
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    userId: row.user_id,
    userName: row.user_name,
    fileName: row.file_name,
    summary: row.summary,
    messageCount: Number(row.message_count),
    memoryCount: Number(row.memory_count),
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at),
  };
}

/**
 * Simpan arsip sesi AI yang baru ditutup.
 *
 * HTML-nya ikut disimpan di database (bukan file terpisah) supaya dashboard bisa
 * mengunduh transkrip lama walau folder `transcripts/` di panel sudah dibersihkan
 * atau bot dipindah ke host lain. `size_bytes` disimpan supaya daftar transkrip
 * tidak perlu membaca kolom HTML yang besar.
 */
export async function insertTranscript(input: {
  guildId: string;
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
  fileName: string;
  summary?: string | null;
  messageCount: number;
  memoryCount: number;
  html: string;
  createdAt?: number;
}): Promise<number> {
  return insert(
    `INSERT INTO transcripts
      (guild_id, channel_id, channel_name, user_id, user_name, file_name, summary,
       message_count, memory_count, size_bytes, html, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.guildId,
      input.channelId,
      input.channelName,
      input.userId,
      input.userName,
      input.fileName,
      input.summary ?? null,
      input.messageCount,
      input.memoryCount,
      Buffer.byteLength(input.html, 'utf8'),
      input.html,
      input.createdAt ?? Date.now(),
    ],
  );
}

/** Daftar transkrip satu server, terbaru dulu. Kolom HTML tidak ikut dibaca. */
export async function listTranscripts(guildId: string, limit = 100): Promise<TranscriptSummary[]> {
  const rows = await all<TranscriptRow>(
    `SELECT id, guild_id, channel_id, channel_name, user_id, user_name, file_name, summary,
            message_count, memory_count, size_bytes, created_at
     FROM transcripts WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [guildId, limit],
  );
  return rows.map(toTranscriptSummary);
}

/** Satu transkrip lengkap (dengan HTML) — dipakai untuk unduhan. */
export async function getTranscript(guildId: string, id: number): Promise<TranscriptRecord | null> {
  const row = await get<TranscriptRow & { html: string }>('SELECT * FROM transcripts WHERE guild_id = ? AND id = ?', [
    guildId,
    id,
  ]);
  if (!row) return null;
  return { ...toTranscriptSummary(row), html: row.html };
}

export async function deleteTranscript(guildId: string, id: number): Promise<boolean> {
  const info = await run('DELETE FROM transcripts WHERE guild_id = ? AND id = ?', [guildId, id]);
  return info.changes > 0;
}

export async function countTranscripts(guildId: string): Promise<number> {
  const row = await get<{ total: number }>('SELECT COUNT(*) AS total FROM transcripts WHERE guild_id = ?', [guildId]);
  return Number(row?.total ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Statistik dashboard                                                */
/* ------------------------------------------------------------------ */

export interface MemoryOwner {
  userId: string;
  count: number;
  lastAt: number;
}

/** Pemilik memori di satu server, diurutkan dari yang paling banyak. */
export async function listMemoryOwners(guildId: string): Promise<MemoryOwner[]> {
  const rows = await all<{ user_id: string; total: number; last_at: number }>(
    `SELECT user_id, COUNT(*) AS total, MAX(created_at) AS last_at
     FROM memories WHERE guild_id = ?
     GROUP BY user_id ORDER BY total DESC, last_at DESC`,
    [guildId],
  );
  return rows.map((row) => ({ userId: row.user_id, count: Number(row.total), lastAt: Number(row.last_at) }));
}

/** Semua memori satu server (untuk halaman Memori). */
export async function listGuildMemories(guildId: string, limit = 500): Promise<Memory[]> {
  const rows = await all<MemoryRow>('SELECT * FROM memories WHERE guild_id = ? ORDER BY id DESC LIMIT ?', [
    guildId,
    limit,
  ]);
  return rows.map(toMemory);
}

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
     JOIN rooms r ON r.channel_id = m.channel_id
     WHERE r.guild_id = ? AND m.created_at >= ?`,
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
  content: string;
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

export async function addModerationLog(input: {
  guildId: string;
  channelId: string;
  userId: string;
  userName: string;
  content: string;
  matched: string;
  action: ModerationAction;
}): Promise<number> {
  return insert(
    `INSERT INTO mod_logs (guild_id, channel_id, user_id, user_name, content, matched, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.guildId,
      input.channelId,
      input.userId,
      input.userName,
      input.content.slice(0, 500),
      input.matched,
      input.action,
      Date.now(),
    ],
  );
}

export async function listModerationLogs(guildId: string, limit = 50): Promise<ModerationLog[]> {
  const rows = await all<{
    id: number;
    guild_id: string;
    channel_id: string;
    user_id: string;
    user_name: string;
    content: string;
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
    content: row.content,
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
/*  Panel room AI (satu channel per server)                            */
/* ------------------------------------------------------------------ */

export interface PanelState {
  guildId: string;
  /** Channel tempat panel dikirim terakhir kali (`null` = belum pernah). */
  channelId: string | null;
  /** ID pesan panel, dipakai untuk menghapus/mengganti panel lama. */
  messageId: string | null;
  /** `false` = tombol "Buat Room AI" ditolak walau pesan panelnya masih ada. */
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

/** Nyalakan/matikan tombol pembuat room tanpa menghapus pesan panelnya. */
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
