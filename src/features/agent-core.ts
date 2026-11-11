/**
 * Logika AI Agent — murni, tanpa objek Discord.
 *
 * Dipisah dari `agent.ts` supaya semua keputusan "boleh nimbrung atau tidak"
 * bisa diuji tanpa koneksi Discord.
 *
 * Aturan yang dijaga:
 *   1. Hanya channel yang diaktifkan admin.
 *   2. Diam saat ramai (beberapa member bicara bersamaan).
 *   3. Jatah balasan per jam — pengaman biaya API + anti-spam.
 *   4. Jeda antar balasan supaya bot tidak mendominasi.
 *   5. Menyapa saat sepi hanya kalau memang sudah lama tidak ada obrolan.
 */
import type { AgentSettings } from '../db/repo.js';

/** Jejak satu pesan member di channel agent. */
export interface ChannelTrace {
  userId: string;
  at: number;
}

/** Percakapan singkat di MEMORI (bukan database) supaya obrolan nyambung. */
export interface MemoryTurn {
  userId: string;
  userName: string;
  /** 'user' = member, 'bot' = balasan AI. */
  role: 'user' | 'bot';
  text: string;
  at: number;
}

/** State in-memory per channel. Tidak pernah ditulis ke database. */
export interface AgentState {
  /** Timestamp balasan bot terakhir. 0 = belum pernah. */
  lastReplyAt: number;
  /** Timestamp balasan bot dalam 1 jam terakhir. */
  repliesLastHour: number[];
  /** Jejak pesan member, terlama di depan. */
  traces: ChannelTrace[];
  /** Beberapa percakapan terakhir — hanya di memori, hilang saat restart. */
  turns: MemoryTurn[];
}

export function emptyState(): AgentState {
  return { lastReplyAt: 0, repliesLastHour: [], traces: [], turns: [] };
}

/** Berapa banyak giliran percakapan yang disimpan sebagai konteks. */
export const MEMORY_TURNS = 8;

/**
 * System prompt untuk kalimat pemecah sepi.
 *
 * Satu sumber untuk dua pemakai: `handleQuietChannel()` (timer di bot.ts) dan
 * `previewQuietBreak()` (tombol "Tes pemecah sepi"). Dulu prompt-nya ditulis
 * dua kali dengan kalimat berbeda, jadi yang dilihat admin di dashboard bukan
 * yang benar-benar dikirim bot.
 */
export const QUIET_SYSTEM_PROMPT =
  'Kamu anggota komunitas yang santai. Tulis satu kalimat pembuka singkat (maks 100 karakter) ' +
  'untuk memecah keheningan. Jangan menyebut dirimu bot atau AI.';

/**
 * Sudut obrolan untuk pemecah sepi — dipilih acak supaya sapaan tidak selalu
 * berbentuk sama.
 *
 * Tanpa ini model cenderung mengulang pola "Sepi banget ya…" setiap kali.
 * Diambil dari referensi `ai-discord-chat` (`_ICEBREAKER_ANGLES`), tapi ditulis
 * ulang untuk konteks Indonesia dan dipangkas jadi sudut yang paling sering
 * memicu balasan.
 */
export const QUIET_ANGLES: readonly string[] = [
  'Sapa warga santai sesuai jam sekarang, lalu tanya lagi pada sibuk apa.',
  'Lempar satu pertanyaan pilihan ringan (makanan/minuman favorit, kebiasaan unik).',
  'Tanya santai warga lagi dengar lagu apa, nonton apa, atau main game apa.',
  'Nyeletuk soal suasana hari ini (hari kerja vs weekend, jam ngantuk, jam rebahan).',
  'Ajak ngobrol ringan soal hobi yang nyambung dengan tema server.',
  'Sapa dengan gaya akrab seolah baru buka HP dan mampir ke channel.',
  'Lempar celetukan relate soal kehidupan sehari-hari biar warga nyaut.',
];

/** Pilih sudut acak. Dipisah supaya test bisa mengunci perilakunya. */
export function pickQuietAngle(random: () => number = Math.random): string {
  const index = Math.floor(random() * QUIET_ANGLES.length);
  return QUIET_ANGLES[Math.min(Math.max(index, 0), QUIET_ANGLES.length - 1)]!;
}

/**
 * Larangan mengulang kalimat sebelumnya.
 *
 * Model tidak punya ingatan antar panggilan, jadi tanpa blok ini sapaan bisa
 * nyaris identik berulang kali. `recent` = kalimat-kalimat bot terakhir di
 * channel itu.
 */
export function buildAntiRepeatBlock(recent: readonly string[]): string {
  const cleaned = recent.map((text) => text.trim()).filter(Boolean).slice(-5);
  if (cleaned.length === 0) return '';
  const quoted = cleaned.map((text) => `"${text.slice(0, 120)}"`).join(' | ');
  return (
    `\nPENTING: kamu sudah pernah mengirim kalimat ini di channel yang sama: [${quoted}]. ` +
    'JANGAN memakai awalan, struktur, atau topik yang mirip. Jangan mengawali dengan "Sepi banget" atau "Aduh sepi".'
  );
}

/** Batas panjang kalimat pemecah sepi sebelum dikirim ke Discord. */
export const QUIET_MAX_CHARS = 200;

/** Tambah satu giliran percakapan, dibatasi `MEMORY_TURNS` terakhir. */
export function pushTurn(state: AgentState, turn: MemoryTurn): AgentState {
  return { ...state, turns: [...state.turns, turn].slice(-MEMORY_TURNS) };
}

