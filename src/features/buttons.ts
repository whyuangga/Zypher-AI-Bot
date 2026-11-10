import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';
import { config } from '../config.js';
import { getGuildSettings } from '../db/repo.js';
import { getPanel, getRoomByChannel } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import { canManageRoom, createAiRoom, endAiRoom, replyRoomHelp } from './rooms.js';
import { endConfirmRow } from './ui.js';

async function resolveMember(interaction: ButtonInteraction): Promise<GuildMember | null> {
  if (!interaction.guild) return null;
  if (interaction.member && 'permissions' in interaction.member) return interaction.member as GuildMember;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function handleCreate(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Room AI hanya bisa dibuat di dalam server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Panel bisa dimatikan dari dashboard tanpa menghapus pesannya — jadi tombol
  // yang masih terlihat pun tidak lagi membuat room.
  const panel = await getPanel(interaction.guild.id).catch(() => null);
  if (panel && !panel.enabled) {
    await interaction.reply({
      content: '🔒 Pembuatan room AI sedang dinonaktifkan admin server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await resolveMember(interaction);
  if (!member) {
    await interaction.reply({ content: 'Tidak bisa membaca data member kamu. Coba lagi.', flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getGuildSettings(interaction.guildId);
  if ((settings?.adminOnlyRooms ?? config.features.adminOnlyRooms) && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: '🔒 Room AI saat ini hanya bisa dibuat oleh admin server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { channel, reused } = await createAiRoom(interaction.guild, member);
    await interaction.editReply({
      content: reused
        ? `Kamu sudah punya room AI aktif: <#${channel.id}>\nLanjutkan di sana ya. Kalau ingin mulai baru, akhiri sesi lama dulu.`
        : `✅ Room AI kamu sudah siap: <#${channel.id}>\nSilakan langsung tanya apa saja di sana.`,
    });
  } catch (error) {
    logger.error('Gagal membuat room AI', errorMessage(error));
    await interaction.editReply({
      content: [
        '❌ Gagal membuat room AI.',
        `\`${errorMessage(error).slice(0, 180)}\``,
        '',
        'Pastikan bot punya izin **Manage Channels** dan **Manage Roles** di server ini.',
      ].join('\n'),
    });
  }
}

async function handleEndRequest(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'Tombol ini hanya berlaku di room AI.', flags: MessageFlags.Ephemeral });
    return;
  }

  const room = await getRoomByChannel(channel.id);
  if (!room) {
    await interaction.reply({
      content: 'Channel ini bukan room AI aktif.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await resolveMember(interaction);
  if (!canManageRoom(member, room)) {
    await interaction.reply({
      content: 'Hanya pemilik room atau staff yang bisa mengakhiri sesi ini.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: [
      '🏁 **Akhiri sesi ini?**',
      '> Transkrip percakapan akan dibuat dan dikirim ke DM kamu.',
      '> Channel room ini akan dihapus permanen.',
      '> Memori jangka panjang kamu tetap tersimpan.',
    ].join('\n'),
    components: [endConfirmRow()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEndConfirm(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.update({ content: 'Channel tidak valid.', components: [] });
    return;
  }

  const room = await getRoomByChannel(channel.id);
  if (!room) {
    await interaction.update({ content: 'Room ini sudah tidak aktif (mungkin sudah ditutup).', components: [] });
    return;
  }

  const member = await resolveMember(interaction);
  if (!canManageRoom(member, room)) {
    await interaction.update({ content: 'Kamu tidak berhak menutup room ini.', components: [] });
    return;
  }

  await endAiRoom(interaction, channel, room);
}

/** Router semua button interaction milik bot. */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  switch (interaction.customId) {
    case 'room:create':
      await handleCreate(interaction);
      return;
    case 'room:help':
      await replyRoomHelp(interaction);
      return;
    case 'room:end':
      await handleEndRequest(interaction);
      return;
    case 'room:end:confirm':
      await handleEndConfirm(interaction);
      return;
    case 'room:end:cancel':
      await interaction.update({ content: 'Oke, sesi dilanjutkan. 👍', components: [] });
      return;
    default:
      logger.debug(`Button tidak dikenal: ${interaction.customId}`);
  }
}
