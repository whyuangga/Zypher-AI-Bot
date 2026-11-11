/**
 * Web dashboard minimal di atas `node:http` — tanpa Express, tanpa build step.
 *
 * Auth: satu token admin (`DASHBOARD_TOKEN`) → sesi cookie httpOnly.
 * Kalau `DASHBOARD_TOKEN` kosong, dashboard tidak dijalankan sama sekali,
 * jadi server Discord tetap bisa dipakai tanpa membuka port apa pun.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Client } from 'discord.js';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import {
  addKeyword,
  clearModerationLogs,
  countModerationLogs,
  deleteModerationLog,
  countGuildMessages,
  countGuildRows,
  countRows,
  deleteKeyword,
  getGuildSettings,
  getModerationSettings,
  getPanel,
  listDocuments,
  getGuildName,
  getAgentSettings,
  saveAgentSettings,
  getWelcomeSettings,
  saveWelcomeSettings,
  getGoodbyeSettings,
  saveGoodbyeSettings,
  listKeywords,
  listModerationLogs,
  listDmSessions,
  messagesPerDay,
  setGuildModel,
  setGuildTtsReplyInRoom,
  setGuildRagEnabled,
  setGuildAutoMemory,
  setGuildAdminOnlyRooms,
  setGuildDiskQuota,
  setGuildTimeZone,
  resolveTimeZone,
  setModerationSettings,
  setPanelEnabled,
  setPersona,
} from '../db/repo.js';
import { invalidateModerationCache } from '../features/moderation.js';
import { listPanelChannels, PanelError, publishPanel, removePanel } from '../features/panel.js';
import { DocumentError, ingestDocument, removeDocument, searchKnowledge } from '../features/rag.js';
import {
  previewAgentReply,
  previewGoodbye,
  previewQuietBreak,
  previewWelcome,
  SAMPLE_MEMBER_NAME,
  type PreviewMemberLike,
} from '../features/preview.js';
import { channelState } from '../features/agent.js';
import { readResourceUsage, readPartitionCapacity, resetFolderCache } from './resources.js';
import { TIME_ZONES } from '../lib/timezone.js';
import { normalizeDisplayMode } from '../features/display-mode.js';
import { cardRendererAvailable, chromiumPath, renderWelcomeCard } from '../features/welcome-card.js';
import { cardDetail } from '../features/welcome.js';
import {
  BannerError,
  bannerExists,
  deleteBanner,
  readBannerBytes,
  readBannerDataUri,
  saveBanner,
} from '../features/banner.js';
import {
  SendTestError,
  sendAgentTest,
  sendGoodbyeTest,
  sendQuietTest,
  sendWelcomeTest,
} from '../features/test-send.js';
import { previewAgentReply as composeAgentPreview } from '../features/preview.js';
import { MAX_BINARY_BYTES } from '../lib/chunker.js';
import { embeddingModelName } from '../features/rag-embed.js';
import { errorMessage, logger } from '../lib/logger.js';
import {
  dokumenPage,
  keywordPage,
  loginPage,
  moderasiPage,
  panelPage,
  pengaturanPage,
  ringkasanPage,
  welcomePage,
  agentPage,
} from './ui/pages.js';
import { dbLabel, dialect } from '../db/index.js';
import { parseLoginLink } from './login-link.js';
import { dashboardStatus } from './status.js';

const SESSION_COOKIE = 'zp_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

const sessions = new Map<string, number>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Client Discord milik bot (kalau dashboard jalan di proses yang sama).
 * `null` di mode dashboard-saja — halaman Panel tetap bisa dibuka, tapi aksi
 * yang butuh Discord akan menampilkan pesan yang jelas.
 */
let botClient: Client | null = null;

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

function readRawBody(request: IncomingMessage, limit: number): Promise<Buffer> {
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
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return readRawBody(request, limit).then((buffer) => buffer.toString('utf8'));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * Font self-host (General Sans, assets/fonts) — disajikan dari repo supaya
 * dashboard tidak bergantung pada CDN/fontshare saat panel tanpa akses keluar.
 * Isinya kecil dan statis, jadi cukup dibaca sekali lalu di-cache di memori.
 */
const FONT_FILES: Record<string, string> = {
  'general-sans-regular.woff2': 'GeneralSans-Regular.woff2',
  'general-sans-medium.woff2': 'GeneralSans-Medium.woff2',
};
const fontCache = new Map<string, Buffer>();

function serveFont(name: string, response: ServerResponse): boolean {
  const file = FONT_FILES[name];
  if (!file) return false;

  let data = fontCache.get(file);
  if (!data) {
    try {
      data = readFileSync(fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url)));
    } catch {
      return false;
    }
    fontCache.set(file, data);
  }

  response.writeHead(200, {
    'content-type': 'font/woff2',
    'content-length': String(data.byteLength),
    'cache-control': 'public, max-age=31536000, immutable',
    'access-control-allow-origin': '*',
  });
  response.end(data);
  return true;
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // Jangan bocorkan URL (yang bisa berisi token) ke situs lain lewat Referer.
    'referrer-policy': 'no-referrer',
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

function loginBlocked(ip: string): boolean {
  const attempt = loginAttempts.get(ip);
  return Boolean(attempt && attempt.resetAt > Date.now() && attempt.count >= LOGIN_MAX_ATTEMPTS);
}

