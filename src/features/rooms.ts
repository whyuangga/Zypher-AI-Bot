import {
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { createRoom, deleteRoom, getRoomByUser, listMemories, clearHistory, type Room } from '../db/repo.js';
import { chat } from '../lib/llm.js';
import { logger, errorMessage } from '../lib/logger.js';
import { buildTranscriptHtml, transcriptFileName, type TranscriptMessage } from '../lib/transcript.js';
import { roomControlsRow, roomWelcomeEmbed } from './ui.js';

const ROOM_TOPIC_MARKER = 'zypher-room:';
const MAX_TRANSCRIPT_MESSAGES = 600;

export const roomTopic = (userId: string): string => `Room AI privat • ${ROOM_TOPIC_MARKER}${userId}`;

const sanitizeChannelName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'member';

/** Cari room lama milik user (kalau bot restart dan DB masih ada). */
async function findExistingRoom(guild: Guild, userId: string): Promise<TextChannel | null> {
  const stored = await getRoomByUser(guild.id, userId);
  if (stored) {
    const channel = await guild.channels.fetch(stored.channelId).catch(() => null);
    if (channel && channel.type === ChannelType.GuildText) return channel;
    await deleteRoom(stored.channelId);
  }

  // Pemulihan: cari channel dengan marker di topic (kalau database ter-reset).
  const marked = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText && typeof channel.topic === 'string' && channel.topic.includes(`${ROOM_TOPIC_MARKER}${userId}`),
  );
  return marked && marked.type === ChannelType.GuildText ? marked : null;
}

async function resolveCategory(guild: Guild) {
  if (config.ids.category) {
    const configured = await guild.channels.fetch(config.ids.category).catch(() => null);
    if (configured?.type === ChannelType.GuildCategory) return configured;
    logger.warn(`AI_CATEGORY_ID (${config.ids.category}) tidak ditemukan — memakai kategori default.`);
  }

  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === 'ai lounge',
  );
  if (existing) return existing;

  return guild.channels.create({
    name: 'AI Lounge',
    type: ChannelType.GuildCategory,
    reason: 'Kategori untuk room AI privat',
  });
}

/**
 * Buat (atau ambil kembali) room AI privat milik member.
 */
export async function createAiRoom(
  guild: Guild,
  member: GuildMember,
): Promise<{ channel: TextChannel; reused: boolean }> {
  const existing = await findExistingRoom(guild, member.id);
  if (existing) return { channel: existing, reused: true };

  const me = guild.members.me;
  if (!me) throw new Error('Bot belum siap (guild member cache kosong). Coba lagi sebentar.');

  const category = await resolveCategory(guild);
  const baseName = `ai-${sanitizeChannelName(member.user.username)}`;
  const nameTaken = guild.channels.cache.some((channel) => channel.name === baseName);
  const name = nameTaken ? `${baseName}-${member.id.slice(-4)}` : baseName;

  const overwrites: OverwriteResolvable[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.UseExternalEmojis,
      ],
    },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (config.ids.staffRole) {
    const staffRole = guild.roles.cache.get(config.ids.staffRole);
    if (staffRole) {
      overwrites.push({
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    } else {
      logger.warn(`STAFF_ROLE_ID (${config.ids.staffRole}) tidak ditemukan di server ${guild.name}.`);
    }
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: roomTopic(member.id),
    permissionOverwrites: overwrites,
    reason: `Room AI privat untuk ${member.user.username}`,
  });

  await createRoom(channel.id, guild.id, member.id);

  const welcome = await channel.send({
    content: `<@${member.id}>`,
    embeds: [roomWelcomeEmbed(member.id)],
    components: [roomControlsRow()],
    allowedMentions: { users: [member.id] },
  });
  await welcome.pin().catch(() => undefined);

  logger.info(`Room AI dibuat: #${channel.name} untuk ${member.user.username} (${guild.name})`);
  return { channel, reused: false };
}

/* ------------------------------------------------------------------ */
/*  Akhiri sesi + transkrip                                            */
/* ------------------------------------------------------------------ */

async function fetchAllMessages(channel: TextChannel, max = MAX_TRANSCRIPT_MESSAGES): Promise<Message[]> {
  const collected: Message[] = [];
  let before: string | undefined;

  while (collected.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-max);
}

function toTranscriptMessage(message: Message): TranscriptMessage {
  return {
    authorName: message.member?.displayName ?? message.author.username,
    authorAvatarUrl: message.author.displayAvatarURL({ size: 64, extension: 'png' }),
    isBot: message.author.bot,
    content: message.content,
    createdAt: message.createdAt,
    attachments: [...message.attachments.values()].map((attachment) => ({
      name: attachment.name ?? 'lampiran',
      url: attachment.url,
    })),
  };
}

async function summarize(messages: Message[], userName: string): Promise<string | null> {
  const usable = messages.filter((message) => Boolean(message.content.trim())).slice(-60);
  if (usable.length < 4) return null;

  const conversation = usable
    .map((message) => `${message.author.bot ? 'AI' : userName}: ${message.content.slice(0, 400)}`)
    .join('\n')
    .slice(0, 8000);

  try {
    const result = await chat({
      messages: [
        {
          role: 'system',
          content:
            'Ringkas percakapan berikut dalam 2-3 kalimat bahasa Indonesia. Sebutkan topik utama dan hasil/kesimpulan yang didapat user. Tanpa pembuka, tanpa bullet, tanpa markdown.',
        },
        { role: 'user', content: conversation },
      ],
      temperature: 0.3,
      maxTokens: 220,
    });
    return result.message.content?.trim() ?? null;
  } catch (error) {
    logger.warn('Gagal membuat ringkasan sesi', errorMessage(error));
    return null;
  }
}

