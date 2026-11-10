import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/** Pastikan command dipakai di dalam server. */
export async function requireGuild(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.inGuild() && interaction.guild) return true;
  await interaction.reply({
    content: [
      'Perintah ini hanya bisa dipakai **di dalam server**, bukan di DM —',
      'karena ia mengubah pengaturan server (bukan percakapan pribadimu).',
      '',
      'Yang bisa dipakai di DM: `/server` · `/akhiri` · `/reset` · `/ingat` · `/memori` · `/lupakan` · `/konsolidasi` · `/bantuan`.',
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
 * - Di server: pakai server tempat perintah dijalankan.
 * - Di DM: pakai server yang tersimpan di sesi DM member (dipilih lewat `/server`).
 *
 * Mengembalikan `null` (setelah membalas) bila konteks tidak bisa ditentukan.
 */
export async function resolveContextGuild(
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  if (interaction.guildId) return interaction.guildId;

  const { getDmSession } = await import('../db/repo.js');
  const session = await getDmSession(interaction.user.id);
  if (session) return session.guildId;

  await interaction.reply({
    content: [
      'Kamu belum punya sesi chat aktif.',
      'Buka DM ke bot lalu kirim pesan, atau jalankan `/server` untuk memilih server konteks.',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

/** Apakah perintah sedang dijalankan di DM (bukan di server). */
export function isDirectMessage(interaction: ChatInputCommandInteraction): boolean {
  return !interaction.inGuild();
}
