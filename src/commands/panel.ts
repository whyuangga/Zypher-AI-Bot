import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PanelError, publishPanel } from '../features/panel.js';
import { requireAdmin } from './helpers.js';
import type { Command } from './types.js';

export const panelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Kirim panel "Chat via DM" ke sebuah channel (admin)')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel tujuan panel (default: channel ini)')
        .addChannelTypes(ChannelType.GuildText),
    ),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) return;

    if (!interaction.guildId) {
      await interaction.reply({
        content: 'Panel hanya bisa dikirim di dalam server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = interaction.options.getChannel('channel');
    const target = selected ?? interaction.channel;

    if (!target || target.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Pilih channel teks sebagai tujuan panel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Panel lama (di channel mana pun) dihapus dulu: satu panel aktif per server.
      // Catatannya juga dipakai halaman Panel di dashboard.
      const result = await publishPanel(interaction.client, interaction.guildId, target.id);
      await interaction.editReply({
        content: [
          `✅ Panel AI sudah dikirim ke <#${result.channelId}>.`,
          result.removedPrevious ? 'Panel lama otomatis dihapus supaya tidak dobel.' : '',
          'Kelola panel (pindah channel / hapus / nonaktifkan) dari dashboard → **Panel**.',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } catch (error) {
      await interaction.editReply({
        content: `❌ ${error instanceof PanelError ? error.message : 'Gagal mengirim panel.'}`,
      });
    }
  },
};