async function deliverFile(channel: TextChannel, fileName: string, html: string) {
  return channel.send({
    files: [new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName })],
  });
}

/**
 * Jeda sebelum channel room dihapus, dalam milidetik.
 *
 * DM terkirim → 3 detik (member sudah punya arsipnya).
 * DM gagal → 60 detik, karena transkrip hanya ada sebagai lampiran di room dan
 * member butuh waktu untuk mengunduhnya sebelum channel hilang.
 */
export function roomDeleteDelayMs(dmSent: boolean): number {
  return dmSent ? 3000 : 60_000;
}

/**
 * Tutup room: buat transkrip, kirim ke DM user, lalu hapus channel.
 * Kalau DM tertutup, transkrip dilampirkan di room dan channel tetap dihapus
 * dengan jeda lebih panjang agar member sempat mengunduhnya.
 * Dipanggil setelah user menekan tombol konfirmasi.
 */
export async function endAiRoom(interaction: ButtonInteraction, channel: TextChannel, room: Room): Promise<void> {
  await interaction.update({
    content: '⏳ Menyiapkan transkrip percakapan kamu…',
    embeds: [],
    components: [],
  });

  const guild = channel.guild;
  const member = await guild.members.fetch(room.userId).catch(() => null);
  const user = member?.user ?? (await interaction.client.users.fetch(room.userId).catch(() => null));
  const userName = member?.displayName ?? user?.username ?? 'member';

  const messages = await fetchAllMessages(channel);
  const memories = await listMemories(guild.id, room.userId, 50);
  const endedAt = new Date();
  const startedAt = messages[0]?.createdAt ?? new Date(room.createdAt);

  const summary = await summarize(messages, userName);

  const html = buildTranscriptHtml({
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ size: 128 }),
    userName,
    userTag: user?.tag ?? room.userId,
    channelName: channel.name,
    startedAt,
    endedAt,
    messages: messages.map(toTranscriptMessage),
    memoryLines: memories.map((memory) => memory.content),
    summary,
  });

  const fileName = transcriptFileName(userName, endedAt);
  const buffer = Buffer.from(html, 'utf8');
  const stats = `📄 **${messages.length} pesan** • ${memories.length} memori • ${Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000))} menit`;

  // Transkrip TIDAK disimpan di database. Satu-satunya tujuan adalah DM user,
  // supaya admin server tidak bisa membaca percakapan member dari dashboard.
  let dmSent = false;
  if (user) {
    try {
      await user.send({
        content: [
          `**Transkrip sesi AI kamu di ${guild.name}**`,
          stats,
          summary ? `\n> ${summary.replace(/\n/g, '\n> ')}` : '',
          '',
          'Channel room AI kamu akan dihapus sebentar lagi. Buka file di bawah untuk arsip lengkap.',
        ]
          .filter(Boolean)
          .join('\n'),
        files: [new AttachmentBuilder(buffer, { name: fileName })],
      });
      dmSent = true;
    } catch {
      logger.warn(`Tidak bisa DM ${userName} (DM ditutup). Transkrip dikirim ke room sebagai lampiran.`);
    }
  }

  const deleteDelayMs = roomDeleteDelayMs(dmSent);

  if (!dmSent) {
    await deliverFile(channel, fileName, html).catch(() => undefined);
    await channel
      .send({
        content: [
          '⚠️ Aku tidak bisa mengirim DM ke kamu (DM tertutup).',
          'Transkrip aku lampirkan di atas — **unduh sekarang**, karena channel ini akan dihapus 60 detik lagi.',
          'Kalau ingin transkrip dikirim lewat DM, buka **Privasi & Keamanan → Izinkan pesan langsung dari server** lalu buat room baru.',
        ].join('\n'),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  await clearHistory(channel.id);
  await deleteRoom(channel.id);

  if (dmSent) {
    await channel
      .send({
        content: '✅ Sesi diakhiri. Channel ini akan dihapus dalam beberapa detik.',
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  setTimeout(() => {
    channel
      .delete(`Sesi AI diakhiri oleh ${interaction.user.username}`)
      .catch((error) => logger.warn('Gagal menghapus channel room AI', errorMessage(error)));
  }, deleteDelayMs);

  logger.info(`Sesi AI ditutup: #${channel.name} (${messages.length} pesan, DM ${dmSent ? 'terkirim' : 'gagal'})`);
}

/** Apakah member berhak menutup room (pemilik atau staff). */
export function canManageRoom(member: GuildMember | null, room: Room): boolean {
  if (!member) return false;
  if (member.id === room.userId) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (config.ids.staffRole && member.roles.cache.has(config.ids.staffRole)) return true;
  return false;
}

export async function replyRoomHelp(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    content: [
      '**Cara pakai room AI**',
      '> Tulis pertanyaan seperti chat biasa — AI langsung menjawab.',
      '> `/ingat fakta:...` untuk menyimpan hal penting tentang kamu.',
      '> `/memori` untuk melihat ingatan AI tentang kamu.',
      '> `/reset` untuk menghapus riwayat dan mulai topik baru.',
      '> Tombol **Akhiri Sesi** menutup room + mengirim transkrip ke DM.',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}
