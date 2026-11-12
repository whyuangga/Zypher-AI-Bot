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
  listCustomPosts,
  getCustomPost,
  parseTrigger,
  type PostLayout,
  type PostTrigger,
  createCustomPost,
  updateCustomPost,
  deleteCustomPost,
  setCustomPostMessage,
  listRoleButtons,
  listRoleMenus,
  replaceRoleButtons,
  replaceRoleMenus,
  listPostActions,
  replacePostActions,
  listSchedules,
  replaceSchedules,
  listPostDocuments,
  getPostDocument,
  savePostDocument,
  deletePostDocument,
  listPostRevisions,
  restorePostRevision,
  listPostTargets,
  replacePostTargets,
  setPostTargetMessage,
  createPostShare,
  deletePostShare,
  getSharedPost,
} from '../db/repo.js';
import { invalidateModerationCache } from '../features/moderation.js';
import { listPanelChannels, PanelError, publishPanel, removePanel } from '../features/panel.js';
import {
  deletePostMessage,
  PostSendError,
  sendPostSeries,
  sendOrUpdatePost,
  sendOrUpdateEmbedPost,
  sendToTargets,
  sendOrUpdatePostViaWebhook,
  webhookIdentityFor,
} from '../features/custom-post-send.js';
import {
  measureBlocks,
  normalizeAccent,
  sanitizeBlocks,
  sanitizeMessageFlags,
  type PostBlock,
} from '../features/custom-post.js';
import {
  discohookShareApiUrl,
  looksLikeDiscohook,
  parseDiscohookShare,
  parseDiscohookShareId,
} from '../features/discohook-import.js';
import { listGuildRoles } from '../features/role-buttons.js';
import { sharePage } from './ui/share.js';
import { payloadUntukPesan } from '../features/custom-post-send.js';
import { CODEGEN_LIBRARIES, generateCodegen } from '../features/post-codegen.js';
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
import { pesanPage } from './ui/pesan.js';
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

/**
 * Kirim pesan yang sama ke channel tambahan, lalu simpan ID pesan per channel.
 *
 * Dibungkus di satu tempat supaya jalur embed dan jalur container memakai
 * aturan yang SAMA: gagal di satu channel dilaporkan per channel, dan ID pesan
 * yang berhasil disimpan supaya pengiriman berikutnya memperbarui pesan lama
 * di channel itu alih-alih menumpuk salinan.
 */
async function kirimTarget(options: {
  client: Client;
  guildId: string;
  postId: number;
  kirim: (channelId: string, messageId: string | null) => Promise<{ messageId: string; edited: boolean; dropped?: string[] }>;
}): Promise<Array<{ channelId: string; messageId?: string; error?: string }>> {
  const targets = await listPostTargets(options.guildId, options.postId);
  if (targets.length === 0) return [];
  const hasil = await sendToTargets({
    client: options.client,
    targets,
    kirim: options.kirim,
  });
  for (const satu of hasil.hasil) {
    if (satu.messageId) {
      await setPostTargetMessage(options.guildId, options.postId, satu.channelId, satu.messageId);
    }
  }
  return hasil.hasil;
}

/**
 * Ringkasan satu baris isi blok — dipakai daftar riwayat versi.
 *
 * Hanya jenis blok yang dihitung, bukan isinya: yang dicari admin di daftar
 * versi adalah "yang mana tadi yang ada tombolnya", bukan teks lengkapnya.
 */
