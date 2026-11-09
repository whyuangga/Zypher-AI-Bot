import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { helpEmbed } from '../features/ui.js';
import type { Command } from './types.js';

export const bantuanCommand: Command = {
  data: new SlashCommandBuilder().setName('bantuan').setDescription('Lihat panduan penggunaan bot'),

  async execute(interaction) {
    await interaction.reply({
      embeds: [helpEmbed(interaction.client.user?.username ?? 'Zypher AI')],
      flags: MessageFlags.Ephemeral,
    });
  },
};
