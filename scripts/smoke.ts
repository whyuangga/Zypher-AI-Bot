/**
 * Smoke test tanpa koneksi Discord / tanpa API key asli.
 * Menguji logika inti: database, memori, keyword, prompt, transkrip, chunking.
 *
 * Jalankan: npm run smoke
 */
process.env.DISCORD_TOKEN = 'smoke-test-token-0000000000000000';
process.env.CLIENT_ID = '123456789012345678';
process.env.AI_API_KEY = 'smoke-test-key-0000';
process.env.DATABASE_PATH = ':memory:';
process.env.AI_FALLBACKS = 'gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free';
process.env.GEMINI_API_KEY = 'smoke-gemini-key';

import assert from 'node:assert/strict';

const { addMemory, listMemories, deleteMemory, clearMemories, addKeyword, listKeywords, deleteKeyword } = await import(
  '../src/db/repo.js'
);
const { createRoom, getRoomByChannel, getRoomByUser, appendMessage, getHistory, clearHistory, deleteRoom, touchRoom } =
  await import('../src/db/repo.js');
const { setPersona, getGuildSettings } = await import('../src/db/repo.js');
const { listGuilds, countGuildRows, countGuildMessages, listMemoryOwners, listGuildMemories, messagesPerDay } =
  await import('../src/db/repo.js');
const { insertTranscript, listTranscripts, getTranscript, deleteTranscript, countTranscripts } = await import(
  '../src/db/repo.js'
);
const { setGuildName, getPanel, setPanelMessage, setPanelEnabled } = await import('../src/db/repo.js');
const { ringkasanPage, keywordPage, memoriPage, transkripPage, moderasiPage, panelPage } = await import(
  '../src/web/ui/pages.js'
);
const {
  setModerationSettings,
  getModerationSettings,
  addModerationLog,
  listModerationLogs,
  deleteModerationLog,
  clearModerationLogs,
  countModerationLogs,
} = await import('../src/db/repo.js');
const { findBannedWords } = await import('../src/features/moderation.js');
const { isImageAttachment, mimeForAttachment, toDataUri, visionUserContent } = await import(
  '../src/features/vision.js'
);
const { isAudioAttachment } = await import('../src/lib/audio.js');
const { hashGuildId, shardInfo, ownsGuild } = await import('../src/lib/shard.js');
const { zipSync, strToU8 } = await import('fflate');
const { parseLoginLink } = await import('../src/web/login-link.js');
const { matchKeywords } = await import('../src/features/keywords.js');
const { buildSystemPrompt } = await import('../src/features/prompt.js');
const { buildTranscriptHtml, transcriptFileName } = await import('../src/lib/transcript.js');
const { chunkMessage, truncate, normalize } = await import('../src/lib/text.js');
const { detectLanguage } = await import('../src/lib/language.js');
const { parseConsolidatedMemories } = await import('../src/features/memory.js');
const { invalidateIndex } = await import('../src/features/rag.js');
const { checkRateLimit } = await import('../src/lib/ratelimit.js');
const { parseFallbackSpec, providerNameForBaseUrl, buildProviderChain } = await import('../src/lib/providers.js');
const { chunkText, extractText, extractFileText, htmlToText, DocumentError } = await import('../src/lib/chunker.js');
const { Bm25Index, tokenize, stem, cosineSimilarity } = await import('../src/lib/lexical.js');
const {
  ingestDocument,
  searchKnowledge,
  removeDocument,
  listGuildDocuments,
  buildKnowledgeBlock,
  summarizeSources,
} = await import('../src/features/rag.js');

let passed = 0;
async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const GUILD = '111111111111111111';
const USER = '222222222222222222';
const CHANNEL = '333333333333333333';

console.log('\n🧪 Zypher AI Bot — smoke test\n');

console.log('Memori');
await testAsync('menyimpan fakta baru', async () => {
  const result = await addMemory(GUILD, USER, 'Namanya Bagas, desainer grafis di Bogor.');
  assert.equal(result.inserted, true);
  assert.equal((await listMemories(GUILD, USER)).length, 1);
});
await testAsync('mencegah duplikat', async () => {
  const result = await addMemory(GUILD, USER, 'Namanya Bagas, desainer grafis di Bogor.');
  assert.equal(result.inserted, false);
  assert.equal((await listMemories(GUILD, USER)).length, 1);
});
await testAsync('memisahkan memori antar user', async () => {
  await addMemory(GUILD, '999999999999999999', 'Suka kopi.');
  assert.equal((await listMemories(GUILD, USER)).length, 1);
});
await testAsync('menghapus satu memori', async () => {
  const [memory] = await listMemories(GUILD, USER);
  assert.ok(memory);
  assert.equal(await deleteMemory(GUILD, USER, memory.id), true);
  assert.equal((await listMemories(GUILD, USER)).length, 0);
});
await testAsync('menghapus semua memori', async () => {
  await addMemory(GUILD, USER, 'Satu.');
  await addMemory(GUILD, USER, 'Dua.');
  assert.equal(await clearMemories(GUILD, USER), 2);
});

console.log('\nKeyword');
await testAsync('menambah & mendeteksi duplikat trigger', async () => {
  const first = await addKeyword(GUILD, 'server ini apa', 'Komunitas Akademi Discord untuk belajar dan mabar.', USER);
  assert.equal(first.ok, true);
  const dup = await addKeyword(GUILD, 'Server Ini Apa', 'Duplikat.', USER);
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
});
await testAsync('mencocokkan pertanyaan dengan kalimat berbeda', async () => {
  const matches = await matchKeywords(GUILD, 'Halo kak, server ini apa ya?');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.trigger, 'server ini apa');
});
await testAsync('mencocokkan dengan kata yang dibalik', async () => {
  const matches = await matchKeywords(GUILD, 'ini server buat apa sih');
  assert.equal(matches.length, 1);
});
await testAsync('tidak mencocokkan pertanyaan tak relevan', async () => {
  assert.equal((await matchKeywords(GUILD, 'tolong buatkan puisi tentang hujan')).length, 0);
});
await testAsync('daftar & hapus keyword', async () => {
  const [keyword] = await listKeywords(GUILD);
  assert.ok(keyword);
  assert.equal(await deleteKeyword(GUILD, keyword.id), true);
  assert.equal((await listKeywords(GUILD)).length, 0);
});

