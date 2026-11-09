import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/** Pastikan command dipakai di dalam server. */
export async function requireGuild(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.inGuild() && interaction.guild) return true;
  await interaction.reply({ content: 'Perintah ini hanya bisa dipakai di dalam server.', flags: MessageFlags.Ephemeral });
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
