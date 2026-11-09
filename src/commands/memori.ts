import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type User } from 'discord.js';
import { listMemories } from '../db/repo.js';
import { BRAND_COLOR } from '../features/ui.js';
import { requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const memoriCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('memori')
    .setDescription('Lihat daftar hal yang AI ingat tentang kamu')
    .addUserOption((option) =>
      option.setName('user').setDescription('Lihat memori member lain (khusus admin)').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const target: User = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = target.id === interaction.user.id;
    const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

    if (!isSelf && !isAdmin) {
      await interaction.reply({
        content: 'Kamu hanya bisa melihat memori milikmu sendiri.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const memories = listMemories(interaction.guildId, target.id, 50);

    if (memories.length === 0) {
      await interaction.reply({
        content: isSelf
          ? 'Belum ada yang aku ingat tentang kamu. Tambahkan dengan `/ingat fakta:...`, atau biarkan aku menyimpannya otomatis saat mengobrol.'
          : `Belum ada memori tersimpan untuk **${target.username}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = memories
      .slice()
      .reverse()
      .map((memory) => `\`#${memory.id}\` • ${memory.content}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`🧠 Memori — ${target.username}`)
      .setDescription(lines.length > 4000 ? `${lines.slice(0, 3990)}…` : lines)
      .setFooter({
        text: `${memories.length} memori • hapus dengan /lupakan id:<nomor>`,
      });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
