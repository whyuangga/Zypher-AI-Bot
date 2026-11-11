/**
 * Smoke test tanpa koneksi Discord / tanpa API key asli.
 * Menguji logika inti: database, memori, keyword, prompt, privasi, chunking.
 *
 * Jalankan: npm run smoke
 */
process.env.DISCORD_TOKEN = 'smoke-test-token-0000000000000000';
// GUILD_ID wajib sejak bot jadi single-server.
process.env.GUILD_ID = '123456789012345678';
process.env.CLIENT_ID = '123456789012345678';
process.env.VOICE_ENABLED = 'true';
process.env.AI_API_KEY = 'smoke-test-key-0000';
process.env.DATABASE_PATH = ':memory:';
process.env.AI_FALLBACKS = 'gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free';
process.env.GEMINI_API_KEY = 'smoke-gemini-key';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';


const { addMemory, listMemories, deleteMemory, clearMemories, addKeyword, listKeywords, deleteKeyword } = await import(
  '../src/db/repo.js'
);
const { setDmSession, getDmSession, listDmSessions, deleteDmSession, touchDmSession, appendMessage, getHistory, clearHistory } =
  await import('../src/db/repo.js');
const { setPersona, getGuildSettings } = await import('../src/db/repo.js');
const { getGuildName, countGuildRows, countGuildMessages, messagesPerDay } = await import('../src/db/repo.js');
const { setGuildName, getPanel, setPanelMessage, setPanelEnabled } = await import('../src/db/repo.js');
const { ringkasanPage, keywordPage, moderasiPage, panelPage } = await import('../src/web/ui/pages.js');
const { pengaturanPage } = await import('../src/web/ui/pages.js');
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

const { config } = await import('../src/config.js');

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
/**
 * Test sinkron.
 *
 * `fn` sengaja bertipe `() => void` (bukan `void | Promise<void>`): dulu ada
 * fungsi async yang didaftarkan ke sini, promise-nya tidak pernah di-await,
 * dan assertion-nya lolos tanpa dicek. Test async wajib memakai `testAsync`.
 */
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

