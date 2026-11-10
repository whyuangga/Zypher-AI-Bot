import { SlashCommandBuilder } from 'discord.js';
import { answerSlashQuestion } from '../features/chat.js';
import { requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const tanyaCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tanya')
    .setDescription('Tanya AI cepat tanpa membuat room (jawaban hanya terlihat olehmu)')
    .addStringOption((option) =>
      option.setName('pertanyaan').setDescription('Apa yang ingin kamu tanyakan?').setRequired(true).setMaxLength(1500),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction))) return;
    const question = interaction.options.getString('pertanyaan', true);
    await answerSlashQuestion(interaction, question);
  },
};
