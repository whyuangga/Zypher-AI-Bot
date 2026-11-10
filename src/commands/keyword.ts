import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { addKeyword, deleteKeyword, listKeywords } from '../db/repo.js';
import { BRAND_COLOR } from '../features/ui.js';
import { truncate } from '../lib/text.js';
import { replyEphemeral, requireAdmin, requireGuild } from './helpers.js';
import type { Command } from './types.js';

export const keywordCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('keyword')
    .setDescription('Kelola jawaban acuan yang divariasikan oleh AI (admin)')
    .addSubcommand((sub) =>
      sub
        .setName('tambah')
        .setDescription('Tambah jawaban acuan baru')
        .addStringOption((option) =>
          option
            .setName('trigger')
            .setDescription('Pemicu/pertanyaan acuan, mis. "server ini apa"')
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((option) =>
          option
            .setName('jawaban')
            .setDescription('Isi jawaban acuan. AI akan memvariasikan bahasanya.')
            .setRequired(true)
            .setMaxLength(1000),
        ),
    )
    .addSubcommand((sub) => sub.setName('daftar').setDescription('Lihat semua keyword yang tersimpan'))
    .addSubcommand((sub) =>
      sub
        .setName('hapus')
        .setDescription('Hapus keyword berdasarkan id')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Id keyword (lihat di /keyword daftar)').setRequired(true).setMinValue(1),
        ),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'daftar') {
      if (!(await requireAdmin(interaction))) return;

      const keywords = await listKeywords(interaction.guildId, 100);
      if (keywords.length === 0) {
        await replyEphemeral(
          interaction,
          'Belum ada keyword. Tambah dengan:\n`/keyword tambah trigger:"server ini apa" jawaban:"Komunitas Akademi Discord..."`',
        );
        return;
      }

      const lines = keywords
        .slice()
        .map(
          (keyword) =>
            `**#${keyword.id} — ${keyword.trigger}**\n> ${truncate(keyword.answer.replace(/\n/g, ' '), 220)}`,
        )
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`🔑 Keyword server — ${keywords.length}`)
        .setDescription(lines.length > 4000 ? `${lines.slice(0, 3990)}…` : lines)
        .setFooter({ text: 'Hapus dengan /keyword hapus id:<nomor>' });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (!(await requireAdmin(interaction))) return;

    if (subcommand === 'tambah') {
      const trigger = interaction.options.getString('trigger', true);
      const answer = interaction.options.getString('jawaban', true);

      const result = await addKeyword(interaction.guildId, trigger, answer, interaction.user.id);

      if (!result.ok) {
        await replyEphemeral(
          interaction,
          result.reason === 'duplicate'
            ? `Keyword \`${trigger.toLowerCase()}\` sudah ada. Hapus dulu dengan \`/keyword hapus\` kalau mau mengubahnya.`
            : 'Trigger dan jawaban tidak boleh kosong.',
        );
        return;
      }

      await replyEphemeral(
        interaction,
        [
          `✅ Keyword **#${result.id}** tersimpan.`,
          `> **Trigger:** ${trigger}`,
          `> **Jawaban acuan:** ${truncate(answer, 300)}`,
          '',
          'AI akan memakai isi ini sebagai fakta, lalu menyusun ulang kalimatnya dengan variasi berbeda setiap kali menjawab.',
        ].join('\n'),
      );
      return;
    }

    if (subcommand === 'hapus') {
      const id = interaction.options.getInteger('id', true);
      const removed = await deleteKeyword(interaction.guildId, id);
      await replyEphemeral(
        interaction,
        removed ? `🗑️ Keyword #${id} dihapus.` : `Tidak ada keyword #${id}. Cek \`/keyword daftar\`.`,
      );
    }
  },
};