function recordLoginFailure(ip: string): void {
  const attempt = loginAttempts.get(ip);
  const next = attempt && attempt.resetAt > Date.now() ? attempt : { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  next.count += 1;
  loginAttempts.set(ip, next);
}

/**
 * IP untuk rate limit login.
 *
 * `X-Forwarded-For` hanya dipercaya kalau koneksi datang dari reverse proxy
 * lokal (127.0.0.1 / ::1) — mis. Cloudflare Tunnel. Dari koneksi luar, header
 * itu bisa dipalsukan siapa saja, jadi yang dipakai alamat socket.
 */
function clientIp(request: IncomingMessage): string {
  const socket = request.socket.remoteAddress ?? 'unknown';
  const fromLocalProxy = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1';
  if (fromLocalProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socket;
}

/** Buat sesi baru dan kembalikan nilai header `set-cookie`. */
function issueSessionCookie(request: IncomingMessage): string {
  const sessionId = randomBytes(24).toString('hex');
  sessions.set(sessionId, Date.now() + SESSION_TTL_MS);

  const secure = (request.headers['x-forwarded-proto'] ?? '').toString() === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

/**
 * Halaman perantara untuk login lewat link. `location.replace()` menimpa entri
 * riwayat, jadi token tidak tertinggal di tombol Back / daftar riwayat.
 */
function loginHandoffPage(): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Masuk… · Zypher AI</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: #080a0f; color: #a7afc2;
    font: 15px/1.6 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .box { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .spin { width: 30px; height: 30px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,.12);
    border-top-color: #7c5cff; animation: spin .8s linear infinite; }
  a { color: #8fb0ff; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
<div class="box">
  <span class="spin"></span>
  <span>Membuka dashboard…</span>
  <noscript><a href="/">Lanjut ke dashboard</a></noscript>
</div>
<script>location.replace('/');</script>
</body></html>`;
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

/**
 * Server yang dikelola dashboard.
 *
 * Bot ini untuk satu server, jadi tidak ada lagi pemilih server: nilainya selalu
 * `GUILD_ID` dari `.env`. Kalau kosong, bot memang tidak pernah sampai ke sini
 * karena config menolak start.
 */
function resolveGuild(): string {
  return config.discord.homeGuildId;
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method ?? 'GET';

  // Font statis dipakai halaman login & dashboard — publik, tanpa auth.
  if (method === 'GET' && path.startsWith('/fonts/')) {
    if (serveFont(path.slice('/fonts/'.length), response)) return;
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Font tidak ditemukan');
    return;
  }

  // Health check tanpa auth — dipakai hosting untuk memastikan proses hidup.
  if (path === '/healthz') {
    sendJson(response, 200, {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      database: await dbLabel(),
      rag: config.rag.enabled,
      documents: await countRows('documents'),
      dmSessions: await countRows('dm_sessions'),
    });
    return;
  }

  if (path === '/login' && method === 'GET') {
    sendHtml(response, 200, loginPage());
    return;
  }

  if (path === '/login' && method === 'POST') {
    const ip = clientIp(request);

    if (loginBlocked(ip)) {
      sendHtml(response, 429, loginPage('Terlalu banyak percobaan. Tunggu beberapa menit.'));
      return;
    }

    const body = await readBody(request, 8 * 1024);
    const submitted = new URLSearchParams(body).get('token') ?? '';

    if (!tokenMatches(submitted)) {
      recordLoginFailure(ip);
      logger.warn(`Login dashboard gagal dari ${ip}`);
      sendHtml(response, 401, loginPage('Token salah.'));
      return;
    }

    loginAttempts.delete(ip);
    redirect(response, '/', issueSessionCookie(request));
    return;
  }

  /* --- Login lewat link: /masuk/<token> atau /login/<token> --- */
  const loginLink = parseLoginLink(path);
  if (loginLink.matched && method === 'GET') {
    if (!loginLink.token) {
      redirect(response, '/login');
      return;
    }

    const ip = clientIp(request);
    if (loginBlocked(ip)) {
      sendHtml(response, 429, loginPage('Terlalu banyak percobaan. Tunggu beberapa menit.'));
      return;
    }

    if (!tokenMatches(loginLink.token)) {
      recordLoginFailure(ip);
      logger.warn(`Login lewat link gagal dari ${ip} (token tidak cocok)`);
      sendHtml(response, 401, loginPage('Token di link tidak cocok. Salin ulang dari panel hosting.'));
      return;
    }

    loginAttempts.delete(ip);
    logger.info('Login dashboard lewat link (token di URL) — sesi 12 jam dibuat');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': issueSessionCookie(request),
    });
    response.end(loginHandoffPage());
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

  const guildId = resolveGuild();

  /* ---------------- halaman ---------------- */

  const navCounts = async (id: string) =>
    id
      ? {
          dokumen: await countGuildRows(id, 'documents'),
          keyword: await countGuildRows(id, 'keywords'),
          moderasi: await countModerationLogs(id),
        }
      : {};

  if (path === '/' && method === 'GET') {
    const sessions = guildId ? (await listDmSessions(guildId)).slice(0, 8) : [];
    const documents = guildId ? (await listDocuments(guildId)).slice(0, 6) : [];
    // Kuota disk per server dipakai agar render pertama sama dengan polling.
    const guildRow = guildId ? await getGuildSettings(guildId) : null;

    sendHtml(
      response,
      200,
      ringkasanPage({
        guildId,
        guildName: await getGuildName(guildId),
        // Angka di dashboard harus mencerminkan server yang sedang dipilih.
        // Dulu ini global, jadi user melihat "1 ROOM AI" sementara daftar room
        // di bawahnya kosong — dua bagian halaman seolah saling bertentangan.
        stats: guildId
          ? {
              rooms: await countGuildRows(guildId, 'dm_sessions'),
              documents: await countGuildRows(guildId, 'documents'),
              chunks: await countGuildRows(guildId, 'chunks'),
              keywords: (await listKeywords(guildId)).length,
              messages: await countGuildMessages(guildId),
            }
          : { rooms: 0, documents: 0, chunks: 0, keywords: 0, messages: 0 },
        rooms: sessions.map((session) => ({
          userId: session.userId,
          messageCount: session.messageCount,
          lastActiveAt: session.lastActiveAt,
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
        model: config.ai.model,
        storage: dialect() === 'pg' ? 'PostgreSQL' : 'SQLite',
        // Grafik dihitung pada zona server: batang "Hari ini" harus hari ini
        // menurut member, bukan menurut Jakarta.
        series: guildId
          ? await messagesPerDay(guildId, 7, await resolveTimeZone(guildId))
          : await messagesPerDay('', 7),
        // Dibaca dengan `catch`: kalau cgroup/proc tidak bisa dibaca di hosting,
        // panelnya hilang — halaman Ringkasan tetap tampil utuh.
        resources: await readResourceUsage({
          workDir: process.cwd(),
          // Kuota harus sama dengan yang dipakai /api/resources. Tanpa ini,
          // render pertama menulis "kuota belum diatur" lalu polling 3 detik
          // kemudian menampilkannya — angka yang berubah sendiri membingungkan.
          diskLimitEnv: config.features.diskLimitBytes || null,
          diskLimitSetting: guildRow?.diskQuotaMb ? guildRow.diskQuotaMb * 1024 * 1024 : null,
        }).catch((error: unknown) => {
          logger.warn(`Gagal membaca pemakaian sumber daya — ${errorMessage(error)}`);
          return null;
        }),
        status: dashboardStatus(),
        counts: await navCounts(guildId),
      }),
    );
    return;
  }

  if ((path === '/sambutan' || path === '/agent') && method === 'GET') {
    const [welcome, goodbye, agent, guildName] = await Promise.all([
      getWelcomeSettings(guildId),
      getGoodbyeSettings(guildId),
      getAgentSettings(guildId),
      getGuildName(guildId),
    ]);

    // Daftar channel hanya tersedia saat bot online — di mode dashboard-saja,
    // pilihan yang sudah tersimpan tetap ditampilkan agar tidak hilang.
    let channels: Array<{ id: string; name: string }> = [];
    if (botClient?.isReady()) {
      channels = await listPanelChannels(botClient, guildId).catch((error: unknown) => {
        logger.warn(`Gagal membaca daftar channel — ${errorMessage(error)}`);
        return [];
      });
    }

    const status = dashboardStatus();
    const counts = await navCounts(guildId);

    if (path === '/sambutan') {
      sendHtml(
        response,
        200,
        welcomePage({
          guildId,
          guildName,
          welcome: {
            enabled: welcome.enabled,
            useAi: welcome.useAi,
            channelId: welcome.channelId,
            template: welcome.template,
            displayMode: welcome.displayMode,
            imageEnabled: welcome.imageEnabled,
            includeAvatar: welcome.includeAvatar,
            cardAvatar: welcome.cardAvatar,
            cardText: welcome.cardText,
            embedAvatar: welcome.embedAvatar,
            embedAuthor: welcome.embedAuthor,
            style: welcome.style,
            example: welcome.example,
            bannerPath: welcome.bannerPath,
            // Hanya status ada/tidak — gambarnya diambil lewat /api/banner/welcome.
            hasBanner: bannerExists(welcome.bannerPath),
          },
          goodbye: {
            enabled: goodbye.enabled,
            useAi: goodbye.useAi,
            channelId: goodbye.channelId,
            template: goodbye.template,
            style: goodbye.style,
            example: goodbye.example,
            bannerPath: goodbye.bannerPath,
            hasBanner: bannerExists(goodbye.bannerPath),
            displayMode: goodbye.displayMode,
            imageEnabled: goodbye.imageEnabled,
            includeAvatar: goodbye.includeAvatar,
            cardAvatar: goodbye.cardAvatar,
            cardText: goodbye.cardText,
            embedAvatar: goodbye.embedAvatar,
            embedAuthor: goodbye.embedAuthor,
          },
          channels,
          botOnline: status.online,
          sampleName: SAMPLE_MEMBER_NAME,
          cardRenderer: { available: cardRendererAvailable(), path: chromiumPath() },
          status,
          counts,
        }),
      );
      return;
    }

    sendHtml(
      response,
      200,
      agentPage({
        guildId,
        guildName,
        persona: guildId ? ((await getGuildSettings(guildId))?.persona ?? null) : null,
        agent: {
          channelId: agent.channelId,
          galleryChannelId: agent.galleryChannelId,
          quietMinutes: agent.quietMinutes,
          maxPerHour: agent.maxPerHour,
          reactEmoji: agent.reactEmoji,
          reactImages: agent.reactImages,
          busyMute: agent.busyMute,
          cooldownSeconds: agent.cooldownSeconds,
          quietHours: agent.quietHours,
        },
        channels,
        botOnline: status.online,
        sampleName: SAMPLE_MEMBER_NAME,
        status,
        counts,
      }),
    );
    return;
  }

  if (path === '/dokumen' && method === 'GET') {
    sendHtml(
      response,
      200,
      dokumenPage({
        guildId,
        guildName: await getGuildName(guildId),
        documents: guildId
          ? (await listDocuments(guildId)).map((document) => ({
              id: document.id,
              name: document.name,
              chunkCount: document.chunkCount,
              chars: document.chars,
              source: document.source,
              createdAt: document.createdAt,
            }))
          : [],
        embedModel: embeddingModelName(),
        status: dashboardStatus(),
        counts: await navCounts(guildId),
      }),
    );
    return;
  }

  if (path === '/keyword' && method === 'GET') {
    sendHtml(
      response,
      200,
      keywordPage({
        guildId,
        guildName: await getGuildName(guildId),
        keywords: guildId
          ? (await listKeywords(guildId)).map((keyword) => ({
              id: keyword.id,
              trigger: keyword.trigger,
              answer: keyword.answer,
              createdAt: keyword.createdAt,
            }))
          : [],
        status: dashboardStatus(),
        counts: await navCounts(guildId),
      }),
    );
    return;
  }

  if (path === '/moderasi' && method === 'GET') {
    const stored = guildId ? await getModerationSettings(guildId) : null;
    sendHtml(
      response,
      200,
      moderasiPage({
        guildId,
        guildName: await getGuildName(guildId),
        enabled: stored ? stored.enabled : config.moderation.enabled,
        words: stored ? stored.words : config.moderation.words,
        action: stored ? stored.action : config.moderation.action,
        timeoutMinutes: stored ? stored.timeoutMinutes : config.moderation.timeoutMinutes,
        fromEnv: !stored,
        logs: guildId ? await listModerationLogs(guildId, 100) : [],
        status: dashboardStatus(),
        counts: await navCounts(guildId),
      }),
    );
    return;
  }

  if (path === '/panel' && method === 'GET') {
    const status = dashboardStatus();
    const state = guildId ? await getPanel(guildId) : null;

    // Daftar channel hanya bisa diambil saat bot online. Di mode dashboard-saja
    // admin masih bisa menempel Channel ID secara manual.
    let channels: Array<{ id: string; name: string }> = [];
    if (guildId && botClient?.isReady()) {
      channels = await listPanelChannels(botClient, guildId).catch((error: unknown) => {
        logger.warn(`Panel: gagal membaca daftar channel — ${errorMessage(error)}`);
        return [];
      });
    }

    sendHtml(
      response,
      200,
      panelPage({
        guildId,
        guildName: await getGuildName(guildId),
        enabled: state?.enabled ?? true,
        channelId: state?.channelId ?? null,
        messageId: state?.messageId ?? null,
        updatedAt: state?.updatedAt ?? null,
        channels,
        botOnline: status.online && status.mode === 'bot',
        status,
        counts: await navCounts(guildId),
      }),
    );
    return;
  }

  if (path === '/pengaturan' && method === 'GET') {
    const settings = guildId ? await getGuildSettings(guildId) : null;
    sendHtml(
      response,
      200,
      pengaturanPage({
        guildId,
        guildName: await getGuildName(guildId),
        timeZone: settings?.timezone ?? null,
        effectiveTimeZone: await resolveTimeZone(guildId),
        defaultTimeZone: config.features.timeZone,
        model: settings?.model ?? null,
        defaultModel: config.ai.model,
        embedModel: embeddingModelName(),
        ragEnabled: config.rag.enabled,
        ttsReplyInRoom: settings?.ttsReplyInRoom ?? null,
        ttsReplyInRoomDefault: config.voice.ttsReplyInRoom,
        ragEnabledSetting: settings?.ragEnabled ?? null,
        ragEnabledDefault: config.rag.enabled,
        autoMemorySetting: settings?.autoMemory ?? null,
        autoMemoryDefault: config.features.autoMemory,
        adminOnlyRoomsSetting: settings?.adminOnlyRooms ?? null,
        adminOnlyRoomsDefault: config.features.adminOnlyRooms,
        diskQuotaMb: settings?.diskQuotaMb ?? null,
        diskQuotaEnvMb: config.features.diskLimitBytes
          ? Math.round(config.features.diskLimitBytes / 1024 / 1024)
          : null,
        stats: {
          rooms: guildId ? await countGuildRows(guildId, 'dm_sessions') : 0,
          messages: guildId ? await countGuildMessages(guildId) : 0,
          documents: guildId ? await countGuildRows(guildId, 'documents') : 0,
        },
        status: dashboardStatus(),
        counts: await navCounts(guildId),
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

    const headerName = request.headers['x-filename'];
    const rawName = Array.isArray(headerName) ? (headerName[0] ?? '') : (headerName ?? 'dokumen.txt');
    let name = 'dokumen.txt';
    try {
      name = decodeURIComponent(rawName) || 'dokumen.txt';
    } catch {
      name = rawName || 'dokumen.txt';
    }

    // PDF/DOCX dikirim sebagai biner asli, jadi butuh ruang lebih besar daripada teks biasa.
    // Body dibaca sebagai Buffer (bukan string) supaya byte biner tidak rusak.
    const binary = /\.(pdf|docx)$/i.test(name);
    const limit = binary
      ? MAX_BINARY_BYTES + 256 * 1024
      : Math.min(config.rag.maxChars * 4 + 64 * 1024, 16 * 1024 * 1024);
    const body = await readRawBody(request, limit);

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

  // Unduh transkrip: dikirim sebagai attachment supaya HTML-nya tidak dieksekusi
  // di origin dashboard (transkrip berisi teks dari member).
  if (path === '/api/documents' && method === 'GET') {
    sendJson(response, 200, { documents: guildId ? await listDocuments(guildId) : [] });
    return;
  }

  // Uji pencarian di halaman Dokumen: "apakah AI benar-benar menemukan
  // potongan ini?". Tanpa endpoint ini tombol Cari di UI memanggil rute yang
  // tidak ada dan selalu menampilkan "Gagal mencari" — fiturnya mati total.
  if (path === '/api/search' && method === 'GET') {
    const query = (url.searchParams.get('q') ?? '').trim();
    if (!query) {
      sendJson(response, 400, { error: 'Kata kunci pencarian kosong.' });
      return;
    }
    // Batasi panjang: query puluhan ribu karakter hanya membebani tokenizer
    // tanpa memberi hasil lebih baik. Ditolak jelas, bukan diproses diam-diam.
    if (query.length > 500) {
      sendJson(response, 400, { error: 'Kata kunci terlalu panjang (maksimal 500 karakter).' });
      return;
    }
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }

    const hits = await searchKnowledge(guildId, query, { topK: 8 });
    sendJson(response, 200, {
      query,
      results: hits.map((hit) => ({
        documentId: hit.documentId,
        documentName: hit.documentName,
        ordinal: hit.ordinal,
        // UI memakai `preview` (bukan `content`) dan memotongnya supaya kartu
        // hasil tidak memanjang. Dipotong di server agar payload tetap kecil;
        // isi tidak di-escape di sini — UI yang meng-escape sebelum menyisipkan.
        preview: hit.content.length > 320 ? `${hit.content.slice(0, 320)}…` : hit.content,
        score: Number(hit.score.toFixed(3)),
        via: hit.via,
      })),
    });
    return;
  }

  if (path === '/api/keyword' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }

    const raw = await readBody(request, 64 * 1024);
    let payload: { trigger?: unknown; answer?: unknown };
    try {
      payload = JSON.parse(raw) as { trigger?: unknown; answer?: unknown };
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const trigger = typeof payload.trigger === 'string' ? payload.trigger.trim() : '';
    const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
    if (trigger.length < 3) {
      sendJson(response, 400, { error: 'Kata kunci minimal 3 karakter.' });
      return;
    }
    if (answer.length < 5) {
      sendJson(response, 400, { error: 'Jawaban masih kosong.' });
      return;
    }

    const result = await addKeyword(guildId, trigger, answer, null);
    if (!result.ok) {
      const message =
        result.reason === 'duplicate' ? 'Keyword dengan kata kunci itu sudah ada.' : 'Keyword gagal disimpan.';
      sendJson(response, 409, { error: message });
      return;
    }

    sendJson(response, 200, { ok: true, id: result.id });
    return;
  }

  /**
   * Persona AI — endpoint sendiri.
   *
   * Dulu persona hanya bisa disimpan lewat /api/pengaturan, karena kartunya
   * ada di halaman Pengaturan. Setelah kartunya pindah ke halaman AI Agent,
   * endpoint terpisah membuat kedua halaman tidak saling bergantung.
   */
  if (path === '/api/persona' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const raw = await readBody(request, 8 * 1024);
    let payload: { persona?: unknown };
    try {
      payload = JSON.parse(raw) as { persona?: unknown };
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }
    if (typeof payload.persona !== 'string' && payload.persona !== null) {
      sendJson(response, 400, { error: 'persona harus teks.' });
      return;
    }
    const persona = typeof payload.persona === 'string' ? payload.persona.trim() : '';
    if (persona.length > 1500) {
      sendJson(response, 400, { error: 'Persona terlalu panjang (maks 1500 karakter).' });
      return;
    }
    await setPersona(guildId, persona || null);
    sendJson(response, 200, { ok: true, persona: persona || null });
    return;
  }

  // Zona waktu server (WIB/WITA/WIT).
  //
  // Endpoint sendiri, bukan menumpang /api/pengaturan: nilainya bukan boolean
  // dan butuh validasi daftar tertutup — kalau nilai ngawur diterima, semua
  // jam (termasuk jam tenang malam) meleset tanpa error.
  /**
   * Sumber daya server dalam JSON, untuk polling di halaman Ringkasan.
   *
   * Halaman Ringkasan dulu hanya memotret sekali saat dimuat, jadi angka CPU
   * dan jaringan selalu basi sampai halaman di-refresh. Endpoint ini yang
   * dipoll tiap beberapa detik. `no-store` wajib: proxy panel hosting suka
   * menyimpan respons GET dan membuat angkanya membeku.
   */
  if (path === '/api/resources' && method === 'GET') {
    const settings = guildId ? await getGuildSettings(guildId) : null;
    const usage = await readResourceUsage({
      workDir: process.cwd(),
      diskLimitEnv: config.features.diskLimitBytes || null,
      diskLimitSetting: settings?.diskQuotaMb ? settings.diskQuotaMb * 1024 * 1024 : null,
    });
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
    });
    response.end(
      JSON.stringify({
        ...usage,
        // Kapasitas partisi mesin: keterangan saja, bukan kuota container.
        partitionTotal: await readPartitionCapacity(process.cwd()),
        diskLimitEnvMb: config.features.diskLimitBytes
          ? Math.round(config.features.diskLimitBytes / 1024 / 1024)
          : null,
        diskLimitSettingMb: settings?.diskQuotaMb ?? null,
      }),
    );
    return;
  }

  if (path === '/api/timezone' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const raw = await readBody(request, 4 * 1024);
    let payload: { timezone?: unknown };
    try {
      payload = JSON.parse(raw) as { timezone?: unknown };
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }
    const requested = typeof payload.timezone === 'string' ? payload.timezone.trim() : '';
    const known = TIME_ZONES.some((zone) => zone.id === requested);
    if (!known) {
      sendJson(response, 400, {
        error: `Zona waktu tidak dikenal. Pilih ${TIME_ZONES.map((zone) => `${zone.label} (${zone.id})`).join(', ')}.`,
      });
      return;
    }
    await setGuildTimeZone(guildId, requested);
    sendJson(response, 200, { ok: true, timezone: requested });
    return;
  }

  /**
   * Kuota disk container (MB). Endpoint sendiri karena nilainya angka, bukan
   * boolean seperti toggle di /api/pengaturan.
   *
   * Kosong (`null`/0) = tidak diatur, dan dashboard berhenti menampilkan bar
   * persentase disk alih-alih memakai kapasitas mesin induk.
   */
  if (path === '/api/disk-quota' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const raw = await readBody(request, 4 * 1024);
    let payload: { megabytes?: unknown };
    try {
      payload = JSON.parse(raw) as { megabytes?: unknown };
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const value = payload.megabytes;
    if (value !== null && typeof value !== 'number') {
      sendJson(response, 400, { error: 'megabytes harus angka atau null.' });
      return;
    }
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      sendJson(response, 400, { error: 'megabytes tidak boleh negatif.' });
      return;
    }
    if (typeof value === 'number' && value > 10_485_760) {
      sendJson(response, 400, { error: 'megabytes terlalu besar (maks 10.485.760 = 10 TB).' });
      return;
    }

    await setGuildDiskQuota(guildId, value === null || value === 0 ? null : value);
    // Kuota baru = admin ingin angka yang segar sekarang, bukan cache 5 menit.
    resetFolderCache();
    const settings = await getGuildSettings(guildId);
    sendJson(response, 200, { ok: true, diskQuotaMb: settings?.diskQuotaMb ?? null });
    return;
  }

  // Ukur ulang pemakaian disk SEKARANG.
  //
  // Angka disk dipakai ulang sampai 5 menit (lihat resources.ts) supaya tidak
  // menjelajahi node_modules tiap 3 detik. Tanpa tombol ini, admin yang baru
  // menghapus sesuatu harus menunggu sampai 5 menit untuk melihat efeknya —
  // dan orang akan mengira tombol hapusnya tidak bekerja.
  if (path === '/api/resources/refresh-disk' && method === 'POST') {
    resetFolderCache();
    const settingMb = guildId ? (await getGuildSettings(guildId))?.diskQuotaMb ?? null : null;
    const usage = await readResourceUsage({
      workDir: process.cwd(),
      diskLimitEnv: config.features.diskLimitBytes || null,
      diskLimitSetting: settingMb === null ? null : settingMb * 1024 * 1024,
    });
    sendJson(response, 200, { ok: true, diskUsed: usage.diskUsed, diskUsedAt: usage.diskUsedAt });
    return;
  }

  if (path === '/api/pengaturan' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }

    const raw = await readBody(request, 32 * 1024);
    let payload: { persona?: unknown; model?: unknown; ttsReplyInRoom?: unknown; ragEnabled?: unknown; autoMemory?: unknown; adminOnlyRooms?: unknown };
    try {
      payload = JSON.parse(raw) as { persona?: unknown; model?: unknown };
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    if (payload.persona !== undefined) {
      const persona = typeof payload.persona === 'string' ? payload.persona.trim() : '';
      if (persona.length > 1500) {
        sendJson(response, 400, { error: 'Persona terlalu panjang (maks 1500 karakter).' });
        return;
      }
      await setPersona(guildId, persona || null);
    }

    if (payload.model !== undefined) {
      const model = typeof payload.model === 'string' ? payload.model.trim() : '';
      if (model.length > 120) {
        sendJson(response, 400, { error: 'Nama model terlalu panjang.' });
        return;
      }
      await setGuildModel(guildId, model || null);
    }

    if (payload.ttsReplyInRoom !== undefined) {
      if (typeof payload.ttsReplyInRoom !== 'boolean') {
        sendJson(response, 400, { error: 'ttsReplyInRoom harus boolean.' });
        return;
      }
      await setGuildTtsReplyInRoom(guildId, payload.ttsReplyInRoom);
    }

    if (payload.ragEnabled !== undefined) {
      if (typeof payload.ragEnabled !== 'boolean') {
        sendJson(response, 400, { error: 'ragEnabled harus boolean.' });
        return;
      }
      await setGuildRagEnabled(guildId, payload.ragEnabled);
    }

    if (payload.autoMemory !== undefined) {
      if (typeof payload.autoMemory !== 'boolean') {
        sendJson(response, 400, { error: 'autoMemory harus boolean.' });
        return;
      }
      await setGuildAutoMemory(guildId, payload.autoMemory);
    }

    if (payload.adminOnlyRooms !== undefined) {
      if (typeof payload.adminOnlyRooms !== 'boolean') {
        sendJson(response, 400, { error: 'adminOnlyRooms harus boolean.' });
        return;
      }
      await setGuildAdminOnlyRooms(guildId, payload.adminOnlyRooms);
    }

    const settings = await getGuildSettings(guildId);
    sendJson(response, 200, {
      ok: true,
      persona: settings?.persona ?? null,
      model: settings?.model ?? null,
      ttsReplyInRoom: settings?.ttsReplyInRoom ?? null,
      ragEnabled: settings?.ragEnabled ?? null,
      autoMemory: settings?.autoMemory ?? null,
      adminOnlyRooms: settings?.adminOnlyRooms ?? null,
    });
    return;
  }

  if (path === '/api/welcome' && method === 'POST') {
    const raw = await readBody(request, 16 * 1024);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
    if (channelId && !/^\d{17,20}$/.test(channelId)) {
      sendJson(response, 400, { error: 'Channel ID tidak valid.' });
      return;
    }
    const template = typeof payload.template === 'string' ? payload.template.trim().slice(0, 1000) : '';
    const style = typeof payload.style === 'string' ? payload.style.trim().slice(0, 300) : '';
    const example = typeof payload.example === 'string' ? payload.example.trim().slice(0, 300) : '';

    const current = await getWelcomeSettings(guildId);
    const bool = (value: unknown, fallback: boolean): boolean =>
      value === undefined || value === null ? fallback : Boolean(value);

    await saveWelcomeSettings(guildId, {
      enabled: bool(payload.enabled, current.enabled),
      channelId: 'channelId' in payload ? channelId || null : current.channelId,
      useAi: bool(payload.useAi, current.useAi),
      template: 'template' in payload ? template || null : current.template,
      style: 'style' in payload ? style || null : current.style,
      example: 'example' in payload ? example || null : current.example,
      displayMode: payload.displayMode === undefined
        ? current.displayMode
        : normalizeDisplayMode(payload.displayMode),
      imageEnabled: bool(payload.imageEnabled, current.imageEnabled),
      includeAvatar: bool(payload.includeAvatar, current.includeAvatar),
      cardAvatar: bool(payload.cardAvatar, current.cardAvatar),
      cardText: bool(payload.cardText, current.cardText),
      embedAvatar: bool(payload.embedAvatar, current.embedAvatar),
      embedAuthor: bool(payload.embedAuthor, current.embedAuthor),
    });

    sendJson(response, 200, { ok: true, welcome: await getWelcomeSettings(guildId) });
    return;
  }

  if (path === '/api/goodbye' && method === 'POST') {
    const raw = await readBody(request, 16 * 1024);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
    if (channelId && !/^\d{17,20}$/.test(channelId)) {
      sendJson(response, 400, { error: 'Channel ID tidak valid.' });
      return;
    }

    const current = await getGoodbyeSettings(guildId);
    const bool = (value: unknown, fallback: boolean): boolean =>
      value === undefined || value === null ? fallback : Boolean(value);
    /** String opsional: tidak dikirim = pakai nilai lama, dikirim kosong = null. */
    const optionalText = (key: string, current: string | null, max = 300): string | null => {
      if (!(key in payload)) return current;
      const value = typeof payload[key] === 'string' ? (payload[key] as string).trim() : '';
      return value ? value.slice(0, max) : null;
    };

    await saveGoodbyeSettings(guildId, {
      enabled: bool(payload.enabled, current.enabled),
      channelId: 'channelId' in payload ? channelId || null : current.channelId,
      useAi: bool(payload.useAi, current.useAi),
      template: optionalText('template', current.template, 1000),
      style: optionalText('style', current.style),
      example: optionalText('example', current.example),
      displayMode: payload.displayMode === undefined
        ? current.displayMode
        : normalizeDisplayMode(payload.displayMode),
      imageEnabled: bool(payload.imageEnabled, current.imageEnabled),
      includeAvatar: bool(payload.includeAvatar, current.includeAvatar),
      cardAvatar: bool(payload.cardAvatar, current.cardAvatar),
      cardText: bool(payload.cardText, current.cardText),
      embedAvatar: bool(payload.embedAvatar, current.embedAvatar),
      embedAuthor: bool(payload.embedAuthor, current.embedAuthor),
    });

    sendJson(response, 200, { ok: true, goodbye: await getGoodbyeSettings(guildId) });
    return;
  }

  if (path === '/api/agent' && method === 'POST') {
    const raw = await readBody(request, 16 * 1024);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
    const galleryChannelId =
      typeof payload.galleryChannelId === 'string' ? payload.galleryChannelId.trim() : '';
    for (const value of [channelId, galleryChannelId]) {
      if (value && !/^\d{17,20}$/.test(value)) {
        sendJson(response, 400, { error: 'Channel ID tidak valid.' });
        return;
      }
    }
    // Satu channel tidak boleh dipakai untuk dua peran sekaligus — obrolan
    // akan menang dan galeri tidak pernah jalan, membingungkan admin.
    if (channelId && galleryChannelId && channelId === galleryChannelId) {
      sendJson(response, 400, { error: 'Channel ngobrol dan galeri harus berbeda.' });
      return;
    }

    const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
      const number = Math.round(Number(value));
      if (!Number.isFinite(number)) return fallback;
      return Math.min(max, Math.max(min, number));
    };

    // Field yang tidak dikirim dibiarkan seperti sebelumnya — tanpa ini,
    // permintaan sebagian (mis. hanya ganti channel) akan mematikan toggle lain.
    const current = await getAgentSettings(guildId);
    const bool = (value: unknown, fallback: boolean): boolean =>
      value === undefined || value === null ? fallback : Boolean(value);

    await saveAgentSettings(guildId, {
      channelId: channelId || null,
      galleryChannelId: galleryChannelId || null,
      quietMinutes: clamp(payload.quietMinutes, 0, 1440, current.quietMinutes),
      maxPerHour: clamp(payload.maxPerHour, 1, 60, current.maxPerHour),
      cooldownSeconds: clamp(payload.cooldownSeconds, 0, 3600, current.cooldownSeconds),
      busyMute: bool(payload.busyMute, current.busyMute),
      reactEmoji: bool(payload.reactEmoji, current.reactEmoji),
      reactImages: bool(payload.reactImages, current.reactImages),
      quietHours: bool(payload.quietHours, current.quietHours),
    });

    sendJson(response, 200, { ok: true, agent: await getAgentSettings(guildId) });
    return;
  }

  /* ------------------------------ banner ----------------------------- */
  // Banner dipakai dua fitur (sambutan & perpisahan); yang menentukan file mana
  // tersimpan adalah tabel pengaturan masing-masing. Body berupa JSON berisi
  // data URI, bukan multipart — tidak perlu parser tambahan dan ukurannya sudah
  // dibatasi (8 MB) sebelum diproses.

  // Gambar banner disajikan sebagai respons biner, bukan data URI di HTML.
  //
  // Dulu halaman Sambutan menyisipkan data URI banner ke HTML. Karena batas
  // unggah 8 MB dan ada dua banner (sambutan + perpisahan), satu kunjungan
  // halaman bisa menarik belasan MB — mematikan di HP atau koneksi lambat.
  // Sekarang browser mengambil gambarnya sendiri dan bisa men-cache.
  if ((path === '/api/banner/welcome' || path === '/api/banner/goodbye') && method === 'GET') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const kind = path.endsWith('/welcome') ? 'welcome' : 'goodbye';
    const settings = kind === 'welcome' ? await getWelcomeSettings(guildId) : await getGoodbyeSettings(guildId);
    const file = await readBannerBytes(settings.bannerPath);
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Banner belum ada.');
      return;
    }
    response.writeHead(200, {
      'content-type': file.mime,
      'content-length': String(file.bytes.byteLength),
      // Nama file banner berisi hash acak, jadi aman di-cache lama: banner baru
      // = nama baru = URL baru.
      'cache-control': 'private, max-age=86400',
    });
    response.end(file.bytes);
    return;
  }

  if ((path === '/api/banner/welcome' || path === '/api/banner/goodbye') && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const kind = path.endsWith('/welcome') ? 'welcome' : 'goodbye';
    const payload = await readJsonBody(request, response, 12 * 1024 * 1024);
    if (!payload) return;

    const current =
      kind === 'welcome' ? await getWelcomeSettings(guildId) : await getGoodbyeSettings(guildId);

    // Hapus banner.
    if (payload.remove === true) {
      await deleteBanner(current.bannerPath);
      // Salinan di database ikut dihapus — kalau tidak, banner yang sudah
      // dihapus akan "hidup lagi" saat file-nya dipulihkan.
      if (kind === 'welcome') await saveWelcomeSettings(guildId, { bannerPath: null, bannerData: null });
      else await saveGoodbyeSettings(guildId, { bannerPath: null, bannerData: null });
      sendJson(response, 200, { ok: true, banner: null });
      return;
    }

    const dataUri = typeof payload.dataUri === 'string' ? payload.dataUri : '';
    if (!dataUri) {
      sendJson(response, 400, { error: 'Tidak ada gambar yang dikirim.' });
      return;
    }

    try {
      const saved = await saveBanner(dataUri, randomBytes(8).toString('hex'));
      // File lama dihapus setelah file baru tersimpan — kalau penyimpanan gagal,
      // banner lama tetap dipakai (tidak ada kondisi "tidak punya banner").
      await deleteBanner(current.bannerPath);

      // Simpan SALINAN di database juga. Hosting panel sering me-reset folder
      // kerja saat deploy (`git pull`), sehingga file di data/banners/ hilang
      // padahal nama file-nya masih tersimpan di DB — dulu hasilnya banner
      // hilang tanpa satu pun log. Salinan ini yang memulihkannya otomatis.
      // MIME diambil dari data URI itu sendiri (browser sudah mengisinya),
      // bukan ditebak dari ekstensi nama file.
      const mimeMatch = /^data:([^;]+);base64,/.exec(dataUri);
      const base64 = dataUri.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
      const bannerData = { mime: mimeMatch?.[1] ?? 'image/png', base64 };

      if (kind === 'welcome') await saveWelcomeSettings(guildId, { bannerPath: saved.name, bannerData });
      else await saveGoodbyeSettings(guildId, { bannerPath: saved.name, bannerData });

      // Kembalikan URL (bukan data URI) supaya dashboard tinggal memasang <img src>.
      // Query `v` = nama file, jadi browser tidak menampilkan banner lama dari cache.
      sendJson(response, 200, {
        ok: true,
        banner: saved,
        preview: `/api/banner/${kind}?v=${encodeURIComponent(saved.name ?? '')}`,
        note: 'Banner tersimpan. Tekan Simpan untuk memastikan pengaturan lain ikut tersimpan.',
      });
      return;
    } catch (error) {
      if (error instanceof BannerError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
  }

  /* ---------------------------- kirim tes ---------------------------- */
  // Berbeda dari /api/preview/*: endpoint ini BENAR-BENAR mengirim pesan ke
  // Discord. Dipisah dengan sengaja supaya admin tidak salah menekan tombol
  // pratinjau lalu kaget karena pesan terkirim.

  if (path.startsWith('/api/send-test/') && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    if (!botClient?.isReady()) {
      sendJson(response, 400, {
        error:
          'Bot sedang offline di proses ini, jadi pesan tidak bisa dikirim. ' +
          'Jalankan bot (npm run dev), bukan dashboard-saja, lalu coba lagi.',
      });
      return;
    }

    const kind = path.slice('/api/send-test/'.length);
    const payload = await readJson(request, response);
    if (!payload) return;

    const me = await botClient.guilds
      .fetch(guildId)
      .then((guild) => guild.members.me)
      .catch(() => null);

    if (!me) {
      sendJson(response, 400, { error: 'Bot tidak berada di server ini.' });
      return;
    }

    try {
      if (kind === 'welcome') {
        const current = await getWelcomeSettings(guildId);
        const result = await sendWelcomeTest(botClient, {
          guildId,
          settings: {
            ...current,
            useAi: payload.useAi === undefined ? current.useAi : Boolean(payload.useAi),
            template: textField(payload, 'template', current.template, 1000),
            style: textField(payload, 'style', current.style),
            example: textField(payload, 'example', current.example),
            // Mode dari form (belum tentu tersimpan) — supaya yang diuji sama
            // persis dengan yang sedang dipilih admin.
            displayMode:
              payload.displayMode === undefined
                ? current.displayMode
                : normalizeDisplayMode(payload.displayMode),
            imageEnabled:
              payload.imageEnabled === undefined ? current.imageEnabled : Boolean(payload.imageEnabled),
            includeAvatar:
              payload.includeAvatar === undefined ? current.includeAvatar : Boolean(payload.includeAvatar),
          },
          member: me,
          target: payload.target === 'channel' ? 'channel' : 'dm',
        });
        sendJson(response, 200, { ...result, ok: true });
        return;
      }

      if (kind === 'goodbye') {
        const current = await getGoodbyeSettings(guildId);
        const result = await sendGoodbyeTest(botClient, {
          guildId,
          settings: {
            ...current,
            useAi: payload.useAi === undefined ? current.useAi : Boolean(payload.useAi),
            template: textField(payload, 'template', current.template, 1000),
            style: textField(payload, 'style', current.style),
            example: textField(payload, 'example', current.example),
            displayMode:
              payload.displayMode === undefined
                ? current.displayMode
                : normalizeDisplayMode(payload.displayMode),
            imageEnabled:
              payload.imageEnabled === undefined ? current.imageEnabled : Boolean(payload.imageEnabled),
            includeAvatar:
              payload.includeAvatar === undefined ? current.includeAvatar : Boolean(payload.includeAvatar),
          },
          member: me,
        });
        sendJson(response, 200, { ...result, ok: true });
        return;
      }

      if (kind === 'quiet') {
        const current = await getAgentSettings(guildId);
        if (!current.channelId) {
          sendJson(response, 400, {
            error: 'Channel ngobrol belum dipilih. Pilih & simpan dulu sebelum mengirim tes.',
          });
          return;
        }

        const forced = payload.force === true;
        // Kalimat dibuat lewat jalur pratinjau yang sama, jadi yang dikirim ke
        // Discord benar-benar teks yang tadi dilihat admin di layar.
        const result = await previewQuietBreak({
          settings: current,
          guildName: (await getGuildName(guildId)) ?? 'Server ini',
          timeZone: await resolveTimeZone(guildId),
          force: forced,
        });

        if (!result.text) {
          sendJson(response, 400, {
            error: result.note || result.reason || 'Model gagal menulis kalimat pemecah sepi.',
          });
          return;
        }

        const sent = await sendQuietTest(botClient, {
          guildId,
          channelId: current.channelId,
          text: result.text,
          forced,
        });
        sendJson(response, 200, { ...sent, ok: true, source: result.source, wouldFire: result.wouldFire });
        return;
      }

      if (kind === 'agent') {
        const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 500) : '';
        const channelIdForSend =
          typeof payload.channelId === 'string' && /^\d{17,20}$/.test(payload.channelId.trim())
            ? payload.channelId.trim()
            : '';
        if (!message) {
          sendJson(response, 400, { error: 'Tulis pesan uji dulu.' });
          return;
        }

        const current = await getAgentSettings(guildId);
        const role = payload.role === 'gallery' ? 'gallery' : 'chat';
        const targetChannelId =
          channelIdForSend ||
          (role === 'gallery' ? current.galleryChannelId : current.channelId) ||
          '';

        if (!targetChannelId) {
          sendJson(response, 400, {
            error:
              role === 'gallery'
                ? 'Channel galeri belum dipilih. Pilih & simpan dulu sebelum mengirim tes.'
                : 'Channel ngobrol belum dipilih. Pilih & simpan dulu sebelum mengirim tes.',
          });
          return;
        }

        const guildSettings = await getGuildSettings(guildId);
        const reply = await composeAgentPreview({
          settings: current,
          guildName: (await getGuildName(guildId)) ?? 'Server ini',
          userName: me.displayName || me.user.username,
          message,
          role,
          botName: botClient.user?.username ?? 'Zypher AI',
          persona: guildSettings?.persona ?? null,
        });

        const result = await sendAgentTest(botClient, {
          guildId,
          channelId: targetChannelId,
          reply: reply.text,
          role,
          sampleMessage: message,
          userName: me.displayName || me.user.username,
        });
        sendJson(response, 200, { ...result, ok: true });
        return;
      }

      sendJson(response, 404, { error: 'Jenis tes tidak dikenal.' });
      return;
    } catch (error) {
      if (error instanceof SendTestError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      logger.warn('Kirim tes gagal', errorMessage(error));
      sendJson(response, 500, { error: `Gagal mengirim: ${errorMessage(error)}` });
      return;
    }
  }

  /* ---------------------------- pratinjau ---------------------------- */
  // Endpoint pratinjau sengaja tidak menyentuh Discord sama sekali: admin bisa
  // mencoba sapaan berkali-kali tanpa mengirim pesan ke channel mana pun.
  // Yang dikembalikan adalah hasil persis seperti yang akan dikirim bot.

  if (path === '/api/preview/goodbye' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const payload = await readJson(request, response);
    if (!payload) return;

    const current = await getGoodbyeSettings(guildId);
    const settings = {
      ...current,
      useAi: payload.useAi === undefined ? current.useAi : Boolean(payload.useAi),
      template: textField(payload, 'template', current.template, 1000),
      style: textField(payload, 'style', current.style),
      example: textField(payload, 'example', current.example),
    };

    const name = previewName(payload, SAMPLE_MEMBER_NAME);
    const guildName = (await getGuildName(guildId)) ?? 'Server ini';
    const withCard = payload.withCard === true;
    const result = await previewGoodbye({
      settings,
      name,
      guildName,
      templateOnly: payload.templateOnly === true,
      withCard,
      // Banner unggahan ikut dirender supaya admin melihat hasil akhirnya.
      bannerDataUri: await readBannerDataUri(settings.bannerPath),
      kicker: 'SAMPAI JUMPA',
      // Sama seperti sambutan: tanpa member tiruan, pratinjau kehilangan
      // warna, footer, avatar, dan mention yang membentuk pesannya.
      member: await previewMemberFor(guildId, name),
      // Renderer disuntikkan supaya modul pratinjau tidak bergantung paket gambar.
      renderCard: withCard
        ? (input) =>
            renderWelcomeCard({
              userName: input.name,
              guildName: input.guildName,
              message: input.text,
              avatarDataUri: null,
              bannerDataUri: input.bannerDataUri ?? null,
              kicker: input.kicker,
              detail: cardDetail('goodbye', input.guildName),
            })
        : undefined,
    });
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (path === '/api/preview/welcome' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const payload = await readJson(request, response);
    if (!payload) return;

    const current = await getWelcomeSettings(guildId);
    const settings = {
      ...current,
      useAi: payload.useAi === undefined ? current.useAi : Boolean(payload.useAi),
      template: textField(payload, 'template', current.template, 1000),
      style: textField(payload, 'style', current.style),
      example: textField(payload, 'example', current.example),
    };

    const name = previewName(payload, SAMPLE_MEMBER_NAME);
    const guildName = (await getGuildName(guildId)) ?? 'Server ini';
    const withCard = payload.withCard === true;

    const result = await previewWelcome({
      settings,
      name,
      guildName,
      templateOnly: payload.templateOnly === true,
      // Zona server menentukan kata "pagi/siang/sore" di sambutan.
      timeZone: await resolveTimeZone(guildId),
      withCard,
      // Banner unggahan ikut dirender supaya admin melihat hasil akhirnya.
      bannerDataUri: await readBannerDataUri(settings.bannerPath),
      kicker: 'SELAMAT DATANG',
      // Member tiruan supaya pratinjau bisa menggambar bentuk pesannya (embed,
      // container, mention di luar embed). Tanpa ini dashboard hanya punya teks.
      member: await previewMemberFor(guildId, name),
      // Renderer disuntikkan supaya modul pratinjau tidak bergantung paket gambar.
      renderCard: withCard
        ? (input) =>
            renderWelcomeCard({
              userName: input.name,
              guildName: input.guildName,
              message: input.text,
              avatarDataUri: null,
              bannerDataUri: input.bannerDataUri ?? null,
              kicker: input.kicker,
              // Baris detail harus sama dengan produksi; kalau dibiarkan kosong,
              // kartu di pratinjau berbeda dari yang diterima member.
              detail: cardDetail('welcome', guildName, botClient?.guilds.cache.get(guildId)?.memberCount),
            })
        : undefined,
    });

    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (path === '/api/preview/agent' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const payload = await readJson(request, response);
    if (!payload) return;

    const current = await getAgentSettings(guildId);
    const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 1500) : '';
    if (!message) {
      sendJson(response, 400, { error: 'Tulis pesan uji dulu.' });
      return;
    }

    const role = payload.role === 'gallery' ? 'gallery' : payload.role === 'chat' ? 'chat' : undefined;
    const guild = await getGuildSettings(guildId);
    const result = await previewAgentReply({
      settings: current,
      guildName: (await getGuildName(guildId)) ?? 'Server ini',
      userName: previewName(payload, SAMPLE_MEMBER_NAME),
      message,
      role,
      botName: botClient?.user?.username ?? 'Zypher AI',
      persona: guild?.persona ?? null,
    });

    // Beri tahu admin kalau channel peran yang diuji belum diatur — biar tidak
    // bingung kenapa bot tidak membalas di server sungguhan.
    if (role === 'gallery' && !current.galleryChannelId) {
      result.note = [result.note, 'Channel galeri belum dipilih — di server sungguhan bot tidak akan membalas mode ini.']
        .filter(Boolean)
        .join(' ');
    }
    if (role === 'chat' && !current.channelId) {
      result.note = [result.note, 'Channel ngobrol belum dipilih — di server sungguhan bot tidak akan membalas.']
        .filter(Boolean)
        .join(' ');
    }
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (path === '/api/preview/quiet' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const payload = await readJson(request, response);
    if (!payload) return;

    const current = await getAgentSettings(guildId);
    const result = await previewQuietBreak({
      settings: current,
      guildName: (await getGuildName(guildId)) ?? 'Server ini',
      // State channel hanya ada kalau bot jalan di proses ini. Tanpa itu,
      // pratinjau tidak bisa menilai apakah timernya sudah waktunya.
      state: current.channelId ? channelState(current.channelId) : undefined,
      timeZone: await resolveTimeZone(guildId),
      force: payload.force === true,
    });
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (path === '/api/moderasi' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }

    const raw = await readBody(request, 32 * 1024);
    let payload: {
      enabled?: unknown;
      words?: unknown;
      action?: unknown;
      timeoutMinutes?: unknown;
    };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const action = payload.action === 'warn' || payload.action === 'timeout' ? payload.action : 'delete';
    const timeoutMinutes = Math.min(10080, Math.max(1, Math.round(Number(payload.timeoutMinutes) || 10)));

    // Kata boleh dikirim sebagai array atau string berkoma/baris baru.
    const rawWords = Array.isArray(payload.words)
      ? payload.words.map((word) => String(word))
      : typeof payload.words === 'string'
        ? payload.words.split(/[,\n]/)
        : [];
    const words = [...new Set(rawWords.map((word) => word.trim().toLowerCase()).filter(Boolean))];
    if (words.length > 200) {
      sendJson(response, 400, { error: 'Terlalu banyak kata (maks 200).' });
      return;
    }
    if (words.some((word) => word.length > 60)) {
      sendJson(response, 400, { error: 'Satu kata/frasa maksimal 60 karakter.' });
      return;
    }

    await setModerationSettings({
      guildId,
      enabled: Boolean(payload.enabled),
      words,
      action,
      timeoutMinutes,
    });
    invalidateModerationCache(guildId);

    const saved = await getModerationSettings(guildId);
    sendJson(response, 200, { ok: true, moderation: saved });
    return;
  }

  if (path === '/api/moderasi/logs' && method === 'DELETE') {
    const removed = guildId ? await clearModerationLogs(guildId) : 0;
    sendJson(response, 200, { ok: true, removed });
    return;
  }

  const modLogMatch = /^\/api\/moderasi\/logs\/(\d+)$/.exec(path);
  if (modLogMatch && method === 'DELETE') {
    const id = Number(modLogMatch[1]);
    const removed = guildId ? await deleteModerationLog(guildId, id) : false;
    sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'Log tidak ditemukan.' });
    return;
  }

  if (path === '/api/panel' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }

    const raw = await readBody(request, 16 * 1024);
    let payload: { action?: unknown; channelId?: unknown; enabled?: unknown };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      sendJson(response, 400, { error: 'Format JSON tidak valid.' });
      return;
    }

    const action = payload.action === 'remove' || payload.action === 'toggle' ? payload.action : 'send';

    try {
      if (action === 'send') {
        const channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
        if (!/^\d{15,25}$/.test(channelId)) {
          sendJson(response, 400, { error: 'Channel ID tidak valid. Salin ID channel teks (mode Developer → Copy Channel ID).' });
          return;
        }
        const result = await publishPanel(botClient as Client, guildId, channelId);
        sendJson(response, 200, { ok: true, ...result, panel: await getPanel(guildId) });
        return;
      }

      if (action === 'remove') {
        const result = await removePanel(botClient as Client, guildId);
        sendJson(response, 200, { ok: true, ...result, panel: await getPanel(guildId) });
        return;
      }

      const enabled = Boolean(payload.enabled);
      const panel = await setPanelEnabled(guildId, enabled);
      sendJson(response, 200, { ok: true, panel });
      return;
    } catch (error) {
      if (error instanceof PanelError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
  }

  const keywordMatch = /^\/api\/keyword\/(\d+)$/.exec(path);
  if (keywordMatch && method === 'DELETE') {
    const id = Number(keywordMatch[1]);
    const removed = guildId ? await deleteKeyword(guildId, id) : false;
    sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'Keyword tidak ditemukan.' });
    return;
  }

  sendJson(response, 404, { error: 'Tidak ditemukan.' });
}

/* ------------------------------------------------------------------ */
/*  Start / stop                                                       */
/* ------------------------------------------------------------------ */

let server: Server | null = null;

export function startDashboard(client?: Client | null): Server | null {
  // Client boleh datang belakangan (bot login setelah dashboard hidup): yang
  // disimpan adalah referensinya, dan setiap aksi mengecek `client.isReady()`.
  if (client) botClient = client;

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

/* ------------------------------ bantuan ------------------------------ */

/** Baca + parse JSON body; `null` = respons error sudah dikirim. */
async function readJson(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<Record<string, unknown> | null> {
  return readJsonBody(request, response, 32 * 1024);
}

/** Sama seperti `readJson`, tapi batas ukurannya bisa diatur (mis. gambar). */
async function readJsonBody(
  request: IncomingMessage,
  response: ServerResponse,
  limit: number,
): Promise<Record<string, unknown> | null> {
  const raw = await readBody(request, limit);
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('bukan objek');
    return parsed as Record<string, unknown>;
  } catch {
    sendJson(response, 400, { error: 'Format JSON tidak valid.' });
    return null;
  }
}

/** Field teks opsional: tidak dikirim = nilai lama, dikirim kosong = null. */
function textField(
  payload: Record<string, unknown>,
  key: string,
  current: string | null,
  max = 300,
): string | null {
  if (!(key in payload)) return current;
  const value = typeof payload[key] === 'string' ? (payload[key] as string).trim() : '';
  return value ? value.slice(0, max) : null;
}

/** Nama yang dipakai pratinjau — diketik admin, kalau kosong pakai nama default. */
function previewName(payload: Record<string, unknown>, fallback: string): string {
  const value = typeof payload.name === 'string' ? payload.name.trim() : '';
  return (value || fallback).slice(0, 60);
}

/**
 * Member tiruan untuk pratinjau.
 *
 * Avatar memakai URL CDN milik bot sendiri, BUKAN gambar contoh dari internet:
 * URL-nya sudah pasti bisa dimuat browser (Discord CDN), tidak menambah
 * ketergantungan jaringan luar, dan tidak ada data member asli yang bocor ke
 * halaman. Kalau bot offline, avatar jatuh ke URL kosong dan UI menggambar
 * inisial nama.
 */
async function previewMemberFor(guildId: string, name: string): Promise<PreviewMemberLike> {
  const guild = botClient?.guilds.cache.get(guildId);
  const guildName = (await getGuildName(guildId)) ?? 'Server ini';
  const avatar = botClient?.user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? '';
  return {
    id: botClient?.user?.id ?? '0',
    // `displayName` yang dipakai baris penulis embed; `username` cadangan.
    displayName: name,
    user: { username: name, displayName: name },
    guild: { name: guildName, memberCount: guild?.memberCount ?? 0 },
    displayAvatarURL: () => avatar,
  };
}
