/**
 * Web dashboard minimal di atas `node:http` — tanpa Express, tanpa build step.
 *
 * Auth: satu token admin (`DASHBOARD_TOKEN`) → sesi cookie httpOnly.
 * Kalau `DASHBOARD_TOKEN` kosong, dashboard tidak dijalankan sama sekali,
 * jadi server Discord tetap bisa dipakai tanpa membuka port apa pun.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { config } from '../config.js';
import {
  countChunks,
  countRows,
  listDocuments,
  listGuildIds,
  listKeywords,
  listMemories,
  listRooms,
  deleteKeyword,
} from '../db/repo.js';
import { DocumentError, ingestDocument, removeDocument, searchKnowledge } from '../features/rag.js';
import { embeddingModelName } from '../features/rag-embed.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { dashboardPage, documentsPage, loginPage } from './views.js';

const SESSION_COOKIE = 'zp_session';
const GUILD_COOKIE = 'zp_guild';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

const sessions = new Map<string, number>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/* ------------------------------------------------------------------ */
/*  Util                                                               */
/* ------------------------------------------------------------------ */

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new DocumentError(`Isi request terlalu besar (batas ${Math.round(limit / 1024)} KB).`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function redirect(response: ServerResponse, location: string, cookie?: string): void {
  const headers: Record<string, string> = { location };
  if (cookie) headers['set-cookie'] = cookie;
  response.writeHead(303, headers);
  response.end();
}

function tokenMatches(candidate: string): boolean {
  const expected = config.dashboard.token ?? '';
  if (!expected) return false;

  const a = Buffer.from(candidate.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hasSession(request: IncomingMessage): boolean {
  const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!sessionId) return false;

  const expiresAt = sessions.get(sessionId);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

function resolveGuild(request: IncomingMessage, url: URL): string {
  const fromQuery = url.searchParams.get('guild');
  if (fromQuery) return fromQuery;

  const fromCookie = parseCookies(request.headers.cookie)[GUILD_COOKIE];
  if (fromCookie) return fromCookie;

  return listGuildIds()[0] ?? '';
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method ?? 'GET';

  // Health check tanpa auth — dipakai hosting untuk memastikan proses hidup.
  if (path === '/healthz') {
    sendJson(response, 200, {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      rag: config.rag.enabled,
      documents: countRows('documents'),
      rooms: countRows('rooms'),
    });
    return;
  }

  if (path === '/login' && method === 'GET') {
    sendHtml(response, 200, loginPage());
    return;
  }

  if (path === '/login' && method === 'POST') {
    const ip = request.socket.remoteAddress ?? 'unknown';
    const attempt = loginAttempts.get(ip);

    if (attempt && attempt.resetAt > Date.now() && attempt.count >= LOGIN_MAX_ATTEMPTS) {
      sendHtml(response, 429, loginPage('Terlalu banyak percobaan. Tunggu beberapa menit.'));
      return;
    }

    const body = await readBody(request, 8 * 1024);
    const submitted = new URLSearchParams(body).get('token') ?? '';

    if (!tokenMatches(submitted)) {
      const next = attempt && attempt.resetAt > Date.now() ? attempt : { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
      next.count += 1;
      loginAttempts.set(ip, next);
      logger.warn(`Login dashboard gagal dari ${ip}`);
      sendHtml(response, 401, loginPage('Token salah.'));
      return;
    }

    loginAttempts.delete(ip);
    const sessionId = randomBytes(24).toString('hex');
    sessions.set(sessionId, Date.now() + SESSION_TTL_MS);

    const secure = (request.headers['x-forwarded-proto'] ?? '').toString() === 'https' ? '; Secure' : '';
    redirect(
      response,
      '/',
      `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`,
    );
    return;
  }

  if (path === '/logout') {
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (sessionId) sessions.delete(sessionId);
    redirect(response, '/login', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    return;
  }

  if (!hasSession(request)) {
    if (path.startsWith('/api/')) {
      sendJson(response, 401, { error: 'Belum login. Buka /login dulu.' });
      return;
    }
    redirect(response, '/login');
    return;
  }

  let guildId = resolveGuild(request, url);
  // Mode dashboard-saja (bot belum pernah join server): izinkan ID dikirim header.
  if (!guildId) {
    const header = request.headers['x-guild'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && value.trim()) guildId = value.trim();
  }
  const guildCookie = guildId ? `${GUILD_COOKIE}=${encodeURIComponent(guildId)}; Path=/; SameSite=Lax` : undefined;
  if (url.searchParams.get('guild') && guildCookie) {
    response.setHeader('set-cookie', guildCookie);
  }

  /* ---------------- halaman ---------------- */

  if (path === '/' && method === 'GET') {
    const rooms = guildId ? listRooms(guildId).slice(0, 8) : [];
    const documents = guildId ? listDocuments(guildId).slice(0, 6) : [];

    sendHtml(
      response,
      200,
      dashboardPage({
        guildId,
        guilds: listGuildIds(),
        stats: {
          rooms: countRows('rooms'),
          documents: countRows('documents'),
          chunks: countRows('chunks'),
          keywords: guildId ? listKeywords(guildId).length : 0,
          memories: countRows('memories'),
          messages: countRows('messages'),
        },
        rooms: rooms.map((room) => ({
          channelId: room.channelId,
          userId: room.userId,
          messageCount: room.messageCount,
          lastActiveAt: room.lastActiveAt,
        })),
        documents: documents.map((document) => ({
          id: document.id,
          name: document.name,
          chunkCount: document.chunkCount,
          chars: document.chars,
          createdAt: document.createdAt,
        })),
        ragEnabled: config.rag.enabled,
        embedModel: embeddingModelName(),
      }),
    );
    return;
  }

  if (path === '/dokumen' && method === 'GET') {
    sendHtml(
      response,
      200,
      documentsPage({
        guildId,
        guilds: listGuildIds(),
        documents: guildId
          ? listDocuments(guildId).map((document) => ({
              id: document.id,
              name: document.name,
              chunkCount: document.chunkCount,
              chars: document.chars,
              source: document.source,
              createdAt: document.createdAt,
            }))
          : [],
        embedModel: embeddingModelName(),
      }),
    );
    return;
  }

  /* ---------------- API ---------------- */

  if (path === '/api/dokumen' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Guild belum dipilih. Buka dashboard lewat ?guild=<id>.' });
      return;
    }

    const limit = Math.min(config.rag.maxChars * 4 + 64 * 1024, 16 * 1024 * 1024);
    const body = await readBody(request, limit);
    const headerName = request.headers['x-filename'];
    const rawName = Array.isArray(headerName) ? (headerName[0] ?? '') : (headerName ?? 'dokumen.txt');
    let name = 'dokumen.txt';
    try {
      name = decodeURIComponent(rawName) || 'dokumen.txt';
    } catch {
      name = rawName || 'dokumen.txt';
    }

    const result = await ingestDocument({
      guildId,
      name: name || 'dokumen.txt',
      content: body,
      source: 'dashboard',
    });

    sendJson(response, 200, {
      id: result.document.id,
      name: result.document.name,
      chunkCount: result.chunkCount,
      embedded: result.embedded,
    });
    return;
  }

  const documentMatch = /^\/api\/dokumen\/(\d+)$/.exec(path);
  if (documentMatch && method === 'DELETE') {
    const id = Number(documentMatch[1]);
    const removed = guildId ? removeDocument(guildId, id) : false;
    sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'Dokumen tidak ditemukan.' });
    return;
  }

  if (path === '/api/search' && method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    if (!guildId || !query.trim()) {
      sendJson(response, 200, { results: [] });
      return;
    }

    const results = await searchKnowledge(guildId, query, { topK: 5 });
    sendJson(response, 200, {
      results: results.map((result) => ({
        documentName: result.documentName,
        ordinal: result.ordinal,
        score: Number(result.score.toFixed(3)),
        via: result.via,
        preview: truncate(result.content, 600),
      })),
    });
    return;
  }

  if (path === '/api/documents' && method === 'GET') {
    sendJson(response, 200, { documents: guildId ? listDocuments(guildId) : [] });
    return;
  }

  if (path === '/api/rooms' && method === 'GET') {
    sendJson(response, 200, { rooms: guildId ? listRooms(guildId) : [] });
    return;
  }

  if (path === '/api/memories' && method === 'GET') {
    const userId = url.searchParams.get('user') ?? '';
    sendJson(response, 200, {
      memories: guildId && userId ? listMemories(guildId, userId, 200) : [],
    });
    return;
  }

  const keywordMatch = /^\/api\/keyword\/(\d+)$/.exec(path);
  if (keywordMatch && method === 'DELETE') {
    const id = Number(keywordMatch[1]);
    const removed = guildId ? deleteKeyword(guildId, id) : false;
    sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'Keyword tidak ditemukan.' });
    return;
  }

  sendJson(response, 404, { error: 'Tidak ditemukan.' });
}

