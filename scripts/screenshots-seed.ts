/**
 * Isi database dengan data demo untuk mengambil screenshot dokumentasi.
 *
 * PENTING: data demo ini **tidak memuat** isi percakapan, memori member,
 * atau cuplikan pesan member — sesuai janji privasi di README. Yang diisi
 * hanya angka, nama dokumen, keyword template, dan log moderasi tanpa isi
 * pesan (kolom `content` sudah tidak ada di tabel `mod_logs`).
 *
 * Pakai database terpisah supaya data asli tidak tersentuh:
 *
 *   DATABASE_PATH=./data/screenshot.db npm run screenshots:seed
 *
 * Jangan pernah menjalankan ini di database produksi.
 */
import 'dotenv/config';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.DATABASE_PATH ?? './data/screenshot.db';

if (!dbPath.includes('screenshot')) {
  console.error(
    `Menolak jalan: DATABASE_PATH="${dbPath}" bukan database demo.\n` +
      'Pakai nama yang memuat kata "screenshot", misal ./data/screenshot.db',
  );
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
rmSync(dbPath, { force: true });

process.env.DASHBOARD_TOKEN ??= 'screenshot-token-0000';
process.env.DISCORD_TOKEN ??= 'screenshot-standalone-token';
process.env.CLIENT_ID ??= '123456789012345678';
// GUILD_ID wajib: dashboard dan seed harus menunjuk server demo yang sama.
process.env.GUILD_ID ??= '156942477750257766';
process.env.AI_API_KEY ??= 'screenshot-key';

const { exec, run, insert } = await import('../src/db/index.js');
const { SCHEMA_SQLITE } = await import('../src/db/schema.js');

await exec(SCHEMA_SQLITE);

/** Server demo. ID-nya sengaja dibuat mirip ID asli Discord (18 digit). */
const GUILD = '156942477750257766';
const GUILD_NAME = 'Komunitas Zypher';

const now = Date.now();
const hour = 3_600_000;
const day = 24 * hour;

await run(
  `INSERT INTO guilds (guild_id, name, persona, model, rag_enabled, vision_enabled, auto_memory, admin_only_rooms, tts_reply_in_room, created_at)
   VALUES (?, ?, ?, ?, 1, 0, 1, 0, 0, ?)`,
  [
    GUILD,
    GUILD_NAME,
    'Kamu asisten santai. Jawab singkat, ramah, dan pakai bahasa Indonesia.',
    'openai/gpt-oss-120b',
    now - 30 * day,
  ],
);

// ---- Sesi DM (angka saja, tanpa isi percakapan) ----
// Nilai ketiga = berapa lama lalu sesi terakhir aktif, dihitung dari `now`.
const sessions: Array<[string, number, number]> = [
  ['900000000000000001', 30, 1 * hour],
  ['900000000000000002', 29, 2 * hour],
  ['900000000000000003', 25, 3 * hour],
];
for (const [userId, count, ago] of sessions) {
  const lastActive = now - ago;
  await run(
    `INSERT INTO dm_sessions (user_id, guild_id, created_at, last_active_at, message_count)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, GUILD, lastActive - 2 * day, lastActive, count],
  );
  // Riwayat pesan dibutuhkan statistik 7 hari; isinya penanda netral,
  // bukan pertanyaan asli member. Pesan disebar ke beberapa hari terakhir
  // (dengan pola tetap, bukan acak) supaya grafik aktivitas terlihat wajar.
  const perDay = [3, 6, 4, 8, 5, 7]; // hari ke-6 s/d hari ke-1 lalu
  let cursor = 0;
  for (let d = 0; d < perDay.length; d += 1) {
    for (let n = 0; n < perDay[d] && cursor < count; n += 1, cursor += 1) {
      const isUser = cursor % 2 === 0;
      await run(
        `INSERT INTO messages (channel_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
        [
          `dm:${userId}`,
          isUser ? 'user' : 'assistant',
          isUser ? '[pertanyaan member]' : '[jawaban AI]',
          now - (perDay.length - d) * day + n * 7 * 60_000,
        ],
      );
    }
  }
  // Sisanya di hari ini, mendekati `lastActive`.
  for (; cursor < count; cursor += 1) {
    const isUser = cursor % 2 === 0;
    await run(
      `INSERT INTO messages (channel_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
      [
        `dm:${userId}`,
        isUser ? 'user' : 'assistant',
        isUser ? '[pertanyaan member]' : '[jawaban AI]',
        lastActive - (count - cursor) * 60_000,
      ],
    );
  }
}

// ---- Dokumen RAG ----
const docs: Array<[string, string, number, number, number]> = [
  ['kebijakan-server.pdf', 'upload', 4800, 1, 41 * 60_000],
  ['panduan-event.docx', 'upload', 8800, 1, 41 * 60_000],
  ['panduan-event.md', 'dashboard', 6400, 9, 3 * day],
  ['aturan-server.txt', 'dashboard', 1800, 3, 2 * day],
  ['faq-komunitas.md', 'dashboard', 4200, 6, 1 * day],
];
for (const [name, source, chars, chunks, ago] of docs) {
  const id = await insert(
    `INSERT INTO documents (guild_id, name, source, chars, chunk_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [GUILD, name, source, chars, chunks, now - ago],
  );
  for (let i = 0; i < chunks; i += 1) {
    await run(
      `INSERT INTO chunks (document_id, guild_id, ordinal, content) VALUES (?, ?, ?, ?)`,
      [id, GUILD, i, `Potongan ${i + 1} dari ${name}.`],
    );
  }
}

// ---- Keyword ----
const keywords: Array<[string, string, number]> = [
  [
    'cara jadi member',
    'Klik tombol Gabung di #selamat-datang.',
    1 * day,
  ],
  [
    'aturan utama',
    'Saling menghormati, tanpa spam, dan konten aman untuk semua umur.',
    4 * day,
  ],
  [
    'cara klaim role',
    'Buka #pilih-role, klik tombol sesuai minatmu. Bisa diubah kapan saja.',
    3 * day,
  ],
  [
    'harga premium',
    'Premium Rp25.000/bulan, aktifkan lewat #toko. Bisa bayar via QRIS atau e-wallet.',
    2 * day,
  ],
  [
    'jam buka',
    'Server aktif setiap hari 08.00–22.00 WIB. Di luar jam itu, balasan admin mungkin lebih lambat.',
    1 * day,
  ],
];
for (const [trigger, answer, ago] of keywords) {
  await run(
    `INSERT INTO keywords (guild_id, trigger, answer, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [GUILD, trigger, answer, 'admin', now - ago],
  );
}

// ---- Moderasi: kata + tindakan saja, TANPA cuplikan pesan ----
await run(
  `INSERT INTO moderation (guild_id, enabled, words, action, timeout_minutes, updated_at)
   VALUES (?, 1, ?, 'timeout', 30, ?)`,
  [GUILD, 'anjing, bangsat, penipuan online, spam link', now - 2 * hour],
);

const logs: Array<[string, string, string, string, number]> = [
  ['Rina', '140000000000000002', 'bangsat', 'timeout', 3 * hour],
  ['Dimas', '140000000000000003', 'penipuan online', 'delete', 12 * hour],
  ['Sari', '140000000000000004', 'anjing', 'warn', 1 * day],
  ['Yoga', '140000000000000005', 'bangsat', 'delete', 2 * day],
];
for (const [userName, userId, matched, action, ago] of logs) {
  await run(
    `INSERT INTO mod_logs (guild_id, channel_id, user_id, user_name, matched, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [GUILD, '130000000000000001', userId, userName, matched, action, now - ago],
  );
}

// ---- Panel ----
await run(
  `INSERT INTO panels (guild_id, channel_id, message_id, enabled, updated_at)
   VALUES (?, ?, ?, 1, ?)`,
  [GUILD, '130000000000000001', '150000000000000001', now - 5 * hour],
);

// ---- Sambutan & AI Agent (contoh pengaturan, bukan data member) ----
await run(
  `INSERT INTO welcome (guild_id, channel_id, enabled, use_ai, template, image_enabled, style, example, include_avatar, updated_at)
   VALUES (?, NULL, 1, 1, ?, 1, ?, ?, 1, ?)`,
  [GUILD, 'Halo {user}, selamat datang di {server}!', 'hangat, santai, sedikit bercanda', 'Pagi Sky! Ngapain aja hari ini?', now - 2 * day],
);
await run(
  `INSERT INTO goodbye (guild_id, channel_id, enabled, use_ai, template, style, example, updated_at)
   VALUES (?, ?, 1, 1, ?, ?, ?, ?)`,
  [GUILD, '130000000000000005', '{user} sudah keluar dari **{server}**. Semoga lancar!', 'sopan, hangat, singkat', 'Semoga urusannya lancar ya.', now - 2 * day],
);
await run(
  `INSERT INTO agent (guild_id, channel_id, gallery_channel_id, quiet_minutes, max_per_hour, react_emoji, react_images, busy_mute, cooldown_seconds, updated_at)
   VALUES (?, ?, ?, 45, 6, 1, 1, 1, 90, ?)`,
  [GUILD, '130000000000000009', '130000000000000010', now - 2 * day],
);

console.log(`Data demo siap di ${dbPath}`);
console.log('  server   : ' + GUILD_NAME + ' (' + GUILD + ')');
console.log('  sesi DM  : ' + sessions.length);
console.log('  dokumen  : ' + docs.length);
console.log('  keyword  : ' + keywords.length);
console.log('  log mod  : ' + logs.length + ' (tanpa isi pesan)');
