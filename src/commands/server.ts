import { SlashCommandBuilder } from 'discord.js';
import {
  dmServerPickerEmbed,
  dmServerPickerRow,
  chooseContextGuild,
  listGuildChoices,
} from '../features/dm.js';
import { getDmSession } from '../db/repo.js';
import { dmCapable, type Command } from './types.js';

/**
 * `/server` — pilih server konteks untuk percakapan DM.
 *
 * Dipakai di DM. Konteks menentukan persona AI, dokumen rujukan, dan memori
 * mana yang dipakai. Bisa juga dipakai di server untuk memindahkan sesi DM
 * ke server itu.
 */
export const serverCommand: Command = {
  data: dmCapable(
    new SlashCommandBuilder()
      .setName('server')
      .setDescription('Pilih server konteks AI (persona/dokumen/memori) — tidak membuat channel')
      .addStringOption((option) =>
        option.setName('nama').setDescription('Nama server (opsional, kalau ingin langsung memilih)'),
    ),
  ),

  async execute(interaction) {
    const choices = await listGuildChoices(interaction.client, interaction.user.id);

    if (choices.length === 0) {
      await interaction.reply({
        content: 'Kamu belum terdaftar di server mana pun yang memakai bot ini.',
      });
      return;
    }

    const wanted = interaction.options.getString('nama')?.trim().toLowerCase();
    const session = await getDmSession(interaction.user.id);

    // Pilihan langsung lewat nama.
    if (wanted) {
      const match = choices.find((choice) => choice.name.toLowerCase() === wanted) ??
        choices.find((choice) => choice.name.toLowerCase().includes(wanted));

      if (!match) {
        await interaction.reply({
          content: `Server "${wanted}" tidak ditemukan. Pilihanmu:\n${choices.map((c) => `> ${c.name}`).join('\n')}`,
        });
        return;
      }

      await chooseContextGuild(interaction.user.id, match.id);
      await interaction.reply({
        content: `✅ Konteks sekarang memakai **${match.name}**. Lanjutkan tanya jawab di DM ya.`,
      });
      return;
    }

    // Hanya satu server: langsung pilih.
    if (choices.length === 1) {
      const only = choices[0]!;
      await chooseContextGuild(interaction.user.id, only.id);
      await interaction.reply({ content: `✅ Konteks memakai **${only.name}**.` });
      return;
    }

    await interaction.reply({
      embeds: [dmServerPickerEmbed(choices, session)],
      components: [dmServerPickerRow(choices)],
    });
  },
};
