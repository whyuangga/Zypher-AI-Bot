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
  type ContainerBuilder,
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
import {
  displayModeLabel,
  fallbackMode,
  type DisplayMode,
} from './display-mode.js';
import { buildContainerCard, containerPayload } from './container-card.js';

/**
 * Nilai untuk semua token template. Dipakai sambutan, perpisahan, dan pratinjau
 * di dashboard supaya hasilnya selalu identik.
 */
function templateValues(member: GuildMember): Parameters<typeof fillText>[1] {
  return {
    user: memberName(member),
    server: member.guild.name,
    mention: `<@${member.id}>`,
    tag: member.user.tag,
    memberCount: member.guild.memberCount,
  };
}

/** Isi placeholder template tanpa AI. */
export function fillTemplate(template: string, member: GuildMember): string {
  return fillText(template, templateValues(member));
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
  // Bot lain ikut disapa, sama seperti TitanBot — kalau kamu menambahkan bot
  // ke server, channel sambutan mencatatnya seperti anggota lain. Dulu bot
  // dilewati diam-diam; kalau ingin itu kembali, cukup tambahkan satu kondisi
  // `if (member.user.bot) return ...` di sini.
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

  const allowed = channel ? channelPermissions(channel, member) : { embed: true, attach: true };

  // Kartu hanya dirender kalau memang akan dipakai: proses render memakan
  // waktu (~1 detik) dan tidak perlu kalau bentuk pesannya embed/teks.
  const wanted = fallbackMode(settings.displayMode, {
    card: allowed.attach,
    embed: allowed.embed,
  });
  if (wanted.fellBack) {
    logger.info(
      `Mode tampilan sambutan "${displayModeLabel(settings.displayMode)}" tidak bisa dipakai (${wanted.reason}) — memakai ${displayModeLabel(wanted.mode)}.`,
    );
  }

  const attachment =
    wanted.mode === 'card'
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
  const mode: DisplayMode =
    wanted.mode === 'card' && !attachment ? (allowed.embed ? 'embed' : 'text') : wanted.mode;
  if (wanted.mode === 'card' && !attachment) {
    logger.info('Kartu sambutan tidak bisa dirender — dikirim sebagai embed teks.');
  }

  const payload = await composePayload({
    mode,
    text,
    member,
    kind: 'welcome',
    channelName: channel?.name ?? null,
    attachment,
    includeAvatar: settings.includeAvatar,
    bannerPath: settings.bannerPath,
    allowed,
    // Mention hanya berguna di channel. Di DM, member sudah tahu dia baru
    // bergabung — dan menulis <@id> di sana hanya terlihat seperti gangguan.
    mentionUser: Boolean(channel),
  });
  let embeds = payload.embeds;
  let files = payload.files;
  const plainText = payload.content;

  // Jaring pengaman terakhir: Discord menolak pesan tanpa isi sama sekali
  // ("Cannot send an empty message"). Mode teks tidak punya embed/file dan mode
  // container tidak punya content sama sekali, jadi yang diperiksa adalah
  // ADA-TIDAKNYA isi dalam bentuk apa pun — dulu pemeriksaan yang hanya melihat
  // embeds/files membuat kedua mode itu dianggap kosong.
  const hasBody =
    plainText.length > 0 || embeds.length > 0 || files.length > 0 || Boolean(payload.components?.length);
  if (!hasBody) {
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
      await channel.send(
        payload.components?.length
          ? // Components V2: content/embeds/files tidak boleh ikut sama sekali.
            {
              components: payload.components,
              flags: payload.flags,
              allowedMentions: { users: [member.id] },
            }
          : {
              // `content` sudah berbentuk akhir dari composePayload (mention +
              // teks untuk mode text, kosong untuk mode lain) — jangan
              // ditambahi lagi, dulu mention ditulis di sini dan hasilnya dobel.
              content: plainText || undefined,
              embeds,
              files,
              allowedMentions: { users: [member.id] },
            },
      );
    } else if (payload.components?.length) {
      await member.send({ components: payload.components, flags: payload.flags });
    } else {
      await member.send({ content: plainText || undefined, embeds, files });
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

/**
 * Izin yang tersedia di channel — dipakai untuk memilih bentuk pesan.
 *
 * TitanBot memakai pola ini: kalau bot tidak punya `EmbedLinks`, kirim teks
 * biasa saja, bukan gagal. Tanpa ini, embed yang tidak diizinkan membuat
 * pengiriman gagal walau `SendMessages` sudah ada.
 */
function channelPermissions(
  channel: TextChannel | AnyThreadChannel,
  member: GuildMember,
): { embed: boolean; attach: boolean } {
  const me = member.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions) return { embed: true, attach: true }; // tidak diketahui: coba saja
  return {
    embed: permissions.has('EmbedLinks'),
    attach: permissions.has('AttachFiles'),
  };
}

/**
 * Susun isi pesan sesuai mode tampilan.
 *
 * Dipisah dari `welcomeMember`/`goodbyeMember` supaya aturan yang paling mudah
 * salah bisa diuji tanpa Discord: **mention hanya hidup di `content`**, tidak
 * pernah di dalam embed. Di dalam embed `<@id>` hanya teks biasa dan tidak
 * memicu notifikasi, jadi mode `embed`/`card` tidak boleh menjanjikan ping.
 *
 * `content` sengaja hanya diisi pada mode `text`; mode lain mengembalikan
 * string kosong supaya pemanggil tidak mengirim teks dua kali.
 */
async function composePayload(options: {
  mode: DisplayMode;
  text: string;
  member: GuildMember;
  kind: 'welcome' | 'goodbye';
  channelName: string | null;
  attachment: AttachmentBuilder | null;
  includeAvatar: boolean;
  bannerPath: string | null;
  allowed: { embed: boolean; attach: boolean };
  /**
   * Boleh menulis `<@id>` di `content`? Sambutan: ya. Perpisahan: tidak —
   * member sudah keluar, mention tidak akan menyapa siapa pun dan hanya
   * memicu notifikasi ke orang yang sudah pergi.
   */
  mentionUser: boolean;
}): Promise<{
  content: string;
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  /** Hanya terisi pada mode `container`: komponen V2 + flag wajibnya. */
  components?: ContainerBuilder[];
  flags?: number;
}> {
  const { mode, text, member, kind, attachment, allowed, mentionUser } = options;
  const footer =
    kind === 'welcome' ? `Member baru · ${member.guild.name}` : `Member keluar · ${member.guild.name}`;
  const color = kind === 'welcome' ? 0x6d8cff : 0x716c98;

  // Mode teks: satu-satunya yang benar-benar me-ping member di luar komponen.
  if (mode === 'text') {
    return { content: mentionUser ? `<@${member.id}> ${text}` : text, embeds: [], files: [] };
  }

  // Mode container (Components V2). Pesan ber-flag ini TIDAK BOLEH memuat
  // content/embeds/files, jadi mention harus ikut di dalam teksnya.
  if (mode === 'container') {
    const teks = mentionUser ? `<@${member.id}> ${text}` : text;
    const card = buildContainerCard({
      kind,
      text: teks,
      guildName: member.guild.name,
      memberCount: member.guild.memberCount,
    });
    if (card) {
      return { content: '', embeds: [], files: [], ...containerPayload(card) };
    }
    // Pustaka tidak mendukung: jatuh ke embed di bawah (tidak pernah pesan kosong).
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(text)
    .setFooter({ text: footer });

  // Mode kartu: PNG jadi lampiran, dan embed hanya dipakai sebagai wadah
  // supaya kartu tampil besar tanpa merusak tata letak.
  if (mode === 'card' && attachment) {
    embed.setImage(`attachment://${attachment.name}`);
    return { content: '', embeds: [embed], files: [attachment] };
  }

  // Mode embed: banner opsional sebagai gambar embed. Discord MENOLAK data URI
  // di setImage() ("Received one or more errors"), jadi banner harus dikirim
  // sebagai lampiran dan dirujuk lewat attachment://.
  const bannerFile = allowed.attach ? await readBannerAttachment(options.bannerPath) : null;
  if (bannerFile) {
    embed.setImage(`attachment://${bannerFile.name}`);
    return { content: '', embeds: [embed], files: [bannerFile.attachment] };
  }

  return { content: '', embeds: [embed], files: [] };
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
  return fillText(template, templateValues(member));
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
  // Bot juga diucapkan selamat jalan (menyelaraskan dengan jalur sambutan).
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

  const allowed = channelPermissions(channel, member);
  const wanted = fallbackMode(settings.displayMode, {
    card: allowed.attach,
    embed: allowed.embed,
  });
  if (wanted.fellBack) {
    logger.info(
      `Mode tampilan salam perpisahan "${displayModeLabel(settings.displayMode)}" tidak bisa dipakai (${wanted.reason}) — memakai ${displayModeLabel(wanted.mode)}.`,
    );
  }

  // Kartu perpisahan opsional, memakai renderer yang sama dengan sambutan.
  const attachment =
    wanted.mode === 'card'
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

  const mode: DisplayMode =
    wanted.mode === 'card' && !attachment ? (allowed.embed ? 'embed' : 'text') : wanted.mode;
  if (wanted.mode === 'card' && !attachment) {
    logger.info('Kartu perpisahan tidak bisa dirender — dikirim sebagai embed teks.');
  }

  const payload = await composePayload({
    mode,
    text,
    member,
    kind: 'goodbye',
    channelName: channel.name,
    attachment,
    includeAvatar: settings.includeAvatar,
    bannerPath: settings.bannerPath,
    allowed,
    // Member sudah keluar: jangan pernah mention.
    mentionUser: false,
  });
  const embeds = payload.embeds;
  const files = payload.files;
  const plainText = payload.content;

  // Jaring pengaman sama seperti sambutan: jangan pernah mengirim pesan tanpa isi.
  if (!plainText && embeds.length === 0 && files.length === 0 && !payload.components?.length) {
    try {
      await channel.send({ content: text, allowedMentions: { parse: [] } });
      logger.info(`Salam perpisahan untuk ${member.user.tag} terkirim (teks polos).`);
      return true;
    } catch (error) {
      logger.warn(`Gagal mengirim salam perpisahan untuk ${member.user.tag}`, errorMessage(error));
      return false;
    }
  }

  try {
    await channel.send(
      payload.components?.length
        ? { components: payload.components, flags: payload.flags, allowedMentions: { parse: [] } }
        : {
            // `content` hanya berisi sesuatu pada mode text (lihat composePayload).
            content: plainText || undefined,
            embeds,
            files,
            // Perpisahan tidak pernah me-ping siapa pun.
            allowedMentions: { parse: [] },
          },
    );
    logger.info(`Salam perpisahan untuk ${member.user.tag} terkirim${greeting ? ' (AI)' : ' (template)'}.`);
    return true;
  } catch (error) {
    logger.warn(`Gagal mengirim salam perpisahan untuk ${member.user.tag}`, errorMessage(error));
    return false;
  }
}
