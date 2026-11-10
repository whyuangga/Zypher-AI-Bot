import { SlashCommandBuilder } from 'discord.js';
import { clearHistory, countHistory, getDmSession } from '../db/repo.js';
import { isDirectMessage, replyEphemeral } from './helpers.js';
import { dmCapable, type Command } from './types.js';

/**
 * `/reset` — hapus riwayat percakapan DM tanpa menutup sesi.
 *
 * Bedanya dengan `/akhiri`:
 * - `/reset`  : riwayat dihapus, sesi TETAP aktif. Bot lupa obrolan sebelumnya,
 *               tapi kamu bisa lanjut bertanya. Memori jangka panjang tetap ada.
 * - `/akhiri` : sesi ditutup, transkrip dikirim ke DM, riwayat dihapus.
 *
 * Bisa dipakai di DM maupun di server (di server ia mengosongkan riwayat
 * percakapan DM milikmu sendiri — riwayat chat memang selalu di DM).
 */
export const resetCommand: Command = {
  data: dmCapable(
    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('Lupakan obrolan sebelumnya, mulai topik baru (memori jangka panjang tetap ada)'),
  ),

  async execute(interaction) {
    // Jangan pakai requireGuild(): riwayat yang dihapus adalah riwayat DM,
    // jadi perintah ini justru paling sering dipakai DI DM. requireGuild()
    // dulu membuatnya selalu menjawab "hanya bisa dipakai di dalam server".
    const inDm = isDirectMessage(interaction);

    const session = await getDmSession(interaction.user.id);
    if (!session) {
      await replyEphemeral(
        interaction,
        [
          'Belum ada sesi chat aktif, jadi tidak ada yang perlu direset.',
          '',
          'Buka DM ke bot lalu kirim pesan — atau klik tombol **Chat via DM** di panel server.',
        ].join('\n'),
      );
      return;
    }

    const before = await countHistory(`dm:${interaction.user.id}`);
    await clearHistory(`dm:${interaction.user.id}`);

    // Kalau di DM, sesi tetap dipakai: beri tahu bahwa bot akan lupa konteks.
    await replyEphemeral(
      interaction,
      [
        `🧹 ${before} pesan dihapus dari konteks AI.`,
        'Sesi tetap aktif — kamu bisa langsung bertanya lagi dari nol.',
        '',
        'Memori jangka panjang kamu **tidak** ikut terhapus (kelola dengan `/memori`).',
        inDm
          ? 'Mau menutup sesi sekalian dan menerima transkrip? Pakai `/akhiri`.'
          : 'Riwayat yang dihapus adalah riwayat chat DM kamu dengan bot.',
      ].join('\n'),
    );
  },
};
