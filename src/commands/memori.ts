import { EmbedBuilder, MessageFlags, SlashCommandBuilder, type User } from 'discord.js';
import { listMemories } from '../db/repo.js';
import { BRAND_COLOR } from '../features/ui.js';
import { resolveContextGuild } from './helpers.js';
import { dmCapable, type Command } from './types.js';

export const memoriCommand: Command = {
  data: dmCapable(
    new SlashCommandBuilder()
      .setName('memori')
      .setDescription('Lihat daftar hal yang AI ingat tentang kamu'),
  ),

  async execute(interaction) {
    const guildId = await resolveContextGuild(interaction);
    if (!guildId) return;

    // Memori bersifat pribadi: siapa pun (termasuk admin) hanya bisa melihat
    // memori miliknya sendiri. Admin server tidak boleh membaca fakta pribadi member.
    const target: User = interaction.user;

    const memories = await listMemories(guildId, target.id, 50);

    if (memories.length === 0) {
      await interaction.reply({
        content:
          'Belum ada yang aku ingat tentang kamu. Tambahkan dengan `/ingat fakta:...`, atau biarkan aku menyimpannya otomatis saat mengobrol.',
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
