import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export const BRAND_COLOR = 0x6d8cff;
export const DANGER_COLOR = 0xff6b6b;

export function panelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🤖 Zypher AI — Ruang Privat')
    .setDescription(
      [
        'Butuh ngobrol sama AI tanpa dilihat orang lain? Klik tombol di bawah.',
        '',
        '**Cara kerjanya**',
        '> 1. Klik **Buat Room AI** — bot membuat **private thread** khusus kamu.',
        '> 2. Tanya apa saja di thread itu, AI langsung menjawab.',
        '> 3. AI mengingat hal penting tentang kamu (`/ingat` untuk menambah manual).',
        '> 4. Klik **Akhiri Sesi** — transkrip percakapan dikirim ke DM kamu, thread dihapus.',
        '',
        'Room hanya bisa dilihat oleh kamu. Staff server tidak otomatis bisa membacanya.',
        '-# Pemilik server dan admin dengan izin Administrator tetap bisa melihat semua private thread — itu batas Discord.',
      ].join('\n'),
    )
    .setFooter({ text: 'Satu room per member • Hanya kamu yang diundang' });
}

export function panelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('room:create').setLabel('Buat Room AI').setEmoji('🤖').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('room:help').setLabel('Cara Kerja').setEmoji('❓').setStyle(ButtonStyle.Secondary),
  );
}

export function roomWelcomeEmbed(userId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Room AI kamu sudah siap ✨')
    .setDescription(
      [
        `Halo <@${userId}>, semua yang kamu tulis di sini hanya dibaca oleh AI, kamu, dan staff.`,
        '',
        '**Contoh yang bisa kamu coba**',
        '> "Halo, kamu siapa?"',
        '> "Tolong jelaskan aturan server ini"',
        '> "Ajarin aku bahasa Inggris dasar dong"',
        '',
        '**Perintah berguna**',
        '> `/ingat` — tambah memori tentang kamu',
        '> `/memori` — lihat apa yang AI ingat',
        '> `/reset` — hapus riwayat, mulai topik baru',
        '> `/bantuan` — panduan lengkap',
        '',
        'Kalau sudah selesai, klik tombol **Akhiri Sesi** di bawah. Transkrip akan dikirim ke DM kamu.',
      ].join('\n'),
    )
    .setFooter({ text: 'Zypher AI • private thread' });
}

export function roomControlsRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('room:end').setLabel('Akhiri Sesi').setEmoji('🏁').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('room:help').setLabel('Bantuan').setEmoji('❓').setStyle(ButtonStyle.Secondary),
  );
}

export function endConfirmRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('room:end:confirm')
      .setLabel('Ya, akhiri & unduh transkrip')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('room:end:cancel').setLabel('Batal').setStyle(ButtonStyle.Secondary),
  );
}

export function helpEmbed(botName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📖 Panduan ${botName}`)
    .setDescription('Bot AI dengan room privat, memori jangka panjang, dokumen rujukan (RAG), dan jawaban kustom dari admin.')
    .addFields(
      {
        name: '🤖 Room AI',
        value: [
          '`/panel` — kirim panel tombol pembuat room *(admin)*',
          'Klik **Buat Room AI** di panel → private thread dibuat',
          'Klik **Akhiri Sesi** → transkrip HTML dikirim ke DM, thread dihapus',
        ].join('\n'),
      },
      {
        name: '🧠 Memori',
        value: [
          '`/ingat fakta:<teks>` — simpan fakta tentang kamu',
          '`/memori` — lihat daftar memori',
          '`/lupakan id:<nomor>` — hapus satu memori',
          '`/lupakan semua:true` — hapus semua memori',
        ].join('\n'),
      },
      {
        name: '💬 Percakapan',
        value: [
          '`/reset` — hapus riwayat chat di room ini',
          '`/tanya pertanyaan:<teks>` — tanya AI cepat tanpa room',
          'Kirim gambar di room AI → AI membacanya *(butuh vision aktif)*',
          'Kirim voice note di room AI → AI transkrip & jawab dengan suara',
          '`/ucap teks:<teks>` — ubah teks jadi pesan suara',
        ].join('\n'),
      },
      {
        name: '📚 Dokumen (RAG)',
        value: [
          '`/dokumen tambah file:<lampiran>` — jadikan dokumen sebagai pengetahuan AI *(admin)*',
          '`/dokumen daftar` · `/dokumen hapus id:<nomor>` *(admin)*',
          '`/dokumen cari pertanyaan:<teks>` — cek potongan yang akan dipakai AI',
          'Format: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.pdf`, `.docx`. AI menyebut sumbernya saat menjawab.',
        ].join('\n'),
      },
      {
        name: '⚙️ Pengaturan *(admin)*',
        value: [
          '`/keyword tambah|daftar|hapus` — jawaban acuan yang jawabannya divariasikan AI',
          '`/persona set|lihat|hapus` — atur peran AI (mis. guru bahasa Inggris)',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Butuh bantuan? Hubungi staff server.' });
}