/** Channel ini termasuk yang dikelola agent? */
export type AgentChannelRole = 'chat' | 'gallery' | null;

/**
 * Tentukan peran sebuah channel.
 *
 * Satu channel bisa dipakai sebagai galeri tanpa punya channel ngobrol —
 * karena itu `chat` dicek lebih dulu supaya channel yang sama tidak dianggap
 * galeri (kalau admin mengisinya dua kali, obrolan menang).
 */
export function channelRole(settings: AgentSettings, channelId: string): AgentChannelRole {
  if (!settings.channelId && !settings.galleryChannelId) return null;
  if (settings.channelId === channelId) return 'chat';
  if (settings.galleryChannelId === channelId) return 'gallery';
  return null;
}

export type SkipReason = 'disabled' | 'other-channel' | 'from-bot' | 'cooldown' | 'hourly-limit' | 'busy';

export interface ReplyDecision {
  reply: boolean;
  reason?: SkipReason;
  /** true = dipanggil langsung (mention/reply), bukan nimbrung sendiri. */
  summoned?: boolean;
}

export const HOUR_MS = 3_600_000;
/** Jendela "sedang ramai". */
export const BUSY_WINDOW_MS = 60_000;

/** Berapa member berbeda yang bicara dalam jendela terakhir. */
export function activeSpeakers(traces: ChannelTrace[], now: number, windowMs = BUSY_WINDOW_MS): number {
  const cutoff = now - windowMs;
  const users = new Set<string>();
  for (let i = traces.length - 1; i >= 0; i -= 1) {
    const trace = traces[i]!;
    if (trace.at < cutoff) break;
    users.add(trace.userId);
  }
  return users.size;
}

export interface ShouldReplyInput {
  settings: AgentSettings;
  state: AgentState;
  channelId: string;
  /** Pesan berasal dari bot (termasuk bot ini). */
  fromBot: boolean;
  /** Bot di-mention atau balasannya di-reply. */
  summoned: boolean;
  now: number;
}

export function shouldReply(input: ShouldReplyInput): ReplyDecision {
  const { settings, state, channelId, fromBot, summoned, now } = input;

  const role = channelRole(settings, channelId);
  if (!role) {
    // Bedakan "fitur mati" dari "channel lain" untuk memudahkan debugging.
    return { reply: false, reason: settings.channelId || settings.galleryChannelId ? 'other-channel' : 'disabled' };
  }
  if (fromBot) return { reply: false, reason: 'from-bot' };

  // Jatah per jam SELALU berlaku, termasuk saat dipanggil — pengaman biaya.
  const recent = state.repliesLastHour.filter((at) => now - at < HOUR_MS);
  if (recent.length >= settings.maxPerHour) return { reply: false, reason: 'hourly-limit' };

  // Saat dipanggil langsung, member memang menunggu jawaban: aturan
  // "jangan menyela" dilewati supaya bot tidak terasa mengabaikan.
  if (!summoned) {
    if (settings.busyMute && activeSpeakers(state.traces, now) >= 2) {
      return { reply: false, reason: 'busy' };
    }
    if (settings.cooldownSeconds > 0 && now - state.lastReplyAt < settings.cooldownSeconds * 1000) {
      return { reply: false, reason: 'cooldown' };
    }
  }

  return { reply: true, summoned };
}

/** Boleh menyapa duluan karena channel sudah sepi? */
/**
 * Apakah `now` masuk jam tenang malam (23:00–06:00 WIB)?
 *
 * Zona waktu dikunci ke Asia/Jakarta, bukan zona server: hosting umumnya UTC,
 * jadi tanpa ini "jam 3 pagi" jadi jam 10 pagi dan aturannya tidak berguna.
 */
export function isQuietHour(now: number): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(
      new Date(now),
    ),
  );
  return hour >= 23 || hour < 6;
}

export function shouldBreakSilence(settings: AgentSettings, state: AgentState, now: number): boolean {
  // Channel galeri tidak pernah disapa sendiri — isinya foto, bukan obrolan.
  if (!settings.channelId || settings.quietMinutes <= 0) return false;

  // Jam tenang malam: jangan menyapa channel kosong saat orang tidur. Balasan
  // ke mention tetap jalan lewat jalur lain — yang ditahan hanya sapaan.
  if (settings.quietHours && isQuietHour(now)) return false;
  if (settings.cooldownSeconds > 0 && now - state.lastReplyAt < settings.cooldownSeconds * 1000) return false;

  const lastTrace = state.traces[state.traces.length - 1];
  const lastActivity = Math.max(lastTrace?.at ?? 0, state.lastReplyAt);
  // Belum pernah ada obrolan: jangan bicara ke ruangan kosong.
  if (lastActivity === 0) return false;

  return now - lastActivity >= settings.quietMinutes * 60_000;
}

/** Catat balasan bot. Hanya 1 jam terakhir yang disimpan. */
export function recordReply(state: AgentState, now: number): AgentState {
  return {
    ...state,
    lastReplyAt: now,
    repliesLastHour: [...state.repliesLastHour.filter((at) => now - at < HOUR_MS), now],
  };
}

/** Catat aktivitas member. Jejak lebih tua dari 10 menit dibuang. */
export function recordTrace(state: AgentState, userId: string, now: number): AgentState {
  const cutoff = now - 600_000;
  return {
    ...state,
    traces: [...state.traces.filter((trace) => trace.at >= cutoff), { userId, at: now }],
  };
}

/** Channel sudah dianggap "diisi" bot (untuk label dashboard). */
export function isAgentActive(settings: AgentSettings): boolean {
  return Boolean(settings.channelId);
}
