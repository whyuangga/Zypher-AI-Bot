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

export function listGuildIds(): string[] {
  const rows = db.prepare('SELECT guild_id FROM guilds ORDER BY guild_id').all() as unknown as Array<{ guild_id: string }>;
  return rows.map((row) => row.guild_id);
}

export function countRows(table: 'memories' | 'keywords' | 'rooms' | 'messages' | 'documents' | 'chunks'): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return row.total;
}
