import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { endDmSession } from '../features/dm.js';
import { getDmSession } from '../db/repo.js';
import type { Command } from './types.js';

/**
 * `/akhiri` — tutup sesi DM: kirim transkrip, hapus riwayat.
 *
 * Transkrip hanya dikirim ke DM member dan tidak disimpan di database mana pun.
 */
export const akhiriCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('akhiri')
    .setDescription('Tutup sesi chat AI dan terima transkrip percakapan'),

  async execute(interaction) {
    const session = await getDmSession(interaction.user.id);
    if (!session) {
      await interaction.reply({
        content: 'Belum ada sesi chat aktif. Kirim pesan ke bot dulu, atau klik **Chat via DM** di panel server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const botName = interaction.client.user?.username ?? 'Zypher AI';
    const result = await endDmSession(interaction.user, botName);

    await interaction.editReply({
      content: result
        ? `✅ Sesi ditutup. Transkrip ${result.messages} pesan sudah dikirim ke DM kamu.\nRiwayat percakapan dihapus dari bot.`
        : 'Sesi sudah tidak aktif.',
    });
  },
};
