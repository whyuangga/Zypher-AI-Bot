import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BRAND_COLOR } from '../features/ui.js';
import { DocumentError, ingestDocument, listGuildDocuments, removeDocument, searchKnowledge } from '../features/rag.js';
import { errorMessage, logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { replyEphemeral, requireAdmin, requireGuild } from './helpers.js';
import type { Command } from './types.js';

/** Batas ukuran file yang mau diunduh (byte). Sisanya jelas ditolak. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} karakter`;
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)} ribu karakter`;
  return `${(chars / 1_000_000).toFixed(2)} juta karakter`;
}

export const dokumenCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('dokumen')
    .setDescription('Kelola dokumen pengetahuan server untuk AI (RAG)')
    .addSubcommand((sub) =>
      sub
        .setName('tambah')
        .setDescription('Upload dokumen (.txt/.md/.csv/.json/.pdf/.docx) sebagai pengetahuan AI')
        .addAttachmentOption((option) =>
          option.setName('file').setDescription('File teks yang mau dijadikan rujukan AI').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('nama')
            .setDescription('Nama dokumen (default: nama file). Nama sama = mengganti versi lama.')
            .setRequired(false)
            .setMaxLength(120),
        ),
    )
    .addSubcommand((sub) => sub.setName('daftar').setDescription('Lihat semua dokumen pengetahuan server'))
    .addSubcommand((sub) =>
      sub
        .setName('hapus')
        .setDescription('Hapus dokumen dari pengetahuan AI')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Id dokumen (lihat /dokumen daftar)').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cari')
        .setDescription('Uji pencarian: lihat potongan dokumen yang akan dipakai AI')
        .addStringOption((option) =>
          option.setName('pertanyaan').setDescription('Pertanyaan untuk diuji').setRequired(true).setMaxLength(300),
        ),
    ),

  async execute(interaction) {
    if (!(await requireGuild(interaction)) || !interaction.guildId) return;

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'cari') {
      const question = interaction.options.getString('pertanyaan', true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const results = await searchKnowledge(interaction.guildId, question, { topK: 3 });

      if (results.length === 0) {
        await interaction.editReply({
          content:
            'Tidak ada dokumen yang cocok. Pastikan sudah upload dengan `/dokumen tambah` dan pertanyaannya memakai kata yang ada di dokumen.',
        });
        return;
      }

      const lines = results.map(
        (result, index) =>
          `**${index + 1}. ${result.documentName}** — bagian ${result.ordinal + 1} · skor ${result.score.toFixed(
            2,
          )} (${result.via})\n> ${truncate(result.content.replace(/\n/g, ' '), 320)}`,
      );

      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🔎 Hasil pencarian dokumen')
        .setDescription(truncate(lines.join('\n\n'), 3800))
        .setFooter({ text: 'Potongan inilah yang diselipkan ke prompt AI saat menjawab' });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (!(await requireAdmin(interaction))) return;

    if (subcommand === 'daftar') {
      const documents = await listGuildDocuments(interaction.guildId);

      if (documents.length === 0) {
        await replyEphemeral(
          interaction,
          [
            'Belum ada dokumen. Upload file teks dengan:',
            '`/dokumen tambah file:<lampiran>`',
            '',
            'Format yang didukung: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.log`, `.pdf`, `.docx`.',
            'AI akan menjawab berdasarkan isi dokumen ini, lengkap dengan nama sumbernya.',
          ].join('\n'),
        );
        return;
      }

      const lines = documents.map(
        (document) =>
          `**#${document.id} — ${document.name}**\n> ${document.chunkCount} potongan · ${formatSize(
            document.chars,
          )} · ${new Date(document.createdAt).toLocaleDateString('id-ID')}`,
      );

      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`📚 Dokumen pengetahuan — ${documents.length}`)
        .setDescription(truncate(lines.join('\n\n'), 3800))
        .setFooter({ text: 'Hapus dengan /dokumen hapus id:<nomor>' });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === 'hapus') {
      const id = interaction.options.getInteger('id', true);
      const removed = await removeDocument(interaction.guildId, id);
      await replyEphemeral(
        interaction,
        removed ? `🗑️ Dokumen #${id} dihapus dari pengetahuan AI.` : `Tidak ada dokumen #${id}. Cek \`/dokumen daftar\`.`,
      );
      return;
    }

    // ---------- tambah ----------
    const attachment = interaction.options.getAttachment('file', true);
    const name = interaction.options.getString('nama') ?? attachment.name;

    if (attachment.size > MAX_UPLOAD_BYTES) {
      await replyEphemeral(
        interaction,
        `File terlalu besar (${(attachment.size / 1024 / 1024).toFixed(1)} MB). Batas upload ${MAX_UPLOAD_BYTES / 1024 / 1024} MB — pecah dulu dokumennya.`,
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) throw new DocumentError(`Gagal mengunduh lampiran (HTTP ${response.status}).`);

      const buffer = new Uint8Array(await response.arrayBuffer());
      const result = await ingestDocument({
        guildId: interaction.guildId,
        name,
        content: buffer,
        createdBy: interaction.user.id,
        source: 'discord',
      });

      await interaction.editReply({
        content: [
          `✅ **${result.document.name}** tersimpan sebagai pengetahuan AI.`,
          `> ${result.chunkCount} potongan · ${formatSize(result.document.chars)}`,
          `> Pencarian: ${result.embedded ? 'hybrid (leksikal + vektor)' : 'leksikal (BM25, tanpa API tambahan)'}`,
          '',
          'Sekarang tanyakan sesuatu lewat chat DM ke bot — kalau relevan, AI menjawab dari dokumen ini dan menyebut sumbernya.',
          `Uji dulu dengan \`/dokumen cari pertanyaan:...\`.`,
        ].join('\n'),
      });
    } catch (error) {
      const message = error instanceof DocumentError ? error.message : errorMessage(error).slice(0, 300);
      logger.warn(`Gagal menambah dokumen: ${message}`);
      await interaction.editReply({ content: `⚠️ ${message}` });
    }
  },
};
