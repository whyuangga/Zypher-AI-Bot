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
 *     channel tidak ada, DM ditutup, kartu gagal dibuat) — bukan "gagal" polos.
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
import { getAgentSettings, type GoodbyeSettings, type WelcomeSettings } from '../db/repo.js';
import { QUIET_MAX_CHARS } from './agent-core.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { previewGoodbye, previewWelcome } from './preview.js';
import { readBannerDataUri, readBannerAttachment } from './banner.js';
import { displayModeLabel, normalizeDisplayMode } from './display-mode.js';
import { buildContainerCard, containerPayload } from './container-card.js';
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
 * Penanda untuk tes pemecah sepi. Dipisah karena pesan ini muncul di tengah
 * obrolan, bukan saat member bergabung — penanda "bukan sambutan" akan
 * membingungkan.
 */
const QUIET_TEST_MARK =
  '🧪 **Tes pemecah sepi dari dashboard** — di pemakaian nyata kalimat ini muncul sendiri saat channel sunyi.';

/**
 * Cari channel teks yang bisa ditulisi bot.
 *
 * Mengembalikan alasan kegagalan, bukan hanya `null`: "channel tidak ditemukan"
 * dan "bot tidak punya izin kirim" butuh tindakan berbeda dari admin.
 */
async function resolveChannel(
  guild: Guild,
  channelId: string,
): Promise<{
  channel: TextChannel | AnyThreadChannel | null;
  reason: string | null;
  /** Izin gambar/lampiran kurang — pesan tetap dikirim, bentuknya dikurangi. */
  warnings?: string[];
}> {
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
  // Izin gambar/lampiran TIDAK dicampur dengan penolakan channel: tanpa
  // `AttachFiles`, banner tidak bisa dikirim dan Discord menolak pesannya
  // dengan error mentah yang sulit ditafsirkan admin. Dikembalikan sebagai
  // peringatan (`warning`) supaya teks polos tetap bisa dikirim.
  const warnings: string[] = [];
  if (permissions && !permissions.has('EmbedLinks')) {
    warnings.push(`Bot tidak punya izin "Embed Links" di #${channel.name} — pesan uji dikirim sebagai teks polos.`);
  }
  if (permissions && !permissions.has('AttachFiles')) {
    warnings.push(`Bot tidak punya izin "Attach Files" di #${channel.name} — banner & kartu tidak bisa dikirim.`);
  }
  return {
    channel: channel as TextChannel | AnyThreadChannel,
    reason: null,
    warnings,
  };
}