console.log('\nPrompt');
await testAsync('menyusun system prompt lengkap', async () => {
  await setPersona(GUILD, 'Kamu guru bahasa Inggris yang sabar.');
  await addMemory(GUILD, USER, 'Namanya Bagas.');
  await addKeyword(GUILD, 'jam mabar', 'Mabar setiap Jumat 20.00 WIB.', USER);

  const prompt = buildSystemPrompt({
    botName: 'Zypher',
    guildName: 'Akademi Discord',
    userName: 'Bagas',
    persona: (await getGuildSettings(GUILD))?.persona ?? null,
    memories: await listMemories(GUILD, USER),
    keywords: await listKeywords(GUILD),
    now: new Date('2026-11-09T10:00:00+07:00'),
  });

  assert.match(prompt, /Zypher/);
  assert.match(prompt, /Akademi Discord/);
  assert.match(prompt, /guru bahasa Inggris/);
  assert.match(prompt, /Namanya Bagas/);
  assert.match(prompt, /jam mabar/);
  assert.match(prompt, /variasikan|bervariasi|variasi/i);
});

console.log('\nKonsolidasi memori');
test('parseConsolidatedMemories: JSON array', () => {
  const result = parseConsolidatedMemories('["Namaku Bagas", "Bagas suka desain"]');
  assert.equal(result.length, 2);
  assert.equal(result[0], 'Namaku Bagas');
});
test('parseConsolidatedMemories: blok JSON dengan markdown', () => {
  const result = parseConsolidatedMemories('```json\n["fakta 1", "fakta 2"]\n```');
  assert.equal(result.length, 2);
  assert.equal(result[0], 'fakta 1');
});
test('parseConsolidatedMemories: fallback bullet list', () => {
  const result = parseConsolidatedMemories('- fakta satu\n- fakta dua\n- fakta tiga');
  assert.equal(result.length, 3);
  assert.equal(result[0], 'fakta satu');
});
test('parseConsolidatedMemories: membatasi maksimal 25', () => {
  const items = Array.from({ length: 40 }, (_, i) => `fakta ${i}`);
  const result = parseConsolidatedMemories(JSON.stringify(items));
  assert.equal(result.length, 25);
});
test('parseConsolidatedMemories: teks bebas jadi satu baris', () => {
  // Fallback bullet-list: teks tanpa bullet tetap ditangkap sebagai satu baris.
  const result = parseConsolidatedMemories('ini bukan JSON juga bukan bullet');
  assert.equal(result.length, 1);
  assert.equal(result[0], 'ini bukan JSON juga bukan bullet');
});

console.log('\nRoom & riwayat');
await testAsync('membuat room dan menemukannya kembali', async () => {
  await createRoom(CHANNEL, GUILD, USER);
  assert.equal((await getRoomByChannel(CHANNEL))?.userId, USER);
  assert.equal((await getRoomByUser(GUILD, USER))?.channelId, CHANNEL);
});
await testAsync('menyimpan & mengambil riwayat berurutan', async () => {
  await appendMessage(CHANNEL, 'user', 'Halo');
  await appendMessage(CHANNEL, 'assistant', 'Hai! Ada yang bisa dibantu?');
  await appendMessage(CHANNEL, 'user', 'Ajarin Inggris dong');
  await touchRoom(CHANNEL, 3);

  const history = await getHistory(CHANNEL, 2);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.content, 'Hai! Ada yang bisa dibantu?');
  assert.equal(history[1]?.role, 'user');
  assert.equal((await getRoomByChannel(CHANNEL))?.messageCount, 3);
});
await testAsync('reset tidak menghapus memori', async () => {
  await clearHistory(CHANNEL);
  assert.equal((await getHistory(CHANNEL, 10)).length, 0);
  assert.equal((await listMemories(GUILD, USER)).length, 1);
});
await testAsync('hapus room membersihkan data', async () => {
  await deleteRoom(CHANNEL);
  assert.equal(await getRoomByChannel(CHANNEL), null);
});

console.log('\nTranskrip');
test('meng-escape HTML berbahaya', () => {
  const html = buildTranscriptHtml({
    guildName: 'Server <script>alert(1)</script>',
    guildIconUrl: null,
    userName: 'Bagas',
    userTag: 'bagas#0001',
    channelName: 'ai-bagas',
    startedAt: new Date('2026-11-09T10:00:00+07:00'),
    endedAt: new Date('2026-11-09T10:30:00+07:00'),
    messages: [
      {
        authorName: 'Bagas',
        authorAvatarUrl: null,
        isBot: false,
        content: '<img src=x onerror=alert(1)> halo **dunia**',
        createdAt: new Date('2026-11-09T10:01:00+07:00'),
        attachments: [],
      },
      {
        authorName: 'Zypher',
        authorAvatarUrl: null,
        isBot: true,
        content: 'Halo! Ini `kode` dan\n> kutipan',
        createdAt: new Date('2026-11-09T10:02:00+07:00'),
        attachments: [],
      },
    ],
    memoryLines: ['Namanya Bagas.'],
    summary: 'User menyapa AI.',
  });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'script tag harus di-escape');
  assert.ok(!html.includes('<img src=x'), 'tag mentah harus di-escape');
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /<strong>dunia<\/strong>/);
  assert.match(html, /<code>kode<\/code>/);
  assert.match(html, /Namanya Bagas/);
  assert.match(html, /Ringkasan Sesi/);
});
test('nama file transkrip aman', () => {
  const name = transcriptFileName('Bagas /../ Prasetyo', new Date('2026-11-09T10:30:00Z'));
  assert.match(name, /^transkrip-bagas-prasetyo-[\d-]+\.html$/);
});

