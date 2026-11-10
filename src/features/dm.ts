/**
 * Percakapan AI lewat **DM (Direct Message)**.
 *
 * Kenapa DM: di Discord, private thread tetap bisa dibaca oleh pemilik server,
 * role dengan izin Administrator, dan siapa pun yang punya `Manage Threads`.
 * Tidak ada konfigurasi channel/thread yang bisa menutup celah itu. DM adalah
 * satu-satunya tempat di Discord yang benar-benar tidak bisa dibaca admin server.
 *
 * Konsekuensi desain:
 * - Tidak ada channel/thread yang dibuat, jadi tidak ada yang bisa "dilihat".
 * - Member harus membuka DM ke bot (Privasi & Keamanan → Izinkan pesan langsung).
 * - Konteks server (persona, memori, dokumen, keyword) ditentukan oleh server
 *   tempat member menekan tombol "Chat via DM" — disimpan di tabel `dm_sessions`.
 */

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Message,
  type User,
} from 'discord.js';
import { config } from '../config.js';
import {
  clearHistory,
  countHistory,
  deleteDmSession,
  getDmSession,
  getGuildSettings,
  getHistory,
  listMemories,
  appendMessage,
  setDmSession,
  touchDmSession,
  type DmSession,
} from '../db/repo.js';
import { chat } from '../lib/llm.js';
import { logger, errorMessage } from '../lib/logger.js';
import { checkRateLimit } from '../lib/ratelimit.js';
import { chunkMessage, truncate } from '../lib/text.js';
import { buildTranscriptHtml, transcriptFileName, type TranscriptMessage } from '../lib/transcript.js';
import { BRAND_COLOR } from './ui.js';

/** Kunci rate limit untuk percakapan DM. */
const rateKey = (userId: string) => `dm:${userId}`;

/**
 * Daftar server (guild) yang bisa dipilih member untuk memulai chat DM.
 *
 * Hanya server yang bot-nya ada, yang member-nya masih anggota, dan yang punya
 * baris di tabel `guilds`/`dm_sessions` (artinya pernah memakai panel).
 */
export async function listGuildChoices(client: Client, userId: string): Promise<Array<{ id: string; name: string }>> {
  const choices: Array<{ id: string; name: string }> = [];

  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    choices.push({ id: guild.id, name: guild.name });
  }

  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

/** Embed pembuka saat member pertama kali membuka DM ke bot. */
export function dmWelcomeEmbed(botName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🤖 ${botName} — Chat Privat`)
    .setDescription(
      [
        'Selamat datang! Di sini **hanya kamu dan AI** yang bisa membaca percakapan.',
        '',
        '**Kenapa di DM?**',
        '> Percakapan di channel/thread server bisa dibaca admin dan pemilik server.',
        '> DM tidak bisa dibaca siapa pun selain kamu dan bot.',
        '',
        '**Cara mulai**',
        '> Tulis pertanyaan apa saja di chat ini — AI langsung menjawab.',
        '> Pakai `/server` untuk memilih server mana yang konteksnya dipakai',
        '> (persona, dokumen, dan memori mengikuti server itu).',
        '> Pakai `/akhiri` untuk menutup sesi + menerima transkrip percakapan.',
        '',
        '**Perintah**',
        '> `/server` · `/akhiri` · `/reset` · `/ingat` · `/memori`',
        '',
        '-# Bot tidak menyimpan transkrip di server mana pun. Riwayat percakapan hanya',
        '-# dipakai untuk konteks dan dihapus saat kamu menjalankan `/akhiri`.',
      ].join('\n'),
    );
}

/** Embed pilihan server saat member punya lebih dari satu server. */
export function dmServerPickerEmbed(
  choices: Array<{ id: string; name: string }>,
  current: DmSession | null,
): EmbedBuilder {
  const active = current ? `\n\n**Aktif sekarang:** ${choices.find((c) => c.id === current.guildId)?.name ?? current.guildId}` : '';
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🌐 Pilih server konteks')
    .setDescription(
      [
        '**`/server` bukan perintah untuk membuat channel.** Ini hanya memilih',
        '**server mana** yang dipakai sebagai sumber konteks AI di DM ini:',
        '',
        '> 🎭 **Persona** — gaya bicara yang diatur admin server itu',
        '> 📚 **Dokumen** — FAQ, aturan, dan catatan yang di-upload ke server itu',
        '> 🧠 **Memori** — fakta yang kamu simpan lewat `/ingat` di server itu',
        '',
        'Chat tetap berjalan di DM ini. Tidak ada channel atau room yang dibuat,',
        'dan admin server tetap tidak bisa membaca percakapan kita.',
        '',
        `**Server yang kamu ikuti (${choices.length}):**`,
        ...choices.map((choice, index) => `**${index + 1}.** ${choice.name}`),
        active,
      ].join('\n'),
    )
    .setFooter({ text: 'Klik tombol di bawah, atau /server nama:<nama server>' });
}

export function dmServerPickerRow(
  choices: Array<{ id: string; name: string }>,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const [index, choice] of choices.slice(0, 5).entries()) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dm:server:${choice.id}`)
        .setLabel(choice.name.slice(0, 80))
        .setStyle(index === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
  }
  return row;
}

