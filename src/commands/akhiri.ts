import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { endDmSession } from '../features/dm.js';
import { getDmSession } from '../db/repo.js';
import { dmCapable, type Command } from './types.js';

/**
 * `/akhiri` — tutup sesi DM: kirim transkrip, hapus riwayat.
 *
 * Transkrip hanya dikirim ke DM member dan tidak disimpan di database mana pun.
 */
export const akhiriCommand: Command = {
  data: dmCapable(
    new SlashCommandBuilder()
      .setName('akhiri')
      .setDescription('Tutup sesi chat, terima transkrip, hapus riwayat dari bot'),
  ),

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

    if (!result) {
      await interaction.editReply({ content: 'Sesi sudah tidak aktif.' });
      return;
    }

    // Jangan pernah mengaku transkrip terkirim kalau DM-nya gagal — member
    // harus tahu supaya tidak kehilangan satu-satunya salinan percakapan.
    await interaction.editReply({
      content: result.delivered
        ? [
            `✅ Sesi ditutup. Transkrip ${result.messages} pesan sudah dikirim ke DM kamu.`,
            'Riwayat percakapan dihapus dari bot.',
          ].join('\n')
        : [
            `⚠️ Sesi ditutup dan riwayat ${result.messages} pesan sudah dihapus,`,
            '**tapi transkrip gagal dikirim** (DM kamu tertutup untuk bot ini).',
            '',
            'Buka **Privasi & Keamanan** → **Izinkan pesan langsung dari server**,',
            'lalu jalankan `/akhiri` lagi pada sesi berikutnya.',
          ].join('\n'),
    });
  },
};