console.log('\nDashboard & daftar server');
await testAsync('server yang hanya punya data tetap muncul di daftar server', async () => {
  // Kasus nyata: room sudah ada, tapi tabel `guilds` belum pernah terisi.
  // Dashboard dulu menampilkan "(belum ada server)" dan semua panel kosong.
  const dataOnlyGuild = '444444444444444444';
  await addKeyword(dataOnlyGuild, 'jam buka', 'Setiap hari 08.00–22.00 WIB.', USER);
  assert.ok(
    (await listGuilds()).some((guild) => guild.id === dataOnlyGuild),
    'guild dengan data harus ikut terdaftar',
  );
});
await testAsync('createRoom mendaftarkan server ke tabel guilds', async () => {
  const freshGuild = '555555555555555555';
  assert.equal(await getGuildSettings(freshGuild), null);
  await createRoom('666666666666666666', freshGuild, USER);
  assert.ok(await getGuildSettings(freshGuild), 'server harus punya baris guilds setelah room dibuat');
});
await testAsync('nama server tersimpan dan dipakai daftar server dashboard', async () => {
  const named = '1567780679515770900';
  await setGuildName(named, '  Server Uji  ');
  assert.equal((await getGuildSettings(named))?.name, 'Server Uji');

  const listed = (await listGuilds()).find((guild) => guild.id === named);
  assert.equal(listed?.name, 'Server Uji');

  // Server tanpa nama (database lama) tetap muncul, hanya namanya null.
  const unnamed = (await listGuilds()).find((guild) => guild.id === '555555555555555555');
  assert.equal(unnamed?.name, null);
});

await testAsync('panel: default aktif, simpan pesan, pindah channel, toggle', async () => {
  const guild = '121212121212121212';
  const initial = await getPanel(guild);
  assert.equal(initial.enabled, true, 'tanpa baris di tabel = panel aktif');
  assert.equal(initial.messageId, null);

  await setPanelMessage(guild, '1400000000000000001', '1500000000000000001');
  let state = await getPanel(guild);
  assert.equal(state.channelId, '1400000000000000001');
  assert.equal(state.messageId, '1500000000000000001');
  assert.equal(state.enabled, true, 'kirim panel tidak boleh mematikan tombolnya');

  // Pindah channel: satu baris per server, referensi pesan diganti (bukan ditambah).
  await setPanelMessage(guild, '1400000000000000002', '1500000000000000002');
  state = await getPanel(guild);
  assert.equal(state.channelId, '1400000000000000002');

  await setPanelEnabled(guild, false);
  state = await getPanel(guild);
  assert.equal(state.enabled, false);
  assert.equal(state.messageId, '1500000000000000002', 'mematikan panel tidak menghapus pesannya');

  await setPanelEnabled(guild, true);
  assert.equal((await getPanel(guild)).enabled, true);

  await setPanelMessage(guild, null, null);
  state = await getPanel(guild);
  assert.equal(state.messageId, null);
  assert.equal(state.enabled, true, 'enable/disable terpisah dari keberadaan pesan');
});

await testAsync('statistik dashboard dipisah per server', async () => {
  const guildA = '777777777777777777';
  const guildB = '888888888888888888';
  const channelA = '999999999999999991';

  await createRoom(channelA, guildA, USER);
  await appendMessage(channelA, 'user', 'Halo dari server A');

  assert.equal(await countGuildRows(guildA, 'rooms'), 1);
  assert.equal(await countGuildRows(guildB, 'rooms'), 0, 'server B tidak boleh ikut menghitung room A');
  assert.equal(await countGuildMessages(guildA), 1);
  assert.equal(await countGuildMessages(guildB), 0);
});

await testAsync('grafik aktivitas menghitung pesan 7 hari terakhir', async () => {
  const guildId = '121212121212121212';
  const channelId = '131313131313131313';
  await createRoom(channelId, guildId, USER);
  await appendMessage(channelId, 'user', 'Halo');
  await appendMessage(channelId, 'assistant', 'Hai');

  const series = await messagesPerDay(guildId, 7);
  assert.equal(series.length, 7, 'harus tepat 7 batang');
  assert.equal(series[6]?.count, 2, 'pesan hari ini masuk batang terakhir');
  assert.equal(series.reduce((sum, item) => sum + item.count, 0), 2);
});
await testAsync('memori dikelompokkan per user', async () => {
  const guildId = '141414141414141414';
  await addMemory(guildId, '151515151515151515', 'Fakta A');
  await addMemory(guildId, '151515151515151515', 'Fakta B');
  await addMemory(guildId, '161616161616161616', 'Fakta C');

  const owners = await listMemoryOwners(guildId);
  assert.equal(owners.length, 2);
  assert.equal(owners[0]?.count, 2, 'user dengan memori terbanyak di atas');
  assert.equal((await listGuildMemories(guildId)).length, 3);
});

console.log('\nLogin lewat link');
test('mengurai /masuk/<token>', () => {
  assert.deepEqual(parseLoginLink('/masuk/abc123'), { matched: true, token: 'abc123' });
  assert.deepEqual(parseLoginLink('/login/abc123'), { matched: true, token: 'abc123' });
});
test('token dengan karakter spesial di-decode', () => {
  assert.deepEqual(parseLoginLink('/masuk/a%2Bb%3D'), { matched: true, token: 'a+b=' });
  // base64 punya "/" — harus tetap terbaca utuh, bukan dianggap sub-path
  assert.deepEqual(parseLoginLink('/masuk/ab/cd=='), { matched: true, token: 'ab/cd==' });
});
test('link tanpa token dan path lain tidak dianggap login link', () => {
  assert.deepEqual(parseLoginLink('/masuk'), { matched: true, token: null });
  assert.deepEqual(parseLoginLink('/masuk/'), { matched: true, token: null });
  assert.deepEqual(parseLoginLink('/'), { matched: false });
  assert.deepEqual(parseLoginLink('/dokumen'), { matched: false });
  assert.deepEqual(parseLoginLink('/masukan/abc'), { matched: false });
});

