import { SlashCommandBuilder } from 'discord.js';
import { clearHistory, countHistory, getRoomByChannel } from '../db/repo.js';
import { canManageRoom } from '../features/rooms.js';
import { replyEphemeral, requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const resetCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Hapus riwayat percakapan di room AI ini (memori jangka panjang tetap disimpan)'),

  async execute(interaction) {
    if (!(await requireGuild(interaction))) return;

    const room = interaction.channelId ? getRoomByChannel(interaction.channelId) : null;
    if (!room) {
      await replyEphemeral(
        interaction,
        'Perintah ini hanya bisa dipakai di dalam room AI. Buat room dulu lewat panel, atau pakai `/tanya` untuk pertanyaan singkat.',
      );
      return;
    }

    const member = interaction.guild?.members.cache.get(interaction.user.id) ?? null;
    if (!canManageRoom(member, room)) {
      await replyEphemeral(interaction, 'Hanya pemilik room atau staff yang bisa mereset percakapan.');
      return;
    }

    const before = countHistory(room.channelId);
    clearHistory(room.channelId);

    await replyEphemeral(
      interaction,
      `🧹 ${before} pesan dihapus dari konteks AI.\nMemori jangka panjang kamu **tidak** ikut terhapus — cek \`/memori\`.`,
    );
  },
};
