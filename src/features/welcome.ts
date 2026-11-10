/**
 * Sambutan member baru.
 *
 * Dua jalur:
 *   1. **AI** — sapaan digenerate per orang memakai nama/nickname + jam masuk,
 *      jadi tiap member dapat kalimat yang berbeda (bukan template seragam).
 *   2. **Template** — kalau AI dimatikan atau gagal, teks template dipakai
 *      apa adanya dengan placeholder `{user}` dan `{server}`.
 *
 * Supaya tidak terasa seperti sistem, sapaan:
 *   - memakai nama panggilan (nickname di server, bukan username),
 *   - menyebut waktu (pagi/siang/malam) sesuai zona server,
 *   - dilarang memakai pembuka khas AI ("Halo! Selamat datang...").
 *
 * Tujuan channel: kalau `channelId` kosong, sambutan dikirim lewat **DM**
 * supaya tidak membanjiri channel dan tidak mempermalukan member baru.
 */
import {
  AttachmentBuilder,
  EmbedBuilder,
  type GuildMember,
  type TextChannel,
  type AnyThreadChannel,
} from 'discord.js';
import { config } from '../config.js';
import { getWelcomeSettings, type WelcomeSettings } from '../db/repo.js';
import { chat } from '../lib/llm.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { renderWelcomeCard } from './welcome-card.js';

const DEFAULT_TEMPLATE = 'Halo {user}, selamat datang di **{server}**! Senang kamu bergabung.';

