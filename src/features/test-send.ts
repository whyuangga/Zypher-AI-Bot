/**
 * Kirim tes: benar-benar mengirim satu pesan ke Discord.
 *
 * Bedanya dengan `preview.ts` (yang hanya menampilkan teks di browser):
 * fungsi di sini memakai **alur yang sama dengan bot sungguhan** — cari channel,
 * cek izin, cek DM bisa dikirim atau tidak, render kartu, lalu kirim. Tujuannya
 * supaya admin bisa membuktikan fiturnya jalan tanpa menunggu ada member baru
 * bergabung atau member lama keluar.
 *
 * Aturan yang dijaga:
 *   - Pesan selalu diberi penanda jelas "ini pesan uji" supaya member yang
 *     melihatnya di channel tidak mengira itu sambutan sungguhan.
 *   - Mention tidak pernah dipicu (`allowedMentions: { parse: [] }`), jadi tidak
 *     ada yang ter-tag karena tes.
 *   - Kalau pengiriman gagal, alasannya dikembalikan apa adanya (izin kurang,
 *     channel tidak ada, DM ditutup, Chromium tidak ada) — bukan "gagal" polos.
 *
 * Tidak dijalankan saat bot offline: mengirim butuh koneksi Discord, dan pesan
 * yang gagal di tengah jalan lebih membingungkan daripada penolakan yang jelas.
 */
import {
  AttachmentBuilder,
  EmbedBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
  type AnyThreadChannel,
} from 'discord.js';
import type { GoodbyeSettings, WelcomeSettings } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { previewGoodbye, previewWelcome } from './preview.js';
import { readBannerDataUri, readBannerAttachment } from './banner.js';
import { renderWelcomeCard } from './welcome-card.js';

export class SendTestError extends Error {}

/**
 * Terjemahkan error Discord yang tidak informatif jadi kalimat yang bisa
 * ditindaklanjuti.
 *
 * Kasus nyata: mengirim embed bergambar data URI ditolak dengan
 * "Received one or more errors" — admin tidak mungkin menebak artinya.
 */
function explainDiscordError(error: unknown): string {
  const raw = errorMessage(error);
  if (/received one or more errors/i.test(raw)) {
    return (
      `${raw}. Discord menolak isi pesan, biasanya karena gambar embed tidak valid. ` +
      'Coba matikan kartu PNG sementara atau unggah ulang banner (PNG/JPG/WebP).'
    );
  }
  if (/missing access|missing permissions/i.test(raw)) {
    return `${raw}. Bot tidak punya izin menulis di channel itu.`;
  }
  if (/unknown channel/i.test(raw)) {
    return `${raw}. Channel sudah dihapus atau bukan milik server ini.`;
  }
  return raw;
}

export interface SendTestResult {
  ok: boolean;
  /** Ke mana pesan benar-benar dikirim. */
  where: 'dm' | 'channel' | 'none';
  /** Nama channel (kalau ke channel). */
  channelName: string | null;
  /** Teks yang dikirim. */
  text: string;
  /** true = kartu PNG ikut terkirim. */
  card: boolean;
  /** Catatan tambahan (mis. kartu tidak dirender, AI jatuh ke template). */
  note: string | null;
}

/** Penanda yang selalu ikut di pesan uji. */
const TEST_MARK = '🧪 **Pesan uji dari dashboard** — bukan sambutan sungguhan.';

/**
 * Cari channel teks yang bisa ditulisi bot.
 *
 * Mengembalikan alasan kegagalan, bukan hanya `null`: "channel tidak ditemukan"
 * dan "bot tidak punya izin kirim" butuh tindakan berbeda dari admin.
 */
async function resolveChannel(
  guild: Guild,
  channelId: string,
): Promise<{ channel: TextChannel | AnyThreadChannel | null; reason: string | null }> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { channel: null, reason: `Channel ${channelId} tidak ditemukan di server ini.` };
  if (!channel.isTextBased() || channel.isDMBased()) {
    return { channel: null, reason: 'Channel itu bukan channel teks.' };
  }

  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has('SendMessages')) {
    return { channel: null, reason: `Bot tidak punya izin "Send Message" di #${channel.name}.` };
  }
  if (permissions && !permissions.has('ViewChannel')) {
    return { channel: null, reason: `Bot tidak bisa melihat #${channel.name}.` };
  }
  return { channel: channel as TextChannel | AnyThreadChannel, reason: null };
}