console.log('\nHalaman dashboard');
const pageContext = {
  guildId: '1569424777750257766',
  guilds: [{ id: '1569424777750257766', name: 'Server Demo' }],
  status: { online: true, mode: 'bot' as const, uptimeSeconds: 3600 },
};
await testAsync('ringkasan merender sidebar, kartu statistik, dan grafik', async () => {
  const html = ringkasanPage({
    ...pageContext,
    stats: { rooms: 3, documents: 2, chunks: 9, keywords: 4, memories: 6, messages: 84 },
    rooms: [{ channelId: '1400000000000000001', userId: USER, messageCount: 12, lastActiveAt: Date.now() }],
    documents: [{ id: 1, name: 'faq.md', chunkCount: 6, chars: 4200, createdAt: Date.now() }],
    series: await messagesPerDay('1569424777750257766', 7),
    ragEnabled: true,
    embedModel: null,
    model: 'openai/gpt-oss-120b',
    counts: { dokumen: 2, keyword: 4, memori: 6 },
  });

  assert.match(html, /class="sidebar"/);
  assert.match(html, /Kontrol panel|Control panel/);
  assert.equal((html.match(/class="stat-value"/g) ?? []).length, 4);
  assert.equal((html.match(/class="bar-col/g) ?? []).length, 7);
  assert.match(html, /openai\/gpt-oss-120b/);
  assert.match(html, /Room AI terbaru/);
});
test('halaman keyword meng-escape input user', () => {
  const html = keywordPage({
    ...pageContext,
    keywords: [{ id: 1, trigger: '<script>alert(1)</script>', answer: 'jam 08.00', createdAt: Date.now() }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'tag mentah tidak boleh lolos');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
test('empty state muncul kalau belum ada memori', () => {
  const html = memoriPage({ ...pageContext, groups: [] });
  assert.match(html, /Belum|belum mengingat|AI belum mengingat/);
  assert.match(html, /class="empty"/);
});

console.log('\nTeks & rate limit');
test('chunkMessage menghormati batas 2000 karakter', () => {
  const long = Array.from({ length: 300 }, (_, i) => `Baris ${i} dengan beberapa kata.`).join('\n');
  const chunks = chunkMessage(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 2000, `chunk ${chunk.length} karakter`);
  assert.equal(chunks.join('\n').replace(/\s+/g, ' ').trim(), long.replace(/\s+/g, ' ').trim());
});
test('truncate menambahkan elipsis', () => {
  assert.equal(truncate('abcdefghij', 5).endsWith('…'), true);
  assert.equal(truncate('abc', 10), 'abc');
});
test('normalize membuang tanda baca', () => {
  assert.equal(normalize('Halo, Server INI apa?!'), 'halo server ini apa');
});
test('rate limit memblokir setelah batas', () => {
  const key = `test:${Date.now()}`;
  for (let i = 0; i < 3; i += 1) assert.equal(checkRateLimit(key, 3).allowed, true);
  const blocked = checkRateLimit(key, 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

console.log('\nDeteksi bahasa & kutipan');
test('detectLanguage: Indonesian vs English', () => {
  assert.equal(detectLanguage('halo apa kabar ya teman'), 'id');
  assert.equal(detectLanguage('what is the price for premium?'), 'en');
  assert.equal(detectLanguage('kamu bisa bantu saya dengan harga ini'), 'id');
  assert.equal(detectLanguage('tell me more about this feature please'), 'en');
  assert.equal(detectLanguage('...'), 'unknown');
});
test('summarizeSources menampilkan nama dokumen + bagian', () => {
  const chunks = [
    { documentId: 1, documentName: 'FAQ', ordinal: 0, content: 'a', score: 0.9, via: 'lexical' as const },
    { documentId: 1, documentName: 'FAQ', ordinal: 2, content: 'b', score: 0.8, via: 'lexical' as const },
    { documentId: 2, documentName: 'Panduan', ordinal: 0, content: 'c', score: 0.7, via: 'lexical' as const },
  ];
  const note = summarizeSources(chunks);
  assert.ok(note.includes('FAQ'), 'FAQ disebut');
  assert.ok(note.includes('bagian 1'), 'bagian 1 disebut');
  assert.ok(note.includes('Panduan'), 'Panduan disebut');
  assert.ok(note.includes('bagian 3'), 'bagian 3 disebut (ordinal 2)');
});
test('buildSystemPrompt menambah instruksi bahasa Inggris', () => {
  const enPrompt = buildSystemPrompt({
    botName: 'Zypher',
    guildName: 'Test',
    userName: 'User',
    persona: null,
    memories: [],
    keywords: [],
    language: 'en',
  });
  assert.ok(enPrompt.includes('bahasa Inggris'), 'prompt bahasa Inggris');

  const idPrompt = buildSystemPrompt({
    botName: 'Zypher',
    guildName: 'Test',
    userName: 'User',
    persona: null,
    memories: [],
    keywords: [],
    language: 'id',
  });
  assert.ok(idPrompt.includes('Bahasa Indonesia'), 'prompt bahasa Indonesia');
});

console.log('\nRAG dokumen');
test('memotong dokumen panjang jadi beberapa chunk yang wajar', () => {
  const paragraph = 'Server ini punya aturan main yang jelas untuk semua member baru agar nyaman. '.repeat(6);
  const doc = [paragraph, paragraph, paragraph, paragraph, paragraph].join('\n\n');
  const chunks = chunkText(doc, { size: 900, overlap: 150 });
  assert.ok(chunks.length > 1, 'dokumen panjang harus dipecah');
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 1500, `chunk kebesaran: ${chunk.length}`);
    assert.ok(chunk.length >= 20);
  }
});
test('chunk pendek tidak dipotong dan teks penting tetap utuh', () => {
  const chunks = chunkText('Jam operasional server: 09.00 sampai 21.00 WIB setiap hari.');
  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? '', /09\.00 sampai 21\.00 WIB/);
});
test('htmlToText membuang tag & script', () => {
  const text = htmlToText('<h1>Judul</h1><script>alert(1)</script><p>Isi <b>penting</b>.</p>');
  assert.match(text, /Judul/);
  assert.match(text, /Isi penting/);
  assert.ok(!text.includes('<'));
  assert.ok(!text.includes('alert'));
});
test('extractText menolak format biner yang belum didukung', () => {
  assert.throws(() => extractText('data.xlsx', 'isi'), DocumentError);
  try {
    extractText('data.xlsx', 'isi');
  } catch (error) {
    assert.match((error as Error).message, /Excel/);
  }
});
test('extractText menolak file biner yang bukan UTF-8', () => {
  const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0xff, 0xfe, 0x00, 0x41, 0x42, 0x43, 0x44, 0x45]);
  assert.throws(() => extractText('data.txt', binary), DocumentError);
});
test('tokenizer: stopword dibuang, imbuhan dipangkas', () => {
  const tokens = tokenize('Bagaimana cara mengingat memori saya tentang server ini?');
  assert.ok(!tokens.includes('saya'));
  assert.ok(!tokens.includes('ini'));
  assert.ok(tokens.includes('ingat'), `harusnya "mengingat" jadi "ingat": ${tokens.join(',')}`);
  assert.equal(stem('memori'), 'memori');
});
test('BM25 menempatkan dokumen paling relevan di urutan pertama', () => {
  const index = new Bm25Index([
    { id: 1, text: 'Cara membuat room AI privat dengan tombol panel di Discord.' },
    { id: 2, text: 'Aturan giveaway: satu akun satu hadiah, pemenang diumumkan malam.' },
    { id: 3, text: 'Cara reset password akun member di website komunitas.' },
  ]);
  const hits = index.search('bagaimana reset password akun', 3);
  assert.equal(hits[0]?.id, 3);
  assert.ok((hits[0]?.score ?? 0) > 0);
});
test('cosineSimilarity benar untuk vektor sederhana', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
});

await testAsync('RAG: ingest dokumen lalu temu kembali dengan nama sumber', async () => {
  const doc = [
    '# FAQ Komunitas',
    '',
    '## Jam operasional',
    'Server aktif setiap hari pukul 09.00 sampai 21.00 WIB. Di luar jam itu staff sedang istirahat.',
    '',
    '## Aturan giveaway',
    'Giveaway hanya boleh diikuti satu akun per orang. Pemenang diumumkan lewat channel #pengumuman.',
  ].join('\n');

  const result = await ingestDocument({ guildId: 'g-rag', name: 'faq.md', content: doc, createdBy: 'u-1' });
  assert.ok(result.chunkCount >= 1);
  assert.equal(result.document.name, 'faq.md');
  assert.equal((await listGuildDocuments('g-rag')).length, 1);

  const hits = await searchKnowledge('g-rag', 'jam operasional server sampai jam berapa?');
  assert.ok(hits.length >= 1, 'harus ada hasil');
  assert.equal(hits[0]?.documentName, 'faq.md');
  assert.match(hits[0]?.content ?? '', /09\.00 sampai 21\.00/);

  const block = buildKnowledgeBlock(hits);
  assert.match(block, /DOKUMEN RUJUKAN/);
  assert.match(block, /Sumber: faq\.md/);
  assert.match(summarizeSources(hits), /faq\.md/);
});

await testAsync('RAG: upload ulang dengan nama sama menggantikan dokumen lama', async () => {
  await ingestDocument({
    guildId: 'g-rag',
    name: 'faq.md',
    content: 'Jam operasional server sekarang 24 jam penuh tanpa henti, staff piket bergiliran.',
  });
  assert.equal((await listGuildDocuments('g-rag')).length, 1, 'tidak boleh duplikat');

  const hits = await searchKnowledge('g-rag', 'jam operasional');
  assert.match(hits[0]?.content ?? '', /24 jam/);
});

await testAsync('RAG: dokumen yang salah server tidak ikut terpakai', async () => {
  const hits = await searchKnowledge('g-lain', 'jam operasional');
  assert.equal(hits.length, 0);
});

await testAsync('RAG: dokumen bisa dihapus dan hasil pencarian hilang', async () => {
  const documents = await listGuildDocuments('g-rag');
  assert.equal(await removeDocument('g-rag', documents[0]!.id), true);
  const hits = await searchKnowledge('g-rag', 'jam operasional');
  assert.equal(hits.length, 0);
});

await testAsync('RAG: pertanyaan yang tidak berhubungan menghasilkan hasil kosong', async () => {
  await ingestDocument({
    guildId: 'g-rag2',
    name: 'aturan.md',
    content: 'Dilarang keras mengirim tautan judi, togel, atau promosi slot di seluruh channel server.',
  });
  const hits = await searchKnowledge('g-rag2', 'kapan jadwal turnamen valorant dimulai?');
  assert.equal(hits.length, 0);
});

console.log('\nDokumen biner (PDF & DOCX)');

/** DOCX minimal: arsip ZIP berisi word/document.xml. */
function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  return zipSync(
    {
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    },
    { level: 6 },
  );
}

/** PDF satu halaman tanpa xref — pdf.js tetap bisa membacanya. */
function makePdf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 20 120 Td (${text}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${content.length}>>stream
${content}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`;
  return new TextEncoder().encode(pdf);
}

await testAsync('DOCX: teks paragraf terbaca', async () => {
  const text = await extractFileText(
    'aturan.docx',
    makeDocx(['Dilarang spam dan tautan judi.', 'Jam operasional server 08.00-22.00 WIB.']),
  );
  assert.match(text, /Dilarang spam/);
  assert.match(text, /08\.00-22\.00/);
});

await testAsync('DOCX rusak ditolak dengan pesan ramah', async () => {
  await assert.rejects(
    () => extractFileText('rusak.docx', new Uint8Array([1, 2, 3, 4, 5])),
    (error: unknown) => error instanceof DocumentError && /rusak|bukan dokumen/i.test((error as Error).message),
  );
});

await testAsync('PDF: teks diekstrak lewat unpdf', async () => {
  const text = await extractFileText('faq.pdf', makePdf('Halo dari PDF aturan server'));
  assert.match(text, /PDF aturan server/);
});

await testAsync('PDF dari Buffer Node (byteOffset != 0) tetap terbaca', async () => {
  const pdf = makePdf('Kebijakan server soal spam');
  // Tiru cara server membaca body upload: Buffer yang menumpang ArrayBuffer bersama.
  const shared = Buffer.concat([Buffer.alloc(544), Buffer.from(pdf)]);
  const view = shared.subarray(544);
  assert.notEqual(view.byteOffset, 0);
  const text = await extractFileText('buffer.pdf', view);
  assert.match(text, /Kebijakan server/);
});

await testAsync('PDF rusak ditolak (bukan crash)', async () => {
  await assert.rejects(
    () => extractFileText('rusak.pdf', new TextEncoder().encode('%PDF-1.4 bukan pdf sungguhan')),
    (error: unknown) => error instanceof DocumentError,
  );
});

await testAsync('PDF hasil scan tanpa teks dapat pesan khusus OCR', async () => {
  await assert.rejects(
    () => extractFileText('scan.pdf', makePdf('')),
    (error: unknown) => error instanceof DocumentError && /scan|OCR|tidak mengandung teks/i.test((error as Error).message),
  );
});

test('format .doc lama tetap ditolak dengan saran konversi', () => {
  assert.throws(
    () => extractText('lama.doc', 'isi'),
    (error: unknown) => error instanceof DocumentError && /Word 97-2003/.test((error as Error).message),
  );
});

console.log('\nArsip transkrip');

const TRANSCRIPT_ID = await insertTranscript({
  guildId: 'g-tr',
  channelId: 'chan-1',
  channelName: 'room-ai-0001',
  userId: USER,
  userName: 'Bagas',
  fileName: 'transkrip-bagas.html',
  summary: 'Member menanyakan jam operasional server.',
  messageCount: 12,
  memoryCount: 2,
  html: '<!doctype html><html><body><p>Halo</p></body></html>',
  createdAt: 1_700_000_000_000,
});

await testAsync('transkrip tersimpan & terbaca di daftar', async () => {
  assert.equal(await countTranscripts('g-tr'), 1);
  const [item] = await listTranscripts('g-tr');
  assert.ok(item);
  assert.equal(item.id, TRANSCRIPT_ID);
  assert.equal(item.messageCount, 12);
  assert.equal(item.userName, 'Bagas');
  assert.match(item.summary ?? '', /jam operasional/);
  assert.ok(item.sizeBytes > 20, 'ukuran file harus tercatat');
});

await testAsync('transkrip lengkap hanya bisa dibuka oleh server pemiliknya', async () => {
  const record = await getTranscript('g-tr', TRANSCRIPT_ID);
  assert.ok(record);
  assert.match(record.html, /<!doctype html>/);
  assert.equal(await getTranscript('g-lain', TRANSCRIPT_ID), null);
});

await testAsync('transkrip bisa dihapus', async () => {
  assert.equal(await deleteTranscript('g-tr', TRANSCRIPT_ID), true);
  assert.equal(await countTranscripts('g-tr'), 0);
  assert.equal(await deleteTranscript('g-tr', TRANSCRIPT_ID), false);
});

test('halaman transkrip merender arsip + tombol unduh', () => {
  const html = transkripPage({
    guildId: 'g-tr',
    guilds: [{ id: 'g-tr', name: 'Server Transkrip' }],
    items: [
      {
        id: 7,
        userId: USER,
        userName: 'Bagas',
        channelName: 'room-ai-0001',
        fileName: 'transkrip-bagas.html',
        summary: 'Member menanyakan jam operasional.',
        messageCount: 12,
        memoryCount: 2,
        sizeBytes: 24_000,
        createdAt: 1_700_000_000_000,
      },
    ],
    status: { online: false, mode: 'standalone', uptimeSeconds: 90 },
  });
  assert.match(html, /Transkrip/);
  assert.match(html, /Bagas/);
  assert.match(html, /\/api\/transkrip\/7/);
  assert.match(html, /Unduh/);
  assert.match(html, /23 KB/);
});

console.log('\nModerasi otomatis');
test('moderasi: mencocokkan kata walau beda huruf besar/kecil & tanda baca', () => {
  assert.deepEqual(findBannedWords('Dasar ANJING banget', ['anjing']), ['anjing']);
  assert.deepEqual(findBannedWords('Dasar!!! anjing??', ['anjing']), ['anjing']);
  assert.deepEqual(findBannedWords('pesan biasa saja', ['anjing']), []);
});

test('moderasi: menangkap variasi leetspeak dan frasa', () => {
  assert.deepEqual(findBannedWords('k0nt0l banget', ['kontol']), ['kontol']);
  assert.deepEqual(findBannedWords('dasar b4ngs4t kamu', ['bangsat']), ['bangsat']);
  assert.deepEqual(findBannedWords('ini info penipuan online ya', ['penipuan online']), ['penipuan online']);
});

test('moderasi: tidak salah tangkap potongan kata lain', () => {
  assert.deepEqual(findBannedWords('saya pakai asuransi kesehatan', ['asu']), []);
  assert.deepEqual(findBannedWords('kelas musik tadi seru', ['asu']), []);
});

await testAsync('moderasi: pengaturan tersimpan per server', async () => {
  assert.equal(await getModerationSettings('g-mod'), null);
  await setModerationSettings({ guildId: 'g-mod', enabled: true, words: ['Anjing', 'Bangsat'], action: 'timeout', timeoutMinutes: 30 });
  const saved = await getModerationSettings('g-mod');
  assert.ok(saved);
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.words, ['anjing', 'bangsat']);
  assert.equal(saved.action, 'timeout');
  assert.equal(saved.timeoutMinutes, 30);
  assert.equal(await getModerationSettings('g-mod-lain'), null, 'server lain harus tetap bersih');
});

await testAsync('moderasi: durasi timeout dijepit ke rentang wajar', async () => {
  await setModerationSettings({ guildId: 'g-mod', enabled: true, words: ['x'], action: 'delete', timeoutMinutes: 0 });
  assert.equal((await getModerationSettings('g-mod'))?.timeoutMinutes, 1);
  await setModerationSettings({ guildId: 'g-mod', enabled: true, words: ['x'], action: 'delete', timeoutMinutes: 99_999 });
  assert.equal((await getModerationSettings('g-mod'))?.timeoutMinutes, 10080);
});

await testAsync('moderasi: log pelanggaran tercatat, terisolasi per server, bisa dihapus', async () => {
  await clearModerationLogs('g-mod');
  const first = await addModerationLog({
    guildId: 'g-mod',
    channelId: 'c-1',
    userId: USER,
    userName: 'Bagas',
    content: 'dasar anjing',
    matched: 'anjing',
    action: 'delete',
  });
  const second = await addModerationLog({
    guildId: 'g-mod',
    channelId: 'c-2',
    userId: '999',
    userName: 'Rina',
    content: 'bangsat banget',
    matched: 'bangsat',
    action: 'warn',
  });

  assert.equal(await countModerationLogs('g-mod'), 2);
  assert.equal(await countModerationLogs('g-mod-lain'), 0);

  const logs = await listModerationLogs('g-mod', 10);
  assert.equal(logs.length, 2);
  assert.equal(logs[0]?.id, second, 'log terbaru muncul duluan');
  assert.equal(logs[1]?.id, first);
  assert.equal(logs[1]?.userName, 'Bagas');

  assert.equal(await deleteModerationLog('g-mod-lain', first), false);
  assert.equal(await deleteModerationLog('g-mod', first), true);
  assert.equal(await countModerationLogs('g-mod'), 1);
  assert.equal(await clearModerationLogs('g-mod'), 1);
  assert.equal(await countModerationLogs('g-mod'), 0);
});

test('halaman moderasi merender pengaturan + log', () => {
  const html = moderasiPage({
    guildId: 'g-mod',
    guilds: [{ id: 'g-mod', name: 'Server Moderasi' }],
    enabled: true,
    words: ['anjing', 'bangsat'],
    action: 'timeout',
    timeoutMinutes: 30,
    fromEnv: false,
    logs: [
      {
        id: 4,
        userId: USER,
        userName: 'Bagas',
        channelId: 'c-1',
        content: 'dasar anjing',
        matched: 'anjing',
        action: 'timeout',
        createdAt: 1_700_000_000_000,
      },
    ],
    status: { online: false, mode: 'standalone', uptimeSeconds: 90 },
  });

  assert.match(html, /Moderasi/);
  assert.match(html, /anjing, bangsat/);
  assert.match(html, /id="modEnabled" checked/);
  assert.match(html, /value="timeout" selected/);
  assert.match(html, /Bagas/);
  assert.match(html, /\/api\/moderasi/);
});

test('halaman panel: dropdown channel saat bot online, peringatan saat offline', () => {
  const online = panelPage({
    guildId: 'g-panel',
    guilds: [{ id: 'g-panel', name: 'Server Panel' }],
    enabled: true,
    channelId: '1400000000000000001',
    messageId: '1500000000000000001',
    updatedAt: Date.now() - 60_000,
    channels: [
      { id: '1400000000000000001', name: 'umum' },
      { id: '1400000000000000002', name: 'pengumuman' },
    ],
    botOnline: true,
    status: { online: true, mode: 'bot', uptimeSeconds: 600 },
  });

  assert.match(online, /id="panelChannel"/);
  assert.match(online, /value="1400000000000000001" selected>#umum/);
  assert.match(online, /value="1400000000000000002">#pengumuman/);
  assert.match(online, /Kirim ulang panel/);
  assert.match(online, /id="panelEnabled" checked/);
  assert.match(online, /\/api\/panel/);
  assert.doesNotMatch(online, /class="notice"/);

  const offline = panelPage({
    guildId: 'g-panel',
    guilds: [{ id: 'g-panel', name: 'Server Panel' }],
    enabled: false,
    channelId: null,
    messageId: null,
    updatedAt: null,
    channels: [],
    botOnline: false,
    status: { online: false, mode: 'standalone', uptimeSeconds: 30 },
  });

  assert.match(offline, /Bot Discord sedang offline/);
  assert.match(offline, /input type="text" id="panelChannel"/);
  assert.match(offline, /Panel nonaktif/);
  assert.match(offline, /id="removePanel"[^>]*disabled/);
});

console.log('\nLayanan panel (client tiruan)');
await testAsync('publishPanel mengirim panel & menghapus panel lama', async () => {
  const { ChannelType } = await import('discord.js');
  const { publishPanel, removePanel, PanelError } = await import('../src/features/panel.js');

  const guild = '131313131313131313';
  await setPanelMessage(guild, '1400000000000000001', '1500000000000000001');

  const deleted: string[] = [];
  const sent: Array<{ channelId: string }> = [];

  const makeChannel = (id: string, name: string) => ({
    id,
    name,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async () => {
      sent.push({ channelId: id });
      return { id: `16000000000000000${sent.length}` };
    },
    messages: {
      fetch: async (messageId: string) => ({
        delete: async () => {
          deleted.push(`${id}:${messageId}`);
        },
      }),
    },
  });

  const channels = new Map([
    ['1400000000000000001', makeChannel('1400000000000000001', 'umum')],
    ['1400000000000000002', makeChannel('1400000000000000002', 'pengumuman')],
  ]);

  const fakeGuild = {
    id: guild,
    members: { me: { id: 'bot' } },
    channels: {
      fetch: async (id?: string) => (id ? channels.get(id) ?? null : channels),
    },
  };
  const fakeClient = {
    isReady: () => true,
    guilds: { fetch: async () => fakeGuild },
  } as unknown as Parameters<typeof publishPanel>[0];

  // Pindah channel: panel lama di #umum harus dihapus, bukan dibiarkan dobel.
  const result = await publishPanel(fakeClient, guild, '1400000000000000002');
  assert.equal(result.channelId, '1400000000000000002');
  assert.equal(result.removedPrevious, true);
  assert.deepEqual(deleted, ['1400000000000000001:1500000000000000001']);

  const state = await getPanel(guild);
  assert.equal(state.channelId, '1400000000000000002');
  assert.equal(state.messageId, result.messageId);

  const removal = await removePanel(fakeClient, guild);
  assert.equal(removal.removed, true);
  assert.equal((await getPanel(guild)).messageId, null);

  // Client yang belum siap (mode dashboard-saja) harus menolak dengan pesan jelas.
  await assert.rejects(
    () => publishPanel({ isReady: () => false } as unknown as Parameters<typeof publishPanel>[0], guild, '1400000000000000002'),
    (error: unknown) => error instanceof PanelError && /offline/i.test(error.message),
  );
});

console.log('\nVision & voice');
test('vision: mengenali lampiran gambar dari nama file atau content-type', () => {
  assert.equal(isImageAttachment('foto.PNG'), true);
  assert.equal(isImageAttachment('foto.jpeg'), true);
  assert.equal(isImageAttachment('screenshot', 'image/webp'), true);
  assert.equal(isImageAttachment('laporan.pdf', 'application/pdf'), false);
  assert.equal(isImageAttachment('catatan.txt', 'text/plain'), false);
});

test('vision: MIME mengikuti content-type lalu ekstensi', () => {
  assert.equal(mimeForAttachment('x.png', 'image/png'), 'image/png');
  assert.equal(mimeForAttachment('x.jpg'), 'image/jpeg');
  assert.equal(mimeForAttachment('x.unknown'), 'image/png');
});

test('vision: data URI bisa dibalik jadi byte asli', () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const uri = toDataUri(bytes, 'image/png');
  assert.ok(uri.startsWith('data:image/png;base64,'));
  const decoded = Buffer.from(uri.split(',')[1] ?? '', 'base64');
  assert.deepEqual([...decoded], [...bytes]);
});

test('vision: pesan multimodal berisi teks lalu semua gambar', () => {
  const content = visionUserContent('Apa isi gambar ini?', ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);
  assert.equal(content.length, 3);
  assert.deepEqual(content[0], { type: 'text', text: 'Apa isi gambar ini?' });
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
  assert.equal(content[2]?.type, 'image_url');
});

test('voice: mengenali voice note Discord (.ogg) dan file audio lain', () => {
  assert.equal(isAudioAttachment('voice-message.ogg', 'audio/ogg'), true);
  assert.equal(isAudioAttachment('rekaman.m4a'), true);
  assert.equal(isAudioAttachment('lagu.mp3', 'audio/mpeg'), true);
  assert.equal(isAudioAttachment('foto.png', 'image/png'), false);
  assert.equal(isAudioAttachment('dokumen.pdf'), false);
});

console.log('\nMulti-shard');
test('shard: hash guild stabil dan tersebar merata', () => {
  assert.equal(hashGuildId('1569424777750257766'), hashGuildId('1569424777750257766'));
  assert.notEqual(hashGuildId('1569424777750257766'), hashGuildId('1569424777750257767'));

  // 100 server sintetis dibagi 4 shard: tidak boleh ada shard yang kosong.
  const buckets = [0, 0, 0, 0];
  for (let index = 0; index < 100; index += 1) buckets[hashGuildId(String(100000000000000000 + index)) % 4] += 1;
  assert.ok(buckets.every((count) => count > 5), `distribusi terlalu timpang: ${buckets.join('/')}`);
});

test('shard: default SHARD_COUNT=1 berarti semua server ditangani', () => {
  assert.deepEqual(shardInfo(), { index: 0, count: 1, enabled: false });
  assert.equal(ownsGuild('123'), true);
  assert.equal(ownsGuild(null), true);
});

console.log('\nProvider & fallback');
test('mengurai AI_FALLBACKS, termasuk model ber-titik-dua', () => {
  const { providers, problems } = parseFallbackSpec(
    'gemini:gemini-3.8-flash, openrouter:google/gemma-4-31b-it:free',
    { GEMINI_API_KEY: 'key-g', OPENROUTER_API_KEY: 'key-o' },
  );
  assert.equal(problems.length, 0);
  assert.equal(providers.length, 2);
  assert.equal(providers[0]?.name, 'gemini');
  assert.equal(providers[0]?.model, 'gemini-3.8-flash');
  assert.equal(providers[1]?.model, 'google/gemma-4-31b-it:free');
  assert.match(providers[1]?.baseUrl ?? '', /openrouter\.ai/);
});
test('melewati provider yang key-nya kosong', () => {
  const { providers, problems } = parseFallbackSpec('gemini:gemini-3.8-flash', {});
  assert.equal(providers.length, 0);
  assert.match(problems[0] ?? '', /GEMINI_API_KEY/);
});
test('menolak provider tak dikenal & format salah', () => {
  const { providers, problems } = parseFallbackSpec('entah:model-x,formatSalah', { GEMINI_API_KEY: 'k' });
  assert.equal(providers.length, 0);
  assert.equal(problems.length, 2);
});
test('NVIDIA NIM dikenali sebagai provider fallback', () => {
  const { providers } = parseFallbackSpec('nvidia:openai/gpt-oss-120b', { NVIDIA_API_KEY: 'nvapi-test' });
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(providers[0]?.model, 'openai/gpt-oss-120b');
});
test('Cerebras & Mistral tidak lagi didukung (minta kartu kredit)', () => {
  const { providers, problems } = parseFallbackSpec('cerebras:gpt-oss-120b,mistral:mistral-small-latest', {
    CEREBRAS_API_KEY: 'x',
    MISTRAL_API_KEY: 'y',
  });
  assert.equal(providers.length, 0);
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? '', /tidak dikenal/);
  assert.match(problems[0] ?? '', /groq, gemini, openrouter, nvidia, ollama/);
});
test('ollama tidak butuh API key', () => {
  const { providers } = parseFallbackSpec('ollama:llama3.1', {});
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.baseUrl, 'http://localhost:11434/v1');
});
test('mendeteksi nama provider dari base URL', () => {
  assert.equal(providerNameForBaseUrl('https://api.groq.com/openai/v1'), 'groq');
  assert.equal(providerNameForBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai/'), 'gemini');
  assert.equal(providerNameForBaseUrl('http://127.0.0.1:11434/v1'), 'ollama');
  assert.equal(providerNameForBaseUrl('https://integrate.api.nvidia.com/v1'), 'nvidia');
});
test('rantai provider: utama di depan, fallback hanya yang ada key-nya', () => {
  const chain = buildProviderChain();
  assert.equal(chain[0]?.name, 'groq');
  assert.equal(chain.length, 2, 'openrouter harus dilewati karena OPENROUTER_API_KEY kosong');
  assert.equal(chain[1]?.name, 'gemini');
});

console.log(`\n${process.exitCode ? '❌ Ada test gagal' : '🎉 Semua test lulus'} — ${passed} test.\n`);
