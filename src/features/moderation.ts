import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import { config } from '../config.js';
import { addModerationLog, getModerationSettings, type ModerationAction } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import { normalize } from '../lib/text.js';

/**
 * Moderasi otomatis sederhana: daftar kata terlarang per server.
 *
 * - Pengaturan diambil dari dashboard (tabel `moderation`); bila server belum
 *   pernah mengaturnya, dipakai nilai dari `.env` sebagai cadangan.
 * - Staff (role `STAFF_ROLE_ID` atau izin Manage Messages) tidak terkena filter.
 * - Setiap tindakan dicatat ke tabel `mod_logs` dan dikirim ke channel log
 *   (`MODLOG_CHANNEL_ID`) bila tersedia.
 */

export interface EffectiveModeration {
  enabled: boolean;
  words: string[];
  action: ModerationAction;
  timeoutMinutes: number;
  /** true = pengaturan berasal dari dashboard, bukan `.env` */
  stored: boolean;
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Variasi teks yang dipakai untuk pencocokan: apa adanya + versi bebas leetspeak. */
function variants(text: string): string[] {
  const plain = normalize(text);
  const deleet = normalize(
    text
      .toLowerCase()
      .split('')
      .map((char) => LEET[char] ?? char)
      .join(''),
  );

  return plain === deleet ? [plain] : [plain, deleet];
}

/** Kata terlarang yang muncul di `text` (sudah dinormalisasi, cocok per kata/frasa). */
export function findBannedWords(text: string, words: string[]): string[] {
  const targets = words.map((word) => normalize(word)).filter(Boolean);
  if (targets.length === 0) return [];

  const haystacks = variants(text).map((value) => ` ${value} `);
  const matched: string[] = [];

  for (const target of targets) {
    const needle = ` ${target} `;
    if (haystacks.some((haystack) => haystack.includes(needle)) && !matched.includes(target)) {
      matched.push(target);
    }
  }

  return matched;
}

// Cache singkat supaya tidak query DB untuk setiap pesan.
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { value: EffectiveModeration; expiresAt: number }>();

export function invalidateModerationCache(guildId?: string): void {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

export async function resolveModeration(guildId: string): Promise<EffectiveModeration> {
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const stored = await getModerationSettings(guildId);
  const value: EffectiveModeration = stored
    ? {
        enabled: stored.enabled,
        words: stored.words,
        action: stored.action,
        timeoutMinutes: stored.timeoutMinutes,
        stored: true,
      }
    : {
        enabled: config.moderation.enabled,
        words: config.moderation.words,
        action: config.moderation.action,
        timeoutMinutes: config.moderation.timeoutMinutes,
        stored: false,
      };

  cache.set(guildId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Channel yang ikut moderasi: channel teks biasa dan thread.
 *
 * Percakapan AI sudah pindah ke DM, jadi moderasi hanya menyaring pesan di
 * channel publik server — bukan percakapan privat member.
 */
function isModeratableChannel(channel: {
  type: ChannelType;
  isThread?: () => boolean;
}): boolean {
  if (channel.type === ChannelType.GuildText) return true;
  return typeof channel.isThread === 'function' && channel.isThread();
}

function isStaff(message: Message): boolean {
  const member = message.member;
  if (!member) return false;
  if (config.ids.staffRole && member.roles.cache.has(config.ids.staffRole)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator);
}

const ACTION_LABEL: Record<ModerationAction, string> = {
  delete: 'hapus pesan',
  warn: 'peringatan',
  timeout: 'timeout',
};

/**
 * Periksa satu pesan. Mengembalikan `true` bila pesan diblokir
 * (pemanggil harus berhenti dan tidak memproses pesan itu lebih jauh).
 */
export async function moderateMessage(message: Message): Promise<boolean> {
  if (message.author.bot || message.system) return false;
  if (!message.inGuild()) return false;
  // Thread publik tetap dimoderasi; DM tidak (pesan DM tidak pernah sampai ke sini).
  if (!isModeratableChannel(message.channel)) return false;
  if (isStaff(message)) return false;

  const guildId = message.guildId;
  const settings = await resolveModeration(guildId);
  if (!settings.enabled || settings.words.length === 0) return false;

  // Pesan tanpa teks (hanya lampiran/stiker) tidak bisa dicocokkan.
  const matched = findBannedWords(message.content, settings.words);
  if (matched.length === 0) return false;

  const action = settings.action;
  const summary = matched.join(', ');

  // Pesan selalu dihapus lebih dulu (ketiga tindakan mengandalkan ini).
  // Kalau bot kurang izin, kita tetap memberi tahu member agar pesannya
  // dihapus sendiri — moderasi tidak boleh gagal diam-diam.
  let deleted = false;
  try {
    await message.delete();
    deleted = true;
  } catch (error) {
    logger.warn('Moderasi: gagal menghapus pesan', errorMessage(error));
  }

  if (action === 'warn') {
    await notify(message, `⚠️ <@${message.author.id}> pesanmu mengandung kata terlarang (${summary}). Mohon jangan diulang ya.`);
  } else if (!deleted) {
    await notify(
      message,
      `⚠️ <@${message.author.id}> pesanmu mengandung kata terlarang dan tidak bisa dihapus otomatis (izin bot kurang). Tolong hapus sendiri ya.`,
    );
  }

  if (action === 'timeout') {
    try {
      await message.member?.timeout(settings.timeoutMinutes * 60_000, `Kata terlarang: ${summary}`);
    } catch (error) {
      logger.warn('Moderasi: gagal memberi timeout', errorMessage(error));
    }
  }

  await logAction(message, {
    matched: summary,
    action,
    timeoutMinutes: settings.timeoutMinutes,
  });

  return true;
}

/**
 * Beri tahu pelanggar. `reply` diutamakan supaya konteksnya jelas, tapi pesan
 * yang sudah dihapus tidak bisa dijadikan target reply (Discord menolak
 * `message_reference` ke pesan yang hilang), jadi jatuh ke kirim biasa.
 */
async function notify(message: Message, content: string): Promise<void> {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false, parse: [] } });
  } catch {
    const channel = message.channel;
    if (!isModeratableChannel(channel) || !('send' in channel)) return;
    await channel.send({ content, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => undefined);
  }
}

async function logAction(
  message: Message,
  detail: { matched: string; action: ModerationAction; timeoutMinutes: number },
): Promise<void> {
  const guildId = message.guild?.id ?? message.guildId ?? '';
  const userName = message.member?.displayName ?? message.author.username;
  const content = message.content.replace(/\s+/g, ' ').trim();

  try {
    const id = await addModerationLog({
      guildId,
      channelId: message.channelId,
      userId: message.author.id,
      userName,
      matched: detail.matched,
      action: detail.action,
    });
    logger.info('Moderasi: pesan diblokir', {
      id,
      guildId,
      userId: message.author.id,
      action: detail.action,
      matched: detail.matched,
    });
  } catch (error) {
    logger.error('Moderasi: gagal menyimpan log', errorMessage(error));
  }

  const logChannelId = config.ids.modLogChannel;
  if (!logChannelId) return;

  const channel = message.guild?.channels.cache.get(logChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const timeoutNote = detail.action === 'timeout' ? ` · timeout ${detail.timeoutMinutes} menit` : '';

  channel
    .send({
      content: [
        `🛡️ **Moderasi · ${ACTION_LABEL[detail.action]}**${timeoutNote}`,
        `• Pelanggar: <@${message.author.id}> (${userName})`,
        `• Channel: <#${message.channelId}>`,
        `• Kata: \`${detail.matched}\``,
      ].join('\n'),
      allowedMentions: { parse: [] },
    })
    .catch((error: unknown) => logger.warn('Moderasi: gagal kirim log ke channel', errorMessage(error)));
}
