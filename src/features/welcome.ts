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
import { getGoodbyeSettings, getWelcomeSettings, type GoodbyeSettings, type WelcomeSettings } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { renderWelcomeCard } from './welcome-card.js';
import { previewGoodbye, previewWelcome } from './preview.js';
import { readBannerDataUri, readBannerAttachment } from './banner.js';
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
/**
 * Minta AI menulis sapaan.
 *
 * Memakai `previewWelcome` — fungsi yang sama dengan tombol "Tes sambutan" di
 * dashboard. Kalau logikanya ditulis dua kali, hasil tes bisa berbeda dari
 * sapaan yang benar-benar dikirim, dan itu sulit dilacak.
 *
 * `null` = AI gagal, pemanggil memakai template.
 */
async function generateGreeting(
  settings: WelcomeSettings,
  member: GuildMember,
): Promise<string | null> {
  const result = await previewWelcome({ settings, ...memberShape(member) });
  return result.source === 'ai' ? result.text : null;
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
  /**
   * Kenapa tidak terkirim. Dipakai log event supaya "tidak terjadi apa-apa"
   * bisa dibedakan: fitur mati, member bot, atau channel bermasalah.
   */
  reason?: string;
}

/**
 * Kirim sambutan untuk member baru.
 *
 * Semua kegagalan ditelan dengan log: member yang menutup DM tidak boleh
 * membuat event handler melempar error.
 */
export async function welcomeMember(member: GuildMember): Promise<WelcomeOutcome> {
  if (member.user.bot) {
    return { sent: false, usedAi: false, where: 'none', reason: 'member yang bergabung adalah bot' };
  }

  const settings = await getWelcomeSettings(member.guild.id);
  if (!settings.enabled) {
    return { sent: false, usedAi: false, where: 'none', reason: 'sambutan belum dinyalakan di dashboard' };
  }

  const greeting = settings.useAi ? await generateGreeting(settings, member) : null;
  const usedAi = Boolean(greeting);
  const text = greeting ?? fillTemplate(settings.template?.trim() || DEFAULT_WELCOME_TEMPLATE, member);

  const resolved =
    settings.channelId && settings.channelId !== member.guild.id
      ? await resolveWelcomeChannel(member, settings.channelId)
      : { channel: null, reason: 'channel sambutan belum dipilih di dashboard' };
  const channel = resolved.channel;
  if (!channel && resolved.reason) {
    // Dicatat sebagai INFO, bukan disembunyikan: inilah satu-satunya cara admin
    // tahu kenapa sambutan tidak muncul di channel yang sudah diatur.
    logger.info(`Sambutan ke channel dilewati (${resolved.reason}) — memakai DM sebagai gantinya.`);
  }
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

  // Kartu diminta tapi gagal dirender (Chromium tidak ada / render error):
  // dulu hasilnya `embeds: []` + tanpa file, sehingga Discord menolak pesan
  // kosong dan sambutan hilang tanpa penjelasan. Sekarang jatuh ke embed biasa,
  // mengikuti pola bot referensi: sambutan tidak boleh gagal hanya karena kartu.
  const cardFailed = settings.imageEnabled && !attachment;
  if (cardFailed) {
    logger.info('Kartu sambutan tidak bisa dirender — dikirim sebagai embed teks.');
  }

  const embed = new EmbedBuilder()
    .setColor(0x6d8cff)
    .setDescription(text)
    .setFooter({ text: `Member baru · ${member.guild.name}` });

  // Tanpa kartu, banner tetap dipakai sebagai gambar embed — supaya unggahan
  // admin tidak sia-sia saat kartu PNG dimatikan.
  //
  // Discord MENOLAK `setImage()` berisi data URI ("Received one or more
  // errors"). Banner harus dikirim sebagai lampiran lalu dirujuk lewat
  // attachment://. Dulu di sini data URI dipakai langsung, sehingga setiap
  // sambutan yang banner-nya aktif gagal terkirim tanpa penjelasan.
  const bannerFile = attachment ? null : await readBannerAttachment(settings.bannerPath);
  if (bannerFile) {
    embed.setImage(`attachment://${bannerFile.name}`);
  }

  const embeds = attachment ? [] : [embed];
  const files = attachment ? [attachment] : bannerFile ? [bannerFile.attachment] : [];

  // Jaring pengaman terakhir: Discord menolak pesan tanpa isi sama sekali
  // ("Cannot send an empty message"). Kalau itu terjadi, lebih baik kirim teks
  // polos daripada tidak ada apa-apa — inilah yang dulu membuat sambutan
  // hilang tanpa satu pun error yang terlihat.
  if (embeds.length === 0 && files.length === 0) {
    logger.warn(`Sambutan untuk ${member.user.tag} tidak punya isi — dikirim sebagai teks polos.`);
    try {
      const fallbackText = `${channel ? `<@${member.id}> ` : ''}${text}`;
      if (channel) await channel.send({ content: fallbackText });
      else await member.send({ content: text });
      logger.info(`Sambutan untuk ${member.user.tag} terkirim via ${where} (teks polos).`);
      return { sent: true, usedAi, where };
    } catch (error) {
      logger.warn(`Gagal mengirim sambutan ke ${member.user.tag}`, errorMessage(error));
      return { sent: false, usedAi, where: 'none', reason: errorMessage(error) };
    }
  }

  try {
    if (channel) {
      await channel.send({
        content: `<@${member.id}>`,
        embeds,
        files,
        allowedMentions: { users: [member.id] },
      });
    } else {
      await member.send({ embeds, files });
    }
    logger.info(`Sambutan untuk ${member.user.tag} terkirim via ${where}${usedAi ? ' (AI)' : ' (template)'}.`);
    return { sent: true, usedAi, where };
  } catch (error) {
    const message = errorMessage(error);
    logger.warn(`Gagal mengirim sambutan ke ${member.user.tag}`, message);

    // DM ditolak (member menutup DM) bukan alasan menyerah: kalau ada channel,
    // kirim ke sana supaya sambutan tetap terlihat.
    if (!channel) {
      return { sent: false, usedAi, where: 'none', reason: `DM ditolak: ${message}` };
    }
    return { sent: false, usedAi, where: 'none', reason: message };
  }
}

