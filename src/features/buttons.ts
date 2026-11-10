import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';
import { config } from '../config.js';
import { getGuildSettings, getPanel } from '../db/repo.js';
import { chooseContextGuild, dmHelpEphemeral, listGuildChoices, startDmSession } from './dm.js';
import { errorMessage, logger } from '../lib/logger.js';

async function resolveMember(interaction: ButtonInteraction): Promise<GuildMember | null> {
  if (!interaction.guild) return null;
  if (interaction.member && 'permissions' in interaction.member) return interaction.member as GuildMember;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

/**
 * Tombol "Chat via DM" di panel server.
 *
 * Tidak ada channel/thread yang dibuat. Bot hanya mengirim DM ke member, jadi
 * tidak ada percakapan yang bisa dibaca admin server.
 */
async function handleStartDm(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: 'Tombol ini dipakai di dalam server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Panel bisa dimatikan dari dashboard tanpa menghapus pesannya.
  const panel = await getPanel(interaction.guild.id).catch(() => null);
  if (panel && !panel.enabled) {
    await interaction.reply({
      content: '🔒 Chat AI sedang dinonaktifkan admin server.',
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
  if (
    (settings?.adminOnlyRooms ?? config.features.adminOnlyRooms) &&
    !member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '🔒 Chat AI saat ini hanya bisa dimulai oleh admin server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const sent = await startDmSession(interaction.user, interaction.guild);
    await interaction.editReply({
      content: sent
        ? '✅ Sudah aku kirim ke DM kamu. Buka DM dan langsung tanya apa saja.'
        : [
            '❌ Aku tidak bisa mengirim DM ke kamu — DM kamu tertutup untuk bot ini.',
            '',
            '**Cara membuka:**',
            '> **Privasi & Keamanan** → **Izinkan pesan langsung dari server** → aktifkan untuk server ini.',
            '',
            'Setelah itu klik tombol ini lagi.',
          ].join('\n'),
    });
  } catch (error) {
    logger.error('Gagal memulai sesi DM', errorMessage(error));
    await interaction.editReply({
      content: ['❌ Gagal memulai chat DM.', `\`${errorMessage(error).slice(0, 180)}\``].join('\n'),
    });
  }
}

/**
 * Tombol pilihan server di embed `/server` (`dm:server:<guildId>`).
 *
 * Hanya server tempat member benar-benar bergabung yang boleh dipilih —
 * kalau tidak, siapa pun bisa memakai dokumen server yang bukan miliknya.
 */
async function handleDmServerPick(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.customId.slice('dm:server:'.length);
  if (!guildId) return;

  const choices = await listGuildChoices(interaction.client, interaction.user.id);
  const match = choices.find((choice) => choice.id === guildId);

  if (!match) {
    await interaction.reply({
      content: 'Server itu tidak ada di daftar keanggotaanmu. Jalankan `/server` untuk melihat pilihan.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await chooseContextGuild(interaction.user.id, match.id);
  await interaction.reply({
    content: `✅ Konteks sekarang memakai **${match.name}**. Lanjutkan tanya jawab di chat ini ya.`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Router semua button interaction milik bot. */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId.startsWith('dm:server:')) {
    await handleDmServerPick(interaction);
    return;
  }

  switch (interaction.customId) {
    case 'dm:start':
      await handleStartDm(interaction);
      return;
    case 'dm:help':
      await dmHelpEphemeral(interaction);
      return;
    default:
      logger.debug(`Button tidak dikenal: ${interaction.customId}`);
  }
}
