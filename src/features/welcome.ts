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
import { getGoodbyeSettings, getWelcomeSettings, type GoodbyeSettings, type WelcomeSettings } from '../db/repo.js';
import { chat } from '../lib/llm.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { renderWelcomeCard } from './welcome-card.js';
import { buildWelcomePrompt, partOfDay, previewGoodbye, previewWelcome } from './preview.js';
import { readBannerDataUri } from './banner.js';
import { DEFAULT_GOODBYE_TEMPLATE, DEFAULT_WELCOME_TEMPLATE, fillText } from './greeting-text.js';

/** Isi placeholder template tanpa AI. */
export function fillTemplate(template: string, member: GuildMember): string {
  return fillText(template, {
    user: memberName(member),
    server: member.guild.name,
  });
}

/** Nama panggilan member — nickname di server lebih dulu, lalu username. */
function memberName(member: GuildMember): string {
  return member.displayName || member.user.username;
}

/** Bentuk minimal member untuk fungsi prompt di `preview.ts`. */
function memberShape(member: GuildMember): { name: string; guildName: string } {
  return { name: memberName(member), guildName: member.guild.name };
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
        { role: 'user', content: buildWelcomePrompt(settings, memberShape(member), when) },
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
  const text = greeting ?? fillTemplate(settings.template?.trim() || DEFAULT_WELCOME_TEMPLATE, member);

  const channel =
    settings.channelId && settings.channelId !== member.guild.id
      ? await fetchChannel(member, settings.channelId)
      : null;
  const where: WelcomeOutcome['where'] = channel ? 'channel' : 'dm';

  // Kartu hanya dibuat kalau memang akan dipakai — proses render memakan
  // waktu (~1 detik) dan tidak perlu kalau admin mematikannya.
  const attachment = settings.imageEnabled
    ? await buildCard(
        {
          member,
          text,
          includeAvatar: settings.includeAvatar,
          bannerPath: settings.bannerPath,
          kicker: 'SELAMAT DATANG',
          filePrefix: 'selamat-datang',
        },
        usedAi,
      )
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x6d8cff)
    .setDescription(text)
    .setFooter({ text: `Member baru · ${member.guild.name}` });

  // Tanpa kartu, banner tetap dipakai sebagai gambar embed — supaya unggahan
  // admin tidak sia-sia saat kartu PNG dimatikan.
  if (!attachment) {
    const banner = await readBannerDataUri(settings.bannerPath);
    if (banner) embed.setImage(banner);
  }

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
  options: {
    member: GuildMember;
    text: string;
    includeAvatar: boolean;
    bannerPath: string | null;
    kicker: string;
    filePrefix: string;
  },
  usedAi: boolean,
): Promise<AttachmentBuilder | null> {
  const { member } = options;
  const [avatar, banner] = await Promise.all([
    options.includeAvatar ? avatarDataUri(member) : Promise.resolve(null),
    readBannerDataUri(options.bannerPath),
  ]);

  const png = await renderWelcomeCard({
    userName: memberName(member),
    guildName: member.guild.name,
    message: truncate(options.text, 200),
    avatarDataUri: avatar,
    bannerDataUri: banner,
    kicker: options.kicker,
  });
  if (!png) return null;

  // Nama file diberi penanda AI/template supaya mudah dibedakan saat diuji.
  const suffix = usedAi ? 'ai' : 'template';
  return new AttachmentBuilder(png, { name: `${options.filePrefix}-${suffix}.png` });
}



/* ------------------------------------------------------------------ */
/*  Salam perpisahan (goodbye)                                         */
/* ------------------------------------------------------------------ */

/** Isi placeholder untuk salam perpisahan. */
export function fillGoodbyeTemplate(template: string, member: GuildMember): string {
  return fillText(template, { user: memberName(member), server: member.guild.name });
}

async function generateGoodbye(settings: GoodbyeSettings, member: GuildMember): Promise<string | null> {
  const result = await previewGoodbye({ settings, ...memberShape(member) });
  return result.source === 'ai' ? result.text : null;
}

/**
 * Kirim salam perpisahan.
 *
 * Catatan penting: member sudah keluar, jadi **DM tidak mungkin** dikirim.
 * Kalau tidak ada channel yang diatur, salam tidak dikirim sama sekali —
 * lebih baik diam daripada mengirim ke channel acak.
 */
export async function goodbyeMember(member: GuildMember): Promise<boolean> {
  if (member.user.bot) return false;

  const settings = await getGoodbyeSettings(member.guild.id);
  if (!settings.enabled) return false;

  const channel = settings.channelId ? await fetchChannel(member, settings.channelId) : null;
  if (!channel) {
    logger.info(`Salam perpisahan untuk ${member.user.tag} dilewati: channel belum diatur.`);
    return false;
  }

  const greeting = settings.useAi ? await generateGoodbye(settings, member) : null;
  const text = greeting ?? fillGoodbyeTemplate(settings.template?.trim() || DEFAULT_GOODBYE_TEMPLATE, member);

  // Kartu perpisahan opsional, memakai renderer yang sama dengan sambutan.
  const attachment = settings.imageEnabled
    ? await buildCard(
        {
          member,
          text,
          includeAvatar: settings.includeAvatar,
          bannerPath: settings.bannerPath,
          kicker: 'SAMPAI JUMPA',
          filePrefix: 'sampai-jumpa',
        },
        Boolean(greeting),
      )
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x716c98)
    .setDescription(text)
    .setFooter({ text: `Member keluar · ${member.guild.name}` });

  if (!attachment) {
    const banner = await readBannerDataUri(settings.bannerPath);
    if (banner) embed.setImage(banner);
  }

  try {
    await channel.send({
      embeds: attachment ? [] : [embed],
      files: attachment ? [attachment] : [],
      allowedMentions: { parse: [] },
    });
    logger.info(`Salam perpisahan untuk ${member.user.tag} terkirim${greeting ? ' (AI)' : ' (template)'}.`);
    return true;
  } catch (error) {
    logger.warn(`Gagal mengirim salam perpisahan untuk ${member.user.tag}`, errorMessage(error));
    return false;
  }
}
