import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';
import { config } from '../config.js';
import { getGuildSettings, getPanel } from '../db/repo.js';
import { dmHelpEphemeral, startDmSession } from './dm.js';
import { handleRoleButton } from './role-button-handler.js';
import { parseRoleButtonId } from './role-buttons.js';
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
 * Router semua button interaction milik bot.
 *
 * Tombol role memakai customId DINAMIS (`post-role:<id>`), jadi tidak bisa
 * masuk `switch` di bawah — ID-nya dibuat saat pesan disusun. Karena itu
 * prefix-nya diperiksa lebih dulu.
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (parseRoleButtonId(interaction.customId) !== null) {
    await handleRoleButton(interaction);
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