/** Jam lokal server (WIB) — dipakai untuk menentukan pagi/siang/malam. */
function partOfDay(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('id-ID', {
      timeZone: config.features.timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  );
  if (hour < 4) return 'dinihari';
  if (hour < 11) return 'pagi';
  if (hour < 15) return 'siang';
  if (hour < 18) return 'sore';
  return 'malam';
}

/** Isi placeholder template tanpa AI. */
export function fillTemplate(template: string, member: GuildMember): string {
  const name = member.displayName || member.user.username;
  const guildName = member.guild.name;
  return template.replace(/\{user\}/g, name).replace(/\{server\}/g, guildName);
}

/** Instruksi gaya untuk model — dipisah supaya mudah dibaca dan diuji. */
export function buildWelcomePrompt(
  settings: WelcomeSettings,
  member: GuildMember,
  when: string,
): string {
  const name = member.displayName || member.user.username;
  return [
    'Kamu anggota komunitas yang ramah, bukan asisten dan bukan bot pengumuman.',
    `Tulis SATU sapaan untuk member baru bernama "${name}" yang baru saja bergabung di server "${member.guild.name}".`,
    `Waktu saat ini: ${when}. Sebut waktu itu kalau terasa pas.`,
    `Gaya: ${settings.style?.trim() || 'hangat, santai, seperti orang sungguhan menyapa'}.`,
    settings.example?.trim() ? `Contoh nada yang ingin ditiru (jangan disalin): "${settings.example.trim()}"` : '',
    'Aturan:',
    '- Maksimal 2 kalimat pendek, tidak lebih dari 220 karakter.',
    '- Sapa pakai nama panggilannya, jangan pakai kata "member" atau "user".',
    '- Jangan memakai pembuka khas AI: "Halo! Selamat datang", "Hai, aku bot", "Semoga betul-betul".',
    '- Jangan membuat janji, tautan, atau menyebut aturan server.',
    '- Boleh menyebut satu hal ringan untuk memulai obrolan (mis. tanya lagi ngapain).',
    'Balas HANYA dengan teks sapaannya.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Minta AI menulis sapaan. `null` = gagal, pemanggil memakai template. */
async function generateGreeting(
  settings: WelcomeSettings,
  member: GuildMember,
): Promise<string | null> {
  const when = partOfDay();
  try {
    const result = await chat({
      messages: [
        { role: 'system', content: 'Kamu menulis satu sapaan singkat. Balas hanya teks sapaannya.' },
        { role: 'user', content: buildWelcomePrompt(settings, member, when) },
      ],
      temperature: 0.9,
      maxTokens: 120,
    });

    const text = (result.message.content ?? '').trim().replace(/^["'“”]|["'“”]$/g, '').trim();
    if (!text) return null;
    return truncate(text, 260);
  } catch (error) {
    logger.warn(`Gagal membuat sapaan AI untuk ${member.user.tag} — pakai template`, errorMessage(error));
    return null;
  }
}

/** Unduh avatar member sebagai data URI untuk kartu. Gagal = tanpa avatar. */
async function avatarDataUri(member: GuildMember): Promise<string | null> {
  try {
    const url = member.displayAvatarURL({ extension: 'png', size: 256 });
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 1_500_000) return null;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export interface WelcomeOutcome {
  sent: boolean;
  /** true = dikirim lewat AI, false = template. */
  usedAi: boolean;
  /** Ke mana pesannya dikirim. */
  where: 'dm' | 'channel' | 'none';
}

/**
 * Kirim sambutan untuk member baru.
 *
 * Semua kegagalan ditelan dengan log: member yang menutup DM tidak boleh
 * membuat event handler melempar error.
 */
export async function welcomeMember(member: GuildMember): Promise<WelcomeOutcome> {
  if (member.user.bot) return { sent: false, usedAi: false, where: 'none' };

  const settings = await getWelcomeSettings(member.guild.id);
  if (!settings.enabled) return { sent: false, usedAi: false, where: 'none' };

  const greeting = settings.useAi ? await generateGreeting(settings, member) : null;
  const usedAi = Boolean(greeting);
  const text = greeting ?? fillTemplate(settings.template?.trim() || DEFAULT_TEMPLATE, member);

  const channel =
    settings.channelId && settings.channelId !== member.guild.id
      ? await fetchChannel(member, settings.channelId)
      : null;
  const where: WelcomeOutcome['where'] = channel ? 'channel' : 'dm';

  // Kartu hanya dibuat kalau memang akan dipakai — proses render memakan
  // waktu (~1 detik) dan tidak perlu kalau admin mematikannya.
  const attachment = settings.imageEnabled
    ? await buildCard(settings, member, text, usedAi)
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x6d8cff)
    .setDescription(text)
    .setFooter({ text: `Member baru · ${member.guild.name}` });

  try {
    if (channel) {
      await channel.send({
        content: `<@${member.id}>`,
        embeds: attachment ? [] : [embed],
        files: attachment ? [attachment] : [],
        allowedMentions: { users: [member.id] },
      });
    } else {
      await member.send({
        embeds: attachment ? [] : [embed],
        files: attachment ? [attachment] : [],
      });
    }
    logger.info(`Sambutan untuk ${member.user.tag} terkirim via ${where}${usedAi ? ' (AI)' : ' (template)'}.`);
    return { sent: true, usedAi, where };
  } catch (error) {
    logger.warn(`Gagal mengirim sambutan ke ${member.user.tag}`, errorMessage(error));
    return { sent: false, usedAi, where: 'none' };
  }
}

async function fetchChannel(
  member: GuildMember,
  channelId: string,
): Promise<TextChannel | AnyThreadChannel | null> {
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  if (!channel.isTextBased() || channel.isDMBased()) return null;

  // Jangan kirim ke channel yang bot-nya tidak bisa menulis — lebih baik DM.
  const me = member.guild.members.me;
  if (me && !channel.permissionsFor(me)?.has('SendMessages')) return null;
  return channel as TextChannel | AnyThreadChannel;
}

async function buildCard(
  settings: WelcomeSettings,
  member: GuildMember,
  text: string,
  usedAi: boolean,
): Promise<AttachmentBuilder | null> {
  const avatar = settings.includeAvatar ? await avatarDataUri(member) : null;
  const png = await renderWelcomeCard({
    userName: member.displayName || member.user.username,
    guildName: member.guild.name,
    message: truncate(text, 200),
    avatarDataUri: avatar,
  });
  if (!png) return null;

  // Nama file diberi penanda AI/template supaya mudah dibedakan saat diuji.
  const suffix = usedAi ? 'ai' : 'template';
  return new AttachmentBuilder(png, { name: `selamat-datang-${suffix}.png` });
}
