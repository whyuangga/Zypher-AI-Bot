import { config } from '../config.js';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/** Pastikan command dipakai di dalam server. */
export async function requireGuild(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.inGuild() && interaction.guild) return true;
  await interaction.reply({
    content: [
      'Perintah ini hanya bisa dipakai **di dalam server**, bukan di DM —',
      'karena ia mengubah pengaturan server (bukan percakapan pribadimu).',
      '',
      'Yang bisa dipakai di DM: `/akhiri` · `/reset` · `/ingat` · `/memori` · `/lupakan` · `/konsolidasi` · `/bantuan`.',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

/** Pastikan pemakai punya izin Manage Server. */
export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!(await requireGuild(interaction))) return false;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  await interaction.reply({
    content: '🔒 Perintah ini khusus admin server (butuh izin **Manage Server**).',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

/**
 * Tentukan server konteks untuk perintah yang bisa dipakai di server maupun DM.
 *
 * Bot ini untuk satu server, jadi konteksnya selalu `GUILD_ID` — tidak ada lagi
 * pilihan server. Perintah di server lain seharusnya tidak pernah sampai ke sini
 * (bot langsung keluar), tetapi pemeriksaan tetap dilakukan untuk keamanan.
 *
 * Mengembalikan `null` (setelah membalas) bila konteks tidak bisa ditentukan.
 */
export async function resolveContextGuild(
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  const homeId = config.discord.homeGuildId;
  if (interaction.guildId === homeId) return homeId;

  if (interaction.guildId) {
    await interaction.reply({
      content: 'Bot ini hanya melayani satu server, dan ini bukan servernya.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  // Di DM: tetap butuh sesi aktif supaya urutan percakapan punya konteks.
  const { getDmSession } = await import('../db/repo.js');
  const session = await getDmSession(interaction.user.id);
  if (session) return homeId;

  await interaction.reply({
    content: ['Kamu belum punya sesi chat aktif.', 'Buka DM ke bot lalu kirim pesan dulu.'].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

/** Apakah perintah sedang dijalankan di DM (bukan di server). */
export function isDirectMessage(interaction: ChatInputCommandInteraction): boolean {
  return !interaction.inGuild();
}
