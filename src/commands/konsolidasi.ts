import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type User } from 'discord.js';
import { consolidateMemories } from '../features/memory.js';
import { listMemories } from '../db/repo.js';
import { replyEphemeral, requireAdmin, requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const konsolidasiCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('konsolidasi')
    .setDescription('AI meninjau memori dan menggabungkan fakta yang berulang')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('User yang memorinya akan dikonversi (khusus admin)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const target: User = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = target.id === interaction.user.id;
    const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

    if (!isSelf && !isAdmin) {
      await interaction.reply({
        content: 'Kamu hanya bisa mengonsolidasi memori milikmu sendiri.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const total = (await listMemories(interaction.guildId, target.id, 500)).length;
    if (total === 0) {
      await replyEphemeral(interaction, 'Belum ada memori untuk dikonversi.');
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await consolidateMemories(interaction.guildId, target.id);

    if (result.skipped) {
      await interaction.editReply({
        content: `ℹ️ ${result.skipped}\nMemori ${result.before} tetap utuh.`,
      });
      return;
    }

    await interaction.editReply({
      content: [
        `🧠 **Konsolidasi selesai** untuk ${isSelf ? 'kamu' : target.username}:`,
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
