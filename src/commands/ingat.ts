import { SlashCommandBuilder } from 'discord.js';
import { addMemory, listMemories } from '../db/repo.js';
import { truncate } from '../lib/text.js';
import { replyEphemeral, requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const ingatCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ingat')
    .setDescription('Simpan hal penting tentang kamu supaya AI mengingatnya')
    .addStringOption((option) =>
      option
        .setName('fakta')
        .setDescription('Contoh: "Namaku Bagas, aku suka desain grafis dan tinggal di Bogor"')
        .setRequired(true)
        .setMaxLength(400),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const fakta = interaction.options.getString('fakta', true);
    const result = await addMemory(interaction.guildId, interaction.user.id, truncate(fakta, 400), 'manual');
    const total = (await listMemories(interaction.guildId, interaction.user.id, 500)).length;

    if (!result.inserted) {
      await replyEphemeral(interaction, `Aku sudah mengingat itu kok 😊\nTotal memori kamu: **${total}**.`);
      return;
    }

    await replyEphemeral(
      interaction,
      ['🧠 **Tersimpan!**', `> ${truncate(fakta, 400)}`, '', `Total memori kamu sekarang: **${total}**. Lihat dengan \`/memori\`.`].join(
        '\n',
      ),
    );
  },
};