/** Render kartu seperti bot sungguhan; `null` = Chromium tidak ada / gagal. */
async function buildCard(options: {
  name: string;
  guildName: string;
  text: string;
  bannerPath: string | null;
  includeAvatar: boolean;
  avatarUrl: string | null;
  kicker: string;
  filePrefix: string;
}): Promise<AttachmentBuilder | null> {
  const banner = await readBannerDataUri(options.bannerPath);
  let avatar: string | null = null;
  if (options.includeAvatar && options.avatarUrl) {
    try {
      const response = await fetch(options.avatarUrl);
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength <= 1_500_000) avatar = `data:image/png;base64,${bytes.toString('base64')}`;
      }
    } catch {
      // Avatar gagal diunduh — kartu tetap dibuat tanpa avatar.
    }
  }

  const png = await renderWelcomeCard({
    userName: options.name,
    guildName: options.guildName,
    message: truncate(options.text, 200),
    avatarDataUri: avatar,
    bannerDataUri: banner,
    kicker: options.kicker,
  });
  if (!png) return null;
  return new AttachmentBuilder(png, { name: `${options.filePrefix}-test.png` });
}

/**
 * Kirim tes sambutan.
 *
 * Ke mana pesannya pergi (berurutan):
 *   1. `target: 'dm'` → DM admin yang menekan tombol.
 *   2. `target: 'channel'` → channel sambutan yang tersimpan (kalau ada).
 *   3. Kalau tidak ada channel tersimpan → DM admin.
 */
export async function sendWelcomeTest(
  client: Client,
  options: {
    guildId: string;
    settings: WelcomeSettings;
    member: GuildMember;
    target: 'dm' | 'channel';
  },
): Promise<SendTestResult> {
  const { settings, member } = options;
  const guild = await client.guilds.fetch(options.guildId).catch(() => null);
  if (!guild) throw new SendTestError('Server tidak ditemukan oleh bot.');

  const name = member.displayName || member.user.username;
  const preview = await previewWelcome({ settings, name, guildName: guild.name });

  const card = settings.imageEnabled
    ? await buildCard({
        name,
        guildName: guild.name,
        text: preview.text,
        bannerPath: settings.bannerPath,
        includeAvatar: settings.includeAvatar,
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
        kicker: 'SELAMAT DATANG',
        filePrefix: 'selamat-datang',
      })
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x6d8cff)
    .setDescription(preview.text)
    .setFooter({ text: `Pesan uji · ${guild.name}` });
  // Discord menolak setImage() berisi data URI ("Received one or more
  // errors"), jadi banner dikirim sebagai lampiran dan dirujuk attachment://.
  // Ternyata ini juga alasan sambutan sungguhan gagal terkirim.
  const bannerFile = card ? null : await readBannerAttachment(settings.bannerPath);
  if (bannerFile) embed.setImage(`attachment://${bannerFile.name}`);

  const note: string[] = [];
  if (preview.source !== 'ai') note.push(preview.note ?? 'AI tidak dipakai.');
  if (settings.imageEnabled && !card) note.push('Kartu PNG tidak dibuat (Chromium tidak tersedia).');

  const payload = {
    content: TEST_MARK,
    embeds: card ? [] : [embed],
    files: card ? [card] : bannerFile ? [bannerFile.attachment] : [],
    allowedMentions: { parse: [] as const },
  };

  // Target DM: menguji jalur paling rawan (member menutup DM).
  if (options.target === 'dm' || !settings.channelId) {
    try {
      await member.send(payload);
      logger.info(`Kirim tes sambutan ke DM ${member.user.tag} berhasil.`);
      return {
        ok: true,
        where: 'dm',
        channelName: null,
        text: preview.text,
        card: Boolean(card),
        note: note.length ? note.join(' ') : null,
      };
    } catch (error) {
      throw new SendTestError(
        `DM ke kamu gagal dikirim: ${errorMessage(error)}. ` +
          'Ini biasanya karena privasi DM Discord menolak pesan dari bot server. ' +
          'Coba target "channel" untuk menguji tanpa DM.',
      );
    }
  }

  const { channel, reason } = await resolveChannel(guild, settings.channelId);
  if (!channel) throw new SendTestError(reason ?? 'Channel sambutan tidak bisa dipakai.');

  try {
    await channel.send(payload);
    logger.info(`Kirim tes sambutan ke #${channel.name} berhasil.`);
    return {
      ok: true,
      where: 'channel',
      channelName: channel.name,
      text: preview.text,
      card: Boolean(card),
      note: note.length ? note.join(' ') : null,
    };
  } catch (error) {
    throw new SendTestError(`Gagal mengirim ke #${channel.name}: ${explainDiscordError(error)}`);
  }
}

/**
 * Kirim tes salam perpisahan.
 *
 * **Selalu ke channel**, tidak pernah DM: member yang keluar sudah tidak berbagi
 * server dengan bot, jadi DM memang tidak mungkin. Kalau channel belum diatur,
 * kirim-tes ditolak dengan penjelasan — bukan diam-diam tidak melakukan apa pun.
 */