/**
 * Channel tujuan yang benar-benar bisa dipakai bot.
 *
 * Mengembalikan alasan saat gagal, bukan `null` tanpa penjelasan. Dulu fungsi
 * ini diam-diam mengembalikan `null` — dan pemanggilnya langsung beralih ke DM.
 * Akibatnya, kalau bot tidak punya izin di channel sambutan, sambutan dikirim
 * ke DM member yang mungkin tertutup, lalu hilang tanpa jejak di log.
 */
async function resolveWelcomeChannel(
  member: GuildMember,
  channelId: string,
): Promise<{ channel: TextChannel | AnyThreadChannel | null; reason: string | null }> {
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { channel: null, reason: `channel ${channelId} tidak ditemukan di server ini` };
  if (!channel.isTextBased() || channel.isDMBased()) {
    return { channel: null, reason: 'channel tujuan bukan channel teks' };
  }

  const me = member.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has('ViewChannel')) {
    return { channel: null, reason: `bot tidak bisa melihat #${channel.name}` };
  }
  if (permissions && !permissions.has('SendMessages')) {
    return { channel: null, reason: `bot tidak punya izin "Send Message" di #${channel.name}` };
  }
  return { channel: channel as TextChannel | AnyThreadChannel, reason: null };
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

  if (!settings.channelId) {
    logger.info(`Salam perpisahan untuk ${member.user.tag} dilewati: channel belum diatur.`);
    return false;
  }

  const resolved = await resolveWelcomeChannel(member, settings.channelId);
  const channel = resolved.channel;
  if (!channel) {
    // Alasan spesifik, bukan "channel belum diatur" — dulu izin yang kurang
    // dilaporkan seolah-olah channel-nya belum dipilih, menyesatkan.
    logger.info(`Salam perpisahan untuk ${member.user.tag} dilewati: ${resolved.reason}.`);
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

  if (settings.imageEnabled && !attachment) {
    logger.info('Kartu perpisahan tidak bisa dirender — dikirim sebagai embed teks.');
  }

  const embed = new EmbedBuilder()
    .setColor(0x716c98)
    .setDescription(text)
    .setFooter({ text: `Member keluar · ${member.guild.name}` });

  // Lihat catatan di welcomeMember(): data URI ditolak Discord, banner harus
  // jadi lampiran dan dirujuk dengan attachment://.
  const bannerFile = attachment ? null : await readBannerAttachment(settings.bannerPath);
  if (bannerFile) embed.setImage(`attachment://${bannerFile.name}`);

  try {
    await channel.send({
      embeds: attachment ? [] : [embed],
      files: attachment ? [attachment] : bannerFile ? [bannerFile.attachment] : [],
      allowedMentions: { parse: [] },
    });
    logger.info(`Salam perpisahan untuk ${member.user.tag} terkirim${greeting ? ' (AI)' : ' (template)'}.`);
    return true;
  } catch (error) {
    logger.warn(`Gagal mengirim salam perpisahan untuk ${member.user.tag}`, errorMessage(error));
    return false;
  }
}