function summarize(blocks: PostBlock[]): string {
  const hasil: string[] = [];
  let teks = 0;
  let tombol = 0;
  let gambar = 0;
  for (const blok of blocks) {
    if (blok.kind === 'text' || blok.kind === 'section') teks += 1;
    else if (blok.kind === 'button') tombol += 1;
    else if (blok.kind === 'image' || blok.kind === 'file') gambar += 1;
  }
  if (teks) hasil.push(`${teks} teks`);
  if (tombol) hasil.push(`${tombol} tombol`);
  if (gambar) hasil.push(`${gambar} media`);
  if (blocks.some((blok) => blok.kind === 'select')) hasil.push('menu pilihan');
  return hasil.join(' · ') || '(kosong)';
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
/**
 * Rapikan izin ping dari dashboard.
 *
 * Hanya tiga jenis yang dikenal Discord. Yang tidak dikenal DIBUANG, dan
 * daftar kosong berarti "tanpa ping" — arah yang aman: salah baca ke arah ini
 * hanya membuat ping tidak terjadi, sedangkan arah sebaliknya bisa memicu ping
 * massal yang tidak bisa ditarik kembali.
 */
function sanitizeAllowedMentions(value: unknown): { parse: Array<'users' | 'roles' | 'everyone'> } {
  const isi = value && typeof value === 'object' ? (value as { parse?: unknown }) : {};
  const daftar = Array.isArray(isi.parse) ? isi.parse : [];
  const sah: Array<'users' | 'roles' | 'everyone'> = [];
  for (const satu of daftar) {
    if (satu === 'users' || satu === 'roles' || satu === 'everyone') {
      if (!sah.includes(satu)) sah.push(satu);
    }
  }
  return { parse: sah };
}

/**
 * Pemicu event dari dashboard.
 *
 * Nilai asing dibaca sebagai `null` (hanya manual), bukan diteruskan: pemicu
 * yang tidak dikenal akan membuat pesan diam selamanya tanpa pesan galat.
 */
function sanitizeLayout(value: unknown): PostLayout | null {
  return value === 'embed' ? 'embed' : value === 'container' ? 'container' : null;
}

function sanitizeTrigger(value: unknown): PostTrigger | null {
  return parseTrigger(typeof value === 'string' ? value : null);
}

/** Nama thread dari dashboard: dipotong ke batas Discord, kosong = null. */
function sanitizeThreadName(value: unknown): string | null {
  const teks = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  return teks ? teks : null;
}

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

  /*
   * Tautan berbagi: halaman PUBLIK, tanpa login.
   *
   * Diletakkan SEBELUM pemeriksaan sesi — itu intinya. Isinya sengaja hanya
   * blok pesan (tanpa ID channel/pesan, tanpa daftar role, tanpa kaitan ke
   * server mana pun), karena tautan ini bisa dibuka siapa saja yang punya
   * alamatnya. Token acak dan bisa dicabut admin kapan saja.
   */
  const shareMatch = /^\/bagi\/([A-Za-z0-9_-]{8,64})$/.exec(path);
  if (shareMatch && method === 'GET') {
    const dibagikan = await getSharedPost(shareMatch[1]!).catch((): null => null);
    if (!dibagikan) {
      sendHtml(
        response,
        404,
        sharePage({ name: '', blocks: [], notFound: true }),
      );
      return;
    }
    sendHtml(response, 200, sharePage({ name: dibagikan.name, blocks: dibagikan.blocks, notFound: false }));
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
          // JANGAN tunggu pemindaian folder saat merender halaman.
          //
          // Pemindaian butuh ~240 ms di mesin ini (di disk jaringan panel
          // hosting bisa jauh lebih lama), dan dulu HTML Ringkasan menunggu
          // angka itu — akibatnya halaman ini terasa lemot padahal halaman
          // lain cepat. Panel menampilkan "—" dulu, lalu polling mengisinya.
          backgroundFolder: true,
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

  if (path === '/pesan' && method === 'GET') {
    // Daftar channel hanya bisa dibaca saat bot online; di mode dashboard-saja
    // admin tetap bisa menyimpan pesan, hanya belum bisa mengirim.
    let channels: Array<{ id: string; name: string }> = [];
    if (guildId && botClient?.isReady()) {
      channels = await listPanelChannels(botClient, guildId).catch((error: unknown) => {
        logger.warn(`Pesan: gagal membaca daftar channel — ${errorMessage(error)}`);
        return [];
      });
    }

    const posts = guildId ? await listCustomPosts(guildId) : [];

    // Tombol role per pesan, dikumpulkan sekalian supaya halaman tidak
    // menembak satu permintaan per pesan saat dibuka.
    const roleButtons: Record<number, Array<{ id: number; roleId: string; label: string; mode: string; emoji: string | null; style: string }>> = {};
    const roleMenus: Record<
      number,
      Array<{
        id: number;
        placeholder: string;
        minValues: number;
        maxValues: number;
        exclusive: boolean;
        options: Array<{ roleId: string; label: string; emoji: string | null; description: string | null }>;
      }>
    > = {};
    /*
     * Aksi komponen (versi ringkas flow Discohook). Dimuat bersama tombol &
     * menu supaya halaman tidak menembak satu permintaan per komponen.
     */
    const postActions: Record<number, Record<string, unknown[]>> = {};

    for (const post of posts) {
      const aksi = await listPostActions(guildId, post.id);
      if (Object.keys(aksi).length > 0) postActions[post.id] = aksi;
      const buttons = await listRoleButtons(guildId, post.id);
      if (buttons.length > 0) {
        roleButtons[post.id] = buttons.map((b) => ({
          id: b.id,
          roleId: b.roleId,
          label: b.label,
          mode: b.mode,
          emoji: b.emoji ?? null,
          style: b.style,
        }));
      }
      const menus = await listRoleMenus(guildId, post.id);
      if (menus.length > 0) {
        roleMenus[post.id] = menus.map((menu) => ({
          id: menu.id,
          placeholder: menu.placeholder,
          minValues: menu.minValues,
          maxValues: menu.maxValues,
          exclusive: menu.exclusive,
          options: menu.options.map((option) => ({
            roleId: option.roleId,
            label: option.label,
            emoji: option.emoji,
            description: option.description,
          })),
        }));
      }
    }

    /** Aksi komponen per pesan, dipakai editor untuk menggambar kartu aksi. */
    const aksiKomponen = postActions;

    /**
     * Jadwal kirim per pesan.
     *
     * Dimuat bersama daftar pesan supaya editor bisa menampilkan "dikirim
     * otomatis tiap …" tanpa permintaan tambahan per pesan.
     */
    const jadwal: Record<number, Array<{ dueAt: number; repeatMinutes: number; lastSentAt: number | null }>> = {};
    if (guildId) {
      for (const post of posts) {
        const daftar = await listSchedules(guildId, post.id).catch(() => []);
        if (daftar.length > 0) {
          jadwal[post.id] = daftar.map((satu) => ({
            dueAt: satu.dueAt,
            repeatMinutes: satu.repeatMinutes,
            lastSentAt: satu.lastSentAt,
          }));
        }
      }
    }

    /*
     * Riwayat versi per pesan, dengan ringkasan bloknya.
     *
     * Ringkasan dihitung di server karena bentuk blok bisa berbeda-beda
     * (container, gambar, tombol) dan klien tidak perlu tahu semua bentuk itu
     * hanya untuk menampilkan satu baris "3 blok: teks, tombol".
     */
    const riwayat: Record<number, Array<{ id: number; name: string; createdAt: number; ringkas: string }>> = {};
    if (guildId) {
      for (const post of posts) {
        const daftar = await listPostRevisions(guildId, post.id).catch(() => []);
        if (daftar.length > 0) {
          riwayat[post.id] = daftar.map((satu) => ({
            id: satu.id,
            name: satu.name,
            createdAt: satu.createdAt,
            ringkas: summarize(satu.snapshot.blocks),
          }));
        }
      }
    }

    // Daftar role hanya tersedia saat bot online.
    const roleInfo =
      guildId && botClient?.isReady()
        ? await listGuildRoles(botClient, guildId).catch((error: unknown) => {
            logger.warn(`Pesan: gagal membaca daftar role — ${errorMessage(error)}`);
            return { options: [], hasManageRoles: false, botHighestPosition: 0 };
          })
        : { options: [], hasManageRoles: false, botHighestPosition: 0 };

    sendHtml(
      response,
      200,
      pesanPage({
        guildId,
        guildName: await getGuildName(guildId),
        posts: posts.map((post) => ({
          id: post.id,
          name: post.name,
          channelId: post.channelId,
          blocks: post.blocks,
          messageId: post.messageId,
          updatedAt: post.updatedAt,
          accent: post.accent,
          sender: post.sender,
          trigger: post.trigger,
          layout: post.layout,
        })),
        channels,
        botReady: Boolean(botClient?.isReady()),
        roles: roleInfo.options,
        hasManageRoles: roleInfo.hasManageRoles,
        roleButtons,
        roleMenus,
        postActions: aksiKomponen,
        schedules: jadwal,
        revisions: riwayat,
        // Dokumen multi-pesan: dikirim sekalian supaya tab "Multi-pesan"
        // bisa dibuka tanpa permintaan tambahan (sama seperti daftar pesan).
        documents: guildId ? await listPostDocuments(guildId) : [],
        status: dashboardStatus(),
        counts: await navCounts(guildId),
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

  /* ---------------- Pesan container (halaman /pesan) ---------------- */

  /** Daftar role server untuk pemilih "tombol ambil role". */
  if (path === '/api/roles' && method === 'GET') {
    if (!guildId || !botClient?.isReady()) {
      sendJson(response, 200, { options: [], hasManageRoles: false, botHighestPosition: 0, offline: true });
      return;
    }
    try {
      const roles = await listGuildRoles(botClient, guildId);
      sendJson(response, 200, { ...roles, offline: false });
    } catch (error) {
      // Dashboard tetap harus terbuka walau Discord sedang bermasalah.
      logger.warn(`Gagal membaca daftar role — ${errorMessage(error)}`);
      sendJson(response, 200, { options: [], hasManageRoles: false, botHighestPosition: 0, offline: true });
    }
    return;
  }

  /**
   * Impor dari Discohook.
   *
   * Dua jalur, satu endpoint, karena keduanya menghasilkan bentuk yang sama
   * (blok `/pesan` + daftar peringatan):
   *
   *   POST /api/posts/import/discohook  { url: "https://discohook.app/?share=xxxx" }
   *   POST /api/posts/import/discohook  { json: { messages: [...] } }
   *
   * Kenapa pengunduhan dilakukan SERVER, bukan browser: Discohook tidak
   * mengirim header CORS untuk `api/v1/share`, jadi `fetch` dari halaman
   * dashboard akan ditolak. Server juga menjadi satu-satunya tempat yang bisa
   * membatasi host tujuan (hanya discohook.app) — tanpa itu endpoint ini
   * menjadi alat SSRF yang bisa disuruh membaca alamat internal.
   */
  if (path === '/api/posts/import/discohook' && method === 'POST') {
    const payload = await readJsonBody(request, response, 1024 * 1024);
    if (!payload) return;

    let data: unknown = payload.json ?? null;
    const sumber = payload.url ?? payload.share ?? '';

    if (typeof sumber === 'string' && sumber.trim()) {
      const shareId = parseDiscohookShareId(sumber);
      if (!shareId) {
        sendJson(response, 400, {
          error:
            'Tautan tidak dikenali. Tempel tautan share Discohook (https://discohook.app/?share=…) atau ID-nya saja.',
        });
        return;
      }
      const api = discohookShareApiUrl(shareId);
      try {
        const res = await fetch(api, {
          headers: { accept: 'application/json', 'user-agent': 'ZypherBot/1.0 (+dashboard import)' },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404) {
          sendJson(response, 400, {
            error: 'Tautan Discohook itu tidak ditemukan — mungkin sudah kedaluwarsa (tautan share berlaku maksimal 4 minggu).',
          });
          return;
        }
        if (!res.ok) {
          sendJson(response, 400, { error: `Discohook menjawab ${res.status}. Coba lagi sebentar.` });
          return;
        }
        data = (await res.json()) as unknown;
      } catch (error) {
        logger.warn(`Gagal mengunduh share Discohook ${shareId} — ${errorMessage(error)}`);
        sendJson(response, 400, {
          error: 'Tidak bisa menghubungi discohook.app dari server ini. Tempel JSON-nya langsung (Ekspor dari Discohook).',
        });
        return;
      }
    }

    if (data === null || data === undefined) {
      sendJson(response, 400, { error: 'Kirim "url" tautan Discohook atau "json" isi ekspornya.' });
      return;
    }

    const hasil = parseDiscohookShare(data);
    if (hasil.messages.length === 0) {
      sendJson(response, 400, {
        error: hasil.warnings[0] ?? 'Tidak ada pesan yang bisa diimpor dari data itu.',
        warnings: hasil.warnings,
      });
      return;
    }

    /*
     * Setiap pesan dilewatkan sanitizer yang SAMA dengan penyimpanan biasa,
     * jadi hasil impor tidak bisa menyelipkan blok yang tidak sah — sama
     * seperti JSON yang ditempel manual di editor.
     */
    sendJson(response, 200, {
      ok: true,
      format: looksLikeDiscohook(data) ? 'discohook' : 'tidak-dikenal',
      messages: hasil.messages.map((pesan) => {
        const bersih = sanitizeBlocks(pesan.blocks);
        return {
          name: pesan.name,
          blocks: bersih.blocks,
          warnings: [...pesan.warnings, ...bersih.dropped.map((alasan) => `Blok dibuang: ${alasan}`)],
          usage: measureBlocks(bersih.blocks),
        };
      }),
      warnings: hasil.warnings,
    });
    return;
  }

  /** `?withMessage=1` saat DELETE = hapus juga pesan di Discord. */

  /*
   * ---------- dokumen multi-pesan (`?grup=`) ----------
   *
   *   GET    /api/post-groups          daftar dokumen
   *   POST   /api/post-groups          simpan dokumen (baru / perbarui)
   *   POST   /api/post-groups/:id/send kirim sebagai rangkaian
   *   DELETE /api/post-groups/:id      hapus dokumen
   *
   * Kenapa endpoint terpisah dari /api/posts: dokumen bisa berisi sampai 20
   * pesan, sedangkan satu baris `custom_posts` selalu satu pesan. Menggabung
   * keduanya berarti setiap pembaca `custom_posts` harus tahu bentuk kedua —
   * dan tombol role, jadwal, serta aksi komponen semuanya bekerja pada satu
   * pesan.
   *
   * Nama `post-groups`, BUKAN `documents`: `/api/documents` sudah dipakai
   * dokumen RAG untuk halaman /dokumen (dan didaftarkan lebih dulu), sehingga
   * rute baru di sini tidak akan pernah tercapai — halaman Multi-pesan akan
   * menampilkan daftar kosong tanpa satu pun error.
   */
  if (path === '/api/post-groups' && (method === 'GET' || method === 'POST')) {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    if (method === 'GET') {
      sendJson(response, 200, { documents: await listPostDocuments(guildId) });
      return;
    }
    const payload = await readJsonBody(request, response, 1024 * 1024);
    if (!payload) return;
    const nama = String(payload.name ?? '').trim();
    if (!nama) {
      sendJson(response, 400, { error: 'Nama dokumen wajib diisi.' });
      return;
    }
    const id = payload.id === undefined ? undefined : Number(payload.id);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) {
      sendJson(response, 400, { error: 'ID dokumen tidak sah.' });
      return;
    }
    const hasil = await savePostDocument(guildId, {
      ...(id === undefined ? {} : { id }),
      name: nama,
      series: payload.series === true,
      messages: payload.messages,
    });
    if (!hasil) {
      sendJson(response, 404, { error: 'Dokumen tidak ditemukan.' });
      return;
    }
    /*
     * `dropped` ikut dikirim: pesan yang dibuang karena kosong, terlalu besar,
     * atau rujukannya menunjuk pesan yang tidak ada. Tanpa ini admin mengira
     * seluruh dokumen tersimpan apa adanya.
     */
    sendJson(response, 200, {
      ok: true,
      document: hasil.document,
      ...(hasil.dropped.length ? { dropped: hasil.dropped } : {}),
      ...(hasil.warnings.length ? { warnings: hasil.warnings } : {}),
    });
    return;
  }

  /*
   * ---------- riwayat revisi & tautan berbagi ----------
   *
   *   GET  /api/posts/:id/revisions       daftar versi
   *   POST /api/posts/:id/revisions       { revisionId } = kembalikan versi itu
   *   POST /api/posts/:id/share           buat tautan berbagi
   *   DELETE /api/posts/:id/share         cabut tautannya
   *
   * Riwayat dibuat otomatis setiap kali pesan diperbarui (lihat
   * updateCustomPost), bukan lewat tombol "simpan versi": admin tidak akan
   * ingat menekannya, dan riwayat yang bolong lebih buruk daripada tidak ada.
   */
  /*
   * ---------- JSON payload & generator kode ----------
   *
   *   GET /api/posts/:id/json?library=djs14|dpy2
   *
   * Dua hal sekaligus, dari SATU penyusun: `components` adalah payload yang
   * benar-benar dikirim ke Discord (hasil buildPostPayload), dan `code`
   * diterjemahkan dari payload itu — bukan dari state editor. Kalau
   * diterjemahkan dari editor, kode yang dihasilkan bisa berbeda dari yang
   * sungguh terkirim, dan justru saat itulah generator kode menyesatkan.
   */
  const jsonMatch = /^\/api\/posts\/(\d+)\/json$/.exec(path);
  if (jsonMatch && method === 'GET') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const post = await getCustomPost(guildId, Number(jsonMatch[1]));
    if (!post) {
      sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
      return;
    }
    const library = new URL(request.url ?? '/', 'http://local').searchParams.get('library');
    const pilihan = CODEGEN_LIBRARIES.includes(library as (typeof CODEGEN_LIBRARIES)[number])
      ? (library as (typeof CODEGEN_LIBRARIES)[number])
      : 'djs14';
    const built = await payloadUntukPesan(guildId, post);
    sendJson(response, 200, {
      post: { id: post.id, name: post.name, channelId: post.channelId },
      blocks: post.blocks,
      allowedMentions: post.allowedMentions,
      threadName: post.threadName,
      flags: post.flags,
      // `null` = pesan kosong; dashboard menampilkan penjelasannya.
      components: built?.components ?? null,
      dropped: built?.dropped ?? [],
      codegen: built?.components
        ? generateCodegen(built.components, pilihan)
        : { imports: [], code: ['// Pesan ini belum punya komponen — susun blok dulu di tab Susun.'], documentation: '', dropped: [] },
      library: pilihan,
    });
    return;
  }

  const revMatch = /^\/api\/posts\/(\d+)(\/revisions|\/share)$/.exec(path);
  if (revMatch) {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const postId = Number(revMatch[1]);
    const jenis = revMatch[2];
    const post = await getCustomPost(guildId, postId);
    if (!post) {
      sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
      return;
    }

    if (jenis === '/revisions' && method === 'GET') {
      const daftar = await listPostRevisions(guildId, postId);
      /*
       * `?revision=<id>` = minta isi blok satu versi saja.
       *
       * Daftar versi sengaja tidak membawa snapshot penuh (20 versi × blok
       * pesan besar = halaman berat). Diff di dashboard memintanya hanya saat
       * tombol Bandingkan ditekan, untuk versi yang benar-benar dibandingkan.
       */
      const ingin = new URL(request.url ?? '/', 'http://local').searchParams.get('revision');
      if (ingin) {
        const id = Number(ingin);
        const satu = daftar.find((revisi) => revisi.id === id);
        if (!satu) {
          sendJson(response, 404, { error: 'Versi itu tidak ada di riwayat pesan ini.' });
          return;
        }
        sendJson(response, 200, {
          revision: { id: satu.id, name: satu.name, createdAt: satu.createdAt, snapshot: satu.snapshot },
        });
        return;
      }
      sendJson(response, 200, { revisions: daftar });
      return;
    }

    if (jenis === '/revisions' && method === 'POST') {
      const payload = await readJsonBody(request, response, 64 * 1024);
      const revisionId = Number(payload?.revisionId);
      if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
        sendJson(response, 400, { error: 'Versi yang mau dikembalikan tidak disebut.' });
        return;
      }
      const hasil = await restorePostRevision(guildId, postId, revisionId);
      if (!hasil.post) {
        sendJson(response, 400, { error: hasil.error ?? 'Versi itu tidak bisa dikembalikan.' });
        return;
      }
      sendJson(response, 200, { ok: true, post: hasil.post });
      return;
    }

    if (jenis === '/share' && (method === 'POST' || method === 'DELETE')) {
      if (method === 'DELETE') {
        await deletePostShare(guildId, postId);
        sendJson(response, 200, { ok: true });
        return;
      }
      const token = await createPostShare(guildId, postId);
      sendJson(response, 200, { ok: true, token });
      return;
    }
    sendJson(response, 405, { error: 'Metode tidak didukung.' });
    return;
  }

  const docMatch = /^\/api\/post-groups\/(\d+)(\/send)?$/.exec(path);
  if (docMatch) {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const docId = Number(docMatch[1]);
    const dokumen = await getPostDocument(guildId, docId);
    if (!dokumen) {
      sendJson(response, 404, { error: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (method === 'DELETE' && !docMatch[2]) {
      await deletePostDocument(guildId, docId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === 'POST' && docMatch[2] === '/send') {
      const payload = await readJsonBody(request, response, 64 * 1024);
      const channelId =
        typeof payload?.channelId === 'string' && payload.channelId.trim()
          ? payload.channelId.trim()
          : null;
      if (!channelId) {
        sendJson(response, 400, { error: 'Pilih channel tujuan lebih dulu.' });
        return;
      }
      if (!botClient?.isReady()) {
        sendJson(response, 400, { error: 'Bot sedang offline di proses ini, jadi pesan tidak bisa dikirim.' });
        return;
      }
      if (dokumen.messages.length === 0) {
        sendJson(response, 400, { error: 'Dokumen ini belum punya pesan yang bisa dikirim.' });
        return;
      }
      try {
        const hasil = await sendPostSeries({
          client: botClient,
          channelId,
          messages: dokumen.messages,
          postId: docId,
        });
        sendJson(response, 200, {
          ok: hasil.failed.length === 0,
          sent: hasil.sent,
          ...(hasil.failed.length ? { failed: hasil.failed } : {}),
          ...(hasil.threads.length ? { threads: hasil.threads } : {}),
        });
      } catch (error) {
        if (error instanceof PostSendError) {
          sendJson(response, 400, { error: error.message });
        } else {
          logger.error('Gagal mengirim dokumen multi-pesan', errorMessage(error));
          sendJson(response, 500, { error: 'Gagal mengirim ke Discord.' });
        }
      }
      return;
    }

    sendJson(response, 405, { error: 'Metode tidak didukung untuk dokumen ini.' });
    return;
  }

  if (path === '/api/posts' && method === 'POST') {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const payload = await readJson(request, response);
    if (!payload) return;

    const name = String(payload.name ?? '').trim();
    if (!name) {
      sendJson(response, 400, { error: 'Nama pesan wajib diisi.' });
      return;
    }
    const channelId = typeof payload.channelId === 'string' && payload.channelId.trim() ? payload.channelId.trim() : null;
    const accent = payload.accent === undefined ? null : normalizeAccent(payload.accent);
    const sender = payload.sender === 'webhook' ? 'webhook' : 'bot';
    /*
     * Flag pesan: nilai asing dibuang sanitizer, bukan diteruskan. Flag yang
     * tidak dikenal membuat Discord menolak pesan, dan admin tidak akan tahu
     * penyebabnya.
     */
    const flags = payload.flags === undefined ? undefined : sanitizeMessageFlags(payload.flags);

    // Blok dirapikan di repo (sanitizeBlocks). Hasil buangannya dikembalikan
    // supaya admin tahu apa yang tidak jadi dikirim, bukan disembunyikan.
    const post = await createCustomPost(guildId, {
      name,
      channelId,
      blocks: payload.blocks,
      accent,
      sender,
      flags,
      allowedMentions: sanitizeAllowedMentions(payload.allowedMentions),
      threadName: sanitizeThreadName(payload.threadName),
      trigger: sanitizeTrigger(payload.trigger),
      layout: sanitizeLayout(payload.layout),
    });
    const { blocks: blokSah, dropped } = sanitizeBlocks(payload.blocks);
    // `usage` = hitungan versi SERVER. Dashboard boleh menghitung sendiri
    // untuk pratinjau, tapi angka inilah yang menentukan boleh-kirim.
    sendJson(response, 200, {
      ok: true,
      post: { ...post } as unknown as Record<string, unknown>,
      dropped,
      usage: measureBlocks(blokSah),
    });
    return;
  }

  const postMatch = /^\/api\/posts\/(\d+)(\/send|\/roles|\/schedules|\/targets)?$/.exec(path);
  if (postMatch) {
    if (!guildId) {
      sendJson(response, 400, { error: 'Server belum dipilih.' });
      return;
    }
    const id = Number(postMatch[1]);
    const isSend = postMatch[2] === '/send';
    const isRoles = postMatch[2] === '/roles';
    const isSchedules = postMatch[2] === '/schedules';
    const isTargets = postMatch[2] === '/targets';

    /* Channel tambahan (targets[]): diganti seluruhnya tiap simpan. */
    if (isTargets && (method === 'GET' || method === 'PUT')) {
      const post = await getCustomPost(guildId, id);
      if (!post) {
        sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
        return;
      }
      if (method === 'GET') {
        sendJson(response, 200, { targets: await listPostTargets(guildId, id) });
        return;
      }
      const payload = await readJson(request, response);
      if (!payload) return;
      const hasil = await replacePostTargets(guildId, id, payload.channels);
      sendJson(response, 200, { ok: true, ...hasil });
      return;
    }

    if (isSend && method === 'POST') {
      const post = await getCustomPost(guildId, id);
      if (!post) {
        sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
        return;
      }

      /*
       * Batas komponen diperiksa SEBELUM cek bot dan sebelum menyentuh
       * Discord. Dua alasan:
       *   1. admin mendapat jawaban yang berguna walau bot sedang offline
       *      (kalau urutannya dibalik, ia hanya melihat "bot offline" dan
       *      tidak tahu pesannya juga terlalu besar)
       *   2. API bisa dipanggil langsung, jadi aturan ini tidak boleh hanya
       *      hidup di dashboard
       */
      const ukuran = measureBlocks(post.blocks);
      if (ukuran.over) {
        sendJson(response, 400, {
          error: `Pesan melewati batas Discord: ${ukuran.masalah.join(' ')}`,
          usage: ukuran,
        });
        return;
      }

      if (!botClient?.isReady()) {
        sendJson(response, 400, { error: 'Bot sedang offline di proses ini, jadi pesan tidak bisa dikirim.' });
        return;
      }
      /*
       * Setelah pemeriksaan di atas, `botClient` sempit ke Client yang siap.
       * Disimpan ke variabel lokal supaya callback pengiriman ke channel
       * tambahan tidak perlu `!` di belasan tempat.
       */
      const bot = botClient;
      if (!post.channelId) {
        sendJson(response, 400, { error: 'Channel tujuan belum dipilih.' });
        return;
      }
      try {
        const roleButtons = await listRoleButtons(guildId, id);
        const roleMenus = await listRoleMenus(guildId, id);
        // Menu dipetakan ke bentuk yang dipahami penyusun payload: `value`
        // berisi role ID supaya interaksi bisa langsung dipakai handler.
        const menuPayload = roleMenus.map((menu) => ({
          id: menu.id,
          placeholder: menu.placeholder,
          minValues: menu.minValues,
          maxValues: menu.maxValues,
          options: menu.options.map((option) => ({
            roleId: option.roleId,
            label: option.label,
            emoji: option.emoji,
            description: option.description,
          })),
        }));
        // Dua jalur pengiriman, pilihan admin:
        //   bot     -> pengirim bot (bisa tombol role)
        //   webhook -> atas nama server (tidak bisa tombol role)
        /*
         * Aksi komponen tidak bisa dipakai di pesan webhook.
         *
         * Discord mengirim interaksi komponen ke aplikasi PEMILIK komponen;
         * untuk pesan webhook, pemiliknya webhook itu sendiri — bukan bot kita.
         * Jadi tombol/aksinya akan diam. Lebih jujur menolak di sini, sama
         * seperti tombol & menu role.
         */
        /*
         * Pesan bergaya embed klasik: jalur kirim sendiri.
         *
         * Aturannya berlawanan dengan Components V2 (embed tidak boleh membawa
         * flag V2, V2 tidak boleh membawa embeds), jadi keduanya tidak boleh
         * lewat penyusun payload yang sama.
         */
        if (post.layout === 'embed') {
          const hasilEmbed = await sendOrUpdateEmbedPost({
            client: bot,
            channelId: post.channelId,
            messageId: post.messageId,
            blocks: post.blocks,
            accent: post.accent,
            title: post.name,
            postId: id,
            flags: post.flags,
            allowedMentions: post.allowedMentions,
            roleButtons: roleButtons.map((b) => ({
              id: b.id,
              label: b.label,
              emoji: b.emoji ?? null,
              style: b.style ?? null,
            })),
            roleMenus: menuPayload,
          });
          await setCustomPostMessage(guildId, id, hasilEmbed.messageId);
          /*
           * Channel tambahan (targets[]): pesan yang sama dikirim ke tiap
           * channel, dengan ID pesannya masing-masing. Gagal di satu channel
           * tidak membatalkan yang lain.
           */
          const targetEmbed = await kirimTarget({
            client: bot,
            guildId,
            postId: id,
            kirim: (channelId, messageId) =>
              sendOrUpdateEmbedPost({
                client: bot,
                channelId,
                messageId,
                blocks: post.blocks,
                accent: post.accent,
                title: post.name,
                postId: id,
                flags: post.flags,
                allowedMentions: post.allowedMentions,
                roleButtons: roleButtons.map((b) => ({
                  id: b.id,
                  label: b.label,
                  emoji: b.emoji ?? null,
                  style: b.style ?? null,
                })),
                roleMenus: menuPayload,
              }),
          });
          sendJson(response, 200, {
            ok: true,
            messageId: hasilEmbed.messageId,
            edited: hasilEmbed.edited,
            ...(hasilEmbed.dropped?.length ? { dropped: hasilEmbed.dropped } : {}),
            ...(targetEmbed.length ? { targets: targetEmbed } : {}),
          });
          return;
        }

        if (post.sender === 'webhook') {
          const aksi = await listPostActions(guildId, id);
          if (Object.keys(aksi).length > 0) {
            sendJson(response, 400, {
              error:
                'Pesan lewat webhook tidak bisa memakai aksi komponen — Discord hanya mengirim interaksi ke aplikasi pengirim. Matikan mode webhook untuk pesan ini, atau hapus aksinya.',
            });
            return;
          }
        }

        const result =
          post.sender === 'webhook'
            ? await sendOrUpdatePostViaWebhook({
                client: bot,
                guildId,
                channelId: post.channelId,
                messageId: post.messageId,
                blocks: post.blocks,
                accent: post.accent ?? undefined,
                identity: await webhookIdentityFor(bot, guildId),
                postId: id,
                flags: post.flags,
                template: null,
              })
            : await sendOrUpdatePost({
                client: bot,
                channelId: post.channelId,
                messageId: post.messageId,
                blocks: post.blocks,
                accent: post.accent ?? undefined,
                postId: id,
                flags: post.flags,
                /* Izin ping & thread: bagian dari isi pesan, bukan komponen. */
                allowedMentions: post.allowedMentions,
                ...(post.threadName ? { threadName: post.threadName } : {}),
                roleButtons: roleButtons.map((b) => ({
                  id: b.id,
                  label: b.label,
                  emoji: b.emoji ?? null,
                  style: b.style ?? null,
                })),
                roleMenus: menuPayload,
              });
        await setCustomPostMessage(guildId, id, result.messageId);
        /*
         * `dropped`/`droppedFiles` ikut dikirim: komponen yang dilewati
         * penyusun payload (mis. select yang tidak didukung) dan berkas yang
         * gagal diunduh. Tanpa ini admin mengira pesannya terkirim utuh.
         */
        /*
         * Channel tambahan. Pesan webhook & pesan bot sama-sama bisa dikirim ke
         * beberapa channel; penyusunnya dipanggil ulang per channel supaya ID
         * pesan tiap channel tercatat sendiri-sendiri.
         */
        const targetUtama = await kirimTarget({
          client: bot,
          guildId,
          postId: id,
          kirim: async (channelId, messageId) =>
            post.sender === 'webhook'
              ? sendOrUpdatePostViaWebhook({
                  client: bot,
                  guildId,
                  channelId,
                  messageId,
                  blocks: post.blocks,
                  accent: post.accent ?? undefined,
                  // Identitas webhook diambil per channel: nama & avatar server
                  // sama, tetapi webhook-nya berbeda per channel.
                  identity: await webhookIdentityFor(bot, guildId),
                  postId: id,
                  flags: post.flags,
                  template: null,
                })
              : sendOrUpdatePost({
                  client: bot,
                  channelId,
                  messageId,
                  blocks: post.blocks,
                  accent: post.accent ?? undefined,
                  postId: id,
                  flags: post.flags,
                  allowedMentions: post.allowedMentions,
                  ...(post.threadName ? { threadName: post.threadName } : {}),
                  roleButtons: roleButtons.map((b) => ({
                    id: b.id,
                    label: b.label,
                    emoji: b.emoji ?? null,
                    style: b.style ?? null,
                  })),
                  roleMenus: menuPayload,
                }),
        });

        sendJson(response, 200, {
          ok: true,
          messageId: result.messageId,
          edited: result.edited,
          ...(result.dropped?.length ? { dropped: result.dropped } : {}),
          ...(result.droppedFiles?.length ? { droppedFiles: result.droppedFiles } : {}),
          ...(targetUtama.length ? { targets: targetUtama } : {}),
        });
      } catch (error) {
        // PostSendError = kesalahan yang bisa dimengerti admin (channel hilang,
        // pesan kosong). Selain itu tetap dicatat sebagai kesalahan server.
        if (error instanceof PostSendError) {
          sendJson(response, 400, { error: error.message });
        } else {
          logger.error('Gagal mengirim pesan kustom', errorMessage(error));
          sendJson(response, 500, { error: 'Gagal mengirim ke Discord.' });
        }
      }
      return;
    }

    /* Tombol ambil role: diganti seluruhnya tiap simpan. */
    if (isRoles && method === 'PUT') {
      const payload = await readJson(request, response);
      if (!payload) return;
      const post = await getCustomPost(guildId, id);
      if (!post) {
        sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
        return;
      }
      const result = await replaceRoleButtons(guildId, id, payload.buttons);
      // Menu disimpan di endpoint yang sama supaya dashboard cukup satu kali
      // simpan. `menus` tidak dikirim = jangan sentuh menu yang sudah ada.
      const menuResult =
        payload.menus === undefined
          ? { menus: await listRoleMenus(guildId, id), dropped: [] as string[] }
          : await replaceRoleMenus(guildId, id, payload.menus);
      /*
       * Aksi komponen disimpan di endpoint yang sama.
       *
       * `actions` TIDAK dikirim = jangan sentuh aksi yang sudah ada (sama
       * seperti `menus`), supaya klien lama yang hanya tahu tombol tidak
       * menghapus aksi tanpa sengaja.
       */
      const actionResult =
        payload.actions === undefined
          ? { actions: await listPostActions(guildId, id), dropped: [] as string[] }
          : await replacePostActions(guildId, id, payload.actions);
      sendJson(response, 200, {
        ok: true,
        buttons: result.buttons,
        menus: menuResult.menus,
        actions: actionResult.actions,
        dropped: [...result.dropped, ...menuResult.dropped, ...actionResult.dropped],
      });
      return;
    }

    /* Jadwal kirim: daftar penuh (null = hapus semua). */
    if (isSchedules && method === 'PUT') {
      const post = await getCustomPost(guildId, id);
      if (!post) {
        sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
        return;
      }
      if (!post.channelId) {
        sendJson(response, 400, { error: 'Pilih channel tujuan dulu — jadwal tanpa channel tidak bisa dikirim.' });
        return;
      }
      const payload = await readJson(request, response);
      if (!payload) return;
      /*
       * Zona waktu server ikut dikirim: jadwal cron berbunyi menurut jam
       * dinding WIB/WITA/WIT, bukan UTC. Offsetnya disimpan bersama jadwal
       * supaya arti "tiap Senin 09:00" tidak berubah kalau zona server diubah.
       */
      const zonaServer = (await getGuildSettings(guildId).catch((): null => null))?.timezone ?? null;
      const hasil = await replaceSchedules(
        guildId,
        id,
        post.channelId,
        payload.schedules,
        zonaServer,
      );
      sendJson(response, 200, { ok: true, schedules: hasil.schedules, dropped: hasil.dropped });
      return;
    }

    if (method === 'POST') {
      const payload = await readJson(request, response);
      if (!payload) return;
      const post = await updateCustomPost(guildId, id, {
        accent: payload.accent === undefined ? undefined : normalizeAccent(payload.accent),
        sender: payload.sender === undefined ? undefined : payload.sender === 'webhook' ? 'webhook' : 'bot',
        name: payload.name === undefined ? undefined : String(payload.name).trim(),
        // Tidak dikirim = flag lama dipertahankan, sama seperti field lain.
        flags: payload.flags === undefined ? undefined : sanitizeMessageFlags(payload.flags),
        // Sama: tidak dikirim = izin ping & nama thread lama dipertahankan.
        allowedMentions:
          payload.allowedMentions === undefined ? undefined : sanitizeAllowedMentions(payload.allowedMentions),
        threadName: payload.threadName === undefined ? undefined : sanitizeThreadName(payload.threadName),
        trigger: payload.trigger === undefined ? undefined : sanitizeTrigger(payload.trigger),
        layout: payload.layout === undefined ? undefined : sanitizeLayout(payload.layout),
        channelId:
          payload.channelId === undefined
            ? undefined
            : typeof payload.channelId === 'string' && payload.channelId.trim()
              ? payload.channelId.trim()
              : null,
        blocks: payload.blocks,
      });
      if (!post) {
        sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
        return;
      }
      const { blocks: blokSah, dropped } =
        payload.blocks === undefined ? { blocks: post.blocks, dropped: [] as string[] } : sanitizeBlocks(payload.blocks);
      sendJson(response, 200, {
        ok: true,
        post: { ...post } as unknown as Record<string, unknown>,
        dropped,
        usage: measureBlocks(blokSah),
      });
      return;
    }

    if (method === 'DELETE') {
      const post = await getCustomPost(guildId, id);
      if (!post) {
        sendJson(response, 404, { error: 'Pesan tidak ditemukan.' });
        return;
      }
      // Pesan di Discord sengaja TIDAK dihapus saat menghapus dari dashboard:
      // kalau admin hanya ingin membersihkan daftar, pesan yang sudah dibaca
      // member jangan lenyap. Ada endpoint terpisah untuk itu (withMessage).
      if (url.searchParams.get('withMessage') === '1' && botClient) {
        const deleted = await deletePostMessage({
          client: botClient,
          channelId: post.channelId,
          messageId: post.messageId,
        }).catch(() => false);
        logger.info(`Pesan kustom ${id}: pesan Discord ${deleted ? 'dihapus' : 'tidak dihapus'}.`);
      }
      await deleteCustomPost(guildId, id);
      sendJson(response, 200, { ok: true });
      return;
    }
  }

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