/** Tombol kirim panel di server (tombol "Chat via DM"). */
export function panelEmbedDm(botName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🤖 ${botName} — Chat Privat`)
    .setDescription(
      [
        'Ngobrol dengan AI tanpa bisa dibaca siapa pun — termasuk admin server.',
        '',
        '**Cara kerjanya**',
        '> 1. Klik **Chat via DM** di bawah → bot mengirim pesan langsung ke DM kamu.',
        '> 2. Tanya apa saja di DM; AI menjawab dengan konteks server ini.',
        '> 3. AI mengingat hal penting tentang kamu (`/ingat` untuk menambah manual).',
        '> 4. Ketik `/akhiri` di DM untuk menerima transkrip percakapan.',
        '',
        '**Kenapa DM, bukan channel?**',
        '> Channel dan thread di server bisa dibaca pemilik server dan admin.',
        '> DM tidak — hanya kamu dan bot yang bisa membaca.',
        '',
        '-# Kalau DM kamu tertutup: **Privasi & Keamanan → Izinkan pesan langsung dari server**.',
      ].join('\n'),
    )
    .setFooter({ text: 'Privat • Tidak ada channel yang dibuat' });
}

export function dmPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('dm:start')
      .setLabel('Chat via DM')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dm:help')
      .setLabel('Cara Kerja')
      .setEmoji('❓')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Mulai (atau lanjutkan) sesi DM untuk member, dengan konteks server `guildId`.
 *
 * Mengembalikan `true` kalau DM berhasil dikirim. Kalau DM ditutup, pemanggil
 * harus memberi tahu member lewat pesan ephemeral.
 */
export async function startDmSession(user: User, guild: Guild): Promise<boolean> {
  const existing = await getDmSession(user.id);
  if (!existing || existing.guildId !== guild.id) {
    await setDmSession(user.id, guild.id, user.id);
  } else {
    await touchDmSession(user.id);
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`💬 Chat AI — ${guild.name}`)
    .setDescription(
      [
        `Halo <@${user.id}>! Kita sekarang ngobrol di **DM** — hanya kamu dan AI yang bisa membaca.`,
        '',
        'Tulis pertanyaanmu langsung di chat ini.',
        '',
        '**Perintah**',
        '> `/server` — ganti server konteks',
        '> `/akhiri` — tutup sesi + terima transkrip',
        '> `/reset` — hapus riwayat, mulai topik baru',
        '> `/ingat` · `/memori` — kelola memori',
      ].join('\n'),
    )
    .setFooter({ text: 'Percakapan ini tidak bisa dibaca admin server' });

  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.warn(`Tidak bisa DM ${user.tag} — DM tertutup`, errorMessage(error));
    return false;
  }
}

/** Handler pesan DM yang masuk ke bot. */
export async function handleDmMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;

  const user = message.author;
  const session = await getDmSession(user.id);

  // Belum punya sesi: bungkus sebagai percakapan server pertama yang tersedia,
  // supaya member yang langsung mengetik di DM tetap dilayani.
  let active = session;
  if (!active) {
    const choices = await listGuildChoices(message.client, user.id);
    if (choices.length === 0) {
      await message
        .reply({
          content:
            'Kamu belum terdaftar di server mana pun yang memakai bot ini. ' +
            'Masuk ke server dulu, lalu klik tombol **Chat via DM** di panel.',
        })
        .catch(() => undefined);
      return;
    }
    await setDmSession(user.id, choices[0]!.id, user.id);
    active = await getDmSession(user.id);
  }

  if (!active) return;

  const guild = message.client.guilds.cache.get(active.guildId);
  if (!guild) {
    await deleteDmSession(user.id);
    await message
      .reply({ content: 'Server konteksmu sudah tidak tersedia. Jalankan `/server` untuk memilih server lain.' })
      .catch(() => undefined);
    return;
  }

  const raw = message.content.trim();
  if (!raw && message.attachments.size === 0) return;

  const rate = checkRateLimit(rateKey(user.id), config.features.rateLimitPerMinute);
  if (!rate.allowed) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    await message
      .reply({ content: `⏳ Pelan-pelan ya, coba lagi dalam ${seconds} detik.` })
      .catch(() => undefined);
    return;
  }

  const settings = await getGuildSettings(guild.id);
  const question = truncate(raw, config.features.maxInputChars);
  if (!question) {
    await message.reply({ content: 'Tulis pertanyaannya dalam bentuk teks ya 🙏' }).catch(() => undefined);
    return;
  }

  // Placeholder, lalu edit bertahap supaya terasa streaming tanpa kena rate limit.
  const placeholder = await message.reply({ content: '💭 *Sedang berpikir…*' }).catch(() => null);
  let preview = '';
  let lastSent = '';
  let busy = false;

  const timer = placeholder
    ? setInterval(() => {
        if (busy || !preview.trim() || preview === lastSent) return;
        busy = true;
        const content = preview.length >= 1800 ? `${preview.slice(0, 1800)}\n…` : preview;
        placeholder
          .edit({ content })
          .then(() => {
            lastSent = content;
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, 1400)
    : null;
  timer?.unref?.();

  try {
    const history = config.ai.historyLimit > 0 ? await getHistory(`dm:${user.id}`, config.ai.historyLimit) : [];

    const result = await generateDmAnswer({
      session: active,
      guild,
      userName: user.username,
      question,
      history: history.map((entry) => ({ role: entry.role, content: truncate(entry.content, 2000) })),
      settings,
      onDelta: (delta) => {
        if (preview.length < 1900) preview = (preview + delta).slice(0, 1900);
      },
    });

    if (timer) clearInterval(timer);

    await appendMessage(`dm:${user.id}`, 'user', question);
    await appendMessage(`dm:${user.id}`, 'assistant', result);
    await touchDmSession(user.id);

    const chunks = chunkMessage(result).slice(0, 4);
    const first = chunks[0] ?? 'Tidak ada jawaban.';

    if (placeholder) {
      await placeholder.edit({ content: first }).catch(() => undefined);
      for (const chunk of chunks.slice(1)) {
        await user.send({ content: chunk }).catch(() => undefined);
      }
    } else {
      await user.send({ content: first }).catch(() => undefined);
    }
  } catch (error) {
    if (timer) clearInterval(timer);
    logger.error('Gagal menjawab pesan DM', errorMessage(error));
    const note = `⚠️ Maaf, ada gangguan: ${errorMessage(error).slice(0, 200)}`;
    if (placeholder) await placeholder.edit({ content: note }).catch(() => undefined);
    else await user.send({ content: note }).catch(() => undefined);
  }
}

/**
 * Susun jawaban untuk sesi DM.
 *
 * Dipisah dari handler supaya bisa dipakai juga oleh `/akhiri`-style flow dan
 * lebih mudah dites.
 */
async function generateDmAnswer(input: {
  session: DmSession;
  guild: Guild;
  userName: string;
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: Awaited<ReturnType<typeof getGuildSettings>>;
  onDelta: (delta: string) => void;
}): Promise<string> {
  const { generateAnswer } = await import('./chat.js');

  const result = await generateAnswer(
    {
      guildId: input.session.guildId,
      guildName: input.guild.name,
      botName: input.guild.client.user?.username ?? 'Zypher AI',
      userId: input.session.userId,
      userName: input.userName,
      question: input.question,
      history: input.history,
      allowTools: true,
    },
    input.onDelta,
  );

  const note = result.sources.length > 0 ? `\n\n-# 📚 ${result.sources.length} potongan dokumen dipakai` : '';
  return `${result.text}${note}`;
}