/* ------------------------------------------------------------------ */
/*  Start / stop                                                       */
/* ------------------------------------------------------------------ */

let server: Server | null = null;

export function startDashboard(): Server | null {
  if (!config.dashboard.token) {
    logger.info('Dashboard web nonaktif (DASHBOARD_TOKEN kosong).');
    return null;
  }

  if (!config.dashboard.enabled) {
    logger.info('Dashboard web nonaktif (WEB_ENABLED=false).');
    return null;
  }

  if (server) return server;

  server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }

      // Kesalahan input user (mis. upload PDF) bukan bug server — jangan dicatat sebagai ERROR.
      if (error instanceof DocumentError) {
        logger.warn(`Dashboard: permintaan ditolak — ${error.message}`);
        sendJson(response, 400, { error: error.message });
        return;
      }

      logger.error(`Dashboard error: ${errorMessage(error)}`);
      sendJson(response, 500, { error: 'Terjadi kesalahan di server dashboard.' });
    });
  });

  server.listen(config.dashboard.port, config.dashboard.host, () => {
    const address = server?.address();
    const actualPort = typeof address === 'object' && address ? address.port : config.dashboard.port;
    const shownHost = config.dashboard.host === '0.0.0.0' ? 'localhost' : config.dashboard.host;

    const url = config.dashboard.publicUrl ?? `http://${shownHost}:${actualPort}`;
    logger.info(`🌐 Dashboard: ${url} (login pakai DASHBOARD_TOKEN)`);
    if (config.dashboard.portSource !== 'default') {
      logger.info(`   Port diambil dari ${config.dashboard.portSource}=${config.dashboard.port}`);
    }
    logger.info('   Di panel hosting, pakai port yang sama dengan yang diberikan panel (bukan selalu 3000).');
  });

  server.on('error', (error) => logger.error(`Dashboard gagal jalan di port ${config.dashboard.port}`, errorMessage(error)));

  // Bersihkan sesi kedaluwarsa tiap 30 menit supaya Map tidak tumbuh terus.
  const janitor = setInterval(pruneSessions, 30 * 60 * 1000);
  janitor.unref();

  return server;
}

export function stopDashboard(): void {
  if (!server) return;
  server.close();
  server = null;
}

/** Dipakai `/healthz` dan halaman login untuk membersihkan sesi kedaluwarsa. */
export function pruneSessions(): void {
  const now = Date.now();
  for (const [id, expiresAt] of sessions) {
    if (expiresAt < now) sessions.delete(id);
  }
}

