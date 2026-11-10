import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { dmPanelRow, panelEmbedDm } from './dm.js';

export const BRAND_COLOR = 0x6d8cff;
export const DANGER_COLOR = 0xff6b6b;

export function panelEmbed(botName = 'Zypher AI'): EmbedBuilder {
  return panelEmbedDm(botName);
}

export function panelRow(): ActionRowBuilder<ButtonBuilder> {
  return dmPanelRow();
}

export function helpEmbed(botName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📖 Panduan ${botName}`)
    .setDescription(
      'Bot AI dengan **chat privat lewat DM**, memori jangka panjang, dokumen rujukan (RAG), dan jawaban kustom dari admin.',
    )
    .addFields(
      {
        name: '💬 Chat privat (DM)',
        value: [
          '`/panel` — kirim panel tombol **Chat via DM** *(admin)*',
          'Klik **Chat via DM** di panel → bot mengirim DM ke kamu',
          'Tanya apa saja di DM — tidak bisa dibaca admin server',
          '`/reset` — lupakan obrolan sebelumnya, mulai topik baru (sesi tetap aktif)',
          '`/akhiri` — tutup sesi & terima transkrip percakapan',
          '',
          '**`/reset` vs `/akhiri`**',
          '> `/reset` = bot lupa obrolan lama, kamu tetap bisa lanjut bertanya.',
          '> `/akhiri` = sesi ditutup, transkrip dikirim, riwayat dihapus.',
        ].join('\n'),
      },
      {
        name: '🧠 Memori',
        value: [
          '`/ingat fakta:<teks>` — simpan fakta tentang kamu',
          '`/memori` — lihat daftar memori',
          '`/lupakan id:<nomor>` — hapus satu memori',
          '`/lupakan semua:true` — hapus semua memori',
          '`/konsolidasi` — gabungkan duplikat dengan AI',
        ].join('\n'),
      },
      {
        name: '📚 Dokumen (RAG)',
        value: [
          '`/dokumen tambah file:<lampiran>` — jadikan dokumen pengetahuan AI *(admin)*',
          '`/dokumen daftar` · `/dokumen hapus id:<nomor>` *(admin)*',
          '`/dokumen cari pertanyaan:<teks>` — cek potongan yang dipakai AI',
          'Format: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.pdf`, `.docx`.',
        ].join('\n'),
      },
      {
        name: '⚙️ Pengaturan *(admin)*',
        value: [
          '`/keyword tambah|daftar|hapus` — jawaban acuan yang divariasikan AI',
          '`/persona set|lihat|hapus` — atur peran AI',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Percakapan DM tidak bisa dibaca admin server.' });
}
