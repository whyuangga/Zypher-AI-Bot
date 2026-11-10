import { SlashCommandBuilder } from 'discord.js';
import { clearHistory, countHistory, getDmSession } from '../db/repo.js';
import { replyEphemeral, requireGuild } from './helpers.js';
import { dmCapable, type Command } from './types.js';

export const resetCommand: Command = {
  data: dmCapable(
    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('Hapus riwayat percakapan DM ini (memori jangka panjang tetap disimpan)'),
  ),

  async execute(interaction) {
    if (!(await requireGuild(interaction))) return;

    const session = await getDmSession(interaction.user.id);
    if (!session) {
      await replyEphemeral(
        interaction,
        'Belum ada sesi chat aktif. Buka DM ke bot lalu kirim pesan, atau pakai `/tanya` untuk pertanyaan singkat.',
      );
      return;
    }

    const before = await countHistory(`dm:${interaction.user.id}`);
    await clearHistory(`dm:${interaction.user.id}`);

    await replyEphemeral(
      interaction,
      `🧹 ${before} pesan dihapus dari konteks AI.\nMemori jangka panjang kamu **tidak** ikut terhapus — cek \`/memori\`.`,
    );
  },
};