/** Render kartu seperti bot sungguhan; `null` = penggambaran gagal. */
async function buildCard(options: {
  name: string;
  guildName: string;
  text: string;
  bannerPath: string | null;
  includeAvatar: boolean;
  avatarUrl: string | null;
  kicker: string;
  filePrefix: string;
  /** Jumlah member untuk baris "member ke-N" di kartu. */
  memberCount?: number;
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
    detail: options.memberCount
      ? `${options.guildName} • member ke-${options.memberCount.toLocaleString('id-ID')}`
      : options.guildName,
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

  // Tes wajib mengirim bentuk yang sama dengan pesan sungguhan — kalau tidak,
  // admin menguji kartu padahal bot mengirim teks (atau sebaliknya).
  const wanted = normalizeDisplayMode(settings.displayMode);
  const card =
    wanted === 'card'
      ? await buildCard({
          name,
          guildName: guild.name,
          text: preview.text,
          bannerPath: settings.bannerPath,
          includeAvatar: settings.includeAvatar,
          avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
          kicker: 'SELAMAT DATANG',
          filePrefix: 'selamat-datang',
          memberCount: guild.memberCount,
        })
      : null;

  const note: string[] = [];
  if (preview.source !== 'ai') note.push(preview.note ?? 'AI tidak dipakai.');

  // Mode yang BENAR-BENAR dipakai, bukan yang diinginkan.
  //
  // Dulu semua keputusan banner memakai `wanted`. Akibatnya, saat mode `card`
  // dipilih tapi kartu gagal dibuat, pesan jatuh ke embed sementara `wanted`
  // masih 'card' — dan banner dibuang karena kode menganggap mode kartu tidak
  // butuh banner terpisah. Hasilnya: sambutan uji terkirim tanpa gambar sama
  // sekali, tanpa error apa pun.
  const modeNow = wanted === 'card' && !card ? 'embed' : wanted;
  if (wanted === 'card' && !card) {
    note.push('Kartu PNG tidak bisa dibuat — dikirim sebagai embed.');
  }
  note.push(`Mode ${displayModeLabel(modeNow)}.`);

  // Banner hanya untuk mode yang memang menampilkannya: embed (gambar di dalam
  // embed) dan container (Media Gallery). Mode kartu sudah memuat banner di
  // dalam PNG; mode teks tidak punya tempat untuk gambar.
  const bannerFile =
    modeNow === 'embed' || modeNow === 'container'
      ? await readBannerAttachment(settings.bannerPath)
      : null;

  const embed = new EmbedBuilder()
    .setColor(0x6d8cff)
    .setDescription(preview.text)
    .setFooter({ text: `Pesan uji · ${guild.name}` });
  // Discord menolak setImage() berisi data URI ("Received one or more
  // errors"), jadi banner dikirim sebagai lampiran dan dirujuk attachment://.
  // Ternyata ini juga alasan sambutan sungguhan gagal terkirim.
  if (bannerFile && modeNow === 'embed') embed.setImage(`attachment://${bannerFile.name}`);

  // Mode container: komponen V2 tidak boleh dicampur content/embeds.
  // `bannerFile` di atas sudah dibaca untuk mode ini — jangan baca ulang.
  const containerBanner = modeNow === 'container' ? bannerFile : null;
  const container =
    modeNow === 'container'
      ? (() => {
          const built = buildContainerCard({
            kind: 'welcome',
            text: preview.text,
            guildName: guild.name,
            memberCount: guild.memberCount,
            bannerName: containerBanner?.name ?? null,
          });
          return built ? containerPayload(built) : null;
        })()
      : null;
  if (modeNow === 'container' && !container) {
    note.push('Components V2 tidak didukung pustaka ini — dikirim sebagai embed.');
  }

  const payload = container
    ? {
        ...container,
        files: containerBanner ? [containerBanner.attachment] : [],
        allowedMentions: { parse: [] as const },
      }
    : modeNow === 'text'
      ? { content: `${TEST_MARK}\n\n${preview.text}`, allowedMentions: { parse: [] as const } }
      : {
          // Petunjuk uji tetap di content supaya pesan tes mudah dikenali.
          content: TEST_MARK,
          // Kartu PNG dibungkus embed: tanpa wadah ini Discord menampilkan PNG
          // sebagai lampiran kecil di bawah pesan, bukan kartu besar. Ini juga
          // yang membuat pesan uji berbeda dari sambutan sungguhan (di sana
          // composePayload sudah memasang wadahnya).
          embeds: [card ? embed.setImage(`attachment://${card.name}`) : embed],
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

  const { channel, reason, warnings = [] } = await resolveChannel(guild, settings.channelId);
  if (!channel) throw new SendTestError(reason ?? 'Channel sambutan tidak bisa dipakai.');
  note.push(...warnings);

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

  const wanted = normalizeDisplayMode(settings.displayMode);
  const card =
    wanted === 'card'
      ? await buildCard({
          name,
          guildName: guild.name,
          text: preview.text,
          bannerPath: settings.bannerPath,
          includeAvatar: settings.includeAvatar,
          avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
          kicker: 'SAMPAI JUMPA',
          filePrefix: 'sampai-jumpa',
          memberCount: guild.memberCount,
        })
      : null;

  const note: string[] = [];
  if (preview.source !== 'ai') note.push(preview.note ?? 'AI tidak dipakai.');

  // Sama seperti jalur sambutan: keputusan banner memakai mode yang benar-benar
  // dipakai. Sebelumnya `wanted` masih 'card' walau kartu gagal dirender,
  // sehingga salam perpisahan uji terkirim sebagai embed TANPA banner.
  const modeNow = wanted === 'card' && !card ? 'embed' : wanted;
  if (wanted === 'card' && !card) {
    note.push('Kartu PNG tidak bisa dibuat — dikirim sebagai embed.');
  }
  note.push(`Mode ${displayModeLabel(modeNow)}.`);

  const bannerFile =
    modeNow === 'embed' || modeNow === 'container'
      ? await readBannerAttachment(settings.bannerPath)
      : null;

  const embed = new EmbedBuilder()
    .setColor(0x716c98)
    .setDescription(preview.text)
    .setFooter({ text: `Pesan uji · ${guild.name}` });
  if (bannerFile && modeNow === 'embed') embed.setImage(`attachment://${bannerFile.name}`);

  const { channel, reason, warnings = [] } = await resolveChannel(guild, settings.channelId);
  if (!channel) throw new SendTestError(reason ?? 'Channel salam perpisahan tidak bisa dipakai.');
  note.push(...warnings);

  try {
    const goodbyeBanner = modeNow === 'container' ? bannerFile : null;
    const goodbyeContainer =
      modeNow === 'container'
        ? (() => {
            const built = buildContainerCard({
              kind: 'goodbye',
              text: preview.text,
              guildName: guild.name,
              memberCount: guild.memberCount,
              bannerName: goodbyeBanner?.name ?? null,
            });
            return built ? containerPayload(built) : null;
          })()
        : null;
    if (modeNow === 'container' && !goodbyeContainer) {
      note.push('Components V2 tidak didukung pustaka ini — dikirim sebagai embed.');
    }

    await channel.send(
      goodbyeContainer
        ? {
            ...goodbyeContainer,
            files: goodbyeBanner ? [goodbyeBanner.attachment] : [],
            allowedMentions: { parse: [] as const },
          }
        : modeNow === 'text'
          ? { content: `${TEST_MARK}\n\n${preview.text}`, allowedMentions: { parse: [] as const } }
          : {
              content: TEST_MARK,
              // Sama seperti jalur sambutan: kartu dibungkus embed supaya tampil
              // besar, bukan sebagai lampiran kecil.
              embeds: [card ? embed.setImage(`attachment://${card.name}`) : embed],
              files: card ? [card] : bannerFile ? [bannerFile.attachment] : [],
              allowedMentions: { parse: [] as const },
            },
    );
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

/**
 * Kirim tes **pemecah sepi** — benar-benar mengirim sapaan ke channel ngobrol.
 *
 * Bedanya dari `sendAgentTest`: di sini tidak ada kutipan pesan member, karena
 * pemecah sepi memang kalimat yang muncul sendiri saat channel sunyi. Yang
 * dikirim adalah bentuk aslinya (teks biasa + penanda uji), sehingga admin
 * melihat persis seperti apa sapaan itu nanti di channel.
 *
 * Seperti tes lain, mention dimatikan: sapaan tidak boleh men-tag siapa pun.
 */
export async function sendQuietTest(
  client: Client,
  options: {
    guildId: string;
    /** Channel tujuan; kalau kosong diambil dari pengaturan agent. */
    channelId?: string | null;
    /** Isi sapaan yang sudah dibuat model. */
    text: string;
    /** true = dipaksa tulis walau timer belum waktunya. */
    forced?: boolean;
  },
): Promise<SendTestResult> {
  const guild = await client.guilds.fetch(options.guildId).catch(() => null);
  if (!guild) throw new SendTestError('Server tidak ditemukan oleh bot.');

  const settings = await getAgentSettings(options.guildId);
  const targetId = options.channelId || settings.channelId;
  if (!targetId) {
    throw new SendTestError('Channel ngobrol belum dipilih. Pilih & simpan dulu sebelum mengirim tes.');
  }

  const { channel, reason } = await resolveChannel(guild, targetId);
  if (!channel) throw new SendTestError(reason ?? 'Channel AI Agent tidak bisa dipakai.');

  const body = truncate(options.text, QUIET_MAX_CHARS) || '(kosong)';

  try {
    await channel.send({
      content: `${QUIET_TEST_MARK}\n\n${body}`,
      allowedMentions: { parse: [] as const },
    });
    logger.info(`Kirim tes pemecah sepi ke #${channel.name} berhasil.`);
    return {
      ok: true,
      where: 'channel',
      channelName: channel.name,
      text: body,
      card: false,
      note: options.forced ? 'Dikirim dengan "paksa tulis" — timer belum tentu waktunya menyapa sekarang.' : null,
    };
  } catch (error) {
    throw new SendTestError(`Gagal mengirim ke #${channel.name}: ${explainDiscordError(error)}`);
  }
}