console.log('\nSesi DM & riwayat');
await testAsync('membuat sesi DM dan menemukannya kembali', async () => {
  await setDmSession(USER, GUILD);
  const session = await getDmSession(USER);
  assert.equal(session?.userId, USER);
  assert.equal(session?.guildId, GUILD);
  assert.equal((await listDmSessions(GUILD)).length, 1);
});
await testAsync('ganti server konteks memperbarui sesi, bukan menambah baris', async () => {
  await setDmSession(USER, '777777777777777777');
  const session = await getDmSession(USER);
  assert.equal(session?.guildId, '777777777777777777');
  assert.equal((await listDmSessions(GUILD)).length, 0, 'server lama tidak boleh punya sesi lagi');
  await setDmSession(USER, GUILD);
});
await testAsync('menyimpan & mengambil riwayat berurutan', async () => {
  const key = `dm:${USER}`;
  await appendMessage(key, 'user', 'Halo');
  await appendMessage(key, 'assistant', 'Hai! Ada yang bisa dibantu?');
  await appendMessage(key, 'user', 'Ajarin Inggris dong');
  await touchDmSession(USER, 3);

  const history = await getHistory(key, 2);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.content, 'Hai! Ada yang bisa dibantu?');
  assert.equal(history[1]?.role, 'user');
  assert.equal((await getDmSession(USER))?.messageCount, 3);
});
await testAsync('reset tidak menghapus memori', async () => {
  await clearHistory(`dm:${USER}`);
  assert.equal((await getHistory(`dm:${USER}`, 10)).length, 0);
  assert.equal((await listMemories(GUILD, USER)).length, 1);
});
await testAsync('hapus sesi DM membersihkan data', async () => {
  await deleteDmSession(USER);
  assert.equal(await getDmSession(USER), null);
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

console.log('\nDashboard server tunggal');
await testAsync('dashboard memakai GUILD_ID, bukan daftar server', async () => {
  // Bot ini untuk satu server: tidak ada lagi dropdown server untuk dipilih.
  const source = await readFile('src/web/server.ts', 'utf8');
  assert.equal(source.includes('guild_manual'), false, 'kotak "Tempel Server ID" sudah dihapus');
  assert.equal(source.includes('zp_guild'), false, 'cookie pilihan server sudah dihapus');
  assert.ok(source.includes('config.discord.homeGuildId'), 'server diambil dari GUILD_ID');
});

await testAsync('shell dashboard tidak punya form pemilih server', async () => {
  const shell = await readFile('src/web/ui/shell.ts', 'utf8');
  assert.equal(shell.includes('guild-picker'), false, 'form .guild-picker sudah dihapus');
  assert.equal(shell.includes('guild_manual'), false, 'input ID manual sudah dihapus');
  assert.ok(shell.includes('guildBadge'), 'diganti badge server statis');
});

await testAsync('nama server tetap tersimpan untuk label dashboard', async () => {
  const named = '1567780679515770900';
  await setGuildName(named, '  Server Uji  ');
  assert.equal(await getGuildName(named), 'Server Uji', 'nama di-trim sebelum disimpan');
  assert.equal(await getGuildName('555555555555555555'), null, 'server tanpa nama -> null');
});
await testAsync('setDmSession mendaftarkan server ke tabel guilds', async () => {
  const freshGuild = '555555555555555555';
  assert.equal(await getGuildSettings(freshGuild), null);
  await setDmSession(USER, freshGuild);
  assert.ok(await getGuildSettings(freshGuild), 'server harus punya baris guilds setelah sesi DM dibuat');
  await deleteDmSession(USER);
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

  await setDmSession(USER, guildA);
  await appendMessage(`dm:${USER}`, 'user', 'Halo dari server A');

  assert.equal(await countGuildRows(guildA, 'dm_sessions'), 1);
  assert.equal(await countGuildRows(guildB, 'dm_sessions'), 0, 'server B tidak boleh ikut menghitung sesi A');
  assert.equal(await countGuildMessages(guildA), 1);
  assert.equal(await countGuildMessages(guildB), 0);
});

await testAsync('grafik aktivitas menghitung pesan 7 hari terakhir', async () => {
  const guildId = '121212121212121212';
  const dmKey = 'dm:131313131313131313';
  await setDmSession('131313131313131313', guildId);
  await appendMessage(dmKey, 'user', 'Halo');
  await appendMessage(dmKey, 'assistant', 'Hai');

  const series = await messagesPerDay(guildId, 7);
  assert.equal(series.length, 7, 'harus tepat 7 batang');
  assert.equal(series[6]?.count, 2, 'pesan hari ini masuk batang terakhir');
  assert.equal(series.reduce((sum, item) => sum + item.count, 0), 2);
});
await testAsync('memori terpisah per user (tidak tercampur antar member)', async () => {
  const guildId = '141414141414141414';
  const A = '151515151515151515';
  const B = '161616161616161616';
  await addMemory(guildId, A, 'Fakta A');
  await addMemory(guildId, A, 'Fakta B');
  await addMemory(guildId, B, 'Fakta C');

  assert.equal((await listMemories(guildId, A)).length, 2);
  assert.equal((await listMemories(guildId, B)).length, 1);
  const isiA = (await listMemories(guildId, A)).map((m) => m.content);
  assert.ok(!isiA.includes('Fakta C'), 'memori user B tidak boleh terbaca user A');
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
  guildName: 'Server Uji',
  status: { online: true, mode: 'bot' as const, uptimeSeconds: 3600 },
};
await testAsync('ringkasan merender sidebar, kartu statistik, dan grafik', async () => {
  const html = ringkasanPage({
    ...pageContext,
    stats: { rooms: 3, documents: 2, chunks: 9, keywords: 4, messages: 84 },
    rooms: [{ userId: USER, messageCount: 12, lastActiveAt: Date.now() }],
    documents: [{ id: 1, name: 'faq.md', chunkCount: 6, chars: 4200, createdAt: Date.now() }],
    series: await messagesPerDay('1569424777750257766', 7),
    ragEnabled: true,
    embedModel: null,
    model: 'openai/gpt-oss-120b',
    counts: { dokumen: 2, keyword: 4 },
  });

  assert.match(html, /class="sidebar"/);
  assert.match(html, /Kontrol panel|Control panel/);
  assert.equal((html.match(/class="stat-value"/g) ?? []).length, 3, 'Room AI, Dokumen RAG, Keyword');
  assert.equal((html.match(/class="bar-col/g) ?? []).length, 7);
  assert.match(html, /openai\/gpt-oss-120b/);
  assert.match(html, /Sesi DM terbaru/);
});
test('halaman keyword meng-escape input user', () => {
  const html = keywordPage({
    ...pageContext,
    keywords: [{ id: 1, trigger: '<script>alert(1)</script>', answer: 'jam 08.00', createdAt: Date.now() }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'tag mentah tidak boleh lolos');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
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

console.log('\nPrivasi: transkrip & memori tidak lewat dashboard');

await testAsync('tabel transcripts sudah tidak ada di schema', async () => {
  const { SCHEMA_SQLITE } = await import('../src/db/schema.js');
  assert.ok(!/CREATE TABLE[^;]*transcripts/i.test(SCHEMA_SQLITE), 'schema tidak boleh punya tabel transcripts');
});

await testAsync('repo tidak mengekspor fungsi transkrip/memori-dashboard', async () => {
  const repo = await import('../src/db/repo.js');
  for (const name of [
    'insertTranscript',
    'listTranscripts',
    'getTranscript',
    'deleteTranscript',
    'countTranscripts',
    'listMemoryOwners',
    'listGuildMemories',
  ]) {
    assert.ok(!(name in repo), `${name} masih diekspor — dashboard bisa membaca data member`);
  }
});

await testAsync('navigasi dashboard tidak punya menu Memori & Transkrip', async () => {
  const { ringkasanPage } = await import('../src/web/ui/pages.js');
  const html = ringkasanPage({
    guildId: 'g-priv',
    guildName: 'Server Uji',
    status: { online: false, mode: 'standalone', uptimeSeconds: 1 },
    stats: { rooms: 0, documents: 0, chunks: 0, keywords: 0, messages: 0 },
    rooms: [],
    documents: [],
    series: [],
    ragEnabled: false,
    embedModel: null,
    model: 'test',
  });
  assert.ok(!html.includes('href="/memori"'), 'menu Memori masih ada');
  assert.ok(!html.includes('href="/transkrip"'), 'menu Transkrip masih ada');
});

await testAsync('halaman dashboard tidak menyebut channel arsip transkrip', async () => {
  const { moderasiPage } = await import('../src/web/ui/pages.js');
  const html = moderasiPage({
    guildId: 'g-priv',
    guildName: 'Server Uji',
    enabled: false,
    words: [],
    action: 'delete',
    timeoutMinutes: 10,
    fromEnv: true,
    logs: [],
    status: { online: false, mode: 'standalone', uptimeSeconds: 1 },
  });
  assert.ok(!html.includes('TRANSCRIPT_CHANNEL_ID'), 'nama env lama masih dipakai');
  assert.ok(html.includes('MODLOG_CHANNEL_ID'), 'nama env log moderasi yang baru harus dipakai');
});

console.log('\nPrivasi: chat hanya lewat DM, tidak ada channel');

await testAsync('DM menggantikan room: tidak ada channel/thread yang dibuat', async () => {
  const source = await readFile(new URL('../src/features/dm.ts', import.meta.url), 'utf8');
  assert.ok(source.length > 0, 'modul dm.ts harus ada');
  assert.ok(!/channels\.create\(/.test(source), 'DM tidak boleh membuat channel');
  assert.ok(!/threads\.create\(/.test(source), 'DM tidak boleh membuat thread');
  assert.ok(!/permissionOverwrites/.test(source), 'DM tidak butuh permission channel');
});

await testAsync('rooms.ts sudah dihapus — tidak ada konsep room/channel lagi', async () => {
  let exists = true;
  try {
    await readFile(new URL('../src/features/rooms.ts', import.meta.url), 'utf8');
  } catch {
    exists = false;
  }
  assert.equal(exists, false, 'rooms.ts harus sudah dihapus');
});

await testAsync('bot menjawab DM member (messageCreate merutekan DM)', async () => {
  const source = await readFile(new URL('../src/events/messageCreate.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(!message\.inGuild\(\)\)/, 'harus mendeteksi DM');
  assert.match(source, /handleDmMessage\(message\)/, 'DM harus diarahkan ke handler DM');
  assert.ok(!/handleRoomMessage/.test(source), 'tidak boleh lagi memanggil handleRoomMessage');
});

await testAsync('chat.ts tidak lagi menangani pesan server (hanya DM)', async () => {
  const source = await readFile(new URL('../src/features/chat.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('handleRoomMessage'), 'handleRoomMessage harus dihapus');
  assert.match(source, /export async function generateAnswer/, 'generateAnswer harus diekspor untuk dm.ts');
});

await testAsync('schema tidak punya tabel rooms, tapi punya dm_sessions', async () => {
  const { SCHEMA_SQLITE } = await import('../src/db/schema.js');
  assert.ok(!/CREATE TABLE[^;]*\brooms\b/i.test(SCHEMA_SQLITE), 'tabel rooms harus dihapus');
  assert.match(SCHEMA_SQLITE, /CREATE TABLE IF NOT EXISTS dm_sessions/, 'tabel dm_sessions harus ada');
});

await testAsync('migrasi membersihkan riwayat pesan room lama', async () => {
  const source = await readFile(new URL('../src/db/index.ts', import.meta.url), 'utf8');
  assert.match(source, /DROP TABLE IF EXISTS rooms/, 'tabel rooms lama harus di-drop');
  assert.match(source, /DELETE FROM messages WHERE channel_id NOT LIKE 'dm:%'/,
    'riwayat pesan room lama harus dibersihkan');
});

await testAsync('dm_sessions menyimpan server konteks, bukan channel', async () => {
  const sed = `SELECT * FROM dm_sessions WHERE user_id = ?`;
  const { getDmSession, setDmSession, deleteDmSession } = await import('../src/db/repo.js');

  await setDmSession('555000555000555000', '999000999000999000');
  const session = await getDmSession('555000555000555000');
  assert.equal(session?.guildId, '999000999000999000');
  assert.equal((session as unknown as { channelId?: string }).channelId, undefined,
    'sesi DM tidak boleh punya channelId');
  assert.ok(sed.includes('user_id'));
  await deleteDmSession('555000555000555000');
});

await testAsync('panel menyebut DM, bukan room/thread', async () => {
  const { panelEmbed, panelRow } = await import('../src/features/ui.js');
  const embed = panelEmbed('Zypher AI').toJSON();
  const text = JSON.stringify(embed);
  assert.match(text, /Chat via DM|DM/, 'panel harus menyebut DM');
  assert.ok(!/Buat Room AI/.test(text), 'panel tidak boleh lagi menawarkan room');
  assert.ok(!/private thread/i.test(text), 'panel tidak boleh menyebut private thread');

  const row = panelRow().toJSON();
  const ids = JSON.stringify(row);
  assert.match(ids, /dm:start/, 'tombol harus memakai customId dm:start');
  assert.ok(!ids.includes('room:create'), 'tombol room:create harus hilang');
});

await testAsync('log moderasi TIDAK menyimpan isi pesan member', async () => {
  const { SCHEMA_SQLITE, SCHEMA_PG } = await import('../src/db/schema.js');
  const modLogSqlite = /CREATE TABLE IF NOT EXISTS mod_logs \(([^)]*)\)/.exec(SCHEMA_SQLITE)?.[1] ?? '';
  const modLogPg = /CREATE TABLE IF NOT EXISTS mod_logs \(([^)]*)\)/.exec(SCHEMA_PG)?.[1] ?? '';

  assert.ok(modLogSqlite.length > 0, 'tabel mod_logs harus ada di schema SQLite');
  assert.ok(!/\bcontent\b/.test(modLogSqlite), 'mod_logs SQLite tidak boleh punya kolom content');
  assert.ok(!/\bcontent\b/.test(modLogPg), 'mod_logs PG tidak boleh punya kolom content');

  const { addModerationLog } = await import('../src/db/repo.js');
  const params = addModerationLog.length > 0 ? String(addModerationLog) : '';
  assert.ok(!/content/.test(params), 'addModerationLog tidak boleh menerima content');
});

await testAsync('dashboard moderasi tidak punya kolom "Pesan"', async () => {
  const { moderasiPage } = await import('../src/web/ui/pages.js');
  const html = moderasiPage({
    guildId: 'g-audit',
    guildName: 'Server Uji',
    enabled: true,
    words: ['anjing'],
    action: 'delete',
    timeoutMinutes: 10,
    fromEnv: false,
    logs: [
      { id: 1, userId: USER, userName: 'Bagas', channelId: 'c-1', matched: 'anjing', action: 'delete', createdAt: Date.now() },
    ],
    status: { online: false, mode: 'standalone', uptimeSeconds: 1 },
  });
  assert.ok(!html.includes('<th class="col-hide-sm">Pesan</th>'), 'kolom Pesan harus hilang dari tabel log');
  assert.ok(html.includes('Pelanggar'), 'kolom Pelanggar tetap ada');
  assert.ok(html.includes('anjing'), 'kata yang cocok tetap ditampilkan');
});

await testAsync('tidak ada endpoint yang membocorkan sesi DM ke dashboard', async () => {
  const source = await readFile(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('/api/rooms'), 'endpoint /api/rooms harus dihapus');
  assert.ok(!source.includes('api/memories'), 'endpoint memori harus tetap hilang');
  assert.ok(!source.includes('api/transkrip'), 'endpoint transkrip harus tetap hilang');
  assert.ok(!source.includes('api/memori'), 'endpoint memori harus tetap hilang');
});

await testAsync('halaman dashboard tidak menyajikan isi percakapan', async () => {
  const source = await readFile(new URL('../src/web/ui/pages.ts', import.meta.url), 'utf8');
  // Hanya nama member + jumlah pesan yang boleh tampil untuk sesi DM.
  const dmTable = source.slice(source.indexOf('Sesi DM terbaru'), source.indexOf('const docsCard'));
  assert.ok(!/content/i.test(dmTable), 'tabel sesi DM tidak boleh merender isi pesan');
});

await testAsync('admin tidak bisa membaca/menghapus memori member lain lewat Discord', async () => {
  const { memoriSlashSource, konsolidasiSlashSource } = await (async () => ({
    memoriSlashSource: await readFile(new URL('../src/commands/memori.ts', import.meta.url), 'utf8'),
    konsolidasiSlashSource: await readFile(new URL('../src/commands/konsolidasi.ts', import.meta.url), 'utf8'),
  }))();

  // Tidak boleh ada opsi `user` untuk menunjuk member lain.
  assert.ok(!memoriSlashSource.includes("addUserOption"), '/memori tidak boleh punya opsi user lain');
  assert.ok(!konsolidasiSlashSource.includes('addUserOption'), '/konsolidasi tidak boleh punya opsi user lain');

  // Target selalu diri sendiri.
  assert.match(memoriSlashSource, /const target: User = interaction\.user/, '/memori harus memakai interaction.user');
  assert.match(konsolidasiSlashSource, /const target: User = interaction\.user/, '/konsolidasi harus memakai interaction.user');
});

await testAsync('log moderasi ke Discord tidak memuat cuplikan isi pesan', async () => {
  const source = await readFile(new URL('../src/features/moderation.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('excerpt'), 'cuplikan pesan harus dihapus');
  assert.ok(!/• \*\*Pesan:\*\*|• Pesan:/.test(source), 'baris "Pesan:" di log harus dihapus');
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
    matched: 'anjing',
    action: 'delete',
  });
  const second = await addModerationLog({
    guildId: 'g-mod',
    channelId: 'c-2',
    userId: '999',
    userName: 'Rina',
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
    guildName: 'Server Uji',
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
    guildName: 'Server Uji',
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
    guildName: 'Server Uji',
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

console.log('\nSuara di room (TTS_REPLY_IN_ROOM)');
test('config voice.ttsReplyInRoom default true', () => {
  // Smoke env tidak setting TTS_REPLY_IN_ROOM → default harus true.
  assert.equal(config.voice.ttsReplyInRoom, true);
});
test('config voice.ttsEnabled default true', () => {
  assert.equal(config.voice.ttsEnabled, true);
});
test('config voice.sttModel default whisper-large-v3', () => {
  assert.equal(config.voice.sttModel, 'whisper-large-v3');
});

console.log('\nToggle fitur per server');
await testAsync('setGuildRagEnabled menyimpan boolean', async () => {
  const { setGuildRagEnabled, getGuildSettings } = await import('../src/db/repo.js');
  const guild = '131313131313131313';
  await setGuildRagEnabled(guild, true);
  assert.equal((await getGuildSettings(guild))?.ragEnabled, true);
  await setGuildRagEnabled(guild, false);
  assert.equal((await getGuildSettings(guild))?.ragEnabled, false);
  await setGuildRagEnabled(guild, null);
  assert.equal((await getGuildSettings(guild))?.ragEnabled, null);
});
await testAsync('vision selalu aktif: tidak ada kolom atau sakelar per server', async () => {
  const repo = await import('../src/db/repo.js');
  const { getGuildSettings, setGuildAutoMemory } = repo;
  const guild = '131313131313131313';
  await setGuildAutoMemory(guild, true);
  const settings = await getGuildSettings(guild);
  assert.ok(settings, 'setelan guild bisa dibaca');
  assert.equal('visionEnabled' in settings!, false, 'tidak ada field visionEnabled lagi');
  assert.equal('setGuildVisionEnabled' in repo, false, 'setter vision sudah dihapus');

  const schema = await readFile('src/db/schema.ts', 'utf8');
  assert.equal(/vision_enabled/.test(schema), false, 'kolom vision_enabled hilang dari skema');
});
await testAsync('setGuildAutoMemory menyimpan boolean', async () => {
  const { setGuildAutoMemory, getGuildSettings } = await import('../src/db/repo.js');
  const guild = '131313131313131313';
  await setGuildAutoMemory(guild, true);
  assert.equal((await getGuildSettings(guild))?.autoMemory, true);
  await setGuildAutoMemory(guild, null);
  assert.equal((await getGuildSettings(guild))?.autoMemory, null);
});
await testAsync('setGuildAdminOnlyRooms menyimpan boolean', async () => {
  const { setGuildAdminOnlyRooms, getGuildSettings } = await import('../src/db/repo.js');
  const guild = '131313131313131313';
  await setGuildAdminOnlyRooms(guild, true);
  assert.equal((await getGuildSettings(guild))?.adminOnlyRooms, true);
  await setGuildAdminOnlyRooms(guild, null);
  assert.equal((await getGuildSettings(guild))?.adminOnlyRooms, null);
});
test('pengaturanPage menampilkan toggle fitur', () => {
  const page = pengaturanPage({
    guildId: '123',
    guildName: 'Server Uji',
    persona: null,
    model: null,
    defaultModel: 'test',
    embedModel: null,
    ragEnabled: false,
    ttsReplyInRoom: null,
    ttsReplyInRoomDefault: true,
    ragEnabledSetting: null,
    ragEnabledDefault: true,
    autoMemorySetting: null,
    autoMemoryDefault: true,
    adminOnlyRoomsSetting: null,
    adminOnlyRoomsDefault: false,
    stats: { messages: 0, rooms: 0, documents: 0 },
    status: { online: false, mode: 'standalone', uptimeSeconds: 0 },
    counts: {},
  });
  assert.ok(page.includes('Dokumen RAG'), 'toggle RAG ada');
  assert.ok(page.includes('Auto Memory'), 'toggle Auto Memory ada');

  // Vision selalu aktif: tidak boleh ada sakelar yang bisa mematikannya.
  assert.equal(page.includes('id="visionEnabled"'), false, 'toggle Vision sudah dihapus');

  // Label lama "Chat khusus admin" ambigu — terbaca seolah membatasi semua chat
  // AI, padahal hanya tombol DM di panel yang dijaga.
  assert.equal(page.includes('Chat khusus admin'), false, 'label ambigu sudah diganti');
  assert.ok(page.includes('Tombol chat DM khusus admin'), 'label baru spesifik');
  assert.ok(page.includes('Manage Server'), 'menyebut izin yang dicek');
  assert.ok(page.includes('AI Agent di channel tidak terpengaruh'), 'menjelaskan batasnya');
});

console.log('\nSlash command di DM');

await testAsync('semua command didaftarkan untuk DM (user install + konteks BotDM)', async () => {
  const { commands } = await import('../src/commands/index.js');

  for (const command of commands) {
    const json = command.data.toJSON() as {
      contexts?: number[];
      integration_types?: number[];
      name: string;
    };

    // Discord hanya menampilkan command di DM bila integration type-nya
    // UserInstall (1) dan konteksnya memuat BotDM (1). Tanpa ini teks
    // "/akhiri" dikirim sebagai pesan biasa dan dijawab AI.
    assert.ok(
      json.integration_types?.includes(1),
      `/${json.name} harus mengizinkan user install`,
    );
    assert.ok(json.contexts?.includes(1), `/${json.name} harus mengizinkan konteks BotDM`);
    assert.ok(json.contexts?.includes(0), `/${json.name} tetap harus jalan di server`);
  }

  assert.ok(commands.length > 0, 'ada command yang terdaftar');
  // /tanya sudah dihapus — chat hanya lewat DM, tanpa perintah pembuka room.
  assert.equal(commands.some((c) => c.data.name === 'tanya'), false, '/tanya tidak ada lagi');
  assert.ok(commands.some((c) => c.data.name === 'akhiri'), '/akhiri terdaftar');
  // /server sudah dihapus permanen: bot ini untuk satu server.
  assert.equal(commands.some((c) => c.data.name === 'server'), false, '/server tidak terdaftar lagi');
});

await testAsync('register: global SELALU didaftarkan, bukan hanya per-guild', async () => {
  const source = await readFile('src/lib/register.ts', 'utf8');
  // Command per-guild tidak muncul di DM — global wajib, bukan opsional.
  assert.ok(source.includes('application.commands.set(body)'), 'mendaftarkan command global');
  assert.equal(
    /if\s*\(config\.discord\.(devGuildId|homeGuildId)\)\s*\{\s*[\s\S]{0,200}?application\.commands\.set/.test(source),
    false,
    'pendaftaran global tidak boleh bergantung pada pendaftaran per-server',
  );
});

await testAsync('fitur multi-server sudah dihapus total', async () => {
  const buttons = await readFile('src/features/buttons.ts', 'utf8');
  assert.equal(buttons.includes('dm:server:'), false, 'handler tombol pilih server hilang');
  assert.equal(buttons.includes('handleDmServerPick'), false, 'fungsi handler pilih server hilang');

  const dm = await readFile('src/features/dm.ts', 'utf8');
  assert.equal(dm.includes('listGuildChoices'), false, 'tidak ada lagi daftar server untuk dipilih');
  assert.equal(dm.includes('dmServerPickerEmbed'), false, 'embed pilih server hilang');
  assert.equal(dm.includes('setDmPrefGuild') || dm.includes('getDmPrefGuild'), false, 'preferensi server hilang');
});

await testAsync('/server tidak lagi terdaftar sebagai command', async () => {
  const index = await readFile('src/commands/index.ts', 'utf8');
  assert.equal(/from '\.\/server\.js'/.test(index), false, 'import /server hilang');
  assert.equal(/\bserverCommand\b/.test(index), false, 'entri /server hilang dari daftar command');
});

await testAsync('endDmSession melaporkan kegagalan kirim transkrip', async () => {
  const source = await readFile('src/features/dm.ts', 'utf8');
  assert.ok(source.includes('delivered'), 'ada penanda delivered');
  assert.ok(
    source.includes('delivered = false'),
    'kegagalan kirim transkrip tidak ditelan diam-diam',
  );
});

console.log('\nSatu bot, satu server');

await testAsync('GUILD_ID wajib dan divalidasi saat start', async () => {
  const source = await readFile('src/config.ts', 'utf8');
  assert.ok(source.includes('requiredGuildId'), 'ada skema GUILD_ID wajib');
  assert.equal(
    /guildId:\s*z\.string\(\)\.optional\(\)/.test(source),
    false,
    'GUILD_ID tidak boleh opsional lagi',
  );
  assert.ok(source.includes('homeGuildId'), 'config mengekspos homeGuildId');
  // Alias lama tetap diterima supaya .env lama tidak langsung rusak.
  assert.ok(source.includes('DEV_GUILD_ID'), 'alias DEV_GUILD_ID tetap diterima');
  assert.ok(source.includes('SERVER_ID'), 'alias SERVER_ID tetap diterima');
});

await testAsync('bot auto-leave server selain GUILD_ID dan memberi alasan', async () => {
  const source = await readFile('src/bot.ts', 'utf8');
  assert.ok(source.includes('leaveOtherGuilds'), 'ada fungsi auto-leave');
  assert.ok(source.includes('guild.leave()'), 'benar-benar keluar dari server lain');
  assert.ok(/hanya untuk satu server/i.test(source), 'menjelaskan alasannya ke admin server');
  assert.ok(source.includes('GuildCreate'), 'server baru langsung ditangani');
});

await testAsync('sesi DM memakai server rumah, bukan pilihan member', async () => {
  const source = await readFile('src/features/dm.ts', 'utf8');
  assert.ok(source.includes('homeGuild'), 'ada helper server rumah');
  assert.ok(source.includes('config.discord.homeGuildId'), 'memakai GUILD_ID');
  assert.equal(source.includes('/server'), false, 'tidak menyebut /server lagi di pesan');

  const block = source.slice(source.indexOf('export async function handleDmMessage'));
  assert.equal(/choices\[0\]/.test(block), false, 'tidak ada fallback "server pertama di cache"');
});

await testAsync('member yang bukan anggota server rumah diberi tahu cara fork', async () => {
  const source = await readFile('src/features/dm.ts', 'utf8');
  assert.ok(/bukan anggota/.test(source), 'pesan jelas saat bukan anggota');
  assert.ok(/fork repo/i.test(source), 'mengarahkan ke fork + API key sendiri');
});

await testAsync('dashboard memakai nama server untuk label, bukan daftar', async () => {
  const repo = await readFile('src/db/repo.ts', 'utf8');
  assert.ok(repo.includes('export async function getGuildName'), 'ada getGuildName');
  assert.equal(repo.includes('export async function listGuilds'), false, 'listGuilds dihapus');
});

await testAsync('/akhiri memberi tahu bahwa sesi baru bisa dimulai langsung di DM', async () => {
  const source = await readFile('src/features/dm.ts', 'utf8');
  assert.ok(source.includes('Langsung tulis di chat ini'), 'menjelaskan tidak perlu klik panel lagi');
  assert.ok(source.includes('Sesi baru dimulai'), 'memberi tahu saat sesi baru dibuka otomatis');
});

console.log('\nCommand di DM');

await testAsync('/reset bisa dipakai di DM (bukan hanya di server)', async () => {
  const source = await readFile('src/commands/reset.ts', 'utf8');
  // requireGuild() membuat /reset selalu ditolak di DM, padahal yang dihapus
  // justru riwayat percakapan DM.
  assert.equal(
    /requireGuild\(interaction\)/.test(source),
    false,
    '/reset tidak boleh memaksa dijalankan di server',
  );
  assert.ok(source.includes('isDirectMessage'), '/reset sadar konteks DM');
  assert.ok(source.includes('clearHistory'), '/reset tetap menghapus riwayat');
  // `/tanya` sudah dihapus dari bot — jangan disebut lagi di pesan bantuan.
  assert.equal(source.includes('/tanya'), false, 'pesan /reset tidak menyebut /tanya');
});

await testAsync('hanya command pengaturan server yang dikunci ke server', async () => {
  for (const name of ['dokumen', 'keyword', 'panel', 'persona']) {
    const source = await readFile(`src/commands/${name}.ts`, 'utf8');
    assert.ok(
      /requireGuild\(interaction\)|requireAdmin\(interaction\)/.test(source),
      `/${name} memang harus di server (mengubah pengaturan server)`,
    );
  }
});

await testAsync('panduan menjelaskan beda /reset dan /akhiri', async () => {
  const { helpEmbed } = await import('../src/features/ui.js');
  const embed = helpEmbed('Zypher').toJSON();
  const text = (embed.fields ?? []).map((f) => `${f.name}\n${f.value}`).join('\n');

  assert.ok(text.includes('/reset'), '/bantuan menyebut /reset');
  assert.ok(text.includes('/akhiri'), '/bantuan menyebut /akhiri');
  assert.ok(/`\/reset` vs `\/akhiri`/.test(text), 'ada penjelasan bedanya');
  assert.equal(text.includes('/tanya'), false, 'tidak menyebut /tanya yang sudah dihapus');
});

await testAsync('requireGuild menjelaskan kenapa harus di server', async () => {
  const source = await readFile('src/commands/helpers.ts', 'utf8');
  const block = source.slice(source.indexOf('export async function requireGuild'), source.indexOf('export async function requireAdmin'));
  assert.ok(block.includes('mengubah pengaturan server'), 'menjelaskan alasannya');
  assert.ok(block.includes('/akhiri'), 'menyebut command yang bisa dipakai di DM');
});

console.log('\nAlignment UI');

await testAsync('card-head: teks di samping judul tidak turun (margin .hint direset)', async () => {
  const { STYLE } = await import('../src/web/ui/theme.js');
  // .hint global punya margin-top 8px. Di dalam .card-head itu membuat teks
  // di samping judul kartu turun ~4px dari judulnya.
  // Ambil isi rule-nya (antara { dan }), bukan 220 karakter pertama — komentar
  // penjelas di dalam rule bisa lebih panjang dari itu.
  const start = STYLE.indexOf('.card-head .hint');
  const block = STYLE.slice(start, STYLE.indexOf('}', start));
  assert.ok(block.includes('margin: 0'), '.card-head .hint harus margin:0');
});

await testAsync('select-shell: chevron menempel ke ujung <select>, bukan tepi shell', async () => {
  const { STYLE } = await import('../src/web/ui/theme.js');
  const shell = STYLE.slice(STYLE.indexOf('.select-shell {'), STYLE.indexOf('.select-shell select'));
  assert.ok(shell.includes('max-width: 100%'), 'shell dibatasi supaya tidak lebih lebar dari select');
  const select = STYLE.slice(STYLE.indexOf('.select-shell select {'), STYLE.indexOf('.select-shell select:hover'));
  assert.ok(select.includes('width: 100%'), 'select mengisi lebar shell');
});

await testAsync('tabel Sesi DM: kolom Pesan punya kelas sendiri, bukan .num rata kanan', async () => {
  const source = await readFile('src/web/ui/pages.ts', 'utf8');
  const card = source.slice(source.indexOf('Sesi DM terbaru'), source.indexOf('Sesi DM terbaru') + 700);
  assert.ok(card.includes('col-count'), 'header Pesan memakai col-count');
  assert.equal(
    /<th class="num">Pesan<\/th>/.test(card),
    false,
    'header Pesan tidak lagi memakai .num (yang rata kanan dan mengambang)',
  );

  const { STYLE } = await import('../src/web/ui/theme.js');
  const rule = STYLE.slice(STYLE.indexOf('.col-count {'), STYLE.indexOf('.col-count {') + 200);
  assert.ok(rule.includes('text-align: left'), 'kolom angka rata kiri, sejajar judulnya');
  assert.ok(rule.includes('width: 92px'), 'lebar kolom dipatok supaya angka tidak di tengah sel');
});

await testAsync('Moderasi: badge status hanya muncul sekali', async () => {
  const source = await readFile('src/web/ui/pages.ts', 'utf8');
  // Badge dulu dipasang di pageHead.actions DAN card right -> terbaca 2x.
  assert.equal(
    /kicker: '08 — Keamanan'[\s\S]{0,400}?actions: status/.test(source),
    false,
    'badge tidak lagi dipasang di judul halaman Moderasi',
  );

  // Kartu "Filter kata" ada SEBELUM pageHead, jadi jangan potong dari judul.
  const cardStart = source.indexOf("title: 'Filter kata'");
  const card = source.slice(cardStart, cardStart + 400);
  assert.ok(card.includes('right: status'), 'badge tetap ada di header kartu Filter kata');
  // Batasi ke fungsi moderasiPage — halaman Panel juga punya `right: status`.
  const fnStart = source.indexOf('export function moderasiPage');
  const fnEnd = source.indexOf('export function ', fnStart + 10);
  const moderasi = source.slice(fnStart, fnEnd);
  assert.equal((moderasi.match(/right: status\b/g) ?? []).length, 1, 'badge dipasang tepat satu kali');
});

console.log('\nScreenshot dokumentasi');
await testAsync('screenshot: tidak ada file yang membocorkan halaman privasi', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir('docs/screenshots');
  const names = files.filter((f) => f.endsWith('.png'));

  // Halaman memori & transkrip sudah dihapus dari dashboard — screenshot-nya
  // juga tidak boleh ada di repo.
  assert.equal(
    names.some((f) => f.startsWith('memori-') || f.startsWith('transkrip-')),
    false,
    'tidak ada screenshot memori/transkrip',
  );

  // Daftar halaman diambil dari script screenshot itu sendiri, supaya halaman
  // baru tidak bisa lolos tanpa screenshot (dulu 'agent' tidak ikut dicek).
  const shots = await readFile('scripts/screenshots.ts', 'utf8');
  const pages = [...shots.matchAll(/\['([a-z-]+)', '\//g)].map((m) => m[1]);
  assert.ok(pages.length >= 8, `ada ${pages.length} halaman yang di-screenshot`);
  for (const slug of pages) {
    assert.ok(names.includes(`${slug}-desktop.png`), `screenshot ${slug}-desktop.png ada`);
    assert.ok(names.includes(`${slug}-mobile.png`), `screenshot ${slug}-mobile.png ada`);
  }
  assert.ok(names.includes('login-mobile.png'), 'screenshot login ada');
});

await testAsync('screenshot: README hanya menyebut file yang benar-benar ada', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir('docs/screenshots');
  const readme = await readFile('docs/screenshots/README.md', 'utf8');

  for (const match of readme.matchAll(/`([a-z-]+\.png)`/g)) {
    assert.ok(files.includes(match[1]), `${match[1]} yang disebut README benar-benar ada`);
  }

  // Dokumentasi tidak boleh mengklaim halaman yang sudah dihapus.
  assert.equal(readme.includes('memori-mobile.png'), false, 'README tanpa screenshot memori');
  assert.equal(readme.includes('transkrip-'), false, 'README tanpa screenshot transkrip');
});

await testAsync('screenshot: seed menolak database non-demo', async () => {
  const source = await readFile('scripts/screenshots-seed.ts', 'utf8');
  assert.ok(source.includes("dbPath.includes('screenshot')"), 'seed memeriksa nama database');
  assert.ok(source.includes("'[pertanyaan member]'"), 'isi pesan demo berupa penanda, bukan kalimat asli');
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

/* ------------------------------------------------------------------ */
/*  Sambutan member baru & AI Agent                                    */
/* ------------------------------------------------------------------ */

console.log('\nAI Agent di channel');

const agentSettings = (patch: Record<string, unknown> = {}) => ({
  guildId: GUILD,
  channelId: '444444444444444444',
  galleryChannelId: null,
  quietMinutes: 45,
  maxPerHour: 6,
  reactEmoji: true,
  reactImages: true,
  busyMute: true,
  cooldownSeconds: 90,
  updatedAt: 0,
  ...patch,
});

const welcomeSettings = (patch: Record<string, unknown> = {}) => ({
  guildId: GUILD,
  channelId: null,
  enabled: true,
  useAi: true,
  template: null,
  style: null,
  example: null,
  imageEnabled: false,
  includeAvatar: true,
  bannerPath: null,
  updatedAt: 0,
  ...patch,
});

const goodbyeSettings = (patch: Record<string, unknown> = {}) => ({
  guildId: GUILD,
  channelId: '333333333333333333',
  enabled: true,
  useAi: true,
  template: null,
  style: null,
  example: null,
  imageEnabled: false,
  includeAvatar: true,
  bannerPath: null,
  updatedAt: 0,
  ...patch,
});

await testAsync('agent: channel selain yang diaktifkan tidak disentuh', async () => {
  const { shouldReply, emptyState } = await import('../src/features/agent-core.js');
  const decision = shouldReply({
    settings: agentSettings(),
    state: emptyState(),
    channelId: '999999999999999999',
    fromBot: false,
    summoned: false,
    now: Date.now(),
  });
  assert.equal(decision.reply, false);
  assert.equal(decision.reason, 'other-channel');
});

await testAsync('agent: mati saat channel belum diatur', async () => {
  const { shouldReply, emptyState } = await import('../src/features/agent-core.js');
  const decision = shouldReply({
    settings: agentSettings({ channelId: null }),
    state: emptyState(),
    channelId: '444444444444444444',
    fromBot: false,
    summoned: true,
    now: Date.now(),
  });
  assert.equal(decision.reply, false);
  assert.equal(decision.reason, 'disabled');
});

await testAsync('agent: diam saat obrolan ramai, tapi tetap jawab kalau dipanggil', async () => {
  const { shouldReply, recordTrace, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  let state = emptyState();
  // Tiga member berbeda bicara dalam 30 detik terakhir → ramai.
  state = recordTrace(state, 'user-a', now - 30_000);
  state = recordTrace(state, 'user-b', now - 20_000);
  state = recordTrace(state, 'user-c', now - 5_000);

  const nimbrung = shouldReply({
    settings: agentSettings({ cooldownSeconds: 0 }),
    state,
    channelId: '444444444444444444',
    fromBot: false,
    summoned: false,
    now,
  });
  assert.equal(nimbrung.reply, false);
  assert.equal(nimbrung.reason, 'busy');

  // Dipanggil langsung → tetap menjawab meski ramai.
  const dipanggil = shouldReply({
    settings: agentSettings({ cooldownSeconds: 0 }),
    state,
    channelId: '444444444444444444',
    fromBot: false,
    summoned: true,
    now,
  });
  assert.equal(dipanggil.reply, true, 'mention/reply harus selalu dijawab');
});

await testAsync('agent: satu member sendirian tetap dilayani', async () => {
  const { shouldReply, recordTrace, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  let state = emptyState();
  state = recordTrace(state, 'user-a', now - 3000);
  state = recordTrace(state, 'user-a', now - 1000);

  const decision = shouldReply({
    settings: agentSettings({ cooldownSeconds: 0 }),
    state,
    channelId: '444444444444444444',
    fromBot: false,
    summoned: false,
    now,
  });
  assert.equal(decision.reply, true, 'satu orang ngobrol = bot boleh menanggapi');
});

await testAsync('agent: jatah per jam membatasi walau dipanggil', async () => {
  const { shouldReply, recordReply, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  let state = emptyState();
  for (let i = 0; i < 6; i += 1) state = recordReply(state, now - i * 1000);

  const decision = shouldReply({
    settings: agentSettings({ maxPerHour: 6, cooldownSeconds: 0 }),
    state,
    channelId: '444444444444444444',
    fromBot: false,
    summoned: true,
    now,
  });
  assert.equal(decision.reply, false);
  assert.equal(decision.reason, 'hourly-limit', 'pengaman biaya API tetap berlaku');
});

await testAsync('agent: jatah per jam dihitung ulang setelah 1 jam', async () => {
  const { shouldReply, recordReply, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  let state = emptyState();
  for (let i = 0; i < 6; i += 1) state = recordReply(state, now - 3_700_000 - i * 1000);

  const decision = shouldReply({
    settings: agentSettings({ maxPerHour: 6, cooldownSeconds: 0 }),
    state,
    channelId: '444444444444444444',
    fromBot: false,
    summoned: true,
    now,
  });
  assert.equal(decision.reply, true, 'balasan lama tidak lagi dihitung');
});

await testAsync('agent: cooldown mencegah bot membalas beruntun', async () => {
  const { shouldReply, recordReply, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  const state = recordReply(emptyState(), now - 10_000);

  const decision = shouldReply({
    settings: agentSettings({ cooldownSeconds: 90 }),
    state,
    channelId: '444444444444444444',
    fromBot: false,
    summoned: false,
    now,
  });
  assert.equal(decision.reply, false);
  assert.equal(decision.reason, 'cooldown');
});

await testAsync('agent: tidak pernah membalas pesan bot lain', async () => {
  const { shouldReply, emptyState } = await import('../src/features/agent-core.js');
  const decision = shouldReply({
    settings: agentSettings({ cooldownSeconds: 0 }),
    state: emptyState(),
    channelId: '444444444444444444',
    fromBot: true,
    summoned: true,
    now: Date.now(),
  });
  assert.equal(decision.reply, false);
  assert.equal(decision.reason, 'from-bot');
});

await testAsync('agent: menyapa saat sepi hanya setelah batas waktu', async () => {
  const { shouldBreakSilence, recordTrace, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  const settings = agentSettings({ quietMinutes: 45, cooldownSeconds: 0 });

  // 10 menit lalu masih ada obrolan → belum sepi.
  assert.equal(
    shouldBreakSilence(settings, recordTrace(emptyState(), 'u1', now - 10 * 60_000), now),
    false,
  );
  // 50 menit tanpa pesan → sepi, boleh menyapa.
  assert.equal(
    shouldBreakSilence(settings, recordTrace(emptyState(), 'u1', now - 50 * 60_000), now),
    true,
  );
  // quietMinutes 0 = tidak pernah menyapa sendiri.
  assert.equal(
    shouldBreakSilence(agentSettings({ quietMinutes: 0 }), recordTrace(emptyState(), 'u1', now - 50 * 60_000), now),
    false,
  );
});

await testAsync('agent: tidak bicara ke channel yang belum pernah ada obrolan', async () => {
  const { shouldBreakSilence, emptyState } = await import('../src/features/agent-core.js');
  assert.equal(shouldBreakSilence(agentSettings(), emptyState(), Date.now()), false);
});

await testAsync('agent: settings tersimpan per server', async () => {
  const { getAgentSettings, saveAgentSettings } = await import('../src/db/repo.js');
  const guild = '777777777777777777';
  assert.equal((await getAgentSettings(guild)).channelId, null, 'default: mati');

  await saveAgentSettings(guild, { channelId: '888888888888888888', maxPerHour: 9, reactImages: false });
  const saved = await getAgentSettings(guild);
  assert.equal(saved.channelId, '888888888888888888');
  assert.equal(saved.maxPerHour, 9);
  assert.equal(saved.reactImages, false);

  // Matikan lagi dengan channelId null.
  await saveAgentSettings(guild, { channelId: null });
  assert.equal((await getAgentSettings(guild)).channelId, null);
});

await testAsync('agent: pesan yang sama tidak ditanggapi dua kali', async () => {
  const { hasAgentReaction, markAgentReaction } = await import('../src/db/repo.js');
  const messageId = 'agent-msg-1';
  assert.equal(await hasAgentReaction(messageId), false);
  await markAgentReaction(messageId);
  assert.equal(await hasAgentReaction(messageId), true);
  // Idempotent.
  await markAgentReaction(messageId);
  assert.equal(await hasAgentReaction(messageId), true);
});

console.log('\nSambutan member baru');

await testAsync('sambutan: default mati, jadi server lama tidak berubah perilakunya', async () => {
  const { getWelcomeSettings } = await import('../src/db/repo.js');
  const settings = await getWelcomeSettings('666666666666666666');
  assert.equal(settings.enabled, false);
  assert.equal(settings.channelId, null);
  assert.equal(settings.useAi, true, 'kalau dinyalakan, default-nya memakai AI');
  assert.equal(settings.imageEnabled, true);
});

await testAsync('sambutan: template mengisi {user} dan {server}', async () => {
  const { fillTemplate } = await import('../src/features/welcome.js');
  const member = {
    displayName: 'Sky',
    user: { username: 'sky123' },
    guild: { name: 'Komunitas Zypher' },
  } as unknown as Parameters<typeof fillTemplate>[1];

  assert.equal(
    fillTemplate('Halo {user}, selamat datang di {server}!', member),
    'Halo Sky, selamat datang di Komunitas Zypher!',
  );
  // Nama panggilan (nickname) dipakai, bukan username.
  const tanpaNick = { ...member, displayName: '' } as typeof member;
  assert.ok(fillTemplate('Hai {user}', tanpaNick).includes('sky123'));
});

await testAsync('sambutan: prompt melarang pembuka khas bot & membatasi panjang', async () => {
  const { buildWelcomePrompt } = await import('../src/features/preview.js');
  const member = { name: 'Sky', guildName: 'Komunitas Zypher' };

  const prompt = buildWelcomePrompt(
    { ...welcomeSettings({ style: 'santai' }) },
    member,
    'pagi',
  );
  assert.ok(prompt.includes('Sky'), 'menyebut nama panggilan');
  assert.ok(/[Jj]angan memakai pembuka khas AI/.test(prompt), 'melarang pembuka khas bot');
  assert.ok(prompt.includes('220 karakter'), 'membatasi panjang sapaan');
  assert.ok(prompt.includes('pagi'), 'menyebut waktu');
});

await testAsync('sambutan: settings tersimpan dan bisa dimatikan lagi', async () => {
  const { getWelcomeSettings, saveWelcomeSettings } = await import('../src/db/repo.js');
  const guild = '666666666666666667';
  await saveWelcomeSettings(guild, { enabled: true, channelId: null, template: 'Halo {user}' });

  const saved = await getWelcomeSettings(guild);
  assert.equal(saved.enabled, true);
  assert.equal(saved.template, 'Halo {user}');
  assert.equal(saved.channelId, null, 'null = kirim lewat DM');

  await saveWelcomeSettings(guild, { enabled: false });
  assert.equal((await getWelcomeSettings(guild)).enabled, false);
  // Field lain tidak ikut terhapus saat patch sebagian.
  assert.equal((await getWelcomeSettings(guild)).template, 'Halo {user}');
});

await testAsync('sambutan: bot lain tidak disambut', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  // Sekarang alasannya ikut dicatat supaya log bisa menjelaskan kenapa diam.
  assert.ok(/if \(member\.user\.bot\)/.test(source), 'member bot dilewati');
  assert.ok(source.includes('member yang bergabung adalah bot'), 'alasan dilewati dicatat');
});

await testAsync('sambutan: hasil pengiriman membawa alasan gagal', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  // Dulu `sent: false` tanpa alasan: log hanya bisa bilang "tidak terkirim",
  // tidak bisa bilang kenapa. Itu yang membuat kebuntuan sulit didiagnosis.
  assert.ok(/reason\?: string/.test(source), 'WelcomeOutcome punya reason');
  assert.ok(source.includes('reason: errorMessage(error)'), 'error pengiriman disimpan sebagai alasan');
});

await testAsync('sambutan: kartu gagal dirender tetap mengirim embed', async () => {
  // Log nyata: "Kartu sambutan PNG dilewati: Chromium tidak ditemukan".
  // Dulu hasilnya payload tanpa embed & tanpa file -> Discord menolak pesan
  // kosong, sambutan hilang tanpa error yang terlihat.
  const source = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(/const cardFailed = settings\.imageEnabled && !attachment/.test(source), 'kegagalan kartu dideteksi');
  assert.ok(source.includes('dikirim sebagai embed teks'), 'mundur ke embed, bukan pesan kosong');
});

await testAsync('sambutan: tidak pernah mengirim pesan kosong', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(
    /embeds\.length === 0 && files\.length === 0/.test(source),
    'ada jaring pengaman pesan kosong',
  );
  assert.ok(source.includes('dikirim sebagai teks polos'), 'jatuh ke teks polos, bukan gagal diam');
});

await testAsync('sambutan: token template {user.mention} & {memberCount} jalan', async () => {
  const { fillText } = await import('../src/features/greeting-text.js');
  const hasil = fillText('Hai {user.mention} ({user.tag}), kamu member ke-{memberCount} di {server}!', {
    user: 'Sky',
    server: 'Zypher',
    mention: '<@123>',
    tag: 'sky#0001',
    memberCount: 42,
  });
  assert.equal(hasil, 'Hai <@123> (sky#0001), kamu member ke-42 di Zypher!');
});

await testAsync('sambutan: {user} tetap nama biasa, bukan mention', async () => {
  // Template lama yang tersimpan di admin memakai {user} dan mengharapkan
  // nama. Mengubahnya jadi mention akan diam-diam mengubah pesan mereka.
  const { fillText } = await import('../src/features/greeting-text.js');
  assert.equal(fillText('Halo {user}', { user: 'Sky', server: 'Z', mention: '<@1>' }), 'Halo Sky');
});

await testAsync('sambutan: token tanpa nilai tidak menyisakan <@undefined>', async () => {
  const { fillText } = await import('../src/features/greeting-text.js');
  const hasil = fillText('Hai {user.mention} di {server}', { user: 'Sky', server: 'Z' });
  assert.equal(hasil, 'Hai Sky di Z');
  assert.ok(!hasil.includes('undefined'), 'tidak ada undefined bocor ke pesan');
});

await testAsync('sambutan: izin Embed Links kurang tetap mengirim teks', async () => {
  // Pola TitanBot: tanpa EmbedLinks jangan gagal, kirim content biasa.
  const source = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(source.includes('EmbedLinks'), 'memeriksa izin EmbedLinks');
  assert.ok(source.includes('dikirim sebagai teks biasa'), 'mundur ke teks biasa');
});

await testAsync('sambutan: izin Attach Files kurang melewati lampiran saja', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(source.includes('AttachFiles'), 'memeriksa izin AttachFiles');
  assert.ok(source.includes('lampiran (kartu/banner) dilewati'), 'hanya lampiran yang dilewati');
});

await testAsync('sambutan: channel bermasalah melaporkan alasan spesifik', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  // Dulu `fetchChannel` mengembalikan null tanpa penjelasan, lalu jatuh ke DM
  // diam-diam — sambutan bisa hilang total dari channel yang sudah diatur.
  assert.ok(/resolveWelcomeChannel\(/.test(source), 'memakai resolver yang menjelaskan alasan');
  assert.ok(source.includes('bot tidak punya izin'), 'alasan izin disebut');
  assert.ok(source.includes('dilewati ('), 'alasan masuk log');
});

await testAsync('sambutan: event dicatat sebelum disaring', async () => {
  // Tanpa log ini, "intent mati" dan "event sengaja dilewati" terlihat sama
  // persis dari log: tidak ada apa pun.
  const source = await readFile('src/events/guildMemberAdd.ts', 'utf8');
  assert.ok(source.includes('Event member masuk:'), 'event join dicatat');
  assert.ok(source.includes('Event member keluar:'), 'event leave dicatat');
  const joinLog = source.indexOf('Event member masuk:');
  const joinFilter = source.indexOf('homeGuildId');
  assert.ok(joinLog < joinFilter, 'log ditulis SEBELUM penyaringan GUILD_ID');
});

await testAsync('bot: status intent Server Members dilaporkan saat start', async () => {
  // Tanpa intent ini Discord tidak pernah mengirim event member, dan tidak ada
  // error sama sekali — harus dilaporkan aktif/nonaktif secara eksplisit.
  const source = await readFile('src/bot.ts', 'utf8');
  assert.ok(source.includes('GatewayIntentBits.GuildMembers'), 'intent diminta');
  assert.ok(/hasMembersIntent/.test(source), 'status intent diperiksa');
  assert.ok(source.includes('Intent Server Members NONAKTIF'), 'peringatan jelas kalau mati');
});

await testAsync('sambutan: hanya untuk server rumah', async () => {
  const source = await readFile('src/events/guildMemberAdd.ts', 'utf8');
  assert.ok(source.includes('config.discord.homeGuildId'), 'memeriksa GUILD_ID');
});

await testAsync('kartu sambutan membungkus teks panjang tanpa melewati lebar', async () => {
  const { wrap } = await import('../src/features/welcome-card.js');
  const panjang = 'Halo Sky, selamat datang di komunitas kami! Semoga betah dan seru-seruan bareng yang lain ya.';
  const lines = wrap(panjang, 52, 3);
  assert.ok(lines.length <= 3, 'maksimal 3 baris');
  for (const line of lines) assert.ok(line.length <= 52, `baris "${line}" terlalu panjang`);

  const pendek = wrap('Halo J!', 52, 3);
  assert.deepEqual(pendek, ['Halo J!']);

  // Teks yang dipotong diberi elipsis.
  const terpotong = wrap('kata '.repeat(80), 20, 2);
  assert.ok(terpotong[terpotong.length - 1]?.endsWith('…'), 'penanda potongan');
});

await testAsync('dashboard: Sambutan dan AI Agent jadi DUA halaman terpisah', async () => {
  const shell = await readFile('src/web/ui/shell.ts', 'utf8');
  assert.ok(shell.includes("href: '/sambutan'"), 'menu Sambutan ada');
  assert.ok(shell.includes("href: '/agent'"), 'menu AI Agent ada');
  assert.ok(shell.includes("key: 'agent'"), 'key halaman agent terdaftar');

  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("path === '/agent'"), 'route agent ada');
  assert.ok(server.includes("path === '/api/welcome'"), 'API sambutan ada');
  assert.ok(server.includes("path === '/api/goodbye'"), 'API perpisahan ada');
  assert.ok(server.includes("path === '/api/agent'"), 'API agent ada');

  // Halaman gabungan sudah tidak ada lagi.
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.equal(pages.includes('sambutanPage'), false, 'halaman gabungan dihapus');
  assert.ok(pages.includes('export function welcomePage'), 'halaman sambutan ada');
  assert.ok(pages.includes('export function agentPage'), 'halaman agent ada');
});

await testAsync('dashboard: input angka agent dibatasi sebelum disimpan', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  // Tanpa clamp, nilai 0/9999 dari form bisa mematikan pengaman biaya.
  assert.ok(server.includes('clamp(payload.maxPerHour, 1, 60'), 'batas per jam dijaga');
  assert.ok(server.includes('clamp(payload.quietMinutes, 0, 1440'), 'batas menit sepi dijaga');
  // Bentuk di sumber: /^\\d{17,20}$/ (backslash literal di file .ts).
  assert.ok(server.includes('\\d{17,20}'), 'channel ID divalidasi 17–20 digit');
});

await testAsync('privasi: agent tidak menyimpan transkrip ke database', async () => {
  const source = await readFile('src/features/agent.ts', 'utf8');
  // State hanya di memori (Map) — tidak boleh ada INSERT ke tabel pesan.
  assert.ok(source.includes('const channels = new Map'), 'state di memori');
  assert.equal(
    /appendMessage|INSERT INTO messages/.test(source),
    false,
    'tidak menyimpan isi obrolan channel ke database',
  );
});

await testAsync('privasi: sambutan default dikirim lewat DM, bukan channel', async () => {
  const welcome = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(welcome.includes('member.send'), 'ada jalur DM');
  assert.ok(
    /settings\.channelId\s*&&\s*settings\.channelId !== member\.guild\.id/.test(welcome) ||
      welcome.includes('settings.channelId && settings.channelId !== member.guild.id'),
    'channel hanya dipakai kalau admin memilihnya',
  );
});

await testAsync('bot: intent GuildMembers & reaksi ditambahkan', async () => {
  const source = await readFile('src/bot.ts', 'utf8');
  assert.ok(source.includes('GatewayIntentBits.GuildMembers'), 'intent member baru');
  assert.ok(source.includes('Events.GuildMemberAdd'), 'handler member baru terpasang');
  assert.ok(source.includes('startQuietWatcher'), 'timer channel sepi terpasang');
});


await testAsync('settings agent: patch sebagian tidak mereset field lain', async () => {
  const { getAgentSettings, saveAgentSettings } = await import('../src/db/repo.js');
  const guild = '777777777777777778';
  await saveAgentSettings(guild, { channelId: '101010101010101010', reactImages: false, maxPerHour: 12 });

  // Permintaan kedua hanya mengirim satu field (mis. dari API lain).
  await saveAgentSettings(guild, { quietMinutes: 20 });
  const saved = await getAgentSettings(guild);
  assert.equal(saved.maxPerHour, 12, 'nilai lama tidak ikut terhapus');
  assert.equal(saved.reactImages, false, 'toggle lama dipertahankan');
  assert.equal(saved.quietMinutes, 20, 'field baru tersimpan');
});

await testAsync('API agent & sambutan mempertahankan nilai yang tidak dikirim', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  // Tanpa pola ini, menyimpan sebagian akan mematikan toggle lain diam-diam.
  const agentBlock = server.slice(server.indexOf("path === '/api/agent'"), server.indexOf("path === '/api/moderasi'"));
  assert.ok(agentBlock.includes('current.reactImages'), 'nilai lama dipakai sebagai fallback');
  assert.ok(agentBlock.includes('bool('), 'ada helper yang membedakan "tidak dikirim" vs "false"');

  const welcomeBlock = server.slice(server.indexOf("path === '/api/welcome'"), server.indexOf("path === '/api/agent'"));
  assert.ok(welcomeBlock.includes("'template' in payload"), 'template hanya diubah kalau dikirim');
});


console.log('\nAI Agent: channel galeri');

await testAsync('galeri: channel galeri dikenali sebagai peran "gallery"', async () => {
  const { channelRole } = await import('../src/features/agent-core.js');
  const settings = agentSettings({ galleryChannelId: '555555555555555555' });

  assert.equal(channelRole(settings, '444444444444444444'), 'chat', 'channel ngobrol');
  assert.equal(channelRole(settings, '555555555555555555'), 'gallery', 'channel galeri');
  assert.equal(channelRole(settings, '999999999999999999'), null, 'channel lain');
});

await testAsync('galeri: bisa hidup tanpa channel ngobrol', async () => {
  const { channelRole, shouldReply, emptyState } = await import('../src/features/agent-core.js');
  const settings = agentSettings({ channelId: null, galleryChannelId: '555555555555555555' });

  assert.equal(channelRole(settings, '555555555555555555'), 'gallery');
  const decision = shouldReply({
    settings,
    state: emptyState(),
    channelId: '555555555555555555',
    fromBot: false,
    summoned: false,
    now: Date.now(),
  });
  assert.equal(decision.reply, true, 'galeri tetap boleh membalas walau channel ngobrol mati');
});

await testAsync('galeri: fitur mati total hanya kalau kedua channel kosong', async () => {
  const { shouldReply, emptyState } = await import('../src/features/agent-core.js');
  const decision = shouldReply({
    settings: agentSettings({ channelId: null, galleryChannelId: null }),
    state: emptyState(),
    channelId: '444444444444444444',
    fromBot: false,
    summoned: true,
    now: Date.now(),
  });
  assert.equal(decision.reason, 'disabled');
});

await testAsync('galeri: tidak pernah menyapa sendiri saat sepi', async () => {
  const { shouldBreakSilence, recordTrace, emptyState } = await import('../src/features/agent-core.js');
  const now = Date.now();
  // Hanya galeri yang aktif — tidak ada channel ngobrol untuk disapa.
  const settings = agentSettings({ channelId: null, galleryChannelId: '555555555555555555', quietMinutes: 1 });
  assert.equal(shouldBreakSilence(settings, recordTrace(emptyState(), 'u1', now - 10 * 60_000), now), false);
});

console.log('\nAI Agent: riwayat percakapan di memori');

await testAsync('riwayat: giliran percakapan dibatasi 8 terakhir', async () => {
  const { pushTurn, emptyState, MEMORY_TURNS } = await import('../src/features/agent-core.js');
  let state = emptyState();
  for (let i = 0; i < 20; i += 1) {
    state = pushTurn(state, { userId: 'u1', userName: 'Sky', role: i % 2 === 0 ? 'user' : 'bot', text: `pesan ${i}`, at: i });
  }
  assert.equal(state.turns.length, MEMORY_TURNS, 'dibatasi supaya prompt tidak membengkak');
  assert.equal(state.turns[state.turns.length - 1]?.text, 'pesan 19', 'yang terbaru dipertahankan');
});

await testAsync('riwayat: disimpan di MEMORI, bukan database', async () => {
  const source = await readFile('src/features/agent.ts', 'utf8');
  assert.ok(source.includes('state.turns'), 'riwayat dibaca dari state');
  assert.ok(source.includes('pushTurn'), 'percakapan dicatat ke state');
  // Privasi: tidak boleh ada INSERT ke tabel pesan untuk channel publik.
  assert.equal(/appendMessage|INSERT INTO messages/.test(source), false, 'tidak menulis ke tabel messages');
});

console.log('\nSalam perpisahan (goodbye)');

await testAsync('goodbye: default mati', async () => {
  const { getGoodbyeSettings } = await import('../src/db/repo.js');
  const settings = await getGoodbyeSettings('999999999999999001');
  assert.equal(settings.enabled, false);
  assert.equal(settings.channelId, null, 'wajib pilih channel — DM tidak mungkin');
  assert.equal(settings.useAi, true);
});

await testAsync('goodbye: template mengisi {user} dan {server}', async () => {
  const { fillGoodbyeTemplate } = await import('../src/features/welcome.js');
  const member = {
    displayName: 'Sky',
    user: { username: 'sky123' },
    guild: { name: 'Komunitas Zypher' },
  } as unknown as Parameters<typeof fillGoodbyeTemplate>[1];

  assert.equal(
    fillGoodbyeTemplate('{user} keluar dari {server}.', member),
    'Sky keluar dari Komunitas Zypher.',
  );
});

await testAsync('goodbye: prompt tidak menanyakan alasan keluar & singkat', async () => {
  const { buildGoodbyePrompt } = await import('../src/features/preview.js');
  const member = { name: 'Sky', guildName: 'Komunitas Zypher' };

  const prompt = buildGoodbyePrompt(
    { ...goodbyeSettings({ channelId: '123' }) },
    member,
  );
  assert.ok(/[Jj]angan menanyakan alasan keluar/.test(prompt), 'melarang menanyakan alasan');
  assert.ok(prompt.includes('180 karakter'), 'membatasi panjang');
  assert.ok(prompt.includes('Sky'), 'menyebut nama');
});

await testAsync('goodbye: tidak dikirim kalau channel belum diatur', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  const block = source.slice(source.indexOf('export async function goodbyeMember'));
  // Member sudah keluar → DM mustahil; tanpa channel, lebih baik diam.
  assert.ok(/if \(!channel\)/.test(block), 'berhenti kalau channel tidak ada');
  assert.ok(block.includes('channel belum diatur'), 'alasannya dicatat di log');
});

await testAsync('goodbye: event GuildMemberRemove terpasang', async () => {
  const bot = await readFile('src/bot.ts', 'utf8');
  assert.ok(bot.includes('Events.GuildMemberRemove'), 'event terpasang');
  assert.ok(bot.includes('onGuildMemberRemove'), 'handler dipanggil');

  const events = await readFile('src/events/guildMemberAdd.ts', 'utf8');
  assert.ok(events.includes('goodbyeMember'), 'memanggil fitur goodbye');
  assert.ok(events.includes('homeGuildId'), 'hanya untuk server rumah');
});

await testAsync('goodbye: settings tersimpan dan patch sebagian aman', async () => {
  const { getGoodbyeSettings, saveGoodbyeSettings } = await import('../src/db/repo.js');
  const guild = '999999999999999002';
  await saveGoodbyeSettings(guild, { enabled: true, channelId: '121212121212121212', style: 'sopan' });

  await saveGoodbyeSettings(guild, { enabled: false });
  const saved = await getGoodbyeSettings(guild);
  assert.equal(saved.enabled, false);
  assert.equal(saved.channelId, '121212121212121212', 'channel lama dipertahankan');
  assert.equal(saved.style, 'sopan', 'gaya lama dipertahankan');
});

await testAsync('agent: gallery_channel_id tersimpan & bisa dikosongkan', async () => {
  const { getAgentSettings, saveAgentSettings } = await import('../src/db/repo.js');
  const guild = '999999999999999003';
  await saveAgentSettings(guild, { channelId: '111111111111111111', galleryChannelId: '222222222222222222' });
  assert.equal((await getAgentSettings(guild)).galleryChannelId, '222222222222222222');

  await saveAgentSettings(guild, { galleryChannelId: null });
  const saved = await getAgentSettings(guild);
  assert.equal(saved.galleryChannelId, null);
  assert.equal(saved.channelId, '111111111111111111', 'channel ngobrol tidak ikut terhapus');
});

await testAsync('API agent: channel ngobrol & galeri tidak boleh sama', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes('Channel ngobrol dan galeri harus berbeda'), 'ada validasi');
});

await testAsync('screening: video dihitung konten visual untuk galeri', async () => {
  const source = await readFile('src/features/agent.ts', 'utf8');
  assert.ok(source.includes('hasVisualContent'), 'ada deteksi konten visual');
  assert.ok(source.includes('video/'), 'video ikut dikenali');
  assert.ok(/mp4|mov\|webm/.test(source) || source.includes('VIDEO_EXT'), 'ekstensi video dikenali');
});


console.log('\nPratinjau & tes fitur (tanpa Discord)');

await testAsync('pratinjau: sambutan jatuh ke template saat AI dimatikan', async () => {
  const { previewWelcome } = await import('../src/features/preview.js');
  const result = await previewWelcome({
    settings: { ...welcomeSettings(), useAi: false, template: 'Halo {user} di {server}!' },
    name: 'Rani',
    guildName: 'Komunitas Zypher',
  });
  assert.equal(result.source, 'template');
  assert.equal(result.text, 'Halo Rani di Komunitas Zypher!');
  assert.ok(result.note?.includes('AI dimatikan'), 'alasan fallback dijelaskan');
});

await testAsync('pratinjau: sambutan memakai template default kalau kosong', async () => {
  const { previewWelcome, SAMPLE_MEMBER_NAME } = await import('../src/features/preview.js');
  const result = await previewWelcome({
    settings: { ...welcomeSettings(), useAi: false, template: null },
    name: SAMPLE_MEMBER_NAME,
    guildName: 'Komunitas Zypher',
  });
  assert.ok(result.text.includes(SAMPLE_MEMBER_NAME), 'nama contoh dipakai');
  assert.ok(result.text.includes('Komunitas Zypher'), 'nama server dipakai');
});

await testAsync('pratinjau: perpisahan jatuh ke template tanpa mengirim apa pun', async () => {
  const { previewGoodbye } = await import('../src/features/preview.js');
  const result = await previewGoodbye({
    settings: { ...goodbyeSettings(), useAi: false },
    name: 'Budi',
    guildName: 'Komunitas Zypher',
  });
  assert.equal(result.source, 'template');
  assert.ok(result.text.includes('Budi'));
  assert.equal(result.text.includes('{user}'), false, 'placeholder terisi');
});

await testAsync('pratinjau: tidak ada modul pratinjau yang mengirim ke Discord', async () => {
  const source = await readFile('src/features/preview.ts', 'utf8');
  // Kalau ini gagal, artinya pratinjau bisa mengirim pesan sungguhan — bahaya.
  // 'discord.js' boleh disebut di komentar; yang dilarang adalah import nyata
  // dan pemanggilan pengiriman pesan.
  for (const forbidden of ["from 'discord.js'", '.send(', 'TextChannel']) {
    assert.equal(source.includes(forbidden), false, `tidak boleh ada ${forbidden}`);
  }
});

await testAsync('pratinjau: prompt hanya punya SATU sumber (dipakai bot & dashboard)', async () => {
  const welcome = await readFile('src/features/welcome.ts', 'utf8');
  const preview = await readFile('src/features/preview.ts', 'utf8');
  assert.ok(welcome.includes("from './preview.js'"), 'welcome memakai prompt dari preview.js');
  assert.equal(/export function buildWelcomePrompt/.test(welcome), false, 'tidak ada salinan di welcome.ts');
  assert.ok(preview.includes('export function buildWelcomePrompt'));
  assert.ok(preview.includes('export function buildGoodbyePrompt'));
});

await testAsync('pratinjau: aturan gaya agent dipakai bersama', async () => {
  const { agentRoleInstruction } = await import('../src/features/preview.js');
  const gallery = agentRoleInstruction('gallery');
  const chat = agentRoleInstruction('chat');
  assert.ok(gallery.includes('galeri'), 'ada instruksi khusus galeri');
  assert.ok(gallery.includes('2 kalimat'), 'komentar galeri dibatasi');
  assert.ok(chat.includes('3 kalimat'), 'obrolan dibatasi');

  const agent = await readFile('src/features/agent.ts', 'utf8');
  assert.ok(agent.includes('agentRoleInstruction'), 'bot memakai aturan yang sama');
});

await testAsync('pratinjau: pemecah sepi menolak kalau fitur mati', async () => {
  const { previewQuietBreak } = await import('../src/features/preview.js');
  const tanpaChannel = await previewQuietBreak({
    settings: agentSettings({ channelId: null }),
    guildName: 'Komunitas Zypher',
  });
  assert.equal(tanpaChannel.wouldFire, false);
  assert.ok(tanpaChannel.reason.includes('Channel ngobrol belum dipilih'));

  const ambangNol = await previewQuietBreak({
    settings: agentSettings({ channelId: '444444444444444444', quietMinutes: 0 }),
    guildName: 'Komunitas Zypher',
  });
  assert.equal(ambangNol.wouldFire, false);
  assert.ok(ambangNol.reason.includes('0 menit'));
});

await testAsync('pratinjau: pesan uji kosong ditolak API', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("'/api/preview/agent'"), 'endpoint ada');
  assert.ok(server.includes("'/api/preview/quiet'"), 'endpoint pemecah sepi ada');
  assert.ok(server.includes('Tulis pesan uji dulu'), 'validasi pesan kosong');
});

await testAsync('pratinjau: peran galeri tanpa channel galeri diberi catatan', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(
    server.includes('Channel galeri belum dipilih'),
    'admin diberi tahu bahwa mode ini belum aktif di server',
  );
});

await testAsync('dashboard: tombol tes memakai form apa adanya', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('async function runTest'), 'ada fungsi tes sambutan');
  assert.ok(pages.includes('async function runAgentTest'), 'ada fungsi tes agent');
  assert.ok(pages.includes('async function runQuietTest'), 'ada tes pemecah sepi');
  assert.ok(pages.includes("'/api/preview/' + kind"), 'menembak endpoint sambutan/perpisahan');
  assert.ok(pages.includes("'/api/preview/agent'"), 'menembak endpoint agent');
  assert.ok(pages.includes("'/api/preview/quiet'"), 'menembak endpoint pemecah sepi');
  assert.ok(pages.includes('Tes tanpa AI'), 'ada tombol tanpa AI');
});

await testAsync('dashboard: postJson terdefinisi di JS bersama', async () => {
  // Bug nyata: tombol Simpan memanggil postJson yang tidak pernah didefinisikan.
  const shell = await readFile('src/web/ui/shell.ts', 'utf8');
  assert.ok(shell.includes('async function postJson'), 'postJson ada di SHARED_JS');
  assert.ok(shell.includes('function toast'), 'toast tersedia');

  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes("await postJson('/api/agent'"), 'halaman agent memakainya');
});


console.log('\nBanner kartu (unggahan sendiri)');

/** PNG 1x1 transparan — cukup untuk menguji deteksi format. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

await testAsync('banner: format dikenali dari isi file, bukan ekstensi', async () => {
  const { detectImage } = await import('../src/features/banner.js');
  const png = detectImage(PNG_1x1);
  assert.equal(png?.mime, 'image/png', 'PNG dikenali');
  assert.equal(png?.width, 1);
  assert.equal(png?.height, 1);

  // Teks yang dinamai .png tidak boleh lolos.
  assert.equal(detectImage(Buffer.from('ini bukan gambar sama sekali ya')), null);
  assert.equal(detectImage(Buffer.alloc(4)), null, 'file terlalu pendek ditolak');
});

await testAsync('banner: JPEG & WebP dikenali dari magic bytes', async () => {
  const { detectImage } = await import('../src/features/banner.js');
  // JPEG minimal: SOI + SOF0 dengan 640x480.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00,
    0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  const meta = detectImage(jpeg);
  assert.equal(meta?.mime, 'image/jpeg');
  assert.equal(meta?.width, 640);
  assert.equal(meta?.height, 480);

  const webp = Buffer.alloc(32);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8 ', 12, 'ascii');
  webp.writeUInt16LE(800, 26);
  webp.writeUInt16LE(450, 28);
  const webpMeta = detectImage(webp);
  assert.equal(webpMeta?.mime, 'image/webp');
  assert.equal(webpMeta?.width, 800);
  assert.equal(webpMeta?.height, 450);
});

await testAsync('banner: nama file aman (tolak path traversal)', async () => {
  const { isSafeBannerName } = await import('../src/features/banner.js');
  assert.equal(isSafeBannerName('banner-abc123.png'), true);
  assert.equal(isSafeBannerName('banner-abc123.jpg'), true);
  assert.equal(isSafeBannerName('../../etc/passwd'), false, 'traversal ditolak');
  assert.equal(isSafeBannerName('/etc/passwd'), false, 'path absolut ditolak');
  assert.equal(isSafeBannerName('banner.exe'), false, 'ekstensi lain ditolak');
  assert.equal(isSafeBannerName(null), false);
  assert.equal(isSafeBannerName(''), false);
});

await testAsync('banner: data URI rusak / bukan gambar ditolak', async () => {
  const { saveBanner, BannerError } = await import('../src/features/banner.js');

  for (const bad of [
    'bukan-data-uri',
    'data:image/png;base64,%%%bukan-base64%%%',
    `data:image/png;base64,${Buffer.from('teks biasa yang dinamai png').toString('base64')}`,
  ]) {
    let caught = false;
    try {
      await saveBanner(bad, 'abc123');
    } catch (error) {
      caught = error instanceof BannerError;
    }
    assert.equal(caught, true, `harus ditolak: ${bad.slice(0, 30)}`);
  }
});

await testAsync('banner: gambar terlalu kecil ditolak (akan pecah sebagai latar)', async () => {
  const { saveBanner } = await import('../src/features/banner.js');
  let message = '';
  try {
    await saveBanner(`data:image/png;base64,${PNG_1x1.toString('base64')}`, 'abc123');
  } catch (error) {
    message = (error as Error).message;
  }
  assert.ok(message.includes('terlalu kecil'), `alasan jelas: ${message}`);
});

await testAsync('banner: tersimpan, terbaca kembali, lalu terhapus', async () => {
  const { saveBanner, readBannerDataUri, deleteBanner, bannerExists } = await import('../src/features/banner.js');
  // PNG 400x100 supaya lolos batas lebar minimum.
  const width = 400;
  const header = Buffer.alloc(33);
  PNG_1x1.copy(header, 0, 0, 16);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(100, 20);
  const png = Buffer.concat([header, PNG_1x1.subarray(33)]);

  const saved = await saveBanner(`data:image/png;base64,${png.toString('base64')}`, 'testbanner01');
  assert.equal(saved.ok, true);
  assert.equal(saved.width, width);
  assert.ok(saved.name?.endsWith('.png'));
  assert.equal(bannerExists(saved.name), true, 'file ada di disk');

  const uri = await readBannerDataUri(saved.name);
  assert.ok(uri?.startsWith('data:image/png;base64,'), 'bisa dibaca sebagai data URI');

  await deleteBanner(saved.name);
  assert.equal(bannerExists(saved.name), false, 'file terhapus');

  // Nama berbahaya tidak menghapus apa pun dan tidak melempar error.
  await deleteBanner('../../etc/passwd');
});

await testAsync('banner: kolom banner_path tersimpan & bisa dikosongkan', async () => {
  const { getWelcomeSettings, saveWelcomeSettings, getGoodbyeSettings, saveGoodbyeSettings } = await import(
    '../src/db/repo.js'
  );
  const guild = '999999999999999011';

  await saveWelcomeSettings(guild, { bannerPath: 'banner-abc.png', style: 'santai' });
  const welcome = await getWelcomeSettings(guild);
  assert.equal(welcome.bannerPath, 'banner-abc.png');
  assert.equal(welcome.style, 'santai', 'field lain tidak ikut berubah');

  await saveWelcomeSettings(guild, { bannerPath: null });
  assert.equal((await getWelcomeSettings(guild)).bannerPath, null, 'banner bisa dihapus');

  await saveGoodbyeSettings(guild, { bannerPath: 'banner-xyz.webp' });
  assert.equal((await getGoodbyeSettings(guild)).bannerPath, 'banner-xyz.webp');
});

await testAsync('banner: default null (tanpa banner = kartu bawaan)', async () => {
  const { getWelcomeSettings, getGoodbyeSettings } = await import('../src/db/repo.js');
  assert.equal((await getWelcomeSettings('999999999999999012')).bannerPath, null);
  assert.equal((await getGoodbyeSettings('999999999999999012')).bannerPath, null);
});

await testAsync('banner: kartu lebih tinggi saat banner dipakai', async () => {
  const { cardHeight } = await import('../src/features/welcome-card.js');
  const tanpa = cardHeight({ bannerDataUri: null });
  const dengan = cardHeight({ bannerDataUri: 'data:image/png;base64,AAAA' });
  assert.ok(dengan > tanpa, 'tinggi bertambah supaya teks tidak menimpa gambar');
  assert.equal(dengan - tanpa, 110, 'selisihnya setinggi strip banner');
});

await testAsync('banner: API unggah & hapus ada untuk kedua fitur', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("'/api/banner/welcome'"), 'endpoint sambutan');
  assert.ok(server.includes("'/api/banner/goodbye'"), 'endpoint perpisahan');
  assert.ok(server.includes('payload.remove === true'), 'bisa dihapus');
  assert.ok(server.includes('await deleteBanner(current.bannerPath)'), 'file lama dibersihkan');
  // File baru disimpan dulu, baru yang lama dihapus: kalau gagal, banner lama tetap ada.
  // Dicari mulai dari endpoint banner supaya tidak tertangkap pemakaian di tempat lain.
  const bannerSection = server.slice(server.indexOf("'/api/banner/welcome'"));
  const saveIndex = bannerSection.indexOf('const saved = await saveBanner');
  assert.ok(saveIndex > -1, 'banner baru disimpan');
  // Cari penghapusan SETELAH penyimpanan (ada juga penghapusan di cabang hapus).
  const deleteAfterSave = bannerSection.indexOf('await deleteBanner(current.bannerPath)', saveIndex);
  assert.ok(deleteAfterSave > saveIndex, 'urutan aman: simpan file baru dulu, baru hapus yang lama');
});

await testAsync('banner: dashboard punya blok unggah di dua kartu', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('function bannerBlock'), 'komponen banner ada');
  assert.ok(pages.includes("bannerBlock('welcome'"), 'dipakai di kartu sambutan');
  assert.ok(pages.includes("bannerBlock('goodbye'"), 'dipakai di kartu perpisahan');
  assert.ok(pages.includes('function uploadBanner'), 'JS unggah ada');
  assert.ok(pages.includes('async function removeBanner'), 'JS hapus ada');
  assert.ok(pages.includes("accept=\"image/png,image/jpeg,image/webp\""), 'hanya format gambar');
  assert.ok(pages.includes('8 * 1024 * 1024'), 'batas ukuran dicek juga di browser');
});

await testAsync('banner: data/banners tidak ikut Git', async () => {
  const { BANNER_DIR } = await import('../src/features/banner.js');
  assert.ok(BANNER_DIR.includes('data'), 'disimpan di folder data');
  const gitignore = await readFile('.gitignore', 'utf8');
  assert.ok(/^data\/$/m.test(gitignore), 'folder data diabaikan Git');
});


await testAsync('pratinjau: bot & dashboard memakai jalur AI yang sama', async () => {
  // Dulu generateGreeting di welcome.ts menulis ulang prompt & pemanggilan model,
  // sehingga hasil tombol tes bisa berbeda dari sapaan sungguhan.
  const welcome = await readFile('src/features/welcome.ts', 'utf8');
  const preview = await readFile('src/features/preview.ts', 'utf8');

  assert.ok(welcome.includes('previewWelcome('), 'sambutan memakai previewWelcome');
  assert.ok(welcome.includes('previewGoodbye('), 'perpisahan memakai previewGoodbye');
  assert.equal(welcome.includes("from '../lib/llm.js'"), false, 'welcome tidak memanggil model sendiri');
  assert.ok(preview.includes('export async function previewWelcome'));
  assert.ok(preview.includes('export async function previewGoodbye'));
});


console.log('\nKonsistensi dokumen');

await testAsync('dokumen: semua halaman dashboard disebut di README', async () => {
  const shell = await readFile('src/web/ui/shell.ts', 'utf8');
  const hrefs = [...shell.matchAll(/href: '(\/[^']*)'/g)].map((m) => m[1]);
  const readme = await readFile('README.md', 'utf8');

  assert.ok(hrefs.length >= 8, `ada ${hrefs.length} halaman di navigasi`);
  for (const href of hrefs) {
    assert.ok(readme.includes(`\`${href}\``), `halaman ${href} belum disebut di README`);
  }
});

await testAsync('dokumen: intent wajib tidak ditulis "opsional"', async () => {
  // Kesalahan ini pernah terjadi: Server Members Intent ditulis opsional padahal
  // sambutan & perpisahan tidak jalan tanpa itu.
  for (const file of ['README.md', 'docs/setup.md', 'docs/sambutan-agent.md']) {
    const text = await readFile(file, 'utf8');
    assert.equal(
      /Server Members Intent\**\s*\*?\(?\*?opsional/i.test(text),
      false,
      `${file} masih menulis Server Members Intent sebagai opsional`,
    );
  }
  const setup = await readFile('docs/setup.md', 'utf8');
  assert.ok(/Server Members Intent.*wajib/is.test(setup), 'setup.md menyebut intent ini wajib');
});

await testAsync('dokumen: file di docs/ terdokumentasi & tidak ada link rusak', async () => {
  const { readdir, stat } = await import('node:fs/promises');
  const entries = await readdir('docs');
  const readme = await readFile('README.md', 'utf8');

  for (const entry of entries) {
    if (entry === 'screenshots' || entry.endsWith('.png')) continue;
    const info = await stat(`docs/${entry}`);
    if (!info.isFile()) continue;
    assert.ok(readme.includes(entry), `docs/${entry} belum disebut di README`);
  }
});

await testAsync('dokumen: banner dijelaskan sebagai data yang perlu disk persisten', async () => {
  // Banner ada di data/banners/, bukan di database. Panduan hosting harus
  // menyebutnya, atau banner hilang saat redeploy tanpa disadari.
  const hosting = await readFile('docs/hosting.md', 'utf8');
  assert.ok(hosting.includes('data/banners'), 'hosting.md menyebut folder banner');
  assert.ok(/backup/i.test(hosting), 'panduan backup ada');
});



console.log('\nKirim tes & perbaikan bug dashboard');

await testAsync('css: atribut hidden selalu menang atas display:block', async () => {
  // Bug nyata: .preview-img { display:block } mengalahkan hidden, sehingga
  // gambar kartu kosong tetap tampil sebagai kotak rusak di halaman Sambutan.
  const theme = await readFile('src/web/ui/theme.ts', 'utf8');
  assert.ok(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(theme), 'ada aturan [hidden] !important');

  // Aturan harus muncul SETELAH kelas gambar agar menang tanpa !important...
  // dengan !important urutan tidak penting, tapi tetap dicek agar tidak terhapus.
  const previewImg = theme.indexOf('.preview-img');
  const hiddenRule = theme.search(/\[hidden\]\s*\{/);
  assert.ok(previewImg > -1 && hiddenRule > -1, 'kedua aturan ada');
});

await testAsync('preview: jawaban kosong diberi saran yang bisa ditindaklanjuti', async () => {
  const { EMPTY_REPLY_HINT } = await import('../src/features/preview.js');
  assert.ok(EMPTY_REPLY_HINT.includes('AI_MAX_TOKENS'), 'menyebut setelan yang harus diubah');
  assert.ok(/reasoning/i.test(EMPTY_REPLY_HINT), 'menjelaskan penyebab umum (model reasoning)');
  // Pesan lama terlalu samar: admin tidak tahu harus berbuat apa.
  assert.ok(/jawaban kosong/i.test(EMPTY_REPLY_HINT), 'menyatakan jawaban kosong');
});

await testAsync('preview: catatan kegagalan tidak dobel di respons API', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  const preview = await readFile('src/features/preview.ts', 'utf8');
  // Dulu dua tempat menambahkan catatan kartu, hasilnya kalimat berulang.
  assert.equal(server.includes('Kartu PNG tidak tersedia — sambutan tetap terkirim'), false);
  assert.ok(preview.includes('Kartu PNG tidak dirender'), 'satu sumber catatan kartu');
});

await testAsync('kirim tes: benar-benar memakai API Discord (bukan pratinjau)', async () => {
  const source = await readFile('src/features/test-send.ts', 'utf8');
  assert.ok(source.includes('.send('), 'memanggil send()');
  assert.ok(source.includes('allowedMentions'), 'mention tidak dipicu');
  assert.ok(source.includes('Pesan uji dari dashboard'), 'pesan diberi penanda jelas');

  // Tidak boleh mengimpor modul pratinjau untuk mengirim: pratinjau tidak punya
  // akses Discord, jadi memakainya di sini berarti tidak ada yang terkirim.
  assert.ok(source.includes('previewWelcome'), 'memakai teks dari pratinjau');
  assert.ok(source.includes("from './preview.js'"), 'teks diambil dari modul pratinjau');
});

await testAsync('kirim tes: menolak saat bot offline dengan alasan jelas', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  const block = server.slice(server.indexOf("path.startsWith('/api/send-test/')"));
  assert.ok(block.includes('botClient?.isReady()'), 'cek bot siap');
  assert.ok(block.includes('Bot sedang offline'), 'alasan disebutkan');
  assert.ok(block.includes('npm run dev'), 'memberi tahu cara memperbaiki');
});

await testAsync('kirim tes: goodbye selalu ke channel (DM tidak mungkin)', async () => {
  const source = await readFile('src/features/test-send.ts', 'utf8');
  const block = source.slice(source.indexOf('export async function sendGoodbyeTest'));
  assert.ok(block.includes('belum punya channel tujuan'), 'menolak tanpa channel');
  assert.equal(block.includes("where: 'dm'"), false, 'tidak pernah mengaku terkirim ke DM');
});

await testAsync('kirim tes: izin channel dilaporkan spesifik', async () => {
  const source = await readFile('src/features/test-send.ts', 'utf8');
  assert.ok(source.includes('Send Message'), 'menyebut izin yang kurang');
  assert.ok(source.includes('tidak bisa melihat'), 'kasus channel tidak terlihat');
  assert.ok(source.includes('privasi DM'), 'menjelaskan kenapa DM bisa gagal');
});

await testAsync('kirim tes: kartu ikut dikirim kalau diaktifkan', async () => {
  const source = await readFile('src/features/test-send.ts', 'utf8');
  assert.ok(source.includes('renderWelcomeCard'), 'memakai renderer kartu yang sama');
  assert.ok(source.includes('Chromium tidak tersedia'), 'memberi tahu saat kartu gagal');
});

await testAsync('kirim tes: endpoint terpisah dari pratinjau', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("'/api/send-test/'") || server.includes("'/api/send-test"), 'endpoint ada');
  assert.ok(server.includes('/api/preview/'), 'pratinjau tetap ada');
  // Pratinjau tidak boleh mengirim, kirim-tes tidak boleh cuma merender.
  const previewBlock = server.slice(server.indexOf("'/api/preview/goodbye'"), server.indexOf("'/api/send-test/"));
  assert.equal(previewBlock.includes('.send('), false, 'pratinjau tidak mengirim');
});

await testAsync('dashboard: tombol kirim tes ada di kedua halaman', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('async function sendTest'), 'JS kirim tes sambutan/perpisahan');
  assert.ok(pages.includes('async function sendAgentTest'), 'JS kirim tes agent');
  assert.ok(pages.includes("'/api/send-test/' + kind"), 'menembak endpoint yang benar');
  assert.ok(pages.includes("'/api/send-test/agent'"), 'endpoint agent');
  assert.ok(pages.includes('Kirim tes sungguhan'), 'label jelas membedakan dari pratinjau');
  assert.ok(pages.includes('Kirim tes ke channel'), 'tombol agent & perpisahan');
});

await testAsync('kirim tes: error Discord yang samar diterjemahkan', async () => {
  const { sendAgentTest } = await import('../src/features/test-send.js');
  const channel = {
    id: '111111111111111111', name: 'ngobrol',
    isTextBased: () => true, isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    // Inilah balasan asli Discord saat embed berisi data URI ditolak.
    send: async () => { throw new Error('Received one or more errors'); },
  };
  const client = {
    guilds: { fetch: async () => ({ id: '1', name: 'S', channels: { fetch: async () => channel }, members: { me: { id: '2' } } }) },
  } as never;

  await assert.rejects(
    () => sendAgentTest(client, { guildId: '1', channelId: channel.id, reply: 'halo', role: 'chat', sampleMessage: 'hai', userName: 'Sky' }),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /Received one or more errors/, 'pesan asli tetap disertakan');
      assert.match(message, /banner|kartu PNG/i, 'menjelaskan kemungkinan penyebab');
      assert.match(message, /unggah ulang/i, 'memberi tindakan yang bisa dilakukan');
      return true;
    },
  );
});

await testAsync('vision: gambar di DM ikut dibaca (tidak lagi langsung kosong)', async () => {
  // Bug: collectImages langsung `return EMPTY` bila message.guildId kosong,
  // sehingga gambar di DM tidak pernah dibaca walau modelnya multimodal.
  const source = await readFile('src/features/vision.ts', 'utf8');
  const fn = source.slice(source.indexOf('export async function collectImages'));
  // Hanya periksa kode, bukan komentar yang menjelaskan bug lama.
  const code = fn
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  assert.equal(
    /if \(!message\.guildId\)/.test(code),
    false,
    'tidak lagi menolak pesan DM',
  );

  const { collectImages } = await import('../src/features/vision.js');
  const { AttachmentBuilder } = await import('discord.js');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const attachment = new AttachmentBuilder(png, { name: 'foto.png' });
  const fake = {
    guildId: null,
    attachments: new Map([['1', { name: 'foto.png', contentType: 'image/png', size: png.length, url: 'https://contoh.invalid/foto.png' }]]),
  };

  // Unduhan di-stub supaya test tidak menyentuh jaringan.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(png, { headers: { 'content-type': 'image/png' } })) as never;
  try {
    const result = await collectImages(fake as never);
    assert.equal(result.dataUris.length, 1, 'gambar DM terkirim ke model');
    assert.ok(result.dataUris[0]!.startsWith('data:image/png;base64,'), 'berupa data URI');
    assert.equal(attachment.name, 'foto.png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('voice: voice note di DM ditranskrip, bukan ditolak', async () => {
  const dm = await readFile('src/features/dm.ts', 'utf8');
  const code = dm
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  // Panggilan sebenarnya, bukan sekadar nama di komentar/import.
  assert.ok(/await readVoiceNote\(/.test(code), 'memanggil readVoiceNote');
  assert.ok(/await replyWithSpeech\(/.test(code), 'memanggil replyWithSpeech untuk balasan suara');
  assert.ok(/if \(voiceNoteText && config\.voice\.ttsEnabled\)/.test(code), 'TTS hanya untuk voice note');
  // Penolakan teks hanya boleh muncul kalau tidak ada teks DAN tidak ada gambar.
  assert.ok(
    /if \(!question && collected\.dataUris\.length === 0\)/.test(dm),
    'tidak menolak pesan yang punya lampiran',
  );

  const chat = await readFile('src/features/chat.ts', 'utf8');
  assert.ok(chat.includes('export async function readVoiceNote'), 'helper bisa dipakai DM');
  assert.ok(chat.includes('export async function replyWithSpeech'), 'TTS bisa dipakai DM');
});

await testAsync('stream: stream kosong memicu provider berikutnya', async () => {
  // Pasangan dari chat(): stream bisa selesai tanpa satu potong teks pun.
  const llm = await readFile('src/lib/llm.ts', 'utf8');
  const streamFn = llm.slice(llm.indexOf('export async function streamChat'));
  assert.ok(/if \(!emitted && !hasToolCalls\)/.test(streamFn), 'stream kosong diperiksa');
  assert.ok(streamFn.includes('continue;'), 'lanjut ke provider berikutnya');
  // Tool call yang sah memang tanpa teks — jangan dianggap kosong.
  assert.ok(
    /const hasToolCalls = Boolean\(result\.message\.tool_calls\?\.length\)/.test(streamFn),
    'tool_calls dihitung sebagai isi yang sah',
  );
});

await testAsync('banner: halaman tidak menyisipkan data URI (bisa belasan MB)', async () => {
  // Dua banner 8 MB sebagai data URI = HTML belasan MB; di HP praktis mati.
  const { welcomePage } = await import('../src/web/ui/pages.js');
  const page = welcomePage({
    guildId: '1',
    guildName: 'Server',
    welcome: {
      enabled: true, useAi: false, channelId: null, template: 'Halo {user}!',
      imageEnabled: false, includeAvatar: false, style: null, example: null,
      bannerPath: 'banner-abc.png', hasBanner: true,
    },
    goodbye: {
      enabled: false, useAi: false, channelId: null, template: 'Bye {user}!',
      imageEnabled: false, includeAvatar: false, style: null, example: null,
      bannerPath: 'banner-def.png', hasBanner: true,
    },
    channels: [],
    botOnline: false,
    sampleName: 'Sky',
    cardRenderer: { available: false, path: null },
    persona: null, model: null, defaultModel: 'x', embedModel: null, ragEnabled: false,
    ttsReplyInRoom: null, ttsReplyInRoomDefault: true, ragEnabledSetting: null,
    ragEnabledDefault: true, autoMemorySetting: null, autoMemoryDefault: true,
    adminOnlyRoomsSetting: null, adminOnlyRoomsDefault: false,
    stats: { rooms: 0, messages: 0, documents: 0 },
    status: { online: false, mode: 'standalone', uptimeSeconds: 0 },
    counts: {},
  } as never);

  // Favicon memang data URI SVG kecil — yang dilarang adalah gambar base64
  // (banner bisa 8 MB dan ada dua).
  assert.equal(page.includes('data:image/png;base64,'), false, 'tidak ada banner base64 di HTML');
  assert.equal(page.includes('data:image/jpeg;base64,'), false, 'tidak ada banner JPEG base64');
  assert.equal(page.includes('data:image/webp;base64,'), false, 'tidak ada banner WebP base64');
  assert.ok(page.includes('/api/banner/welcome?v=banner-abc.png'), 'gambar diambil lewat URL');
  assert.ok(page.includes('/api/banner/goodbye?v=banner-def.png'), 'banner perpisahan juga URL');
  // Penanda "ada banner" harus boolean, bukan string kosong (falsy).
  assert.ok(page.includes('src="/api/banner/welcome'), 'gambar tampil saat ada banner');
});

await testAsync('banner: ada endpoint gambar + penanda boolean', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(/method === 'GET'/.test(server) && server.includes("path.endsWith('/welcome')"), 'endpoint GET banner ada');
  assert.ok(server.includes('readBannerBytes'), 'menyajikan byte gambar');
  assert.ok(server.includes("'cache-control': 'private, max-age=86400'"), 'gambar bisa di-cache');
  assert.ok(server.includes('hasBanner: bannerExists('), 'penanda boolean, bukan string');
});

await testAsync('kirim: banner dikirim sebagai lampiran, bukan data URI', async () => {
  // Bug nyata: embed.setImage(dataUri) ditolak Discord dengan pesan samar
  // "Received one or more errors", sehingga sambutan, salam perpisahan, dan
  // tombol kirim tes semuanya gagal terkirim tanpa penjelasan.
  const welcome = await readFile('src/features/welcome.ts', 'utf8');
  const test = await readFile('src/features/test-send.ts', 'utf8');

  for (const [name, source] of [['welcome.ts', welcome], ['test-send.ts', test]] as const) {
    const setImages = [...source.matchAll(/embed\.setImage\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    assert.ok(setImages.length > 0, `${name} memakai setImage`);
    for (const arg of setImages) {
      assert.ok(
        arg.includes('attachment://'),
        `${name}: setImage harus merujuk attachment://, bukan ${arg.slice(0, 40)}`,
      );
    }
    // Data URI hanya boleh dipakai untuk SVG kartu / <img> pratinjau.
    assert.ok(
      source.includes('readBannerAttachment'),
      `${name} memakai readBannerAttachment untuk lampiran`,
    );
  }
});

await testAsync('ai: balasan kosong memicu provider berikutnya (bukan teks kosong)', async () => {
  // Dulu rantai fallback hanya jalan kalau ada error. Model reasoning yang
  // menghabiskan token untuk berpikir tetap dianggap "berhasil", jadi user
  // menerima teks kosong padahal provider cadangan tersedia.
  const llm = await readFile('src/lib/llm.ts', 'utf8');
  assert.ok(llm.includes('hasVisibleText'), 'ada pemeriksaan isi balasan');
  assert.ok(
    /if \(!hasVisibleText\(result\.message\)\)/.test(llm),
    'balasan kosong diperlakukan sebagai kegagalan provider',
  );
  assert.ok(llm.includes('continue;'), 'lanjut ke provider berikutnya');
  // reasoning_content harus dianggap isi yang sah.
  const block = llm.slice(llm.indexOf('function hasVisibleText'));
  assert.ok(block.includes('reasoning_content'), 'reasoning_content ikut diterima');
  assert.ok(block.includes('tool_calls'), 'tool call tanpa teks tetap sah');
});

await testAsync('ai: penolakan max_tokens diulang di provider yang sama (bukan lompat fallback)', async () => {
  // Bug nyata: AiError dilempar tanpa membawa `tokenCap`, jadi chat() tidak
  // pernah tahu ada plafon token. Akibatnya permintaan langsung dilempar ke
  // provider cadangan padahal provider utama hanya perlu angka lebih kecil —
  // atau lebih buruk, user tidak pernah dapat jawaban sama sekali.
  const llm = await readFile('src/lib/llm.ts', 'utf8');

  // 1. Nilai plafon harus tersimpan di error yang dilempar.
  const ctor = llm.slice(llm.indexOf('export class AiError'), llm.indexOf('const clients = new Map'));
  assert.ok(/tokenCap\?: number/.test(ctor), 'AiError membawa tokenCap');

  // 2. classify() mengisi field itu, bukan cuma mengembalikan objek terpisah.
  assert.ok(
    /new AiError\(`plafon max_tokens provider \(\$\{cap\}\)`, status, true, false, cap\)/.test(llm),
    'classify meneruskan cap ke AiError',
  );

  // 3. chat() membacanya kembali dari AiError (dulu dipaksa undefined).
  const chatFn = llm.slice(llm.indexOf('export async function chat'), llm.indexOf('async function streamOnProvider'));
  assert.ok(/tokenCap: error\.tokenCap/.test(chatFn), 'chat membaca tokenCap dari AiError');
  assert.equal(/tokenCap: undefined/.test(chatFn), false, 'tidak ada lagi tokenCap yang dibuang');

  // 4. Pengaman anti-loop tetap ada: satu kali ulang per provider.
  assert.ok(chatFn.includes('tokenRetries.has(key)'), 'ada penjaga agar tidak mengulang terus');
  assert.ok(chatFn.includes('index -= 1'), 'kembali ke provider yang sama');
});

await testAsync('ai: 429 langsung pindah provider (tidak menunggu backoff)', async () => {
  // Menunggu 400ms + 800ms untuk rate limit hanya membuang waktu user;
  // provider cadangan bisa menjawab sekarang juga.
  const llm = await readFile('src/lib/llm.ts', 'utf8');
  const guards = llm.match(/aiError\.status === 429 && hasFallbackProvider\(\)/g) ?? [];
  assert.equal(guards.length, 2, 'aturan ini berlaku di chat() dan streamChat()');
  assert.ok(/function hasFallbackProvider\(\): boolean/.test(llm), 'memakai satu pengecekan bersama');
});

await testAsync('config: AI_BREVITY_TOKENS terpisah dari AI_MAX_TOKENS', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(typeof config.ai.brevityTokens, 'number', 'brevityTokens ada di config');
  assert.ok(config.ai.brevityTokens >= 256, `jatah ringkas minimal 256 token (dapat ${config.ai.brevityTokens})`);
  assert.ok(
    config.ai.maxTokens >= config.ai.brevityTokens,
    `maxTokens (${config.ai.maxTokens}) tidak boleh lebih kecil dari brevityTokens (${config.ai.brevityTokens})`,
  );

  // Angka kecil hardcoded dulu penyebab "teks kosong": pemanggil memaksa 80-220.
  for (const file of ['src/features/preview.ts', 'src/features/agent.ts', 'src/features/dm.ts']) {
    const source = await readFile(file, 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    const stray = [...code.matchAll(/maxTokens:\s*(\d+)/g)].filter((m) => Number(m[1]) < 256);
    assert.equal(stray.length, 0, `${file} masih memaksa max_tokens kecil (${stray.map((m) => m[1]).join(', ')})`);
  }
});

await testAsync('ai: parseTokenCap membaca format error provider nyata', async () => {
  const { parseTokenCap } = await import('../src/lib/llm.js');
  assert.equal(parseTokenCap('max_tokens must be less than or equal to 8191'), 8191);
  assert.equal(parseTokenCap("'max_tokens' too large: 8192 (maximum 4096)"), 4096);
  assert.equal(parseTokenCap('Model returned empty content'), null, 'error lain tidak dianggap plafon');
  assert.equal(parseTokenCap('max_tokens must be less than or equal to 12'), null, 'angka tidak masuk akal ditolak');

  // "maximum context length" adalah percakapan kepanjangan, bukan plafon token
  // keluaran. Kalau tertukar, user disuruh menunggu retry yang pasti gagal
  // padahal yang perlu dilakukan adalah /reset.
  assert.equal(parseTokenCap('maximum context length is 8192 tokens'), null, 'konteks kepanjangan bukan plafon');
});

await testAsync('agent: pesan uji memakai teks biasa, bukan embed', async () => {
  const source = await readFile('src/features/test-send.ts', 'utf8');
  const block = source.slice(source.indexOf('export async function sendAgentTest'));
  const body = block.slice(0, block.indexOf('catch (error)'));

  // Agent di channel membalas sebagai pesan biasa supaya menyatu dengan member.
  // Pesan uji harus memperlihatkan bentuk yang sama.
  assert.equal(/embeds:\s*\[/.test(body), false, 'tidak mengirim embed');
  assert.ok(body.includes('content: body'), 'mengirim konten teks');
  assert.ok(body.includes('quoted'), 'pesan member dikutip sebagai blockquote');
  assert.ok(body.includes('allowedMentions'), 'mention tetap tidak dipicu');
});

await testAsync('css: ikon di tombol kotak tepat di tengah & badge sejajar judul', async () => {
  const theme = await readFile('src/web/ui/theme.ts', 'utf8');

  // Aturan global `button { padding: 12px 18px }` menyisakan ruang isi 8px di
  // kotak 34px, sehingga ikon 18px menempel ke atas (turun 5px dari tengah).
  const iconStart = theme.indexOf('.icon-btn {');
  const iconBtn = theme.slice(iconStart, theme.indexOf('}', iconStart) + 1);
  assert.ok(/padding:\s*0/.test(iconBtn), '.icon-btn menolkan padding dari aturan button');

  // Di HP, flex-wrap dulu menaruh badge di baris kedua (38px dari atas, 19px
  // dari bawah → terlihat melorot). Sekarang card-head memakai grid 2 kolom.
  const mobile = theme.slice(theme.indexOf('@media (max-width: 860px)'));
  const headStart = mobile.indexOf('.card-head {');
  const head = mobile.slice(headStart, mobile.indexOf('}', headStart) + 1);
  assert.ok(/display:\s*grid/.test(head), 'card-head di HP memakai grid');
  assert.ok(/grid-row:\s*1\s*\/\s*span\s*2/.test(mobile), 'badge membentang dua baris judul+hint');
  assert.equal(/\.card-head\s*\{\s*flex-wrap:\s*wrap/.test(theme), false, 'flex-wrap lama sudah dibuang');
});

await testAsync('css: baris toggle tidak melebar keluar kartu', async () => {
  // Bug nyata di HP: .toggle-row adalah grid item, sehingga min-width:auto
  // membuatnya selebar teks penjelasan (730px di layar 390px) dan kartu
  // memotong kalimatnya. Dua aturan berikut yang mencegahnya kembali.
  const theme = await readFile('src/web/ui/theme.ts', 'utf8');

  const rowBlock = theme.slice(theme.indexOf('.toggle-row {'), theme.indexOf('.toggle-row {') + 400);
  assert.ok(/min-width:\s*0/.test(rowBlock), '.toggle-row punya min-width:0');

  const textBlock = theme.slice(theme.indexOf('.toggle-row .toggle-text .cell-sub'));
  assert.ok(/white-space:\s*normal/.test(textBlock.slice(0, 300)), 'penjelasan boleh turun baris');

  // Aturan mobile `.cell-sub { white-space:nowrap }` menang bila selektornya
  // setara — maka selektor kita harus lebih spesifik (3 kelas).
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('class="toggle-text"'), 'teks toggle dibungkus .toggle-text');
});

await testAsync('kirim tes: pesan benar-benar terkirim lewat channel (channel palsu)', async () => {
  const { sendGoodbyeTest } = await import('../src/features/test-send.js');

  // Channel palsu: meniru bagian discord.js yang dipakai resolveChannel + send.
  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '111111111111111111',
    name: 'perpisahan',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: '1' };
    },
  };
  const guild = {
    id: '156942477750257766',
    name: 'Komunitas Zypher',
    channels: { fetch: async () => channel },
    members: { me: { id: '2' } },
  };
  const fakeClient = { guilds: { fetch: async () => guild } } as never;
  const member = {
    displayName: 'Sky',
    user: { username: 'sky', tag: 'sky#0001' },
    displayAvatarURL: () => 'https://contoh.invalid/a.png',
    send: async () => ({ id: '3' }),
  } as never;

  const result = await sendGoodbyeTest(fakeClient, {
    guildId: guild.id,
    settings: {
      channelId: channel.id, useAi: false, imageEnabled: false, includeAvatar: false,
      template: 'Sampai jumpa {user}!', style: '', example: '', bannerPath: null,
    } as never,
    member,
  });

  assert.equal(sent.length, 1, 'tepat satu pesan dikirim');
  assert.equal(result.where, 'channel', 'melaporkan tujuan sebenarnya');
  assert.equal(result.channelName, 'perpisahan', 'nama channel ikut dilaporkan');

  const payload = sent[0]!;
  assert.ok(String(payload.content).includes('Pesan uji dari dashboard'), 'pesan diberi penanda');
  assert.deepEqual(payload.allowedMentions, { parse: [] }, 'mention tidak dipicu');
  assert.equal(result.text, 'Sampai jumpa Sky!', 'isi pesan = hasil pratinjau');
});

await testAsync('kirim tes: menolak perpisahan tanpa channel, tidak ada yang terkirim', async () => {
  const { sendGoodbyeTest, SendTestError } = await import('../src/features/test-send.js');
  let called = false;
  const fakeClient = {
    guilds: {
      fetch: async () => ({
        id: '1', name: 'Server',
        channels: { fetch: async () => { called = true; return null; } },
        members: { me: { id: '2' } },
      }),
    },
  } as never;

  await assert.rejects(
    () => sendGoodbyeTest(fakeClient, {
      guildId: '1',
      settings: { channelId: null } as never,
      member: { displayName: 'Sky', user: { username: 'sky' } } as never,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SendTestError, 'memakai error khusus agar jadi 400');
      assert.match((error as Error).message, /belum punya channel tujuan/);
      return true;
    },
  );
  assert.equal(called, false, 'tidak menyentuh channel sama sekali');
});

await testAsync('kirim tes: DM gagal menjelaskan sebab dan menawarkan target channel', async () => {
  const { sendWelcomeTest } = await import('../src/features/test-send.js');
  const fakeClient = {
    guilds: { fetch: async () => ({ id: '1', name: 'Server', channels: { fetch: async () => null } }) },
  } as never;
  const member = {
    displayName: 'Sky',
    user: { username: 'sky' },
    displayAvatarURL: () => 'https://contoh.invalid/a.png',
    send: async () => { throw new Error('Cannot send messages to this user'); },
  } as never;

  await assert.rejects(
    () => sendWelcomeTest(fakeClient, {
      guildId: '1',
      settings: { channelId: null, useAi: false, imageEnabled: false, includeAvatar: false } as never,
      member,
      target: 'dm',
    }),
    (error: unknown) => {
      assert.match((error as Error).message, /privasi DM/i);
      assert.match((error as Error).message, /target "channel"/i, 'memberi jalan keluar');
      return true;
    },
  );
});

await testAsync('dashboard: peringatan ditampilkan kalau Chromium tidak ada', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('Kartu PNG tidak akan terkirim'), 'peringatan ada');
  assert.ok(pages.includes('CHROMIUM_PATH'), 'menyebut cara memperbaiki');

  const card = await readFile('src/features/welcome-card.ts', 'utf8');
  assert.ok(card.includes('export function cardRendererAvailable'), 'status bisa dicek');
});


/*
 * Pemeriksaan terakhir: angka test di dokumentasi harus sama dengan jumlah test
 * yang benar-benar dijalankan.
 *
 * Ditempatkan di akhir (bukan sebagai `testAsync`) karena `passed` baru bernilai
 * final setelah semua test selesai. Dulu angka di dokumen tertinggal jauh
 * (82 dan 176 padahal sudah ratusan) dan tidak ada yang menyadarinya.
 */
{
  const docFile = [
    ['README.md', /npm run smoke\s+#\s*(\d+) test/],
    ['docs/postgres.md', /npm run smoke\s+#\s*(\d+) test/],
    ['docs/sambutan-agent.md', /npm run smoke\s+#\s*(\d+) test/],
  ] as const;

  const stale: string[] = [];
  for (const [file, pattern] of docFile) {
    const text = await readFile(file, 'utf8');
    const match = pattern.exec(text);
    if (match && Number(match[1]) !== passed) {
      stale.push(`${file} menulis ${match[1]} test, seharusnya ${passed}`);
    }
  }

  // Angka smoke:pg dihitung dengan cara yang sama (panggilan `await test(`).
  const pgSource = await readFile('scripts/smoke-pg.ts', 'utf8');
  const pgTotal = (pgSource.match(/\bawait test\(/g) ?? []).length;
  for (const file of ['README.md', 'docs/postgres.md']) {
    const text = await readFile(file, 'utf8');
    const match = /npm run smoke:pg\s+#\s*(\d+) test/.exec(text);
    if (match && Number(match[1]) !== pgTotal) {
      stale.push(`${file} menulis ${match[1]} test pg, seharusnya ${pgTotal}`);
    }
  }

  if (stale.length > 0) {
    console.error('\n  ❌ dokumen: angka test usang');
    for (const line of stale) console.error(`     ${line}`);
    process.exitCode = 1;
  } else {
    console.log('  ✅ dokumen: angka test sama dengan jumlah test yang dijalankan');
  }
}

console.log(`\n${process.exitCode ? '❌ Ada test gagal' : '🎉 Semua test lulus'} — ${passed} test.\n`);