export async function sendGoodbyeTest(
  client: Client,
  options: {
    guildId: string;
    settings: GoodbyeSettings;
    member: GuildMember;
  },
): Promise<SendTestResult> {
  const { settings, member } = options;
  const guild = await client.guilds.fetch(options.guildId).catch(() => null);
  if (!guild) throw new SendTestError('Server tidak ditemukan oleh bot.');

  if (!settings.channelId) {
    throw new SendTestError(
      'Salam perpisahan belum punya channel tujuan. Pilih channel dulu di atas, lalu simpan sebelum mengirim tes.',
    );
  }

  const name = member.displayName || member.user.username;
  const preview = await previewGoodbye({ settings, name, guildName: guild.name });

  const card = settings.imageEnabled
    ? await buildCard({
        name,
        guildName: guild.name,
        text: preview.text,
        bannerPath: settings.bannerPath,
        includeAvatar: settings.includeAvatar,
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
        kicker: 'SAMPAI JUMPA',
        filePrefix: 'sampai-jumpa',
      })
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x716c98)
    .setDescription(preview.text)
    .setFooter({ text: `Pesan uji · ${guild.name}` });
  const bannerFile = card ? null : await readBannerAttachment(settings.bannerPath);
  if (bannerFile) embed.setImage(`attachment://${bannerFile.name}`);

  const note: string[] = [];
  if (preview.source !== 'ai') note.push(preview.note ?? 'AI tidak dipakai.');
  if (settings.imageEnabled && !card) note.push('Kartu PNG tidak dibuat (Chromium tidak tersedia).');

  const { channel, reason } = await resolveChannel(guild, settings.channelId);
  if (!channel) throw new SendTestError(reason ?? 'Channel salam perpisahan tidak bisa dipakai.');

  try {
    await channel.send({
      content: TEST_MARK,
      embeds: card ? [] : [embed],
      files: card ? [card] : bannerFile ? [bannerFile.attachment] : [],
      allowedMentions: { parse: [] as const },
    });
    logger.info(`Kirim tes salam perpisahan ke #${channel.name} berhasil.`);
    return {
      ok: true,
      where: 'channel',
      channelName: channel.name,
      text: preview.text,
      card: Boolean(card),
      note: note.length ? note.join(' ') : null,
    };
  } catch (error) {
    throw new SendTestError(`Gagal mengirim ke #${channel.name}: ${explainDiscordError(error)}`);
  }
}

/**
 * Kirim tes AI Agent.
 *
 * Berbeda dari sambutan: agent membalas **ke pesan**, jadi tesnya mengirim satu
 * pesan contoh dari bot lalu membalasnya? Tidak — itu akan mengotori channel
 * dengan dua pesan. Yang dilakukan: bot mengirim satu pesan berisi balasan yang
 * akan ia berikan, dengan kutipan pesan uji di atasnya. Hasilnya bisa dinilai
 * tanpa membuat pesan palsu dari "member".
 */
export async function sendAgentTest(
  client: Client,
  options: {
    guildId: string;
    channelId: string;
    reply: string;
    role: 'chat' | 'gallery';
    sampleMessage: string;
    userName: string;
  },
): Promise<SendTestResult> {
  const guild = await client.guilds.fetch(options.guildId).catch(() => null);
  if (!guild) throw new SendTestError('Server tidak ditemukan oleh bot.');

  const { channel, reason } = await resolveChannel(guild, options.channelId);
  if (!channel) throw new SendTestError(reason ?? 'Channel AI Agent tidak bisa dipakai.');

  // Sengaja teks biasa, bukan embed: AI Agent di channel membalas sebagai
  // pesan biasa supaya menyatu dengan obrolan member. Pesan uji harus
  // memperlihatkan bentuk yang sama, bukan kotak embed yang tidak akan pernah
  // muncul di pemakaian nyata.
  //
  // Format: penanda uji, kutipan pesan member (blockquote), lalu balasan bot.
  const quoted = options.sampleMessage
    .slice(0, 300)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const body = [
    TEST_MARK,
    '',
    `**${options.userName} (pesan uji):**`,
    quoted,
    '',
    truncate(options.reply, 1500) || '(kosong)',
  ].join('\n');

  try {
    await channel.send({
      content: body,
      allowedMentions: { parse: [] as const },
    });
    logger.info(`Kirim tes agent ke #${channel.name} berhasil.`);
    return {
      ok: true,
      where: 'channel',
      channelName: channel.name,
      text: options.reply,
      card: false,
      note: null,
    };
  } catch (error) {
    throw new SendTestError(`Gagal mengirim ke #${channel.name}: ${explainDiscordError(error)}`);
  }
}
