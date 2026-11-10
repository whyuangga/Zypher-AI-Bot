import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getGuildSettings, setPersona } from '../db/repo.js';
import { truncate } from '../lib/text.js';
import { replyEphemeral, requireAdmin, requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const personaCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Atur peran/kepribadian AI di server ini (admin)')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Tentukan peran AI, mis. "kamu guru bahasa Inggris yang sabar"')
        .addStringOption((option) =>
          option
            .setName('teks')
            .setDescription('Deskripsi peran & gaya bicara AI')
            .setRequired(true)
            .setMaxLength(1500),
        ),
    )
    .addSubcommand((sub) => sub.setName('lihat').setDescription('Lihat persona yang aktif sekarang'))
    .addSubcommand((sub) => sub.setName('hapus').setDescription('Kembali ke persona default')),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const subcommand = interaction.options.getSubcommand(true);
    const settings = await getGuildSettings(interaction.guildId);

    if (subcommand === 'lihat') {
      if (!(await requireAdmin(interaction))) return;
      await replyEphemeral(
        interaction,
        settings?.persona
          ? `🎭 **Persona aktif:**\n> ${settings.persona.replace(/\n/g, '\n> ')}`
          : 'Belum ada persona khusus — AI memakai gaya default (asisten ramah & ringkas).',
      );
      return;
    }

    if (!(await requireAdmin(interaction))) return;

    if (subcommand === 'hapus') {
      await setPersona(interaction.guildId, null);
      await replyEphemeral(interaction, '✅ Persona dihapus. AI kembali ke gaya default.');
      return;
    }

    if (subcommand === 'set') {
      const teks = interaction.options.getString('teks', true).trim();
      await setPersona(interaction.guildId, teks);
      await interaction.reply({
        content: ['✅ Persona disimpan.', `> ${truncate(teks, 600).replace(/\n/g, '\n> ')}`, '', 'Berlaku untuk semua room AI di server ini.'].join(
          '\n',
        ),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
