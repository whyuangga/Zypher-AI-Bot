import { MessageFlags, SlashCommandBuilder, type User } from 'discord.js';
import { consolidateMemories } from '../features/memory.js';
import { listMemories } from '../db/repo.js';
import { replyEphemeral, resolveContextGuild } from './helpers.js';
import { dmCapable, type Command } from './types.js';

export const konsolidasiCommand: Command = {
  data: dmCapable(
    new SlashCommandBuilder()
      .setName('konsolidasi')
      .setDescription('AI meninjau memori kamu dan menggabungkan fakta yang berulang'),
  ),

  async execute(interaction) {
    const guildId = await resolveContextGuild(interaction);
    if (!guildId) return;

    // Memori bersifat pribadi: konsolidasi hanya untuk memori sendiri.
    // Admin tidak boleh menyentuh (apalagi membaca) memori member lain.
    const target: User = interaction.user;

    const total = (await listMemories(guildId, target.id, 500)).length;
    if (total === 0) {
      await replyEphemeral(interaction, 'Belum ada memori untuk dikonversi.');
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await consolidateMemories(guildId, target.id);

    if (result.skipped) {
      await interaction.editReply({
        content: `ℹ️ ${result.skipped}\nMemori ${result.before} tetap utuh.`,
      });
      return;
    }

    await interaction.editReply({
      content: [
        '🧠 **Konsolidasi selesai** untuk kamu:',
        `- Sebelum: **${result.before}** memori`,
        `- Setelah: **${result.after}** memori`,
        `- Hapus: **${result.removed}** memori (duplikat / tidak berguna)`,
        '',
        `> ${result.kept.slice(0, 5).map((fact) => `• ${fact}`).join('\n> ')}` +
          (result.kept.length > 5 ? `\n> • … +${result.kept.length - 5} lainnya` : ''),
      ].join('\n'),
    });
  },
};
