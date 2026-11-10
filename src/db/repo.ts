import { db } from './index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GuildSettings {
  guildId: string;
  persona: string | null;
  model: string | null;
  createdAt: number;
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
  persona: string | null;
  model: string | null;
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
  persona: row.persona,
  model: row.model,
  createdAt: row.created_at,
});

const toMemory = (row: MemoryRow): Memory => ({
  id: row.id,
  guildId: row.guild_id,
  userId: row.user_id,
  content: row.content,
  source: row.source,
  createdAt: row.created_at,
});

const toKeyword = (row: KeywordRow): Keyword => ({
  id: row.id,
  guildId: row.guild_id,
  trigger: row.trigger,
  answer: row.answer,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const toRoom = (row: RoomRow): Room => ({
  channelId: row.channel_id,
  guildId: row.guild_id,
  userId: row.user_id,
  createdAt: row.created_at,
  lastActiveAt: row.last_active_at,
  messageCount: row.message_count,
});

const toDocument = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  guildId: row.guild_id,
  name: row.name,
  source: row.source,
  chars: row.chars,
  chunkCount: row.chunk_count,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const toChunk = (row: ChunkRow): ChunkRecord => ({
  id: row.id,
  documentId: row.document_id,
  guildId: row.guild_id,
  ordinal: row.ordinal,
  content: row.content,
  embedding: row.embedding,
});

const toMessage = (row: MessageRow): StoredMessage => ({
  id: row.id,
  channelId: row.channel_id,
  role: row.role === 'assistant' ? 'assistant' : 'user',
  content: row.content,
  createdAt: row.created_at,
});

/* ------------------------------------------------------------------ */
/*  Guild settings                                                     */
/* ------------------------------------------------------------------ */

export function ensureGuild(guildId: string): void {
  db.prepare('INSERT OR IGNORE INTO guilds (guild_id, created_at) VALUES (?, ?)').run(guildId, Date.now());
}

export function getGuildSettings(guildId: string): GuildSettings | null {
  const row = db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId) as GuildRow | undefined;
  return row ? toGuild(row) : null;
}

export function setPersona(guildId: string, persona: string | null): void {
  ensureGuild(guildId);
  db.prepare('UPDATE guilds SET persona = ? WHERE guild_id = ?').run(persona, guildId);
}

export function setGuildModel(guildId: string, model: string | null): void {
  ensureGuild(guildId);
  db.prepare('UPDATE guilds SET model = ? WHERE guild_id = ?').run(model, guildId);
}

/* ------------------------------------------------------------------ */
/*  Memory                                                             */
/* ------------------------------------------------------------------ */

export function addMemory(
  guildId: string,
  userId: string,
  content: string,
  source: 'manual' | 'auto' = 'manual',
): { inserted: boolean; id: number | null } {
  const cleaned = content.trim();
  if (!cleaned) return { inserted: false, id: null };

  const existing = db
    .prepare('SELECT id FROM memories WHERE guild_id = ? AND user_id = ? AND content = ?')
    .get(guildId, userId, cleaned) as { id: number } | undefined;
  if (existing) return { inserted: false, id: existing.id };

  const info = db
    .prepare('INSERT INTO memories (guild_id, user_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, userId, cleaned, source, Date.now());

  return { inserted: true, id: Number(info.lastInsertRowid) };
}

export function listMemories(guildId: string, userId: string, limit = 50): Memory[] {
  const rows = db
    .prepare('SELECT * FROM memories WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, userId, limit) as unknown as MemoryRow[];
  return rows.map(toMemory);
}

export function deleteMemory(guildId: string, userId: string, id: number): boolean {
  const info = db.prepare('DELETE FROM memories WHERE guild_id = ? AND user_id = ? AND id = ?').run(guildId, userId, id);
  return Number(info.changes) > 0;
}

export function clearMemories(guildId: string, userId: string): number {
  const info = db.prepare('DELETE FROM memories WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  return Number(info.changes);
}

/* ------------------------------------------------------------------ */
/*  Keywords                                                           */
/* ------------------------------------------------------------------ */

export function addKeyword(
  guildId: string,
  trigger: string,
  answer: string,
  createdBy: string | null,
): { ok: boolean; id?: number; reason?: 'duplicate' } {
  const cleanTrigger = trigger.trim().toLowerCase();
  const cleanAnswer = answer.trim();
  if (!cleanTrigger || !cleanAnswer) return { ok: false };

  const existing = db
    .prepare('SELECT id FROM keywords WHERE guild_id = ? AND trigger = ?')
    .get(guildId, cleanTrigger) as { id: number } | undefined;
  if (existing) return { ok: false, reason: 'duplicate' };

  const info = db
    .prepare('INSERT INTO keywords (guild_id, trigger, answer, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, cleanTrigger, cleanAnswer, createdBy ?? null, Date.now());

  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function listKeywords(guildId: string, limit = 100): Keyword[] {
  const rows = db
    .prepare('SELECT * FROM keywords WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, limit) as unknown as KeywordRow[];
  return rows.map(toKeyword);
}

export function deleteKeyword(guildId: string, id: number): boolean {
  const info = db.prepare('DELETE FROM keywords WHERE guild_id = ? AND id = ?').run(guildId, id);
  return Number(info.changes) > 0;
}

/* ------------------------------------------------------------------ */
/*  Rooms                                                              */
/* ------------------------------------------------------------------ */

export function createRoom(channelId: string, guildId: string, userId: string): void {
  const now = Date.now();
  // Setiap room menyiratkan server: pastikan baris `guilds` ada supaya server
  // muncul di dropdown dashboard (kalau tidak, dashboard tampak kosong).
  ensureGuild(guildId);
  db.prepare(
    `INSERT INTO rooms (channel_id, guild_id, user_id, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET guild_id = excluded.guild_id, user_id = excluded.user_id`,
  ).run(channelId, guildId, userId, now, now);
}

export function getRoomByChannel(channelId: string): Room | null {
  const row = db.prepare('SELECT * FROM rooms WHERE channel_id = ?').get(channelId) as RoomRow | undefined;
  return row ? toRoom(row) : null;
}

export function getRoomByUser(guildId: string, userId: string): Room | null {
  const row = db.prepare('SELECT * FROM rooms WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as
    | RoomRow
    | undefined;
  return row ? toRoom(row) : null;
}

export function listRooms(guildId: string): Room[] {
  const rows = db.prepare('SELECT * FROM rooms WHERE guild_id = ? ORDER BY last_active_at DESC').all(guildId) as unknown as RoomRow[];
  return rows.map(toRoom);
}

export function touchRoom(channelId: string, messagesAdded = 1): void {
  db.prepare('UPDATE rooms SET last_active_at = ?, message_count = message_count + ? WHERE channel_id = ?').run(
    Date.now(),
    messagesAdded,
    channelId,
  );
}

export function deleteRoom(channelId: string): void {
  db.prepare('DELETE FROM rooms WHERE channel_id = ?').run(channelId);
}

/* ------------------------------------------------------------------ */
/*  Conversation history                                               */
/* ------------------------------------------------------------------ */

export function appendMessage(channelId: string, role: ChatRole, content: string): void {
  db.prepare('INSERT INTO messages (channel_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
    channelId,
    role,
    content,
    Date.now(),
  );
}

/** Ambil N pesan terakhir, dikembalikan urut lama -> baru. */
export function getHistory(channelId: string, limit: number): StoredMessage[] {
  if (limit <= 0) return [];
  const rows = db
    .prepare('SELECT sub.* FROM (SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?) sub ORDER BY sub.id ASC')
    .all(channelId, limit) as unknown as MessageRow[];
  return rows.map(toMessage);
}

export function clearHistory(channelId: string): number {
  const info = db.prepare('DELETE FROM messages WHERE channel_id = ?').run(channelId);
  return Number(info.changes);
}

export function countHistory(channelId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM messages WHERE channel_id = ?').get(channelId) as { total: number };
  return row.total;
}

/* ------------------------------------------------------------------ */
/*  Dokumen (RAG)                                                      */
/* ------------------------------------------------------------------ */

export function insertDocument(input: {
  guildId: string;
  name: string;
  source?: string;
  chars: number;
  createdBy?: string | null;
}): number {
  const info = db
    .prepare(
      `INSERT INTO documents (guild_id, name, source, chars, chunk_count, created_by, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(input.guildId, input.name, input.source ?? 'upload', input.chars, input.createdBy ?? null, Date.now());
  return Number(info.lastInsertRowid);
}

export function insertChunks(
  documentId: number,
  guildId: string,
  chunks: Array<{ content: string; embedding?: number[] | null }>,
): void {
  const statement = db.prepare(
    'INSERT INTO chunks (document_id, guild_id, ordinal, content, embedding) VALUES (?, ?, ?, ?, ?)',
  );

  chunks.forEach((chunk, index) => {
    statement.run(
      documentId,
      guildId,
      index,
      chunk.content,
      chunk.embedding && chunk.embedding.length > 0 ? JSON.stringify(chunk.embedding) : null,
    );
  });

  db.prepare('UPDATE documents SET chunk_count = ? WHERE id = ?').run(chunks.length, documentId);
}

export function listDocuments(guildId: string): DocumentRecord[] {
  const rows = db
    .prepare(
      `SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
       FROM documents d WHERE d.guild_id = ? ORDER BY d.id DESC`,
    )
    .all(guildId) as unknown as DocumentRow[];
  return rows.map(toDocument);
}

export function getDocument(guildId: string, id: number): DocumentRecord | null {
  const row = db.prepare('SELECT * FROM documents WHERE guild_id = ? AND id = ?').get(guildId, id) as
    | DocumentRow
    | undefined;
  return row ? toDocument(row) : null;
}

export function findDocumentByName(guildId: string, name: string): DocumentRecord | null {
  const row = db
    .prepare('SELECT * FROM documents WHERE guild_id = ? AND lower(name) = lower(?)')
    .get(guildId, name.trim()) as DocumentRow | undefined;
  return row ? toDocument(row) : null;
}

export function deleteDocument(guildId: string, id: number): boolean {
  // Hapus potongan lebih dulu supaya tetap aman walau foreign_keys dimatikan.
  db.prepare('DELETE FROM chunks WHERE guild_id = ? AND document_id = ?').run(guildId, id);
  const info = db.prepare('DELETE FROM documents WHERE guild_id = ? AND id = ?').run(guildId, id);
  return Number(info.changes) > 0;
}

/** Semua potongan satu server, lengkap dengan nama dokumennya (untuk indeks pencarian). */
export function listChunks(guildId: string, limit = 5000): ChunkWithDocument[] {
  const rows = db
    .prepare(
      `SELECT c.*, d.name AS document_name
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.guild_id = ? ORDER BY c.document_id DESC, c.ordinal ASC LIMIT ?`,
    )
    .all(guildId, limit) as unknown as Array<ChunkRow & { document_name: string }>;

  return rows.map((row) => ({ ...toChunk(row), documentName: row.document_name }));
}

export function countChunks(guildId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE guild_id = ?').get(guildId) as { total: number };
  return row.total;
}

/**
 * Daftar server untuk dropdown dashboard.
 *
 * Sumbernya bukan hanya tabel `guilds`: database lama (atau bot yang baru saja
 * dipasang) bisa sudah punya room/dokumen/keyword/memori tanpa baris `guilds`.
 * Kalau kita hanya membaca `guilds`, dashboard menampilkan "(belum ada server)"
 * padahal data bot jelas ada. UNION membuat data itu tetap muncul.
 */
export function listGuildIds(): string[] {
  const rows = db
    .prepare(
      `SELECT guild_id FROM guilds
       UNION SELECT guild_id FROM rooms
       UNION SELECT guild_id FROM documents
       UNION SELECT guild_id FROM keywords
       UNION SELECT guild_id FROM memories
       ORDER BY guild_id`,
    )
    .all() as unknown as Array<{ guild_id: string }>;
  return rows.map((row) => row.guild_id);
}

export function countRows(table: 'memories' | 'keywords' | 'rooms' | 'messages' | 'documents' | 'chunks'): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return row.total;
}

/** Jumlah baris milik satu server — dipakai dashboard agar angka cocok dengan daftar di bawahnya. */
export function countGuildRows(
  guildId: string,
  table: 'memories' | 'keywords' | 'rooms' | 'documents' | 'chunks',
): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE guild_id = ?`).get(guildId) as {
    total: number;
  };
  return row.total;
}

/** Tabel `messages` tidak menyimpan `guild_id` — hitung lewat room milik server itu. */
export function countGuildMessages(guildId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM messages m
       JOIN rooms r ON r.channel_id = m.channel_id
       WHERE r.guild_id = ?`,
    )
    .get(guildId) as { total: number };
  return row.total;
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
export function insertTranscript(input: {
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
}): number {
  const result = db
    .prepare(
      `INSERT INTO transcripts
        (guild_id, channel_id, channel_name, user_id, user_name, file_name, summary,
         message_count, memory_count, size_bytes, html, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
  return Number(result.lastInsertRowid);
}

/** Daftar transkrip satu server, terbaru dulu. Kolom HTML tidak ikut dibaca. */
export function listTranscripts(guildId: string, limit = 100): TranscriptSummary[] {
  const rows = db
    .prepare(
      `SELECT id, guild_id, channel_id, channel_name, user_id, user_name, file_name, summary,
              message_count, memory_count, size_bytes, created_at
       FROM transcripts WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(guildId, limit) as unknown as TranscriptRow[];
  return rows.map(toTranscriptSummary);
}

/** Satu transkrip lengkap (dengan HTML) — dipakai untuk unduhan. */
export function getTranscript(guildId: string, id: number): TranscriptRecord | null {
  const row = db
    .prepare('SELECT * FROM transcripts WHERE guild_id = ? AND id = ?')
    .get(guildId, id) as unknown as (TranscriptRow & { html: string }) | undefined;
  if (!row) return null;
  return { ...toTranscriptSummary(row), html: row.html };
}

export function deleteTranscript(guildId: string, id: number): boolean {
  const result = db.prepare('DELETE FROM transcripts WHERE guild_id = ? AND id = ?').run(guildId, id);
  return result.changes > 0;
}

export function countTranscripts(guildId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM transcripts WHERE guild_id = ?').get(guildId) as {
    total: number;
  };
  return row.total;
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
export function listMemoryOwners(guildId: string): MemoryOwner[] {
  const rows = db
    .prepare(
      `SELECT user_id, COUNT(*) AS total, MAX(created_at) AS last_at
       FROM memories WHERE guild_id = ?
       GROUP BY user_id ORDER BY total DESC, last_at DESC`,
    )
    .all(guildId) as unknown as Array<{ user_id: string; total: number; last_at: number }>;
  return rows.map((row) => ({ userId: row.user_id, count: Number(row.total), lastAt: Number(row.last_at) }));
}

/** Semua memori satu server (untuk halaman Memori). */
export function listGuildMemories(guildId: string, limit = 500): Memory[] {
  const rows = db
    .prepare('SELECT * FROM memories WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, limit) as unknown as MemoryRow[];
  return rows.map(toMemory);
}

/**
 * Jumlah pesan per hari (zona waktu WIB) selama `days` hari terakhir.
 * Dipakai grafik aktivitas di dashboard.
 */
export function messagesPerDay(guildId: string, days = 7, timeZone = 'Asia/Jakarta'): Array<{ day: string; count: number }> {
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
  const rows = db
    .prepare(
      `SELECT m.created_at AS created_at FROM messages m
       JOIN rooms r ON r.channel_id = m.channel_id
       WHERE r.guild_id = ? AND m.created_at >= ?`,
    )
    .all(guildId, since) as unknown as Array<{ created_at: number }>;

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
export function getModerationSettings(guildId: string): ModerationSettings | null {
  const row = db.prepare('SELECT * FROM moderation WHERE guild_id = ?').get(guildId) as unknown as
    | ModerationRow
    | undefined;
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

export function setModerationSettings(input: {
  guildId: string;
  enabled: boolean;
  words: string[] | string;
  action: ModerationAction;
  timeoutMinutes: number;
}): void {
  const words = Array.isArray(input.words) ? input.words : splitWords(input.words);
  const timeout = Math.min(10080, Math.max(1, Math.round(input.timeoutMinutes)));

  db.prepare(
    `INSERT INTO moderation (guild_id, enabled, words, action, timeout_minutes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       enabled = excluded.enabled,
       words = excluded.words,
       action = excluded.action,
       timeout_minutes = excluded.timeout_minutes,
       updated_at = excluded.updated_at`,
  ).run(input.guildId, input.enabled ? 1 : 0, words.join(','), input.action, timeout, Date.now());
}

export function addModerationLog(input: {
  guildId: string;
  channelId: string;
  userId: string;
  userName: string;
  content: string;
  matched: string;
  action: ModerationAction;
}): number {
  const result = db
    .prepare(
      `INSERT INTO mod_logs (guild_id, channel_id, user_id, user_name, content, matched, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.channelId,
      input.userId,
      input.userName,
      input.content.slice(0, 500),
      input.matched,
      input.action,
      Date.now(),
    );
  return Number(result.lastInsertRowid);
}

export function listModerationLogs(guildId: string, limit = 50): ModerationLog[] {
  const rows = db
    .prepare('SELECT * FROM mod_logs WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(guildId, limit) as unknown as Array<{
    id: number;
    guild_id: string;
    channel_id: string;
    user_id: string;
    user_name: string;
    content: string;
    matched: string;
    action: string;
    created_at: number;
  }>;

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

export function deleteModerationLog(guildId: string, id: number): boolean {
  const result = db.prepare('DELETE FROM mod_logs WHERE guild_id = ? AND id = ?').run(guildId, id);
  return result.changes > 0;
}

export function clearModerationLogs(guildId: string): number {
  const result = db.prepare('DELETE FROM mod_logs WHERE guild_id = ?').run(guildId);
  return Number(result.changes);
}

export function countModerationLogs(guildId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM mod_logs WHERE guild_id = ?').get(guildId) as {
    total: number;
  };
  return row.total;
}

