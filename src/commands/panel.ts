import { ChannelType, MessageFlags, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { panelEmbed, panelRow } from '../features/ui.js';
import { requireAdmin } from './helpers.js';
import type { Command } from './types.js';

export const panelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Kirim panel pembuat room AI ke sebuah channel (admin)')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel tujuan panel (default: channel ini)')
        .addChannelTypes(ChannelType.GuildText),
    ),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) return;

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
      await (target as TextChannel).send({ embeds: [panelEmbed()], components: [panelRow()] });
      await interaction.editReply({ content: `✅ Panel AI sudah dikirim ke <#${target.id}>.` });
    } catch {
      await interaction.editReply({
        content: `❌ Gagal mengirim panel ke <#${target.id}>. Pastikan bot punya izin **Send Messages** & **Embed Links** di sana.`,
      });
    }
  },
};