/**
 * Tutup sesi DM: kirim transkrip, hapus riwayat, hapus sesi.
 *
 * Transkrip **hanya** dikirim ke DM — tidak disimpan di database mana pun.
 */
export async function endDmSession(user: User, botName: string): Promise<{ messages: number; delivered: boolean } | null> {
  const session = await getDmSession(user.id);
  if (!session) return null;

  const guild = user.client.guilds.cache.get(session.guildId);
  const history = await getHistory(`dm:${user.id}`, 600);
  const memories = await listMemories(session.guildId, user.id, 50);
  const endedAt = new Date();

  const lines: TranscriptMessage[] = history.map((entry, index) => ({
    authorName: entry.role === 'user' ? user.username : botName,
    authorAvatarUrl: entry.role === 'user' ? user.displayAvatarURL({ size: 64, extension: 'png' }) : null,
    isBot: entry.role === 'assistant',
    content: entry.content,
    createdAt: new Date(session.createdAt + index),
    attachments: [],
  }));

  let summary: string | null = null;
  if (lines.length >= 4) {
    const usable = lines.slice(-60).filter((line) => line.content.trim());
    try {
      const result = await chat({
        messages: [
          {
            role: 'system',
            content:
              'Ringkas percakapan berikut dalam 2-3 kalimat bahasa Indonesia. Sebutkan topik utama dan kesimpulan. Tanpa pembuka, tanpa bullet, tanpa markdown.',
          },
          {
            role: 'user',
            content: usable
              .map((line) => `${line.isBot ? 'AI' : user.username}: ${line.content.slice(0, 400)}`)
              .join('\n')
              .slice(0, 8000),
          },
        ],
        temperature: 0.3,
        maxTokens: 220,
      });
      summary = result.message.content?.trim() ?? null;
    } catch (error) {
      logger.warn('Gagal membuat ringkasan sesi DM', errorMessage(error));
    }
  }

  const html = buildTranscriptHtml({
    guildName: guild?.name ?? 'DM',
    guildIconUrl: guild?.iconURL({ size: 128 }) ?? null,
    userName: user.username,
    userTag: user.tag,
    channelName: 'Direct Message',
    startedAt: new Date(session.createdAt),
    endedAt,
    messages: lines,
    memoryLines: memories.map((memory) => memory.content),
    summary,
  });

  const fileName = transcriptFileName(user.username, endedAt);

  let delivered = true;
  try {
    await user.send({
      content: [
        '**Transkrip percakapan kamu**',
        `📄 ${lines.length} pesan • ${memories.length} memori`,
        '',
        'Sesi ditutup. Riwayat percakapan dihapus dari bot — file di bawah satu-satunya salinan.',
      ].join('\n'),
      files: [new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName })],
    });
  } catch (error) {
    delivered = false;
    logger.warn('Gagal mengirim transkrip DM', errorMessage(error));
  }

  await clearHistory(`dm:${user.id}`);
  await deleteDmSession(user.id);

  // `delivered: false` = sesi tetap ditutup, tapi member tidak menerima file.
  // Pemanggil wajib memberi tahu, jangan diam-diam mengaku berhasil.
  return { messages: lines.length, delivered };
}

/** Jumlah pesan di sesi DM aktif. */
export async function dmMessageCount(userId: string): Promise<number> {
  return countHistory(`dm:${userId}`);
}

/** Placeholder supaya tombol bantuan DM punya balasan. */
export async function dmHelpEphemeral(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    content: [
      '**Cara pakai chat DM**',
      '> Tulis pertanyaan langsung di chat ini.',
      '> `/server` — pilih server konteks (persona & dokumen)',
      '> `/akhiri` — tutup sesi dan terima transkrip',
      '> `/reset` — hapus riwayat, mulai topik baru',
      '',
      'Percakapan ini tidak bisa dibaca admin server mana pun.',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}
