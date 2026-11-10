import { SlashCommandBuilder } from 'discord.js';
import { clearMemories, deleteMemory, listMemories } from '../db/repo.js';
import { replyEphemeral, requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const lupakanCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('lupakan')
    .setDescription('Hapus memori yang disimpan tentang kamu')
    .addIntegerOption((option) =>
      option.setName('id').setDescription('Nomor memori (lihat di /memori)').setMinValue(1).setRequired(false),
    )
    .addBooleanOption((option) =>
      option.setName('semua').setDescription('Hapus SEMUA memori tentang kamu').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const id = interaction.options.getInteger('id');
    const all = interaction.options.getBoolean('semua') ?? false;

    if (!id && !all) {
      const memories = await listMemories(interaction.guildId, interaction.user.id, 50);
      if (memories.length === 0) {
        await replyEphemeral(interaction, 'Tidak ada memori yang tersimpan.');
        return;
      }
      const ids = memories
        .map((memory) => `#${memory.id}`)
        .slice(0, 30)
        .join(', ');
      await replyEphemeral(
        interaction,
        `Sebutkan id yang mau dihapus, atau pakai \`semua:true\`.\nMemori kamu: ${ids}\n\nCek isinya dengan \`/memori\`.`,
      );
      return;
    }

    if (all) {
      const removed = await clearMemories(interaction.guildId, interaction.user.id);
      await replyEphemeral(interaction, `🗑️ ${removed} memori dihapus. Aku mulai dari nol tentang kamu.`);
      return;
    }

    const removed = await deleteMemory(interaction.guildId, interaction.user.id, id as number);
    await replyEphemeral(
      interaction,
      removed ? `🗑️ Memori #${id} dihapus.` : `Tidak ada memori #${id} milikmu. Cek daftarnya di \`/memori\`.`,
    );
  },
};
