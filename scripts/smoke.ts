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
const { pengaturanPage, agentPage } = await import('../src/web/ui/pages.js');
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

await testAsync('Ringkasan: tombol Upload dokumen di header sudah dihapus', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  const ringkasan = pages.slice(
    pages.indexOf('export function ringkasanPage'),
    pages.indexOf('export function dokumenPage'),
  );

  // User meminta tombol besar di header Ringkasan dihapus: halaman itu bukan
  // tempat upload, dan tombolnya cuma melempar orang ke halaman lain.
  assert.equal(
    ringkasan.includes('<a class=\"btn-primary\" href=\"/dokumen\">${icon(\'upload\', 16)} Upload dokumen</a>'),
    false,
    'tombol header sudah tidak ada',
  );
  // Input file tetap hanya di halaman Dokumen.
  assert.equal(ringkasan.includes('type=\"file\"'), false, 'Ringkasan tidak punya input file');
  // Pintasan di keadaan kosong masih boleh — itu bagian alur, bukan header.
  assert.ok(ringkasan.includes('Belum ada dokumen'), 'keadaan kosong tetap ada');
});

await testAsync('Ringkasan: panel pemakaian server muncul setelah Aktivitas 7 hari', async () => {
  const { ringkasanPage } = await import('../src/web/ui/pages.js');
  const html = ringkasanPage({
    guildId: 'g-res',
    guildName: 'Server Uji',
    status: { online: true, mode: 'standalone', uptimeSeconds: 120 },
    stats: { rooms: 0, documents: 0, chunks: 0, keywords: 0, messages: 0 },
    rooms: [],
    documents: [],
    series: [],
    ragEnabled: true,
    embedModel: null,
    model: 'test',
    resources: {
      cpuPercent: 12.5,
      memoryUsed: 96 * 1024 * 1024,
      memoryTotal: 612 * 1024 * 1024,
      memoryFromCgroup: true,
      networkIn: 2048,
      networkOut: 1024,
      diskUsed: 184 * 1024 * 1024,
      diskTotal: 1024 * 1024 * 1024,
      uptimeSeconds: 120,
      inContainer: true,
    },
  } as never);

  assert.ok(html.includes('Pemakaian server'), 'kartu sumber daya ada');
  for (const label of ['CPU', 'Memori', 'Jaringan', 'Disk']) {
    assert.ok(html.includes(`> ${label}</span>`), `baris ${label} ada`);
  }
  // Urutan yang diminta user: di bawah Aktivitas 7 hari.
  const aktivitas = html.indexOf('Aktivitas 7 hari');
  const sumberDaya = html.indexOf('Pemakaian server');
  const status = html.indexOf('Status sistem');
  assert.ok(aktivitas >= 0 && sumberDaya > aktivitas, 'di bawah Aktivitas 7 hari');
  assert.ok(status > sumberDaya, 'status sistem setelah panel sumber daya');

  // Angka harus dari data, bukan karangan.
  assert.ok(html.includes('96 MB'), 'memori terpakai dari data');
  assert.ok(html.includes('612 MB'), 'batas container dari data');
  assert.ok(html.includes('12,5%'), 'persen CPU terformat id-ID');
  assert.ok(html.includes('batas container'), 'menjelaskan asal batas memori');
});

await testAsync('Ringkasan: tanpa data sumber daya, kartunya hilang (bukan 0%)', async () => {
  const { ringkasanPage } = await import('../src/web/ui/pages.js');
  const html = ringkasanPage({
    guildId: 'g-res2',
    guildName: 'Server Uji',
    status: { online: false, mode: 'dashboard', uptimeSeconds: 1 },
    stats: { rooms: 0, documents: 0, chunks: 0, keywords: 0, messages: 0 },
    rooms: [],
    documents: [],
    series: [],
    ragEnabled: false,
    embedModel: null,
    model: 'test',
    resources: null,
  } as never);

  // Klaim "0%" dan "tidak bisa dibaca" berbeda — kalau gagal, sembunyikan.
  assert.equal(html.includes('Pemakaian server'), false, 'panel tidak dirender');
  assert.ok(html.includes('Aktivitas 7 hari'), 'halaman tetap utuh');
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
    timeZone: null,
    effectiveTimeZone: 'Asia/Jakarta',
    defaultTimeZone: 'Asia/Jakarta',
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
    diskQuotaMb: null,
    diskQuotaEnvMb: null,
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

  // Persona pindah ke halaman AI Agent: kalau muncul lagi di sini, orang akan
  // mengira itu pengaturan akun (keluhan aslinya).
  assert.equal(page.includes('id="persona"'), false, 'textarea persona tidak di pengaturan');
  assert.equal(page.includes('savePersona'), false, 'tombol simpan persona tidak di pengaturan');
  assert.equal(page.includes('Persona AI'), false, 'kartu Persona AI tidak di pengaturan');
});

console.log('\nPersona di halaman AI Agent');

await testAsync('halaman agent memuat kartu persona beserta nilainya', async () => {
  const page = agentPage({
    guildId: '123',
    guildName: 'Server Uji',
    guildIconUrl: null,
    persona: 'Kamu asisten yang ramah dan santai.',
    channels: [],
    agent: {
      channelId: null,
      galleryChannelId: null,
      quietMinutes: 0,
      maxPerHour: 6,
      reactEmoji: true,
      reactImages: true,
      busyMute: true,
      cooldownSeconds: 0,
    },
    status: { online: false, mode: 'standalone', uptimeSeconds: 0 },
    counts: {},
  } as never);

  assert.ok(page.includes('id="persona"'), 'textarea persona ada di halaman agent');
  assert.ok(page.includes('rows="4"'), 'textarea cukup tinggi');
  assert.ok(page.includes('Persona AI'), 'judul kartu ada');
  assert.ok(page.includes('Kamu asisten yang ramah dan santai.'), 'nilai persona terisi');
  assert.ok(page.includes('id="savePersona"'), 'tombol simpan ada');
  assert.ok(page.includes('async function savePersona()'), 'fungsi simpan ada');
  assert.ok(page.includes("postJson('/api/persona'"), 'memanggil endpoint persona');
});

await testAsync('persona kosong dirender sebagai textarea kosong, bukan "null"', async () => {
  const page = agentPage({
    guildId: '123',
    guildName: 'Server Uji',
    guildIconUrl: null,
    persona: null,
    channels: [],
    agent: {
      channelId: null,
      galleryChannelId: null,
      quietMinutes: 0,
      maxPerHour: 6,
      reactEmoji: true,
      reactImages: true,
      busyMute: true,
      cooldownSeconds: 0,
    },
    status: { online: false, mode: 'standalone', uptimeSeconds: 0 },
    counts: {},
  } as never);

  assert.equal(page.includes('>null<'), false, 'tidak menulis null ke layar');
  assert.ok(page.includes('id="persona"'), 'textarea tetap ada');
});

await testAsync('endpoint /api/persona menjaga batas dan tipe', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("path === '/api/persona'"), 'endpoint terdaftar');
  assert.ok(server.includes('maks 1500 karakter'), 'menolak persona kepanjangan');
  assert.ok(server.includes("persona harus teks"), 'menolak tipe selain teks');
  assert.ok(server.includes('setPersona(guildId'), 'menyimpan lewat repo');
  // Persona tidak boleh lagi dikirim ke halaman pengaturan.
  assert.equal(
    /pengaturanPage\(\{[^}]*persona/.test(server),
    false,
    'persona tidak dikirim ke halaman pengaturan',
  );
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

await testAsync('select-shell: chevron tidak melayang di luar garis bawah select', async () => {
  // Bug nyata dari laporan pemilik server: garis bawah select berhenti di
  // tengah baris, lalu panah chevron melayang jauh di kanannya.
  //
  // Penyebabnya: form memakai `<span class="select-shell" style="width:100%">`,
  // jadi shell selebar kolom (mis. 400px) sementara `<select>` tetap dibatasi
  // `max-width: 260px`. Chevron diposisikan `right: 10px` terhadap SHELL, jadi
  // ia jatuh ~140px di kanan ujung select dan di luar garis bawahnya.
  const { STYLE } = await import('../src/web/ui/theme.js');

  const rule = (selector: string): string => {
    const start = STYLE.indexOf(`${selector} {`);
    assert.ok(start > -1, `aturan ${selector} ada`);
    return STYLE.slice(start, STYLE.indexOf('}', start));
  };

  const full = rule('.select-shell.full');
  assert.ok(/width:\s*100%/.test(full), 'shell varian .full selebar kolom');

  const fullSelect = rule('.select-shell.full select');
  // Kunci perbaikannya: select tidak boleh lagi dibatasi 260px, kalau tidak
  // chevron (posisinya relatif ke shell) berakhir di luar garis bawah select.
  assert.ok(
    /max-width:\s*none/.test(fullSelect),
    'select di dalam .full TIDAK dibatasi max-width (chevron ikut ujung garis)',
  );
  assert.ok(/min-width:\s*0/.test(fullSelect), 'nama channel panjang tidak mendorong lebar');
  // Chevron 15px + right:10px. Padding kanan harus lebih besar dari itu,
  // kalau tidak nama channel panjang menabrak panahnya.
  assert.ok(
    /padding-right:\s*34px/.test(fullSelect),
    'padding kanan menyisakan ruang untuk chevron',
  );

  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  // Inline style itulah akar bug: ia melebarkan SHELL, bukan select.
  assert.equal(
    /class="select-shell"[^>]*style="[^"]*width:\s*100%/.test(pages),
    false,
    'tidak ada lagi shell selebar kolom lewat inline style',
  );
  // Semua shell di dalam form harus memakai varian .full supaya select dan
  // chevron berbagi kotak yang sama.
  const shells = [...pages.matchAll(/class="select-shell([^"]*)"/g)].map((m) => m[1]!.trim());
  assert.ok(shells.length >= 6, `ada ${shells.length} pemakaian select-shell`);
  const tanpaFull = shells.filter((cls) => !cls.includes('full'));
  assert.deepEqual(tanpaFull, [], `select-shell di form wajib .full: ${tanpaFull.join(' | ')}`);
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
  quietHours: true,
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
  displayMode: 'embed' as const, imageEnabled: false,
  includeAvatar: true,
  cardAvatar: true,
  cardText: true,
  embedAvatar: false,
  embedAuthor: false,
  bannerPath: null,
  bannerData: null,
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
  displayMode: 'embed' as const, imageEnabled: false,
  includeAvatar: true,
  cardAvatar: true,
  cardText: true,
  embedAvatar: false,
  embedAuthor: false,
  bannerPath: null,
  bannerData: null,
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
  const { hourInZone } = await import('../src/lib/timezone.js');
  // Jam DIPATOK, bukan Date.now().
  //
  // Test ini dulu memakai jam mesin, dan `quietHours` default menyala. Zona
  // bawaannya WIB (UTC+7), jadi antara 16:00–22:59 UTC jam WIB sudah 23:00+
  // — masuk jam tenang, sapaan ditahan, dan test gagal padahal kodenya benar.
  // Hasilnya: CI hijau bila kebetulan jalan siang, merah bila jalan malam.
  // 09:00 WIB dipilih supaya jauh dari batas jam tenang (23:00–06:00).
  const now = Date.parse('2026-01-15T02:00:00.000Z');
  assert.equal(hourInZone(now, 'Asia/Jakarta'), 9, 'prasyarat: 09:00 WIB, di luar jam tenang');
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

await testAsync('sambutan: bot lain IKUT disambut (keputusan pemilik)', async () => {
  // Perilaku ini sengaja dibalik: dulu bot dilewati diam-diam. Sekarang bot
  // yang ditambahkan ke server disapa seperti anggota lain, mengikuti TitanBot.
  // Yang dijaga test ini: kalau ada yang mengembalikan filter bot tanpa sadar,
  // test akan merah dan keputusannya bisa ditinjau ulang.
  const source = await readFile('src/features/welcome.ts', 'utf8');
  const welcome = source.slice(
    source.indexOf('export async function welcomeMember'),
    source.indexOf('export async function goodbyeMember'),
  );
  // Buang komentar dulu: komentar di berkas ini MENJELASKAN cara
  // mengembalikan filter bot, jadi teks mentah akan cocok palsu.
  const tanpaKomentar = (kode: string): string =>
    kode
      .split('\n')
      .filter((baris) => !baris.trim().startsWith('//') && !baris.trim().startsWith('*'))
      .join('\n');

  assert.ok(
    !/if \(member\.user\.bot\)/.test(tanpaKomentar(welcome)),
    'jalur sambutan tidak memfilter bot',
  );

  const goodbye = source.slice(source.indexOf('export async function goodbyeMember'));
  assert.ok(
    !/if \(member\.user\.bot\) return/.test(tanpaKomentar(goodbye)),
    'jalur perpisahan tidak memfilter bot',
  );
});

await testAsync('sambutan: bot lain disapa end-to-end', async () => {
  // Bukan hanya grep: bot yang bergabung harus benar-benar memicu pengiriman.
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '121212121212121212',
    name: 'join-leave',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: '1' };
    },
  };
  const guild = {
    id: '131313131313131313',
    name: 'Komunitas Zypher',
    memberCount: 7,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '141414141414141414',
    displayName: 'HelperBot',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    send: async () => ({ id: '1' }),
    user: {
      bot: true, // ⬅ inti test
      username: 'helperbot',
      tag: 'helperbot#0000',
      displayAvatarURL: () => 'https://x/y.png',
    },
  };

  await saveWelcomeSettings(guild.id, {
    enabled: true,
    useAi: false,
    channelId: channel.id,
    template: 'Halo {user}',
    displayMode: 'text',
    imageEnabled: false,
  });

  const hasil = await welcomeMember(member as never);
  assert.equal(hasil.sent, true, 'bot yang bergabung tetap disapa');
  assert.ok(String(sent.at(-1)!.content).includes('Halo HelperBot'), 'teks sambutan terkirim');
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
  assert.ok(/wanted\.mode === 'card' && !attachment/.test(source), 'kegagalan kartu dideteksi');
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

await testAsync('mode tampilan: tiap mode mengirim bentuk berbeda (channel palsu)', async () => {
  const { sendGoodbyeTest } = await import('../src/features/test-send.js');
  const { GOODBYE_DEFAULTS } = await import('../src/db/repo.js');

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
    memberCount: 12,
    channels: { fetch: async () => channel },
    // resolveChannel() memeriksa izin lewat guild.members.me.
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };
  const client = { guilds: { fetch: async () => guild } } as never;

  // Mode text: harus ada content berisi teks, tanpa embed & tanpa file.
  await sendGoodbyeTest(client, {
    guildId: guild.id,
    member: member as never,
    settings: { ...GOODBYE_DEFAULTS, guildId: guild.id, enabled: true, useAi: false, channelId: channel.id, displayMode: 'text', updatedAt: 0 } as never,
  });
  const textKirim = sent.at(-1)!;
  assert.equal(typeof textKirim.content, 'string', 'mode text mengirim content');
  assert.ok(String(textKirim.content).length > 0, 'content tidak kosong');
  // Mode text tidak menyertakan embeds sama sekali (payload-nya memang beda).
  assert.ok(textKirim.embeds === undefined, 'mode text tidak mengirim embed');

  // Mode embed: embeds berisi, content hanya penanda uji.
  await sendGoodbyeTest(client, {
    guildId: guild.id,
    member: member as never,
    settings: { ...GOODBYE_DEFAULTS, guildId: guild.id, enabled: true, useAi: false, channelId: channel.id, displayMode: 'embed', updatedAt: 0 } as never,
  });
  const embedKirim = sent.at(-1)!;
  assert.ok(Array.isArray(embedKirim.embeds) && embedKirim.embeds.length === 1, 'mode embed mengirim 1 embed');
  assert.deepEqual(embedKirim.files, [], 'mode embed tanpa lampiran (tanpa banner)');

  // Mode card: kartu PNG saja — TANPA embed.
  //
  // Dulu kartu dibungkus embed "supaya tampil besar". Ternyata wadah itu yang
  // membuat hasilnya terbaca sebagai embed biasa (garis biru + footer), padahal
  // yang diminta adalah kartu seperti bot besar: teks, lalu gambar. Test ini
  // sekarang mengunci bentuk itu, termasuk mention yang benar-benar aktif.
  await sendGoodbyeTest(client, {
    guildId: guild.id,
    member: member as never,
    settings: { ...GOODBYE_DEFAULTS, guildId: guild.id, enabled: true, useAi: false, channelId: channel.id, displayMode: 'card', updatedAt: 0 } as never,
  });
  const cardKirim = sent.at(-1)!;
  const kartuFiles = (cardKirim.files ?? []) as Array<{ name?: string }>;
  assert.equal(kartuFiles.length, 1, 'mode card mengirim tepat satu lampiran');
  assert.match(String(kartuFiles[0]?.name), /^sampai-jumpa-.*\.png$/, 'lampirannya PNG kartu');

  // Maksud test: kartu tidak dibungkus embed. Payload mode kartu sekarang
  // tidak mengirim kunci `embeds` sama sekali (undefined), bukan array kosong —
  // jadi yang diperiksa adalah tidak adanya embed BERISI.
  const kartuEmbeds = (cardKirim.embeds ?? []) as unknown[];
  assert.equal(kartuEmbeds.length, 0, 'kartu TIDAK dibungkus embed');
  assert.ok(
    String(cardKirim.content).includes('<@222222222222222222>'),
    'member di-mention di content, bukan hanya namanya',
  );
  assert.ok(
    JSON.stringify(cardKirim.allowedMentions).includes('222222222222222222'),
    'mention diizinkan — tanpa ini yang tampil teks mentah',
  );
});

await testAsync('dashboard: tombol Kelola tidak memakai panah dropdown', async () => {
  // Panah ke bawah di tombol membuat orang mengira ada menu yang bisa dibuka;
  // keduanya sebenarnya tautan biasa ke halaman lain.
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  const panel = pages.slice(pages.indexOf('href="/panel"') - 60, pages.indexOf('href="/panel"') + 90);
  assert.ok(panel.includes('Kelola panel'), 'tombol panel ada');
  assert.ok(!panel.includes('chevron'), 'tombol panel tanpa chevron');

  const dok = pages.slice(pages.indexOf('href="/dokumen"') - 60, pages.indexOf('href="/dokumen"') + 80);
  assert.ok(dok.includes('Kelola'), 'tombol dokumen ada');
  assert.ok(!dok.includes('chevron'), 'tombol dokumen tanpa chevron');

  // Panah pada <select> asli tetap dipertahankan — di sana memang indikator dropdown.
  assert.ok(pages.includes("icon('chevron', 15)"), 'select masih memakai chevron');
});

/** PNG RGBA satu warna — cukup untuk menguji jalur baca/tulis banner. */
async function buatPngMinimal(width: number, height: number): Promise<Buffer> {
  const { deflateSync } = await import('node:zlib');
  const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 90)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await testAsync('banner: dipulihkan dari database saat file hilang', async () => {
  // Hosting panel men-deploy ulang dengan `git pull` dan me-reset folder kerja,
  // jadi data/banners/ bisa hilang padahal nama file masih tersimpan di DB.
  // Dulu hasilnya banner hilang TANPA satu pun log — tidak mungkin didiagnosis.
  const { rmSync, existsSync } = await import('node:fs');
  const { BANNER_DIR } = await import('../src/features/banner.js');
  const { join } = await import('node:path');

  const name = 'banner-uji-pulih.png';
  const target = join(BANNER_DIR, name);
  // PNG minimal dibangun di sini, bukan dibaca dari file contoh — test harus
  // mandiri supaya tidak rusak hanya karena berkas contohnya dihapus.
  const png = await buatPngMinimal(400, 120);
  rmSync(target, { force: true });

  assert.equal(existsSync(target), false, 'file belum ada');

  // Diuji lewat jalur yang benar-benar dipakai sambutan — memanggil
  // ensureBannerFile() saja tidak cukup: dulu readBannerAttachment() bisa
  // melewatinya dan tetap mengembalikan null tanpa log.
  const { readBannerAttachment } = await import('../src/features/banner.js');
  const att = await readBannerAttachment(name, { mime: 'image/png', base64: png.toString('base64') });
  assert.ok(att, 'lampiran terbentuk dari salinan database');
  assert.equal(att!.name, name, 'nama lampiran benar');
  assert.equal(existsSync(target), true, 'file kembali ada di disk');
  rmSync(target, { force: true });

  // Tanpa salinan DAN tanpa file: menolak, tapi tidak melempar error.
  const gagal = await readBannerAttachment(name, null);
  assert.equal(gagal, null, 'tanpa salinan tidak bisa dipulihkan');
});

await testAsync('banner: tetap terkirim saat mode card jatuh ke embed', async () => {
  // Bug nyata dari hosting user: mode "Card" dipilih, Chromium tidak ada
  // (Pterodactyl tidak menyediakannya), jadi pesan jatuh ke embed — tapi
  // keputusan banner masih memakai `wanted` ('card'), sehingga banner dibuang
  // dan sambutan uji terkirim tanpa gambar. Tidak ada error di log.
  const { sendWelcomeTest } = await import('../src/features/test-send.js');
  const { WELCOME_DEFAULTS } = await import('../src/db/repo.js');
  const { saveBanner, deleteBanner } = await import('../src/features/banner.js');

  const png = await buatPngMinimal(400, 120);
  const banner = await saveBanner(`data:image/png;base64,${png.toString('base64')}`, 'uji-card-fallback');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '111111111111111111',
    name: 'sambutan',
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
    memberCount: 12,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };
  const client = { guilds: { fetch: async () => guild } } as never;

  try {
    // Mode card + Chromium TIDAK tersedia (sandbox & hosting panel).
    // Kalau runner punya Chromium, kartu jadi PNG dan banner ada di dalamnya —
    // itu juga benar, jadi kedua hasil diterima. Yang TIDAK boleh: embed tanpa
    // banner sama sekali.
    await sendWelcomeTest(client, {
      guildId: guild.id,
      member: member as never,
      target: 'channel',
      settings: {
        ...WELCOME_DEFAULTS,
        guildId: guild.id,
        enabled: true,
        useAi: false,
        channelId: channel.id,
        displayMode: 'card',
        bannerPath: banner.name,
        updatedAt: 0,
      } as never,
    });

    const payload = sent.at(-1)!;
    const files = (payload.files ?? []) as unknown[];
    const embeds = (payload.embeds ?? []) as unknown[];

    // Sejak kartu digambar sendiri (tanpa Chromium), mode Card WAJIB menghasilkan
    // PNG. Dulu test ini menerima "kartu ATAU embed" karena di hosting tidak ada
    // Chromium — kelonggaran itulah yang menyembunyikan bug "banner tak pernah
    // terkirim" selama berbulan-bulan. Sekarang tidak ada alasan untuk mundur.
    assert.equal(files.length, 1, 'mode card mengirim tepat satu lampiran PNG');
    const kartu = files[0] as { name?: string; attachment?: unknown };
    assert.match(String(kartu.name), /^selamat-datang-.*\.png$/, 'lampirannya PNG kartu');
    assert.ok((kartu.attachment as Buffer).byteLength > 10_000, 'PNG-nya berisi gambar nyata');

    // Kartu dikirim sebagai lampiran gambar biasa, bukan di dalam embed.
    assert.deepEqual(embeds, [], 'kartu TIDAK dibungkus embed');
    assert.ok(
      String(payload.content).includes('<@222222222222222222>'),
      'member baru di-mention di content',
    );
    assert.ok(
      JSON.stringify(payload.allowedMentions).includes('222222222222222222'),
      'mention diizinkan',
    );

    // Banner TIDAK dikirim terpisah lagi: isinya sudah menjadi latar kartu.
    assert.equal(
      files.some((file) => (file as { name?: string }).name === banner.name),
      false,
      'banner tidak dikirim sebagai lampiran kedua',
    );
  } finally {
    await deleteBanner(banner.name).catch(() => undefined);
  }
});

await testAsync('banner: mode embed biasa mengirim banner sebagai lampiran', async () => {
  // Kasus paling umum: admin memilih mode Embed. Banner harus selalu ikut.
  const { sendGoodbyeTest } = await import('../src/features/test-send.js');
  const { GOODBYE_DEFAULTS } = await import('../src/db/repo.js');
  const { saveBanner, deleteBanner } = await import('../src/features/banner.js');

  const png = await buatPngMinimal(300, 100);
  const banner = await saveBanner(`data:image/png;base64,${png.toString('base64')}`, 'uji-embed-banner');

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
    memberCount: 12,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };
  const client = { guilds: { fetch: async () => guild } } as never;

  try {
    await sendGoodbyeTest(client, {
      guildId: guild.id,
      member: member as never,
      settings: {
        ...GOODBYE_DEFAULTS,
        guildId: guild.id,
        enabled: true,
        useAi: false,
        channelId: channel.id,
        displayMode: 'embed',
        bannerPath: banner.name,
        updatedAt: 0,
      } as never,
    });

    const payload = sent.at(-1)!;
    const files = (payload.files ?? []) as unknown[];
    const embeds = (payload.embeds ?? []) as Array<{ data?: { image?: { url?: string } } }>;

    assert.equal(files.length, 1, 'satu lampiran: banner');
    assert.equal((files[0] as { name?: string }).name, banner.name, 'nama lampiran = banner');
    assert.equal(embeds.length, 1, 'satu embed');
    assert.match(
      embeds[0]?.data?.image?.url ?? '',
      /^attachment:\/\//,
      'embed menunjuk lampiran, bukan data URI',
    );
  } finally {
    await deleteBanner(banner.name).catch(() => undefined);
  }
});

await testAsync('banner: izin Attach Files kurang diberi tahu, bukan gagal senyap', async () => {
  const { sendGoodbyeTest } = await import('../src/features/test-send.js');
  const { GOODBYE_DEFAULTS } = await import('../src/db/repo.js');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '111111111111111111',
    name: 'perpisahan',
    isTextBased: () => true,
    isDMBased: () => false,
    // SendMessages & ViewChannel ada; EmbedLinks & AttachFiles tidak.
    permissionsFor: () => ({ has: (name: string) => name === 'SendMessages' || name === 'ViewChannel' }),
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: '1' };
    },
  };
  const guild = {
    id: '156942477750257766',
    name: 'Komunitas Zypher',
    memberCount: 12,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };
  const client = { guilds: { fetch: async () => guild } } as never;

  const result = await sendGoodbyeTest(client, {
    guildId: guild.id,
    member: member as never,
    settings: {
      ...GOODBYE_DEFAULTS,
      guildId: guild.id,
      enabled: true,
      useAi: false,
      channelId: channel.id,
      displayMode: 'embed',
      updatedAt: 0,
    } as never,
  });

  // Tetap terkirim (tidak melempar), tapi admin diberi tahu keterbatasannya.
  assert.ok(result.ok, 'pesan tetap terkirim');
  assert.ok(result.note?.includes('Attach Files'), 'menyebut izin Attach Files');
  assert.ok(result.note?.includes('Embed Links'), 'menyebut izin Embed Links');
  assert.ok(result.note?.includes('banner'), 'menjelaskan dampaknya ke banner');
});

await testAsync('banner: mode teks tidak memaksa lampiran', async () => {
  const source = await readFile('src/features/test-send.ts', 'utf8');
  // Mode teks murni tidak punya tempat untuk gambar — jangan menambah lampiran
  // yang membuat pesan terlihat seperti embed gagal.
  assert.ok(/modeNow === 'embed' \|\| modeNow === 'container'/.test(source), 'banner dibatasi ke mode bergambar');
  // Keputusan banner TIDAK boleh lagi memakai `wanted`.
  assert.equal(
    /wanted === 'card' \|\| wanted === 'text'/.test(source),
    false,
    'tidak ada lagi keputusan banner berbasis mode keinginan',
  );
});

await testAsync('banner: unggahan menyimpan salinan ke database', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(/bannerData\s*=\s*\{\s*mime/.test(server), 'membentuk bannerData saat unggah');
  assert.ok(
    server.includes('saveWelcomeSettings(guildId, { bannerPath: saved.name, bannerData })'),
    'salinan ikut disimpan (sambutan)',
  );
  assert.ok(
    server.includes('{ bannerPath: null, bannerData: null }'),
    'salinan ikut dihapus saat banner dihapus',
  );
});

await testAsync('banner: dipakai di mode container lewat Media Gallery', async () => {
  const { buildContainerCard } = await import('../src/features/container-card.js');

  const dengan = buildContainerCard({
    kind: 'welcome', text: 'Halo Sky', guildName: 'Z', memberCount: 5, banner: { name: 'banner-x.png' },
  });
  const json = JSON.stringify(dengan!.toJSON());
  assert.ok(json.includes('attachment://banner-x.png'), 'banner dirujuk lewat attachment://');
  assert.ok(json.includes('"type":12'), 'memakai Media Gallery (tipe 12)');

  const tanpa = buildContainerCard({ kind: 'welcome', text: 'Halo Sky', guildName: 'Z' });
  assert.ok(!JSON.stringify(tanpa!.toJSON()).includes('"type":12'), 'tanpa banner tidak ada galeri');
});

await testAsync('banner: files tetap boleh di Components V2', async () => {
  // Yang dilarang hanya content, embeds, stickers, poll. `files` justru cara
  // mengirim banner, jadi jangan sampai ada yang "merapikan" kode dengan
  // membuang files dari payload container.
  const source = await readFile('src/features/welcome.ts', 'utf8');
  const blok = source.slice(source.indexOf('payload.components?.length'));
  assert.ok(/components: payload\.components,\s*flags: payload\.flags,\s*files/.test(blok), 'files ikut terkirim');
});

await testAsync('mode container: komponen V2 dibentuk, tanpa embed', async () => {
  const { buildContainerCard, containerPayload } = await import('../src/features/container-card.js');
  const { MessageFlags } = await import('discord.js');

  const card = buildContainerCard({
    kind: 'welcome',
    text: 'Selamat datang Sky',
    guildName: 'Komunitas Zypher',
    memberCount: 42,
    extra: ['dibuat dengan AI'],
  });
  assert.ok(card, 'kartu terbentuk');

  const json = card!.toJSON() as unknown as Record<string, unknown>;
  assert.equal(json.type, 17, 'tipe Container');
  assert.ok(Array.isArray(json.components) && (json.components as unknown[]).length >= 3, 'ada beberapa blok');

  const payload = containerPayload(card!);
  // Flag ini WAJIB. Tanpa IsComponentsV2, Discord mengabaikan container dan
  // menganggap pesan tidak punya isi.
  assert.equal(payload.flags, MessageFlags.IsComponentsV2, 'flag Components V2 dipasang');
});

await testAsync('mode container: teks kosong tidak menghasilkan kartu kosong', async () => {
  const { buildContainerCard } = await import('../src/features/container-card.js');
  assert.equal(buildContainerCard({ kind: 'welcome', text: '   ', guildName: 'Z' }), null);
});

await testAsync('mode container: dikirim tanpa content/embeds (channel palsu)', async () => {
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '151515151515151515',
    name: 'join-leave',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: '1' };
    },
  };
  const guild = {
    id: '161616161616161616',
    name: 'Komunitas Zypher',
    memberCount: 42,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '171717171717171717',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    send: async () => ({ id: '1' }),
    user: { bot: false, username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };

  await saveWelcomeSettings(guild.id, {
    enabled: true,
    useAi: false,
    channelId: channel.id,
    template: 'Halo {user}, member ke-{memberCount}!',
    displayMode: 'container',
    imageEnabled: false,
  });

  await welcomeMember(member as never);
  const kirim = sent.at(-1)!;
  assert.ok(Array.isArray(kirim.components) && (kirim.components as unknown[]).length === 1, 'mengirim komponen');
  assert.equal(kirim.content, undefined, 'tanpa content (dilarang di V2)');
  assert.equal(kirim.embeds, undefined, 'tanpa embed (dilarang di V2)');
  // `files` TIDAK dilarang di Components V2 — hanya content/embeds/stickers/poll.
  // Ini yang dipakai mengirim banner, jadi harus tetap boleh ada.
  assert.ok(Array.isArray(kirim.files), 'files boleh ada (untuk banner)');
  assert.ok(typeof kirim.flags === 'number', 'flag ikut terkirim');
});

await testAsync('mode tampilan: card, embed, text dikenali', async () => {
  const { DISPLAY_MODES, normalizeDisplayMode, displayModeLabel } = await import(
    '../src/features/display-mode.js'
  );
  const kunci = DISPLAY_MODES.map((m) => m.key);
  assert.deepEqual(kunci, ['card', 'container', 'embed', 'text'], 'empat mode, urutan untuk dashboard');

  assert.equal(normalizeDisplayMode('card'), 'card');
  assert.equal(normalizeDisplayMode('EMBED'), 'embed', 'tidak peka huruf besar');
  assert.equal(normalizeDisplayMode(' text '), 'text', 'spasi diabaikan');
  assert.equal(displayModeLabel('text'), 'Text');
});

await testAsync('mode tampilan: embed satu-satunya yang tidak bisa me-ping', async () => {
  const { DISPLAY_MODES } = await import('../src/features/display-mode.js');
  const peming = DISPLAY_MODES.filter((m) => m.canMention).map((m) => m.key);
  // Discord tidak memicu mention di dalam embed — itu satu-satunya batasan
  // nyata. Card ikut bisa me-ping sejak kartunya tidak lagi dibungkus embed;
  // container bisa karena mention-nya di Text Display. Kalau daftar ini
  // berubah, dashboard akan menjanjikan ping yang tidak pernah terjadi.
  assert.deepEqual(peming, ['card', 'container', 'text']);
});

await testAsync('mode tampilan: nilai asing jatuh ke embed, bukan error', async () => {
  const { normalizeDisplayMode, DEFAULT_DISPLAY_MODE } = await import(
    '../src/features/display-mode.js'
  );
  assert.equal(DEFAULT_DISPLAY_MODE, 'embed', 'bawaan = bentuk pesan lama');
  for (const aneh of [null, undefined, '', 'kartu', 42, {}]) {
    assert.equal(normalizeDisplayMode(aneh), 'embed', `nilai ${String(aneh)} harus aman`);
  }
});

await testAsync('mode tampilan: nama mode lama tetap diterima', async () => {
  const { normalizeDisplayMode } = await import('../src/features/display-mode.js');
  assert.equal(normalizeDisplayMode('mati'), 'text');
  assert.equal(normalizeDisplayMode('statis'), 'embed');
  assert.equal(normalizeDisplayMode('dinamis'), 'card');
});

await testAsync('mode tampilan: cadangan berurutan saat sumber daya kurang', async () => {
  const { fallbackMode } = await import('../src/features/display-mode.js');

  // Kartu tanpa renderer -> embed.
  assert.deepEqual(fallbackMode('card', { card: false }), {
    mode: 'embed',
    fellBack: true,
    reason: 'kartu tidak bisa dirender',
  });
  // Kartu tanpa renderer DAN tanpa izin embed -> teks.
  assert.equal(fallbackMode('card', { card: false, embed: false }).mode, 'text');
  // Embed tanpa izin -> teks.
  assert.equal(fallbackMode('embed', { embed: false }).mode, 'text');
  // Teks selalu bisa, bahkan tanpa izin lain.
  assert.equal(fallbackMode('text', { card: false, embed: false }).mode, 'text');
  // Tidak ada kekurangan -> tidak jatuh.
  const pas = fallbackMode('card', {});
  assert.equal(pas.mode, 'card');
  assert.equal(pas.fellBack, false);
});

await testAsync('mode tampilan: data lama diterjemahkan dari imageEnabled', async () => {
  const { modeFromLegacySettings } = await import('../src/features/display-mode.js');
  // Server yang dulu mengirim kartu tetap mengirim kartu.
  assert.equal(modeFromLegacySettings(true), 'card');
  // Server yang dulu embed tetap embed — bukan pindah ke kartu diam-diam.
  assert.equal(modeFromLegacySettings(false), 'embed');
});

await testAsync('mode tampilan: welcomeMember mengirim sesuai mode (end-to-end)', async () => {
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '333333333333333333',
    name: 'join-leave',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: '1' };
    },
  };
  const guild = {
    id: '444444444444444444',
    name: 'Komunitas Zypher',
    memberCount: 42,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '555555555555555555',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    send: async () => ({ id: '1' }),
    user: {
      bot: false,
      username: 'sky',
      tag: 'sky#0000',
      displayAvatarURL: () => 'https://x/y.png',
    },
  };

  // Waktu ini dibekukan agar AI tidak dipanggil: mode template + useAi false.
  await saveWelcomeSettings(guild.id, {
    enabled: true,
    useAi: false,
    channelId: channel.id,
    template: 'Halo {user} di {server}',
    displayMode: 'text',
    imageEnabled: false,
  });

  const hasil = await welcomeMember(member as never);
  assert.equal(hasil.sent, true, 'sambutan terkirim');
  const kirim = sent.at(-1)!;
  assert.ok(String(kirim.content).includes('<@555555555555555555>'), 'mode text me-mention member');
  assert.ok(String(kirim.content).includes('Halo Sky di Komunitas Zypher'), 'teks template terisi');
  assert.deepEqual(kirim.embeds, [], 'mode text tanpa embed');
  assert.ok(
    JSON.stringify(kirim.allowedMentions).includes('555555555555555555'),
    'mention diizinkan (kalau tidak, tidak akan memicu notifikasi)',
  );

  // Mode embed: satu embed, dan mention lewat content.
  //
  // Test ini dulu berbunyi "mode embed tidak menulis content" — dan itulah
  // bug-nya: member baru tidak pernah menerima notifikasi di mode embed.
  // Mention HARUS di content, karena `<@id>` di dalam embed cuma teks biasa.
  await saveWelcomeSettings(guild.id, { displayMode: 'embed' });
  await welcomeMember(member as never);
  const embedKirim = sent.at(-1)!;
  assert.equal((embedKirim.embeds as unknown[]).length, 1, 'mode embed mengirim 1 embed');
  assert.equal(embedKirim.content, '<@555555555555555555>', 'mention dikirim lewat content');
  assert.ok(
    !String(embedKirim.content).includes('Halo Sky'),
    'teks sapaan tidak diulang di content — sudah ada di deskripsi embed',
  );
  assert.ok(
    JSON.stringify(embedKirim.allowedMentions).includes('555555555555555555'),
    'mention diizinkan',
  );
});

await testAsync('mention: aktif di SEMUA mode, bukan hanya text', async () => {
  // Bug nyata: mode embed mengembalikan `content: ''`, jadi member baru tidak
  // pernah dapat notifikasi. Test lama justru mengunci bug itu ("mode embed
  // tidak menulis content"). Sekarang seluruh matriks diuji sekaligus supaya
  // tidak ada mode yang terlewat lagi.
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const ID = '222222222222222222';
  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '999999999999999991', name: 'join-leave',
    isTextBased: () => true, isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p: Record<string, unknown>) => { sent.push(p); return { id: '1' }; },
  };
  const guild = {
    id: '156942477750257700', name: 'Komunitas Zypher', memberCount: 5,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: ID, displayName: 'Sky', guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { bot: false, username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };

  for (const mode of ['card', 'embed', 'text', 'container'] as const) {
    await saveWelcomeSettings(guild.id, {
      enabled: true, useAi: false, channelId: channel.id,
      template: 'Halo {user}!', displayMode: mode, bannerPath: null,
    });
    await welcomeMember(member as never);
    const p = sent.at(-1)!;

    // Container menaruh mention di komponen; mode lain di content.
    // Yang dibandingkan adalah payload utuh, karena itu yang diterima Discord.
    const utuh = JSON.stringify({ content: p.content ?? '', components: p.components ?? [] });
    assert.ok(utuh.includes(`<@${ID}>`), `mode ${mode}: member di-mention`);
    assert.ok(
      JSON.stringify(p.allowedMentions ?? {}).includes(ID),
      `mode ${mode}: mention diizinkan (tanpa ini yang tampil teks mentah)`,
    );
  }
});

await testAsync('mention: mode embed tidak mengulang teks sapaan di content', async () => {
  // Mention embed harus dikirim sebagai content, TAPI teksnya sudah ada di
  // deskripsi embed. Kalau ditempel lagi, sapaan tampil dua kali.
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '999999999999999992', name: 'join-leave',
    isTextBased: () => true, isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p: Record<string, unknown>) => { sent.push(p); return { id: '1' }; },
  };
  const guild = {
    id: '156942477750257701', name: 'Komunitas Zypher', memberCount: 5,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222223', displayName: 'Rani', guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { bot: false, username: 'rani', tag: 'rani#0000', displayAvatarURL: () => 'https://x/y.png' },
  };

  await saveWelcomeSettings(guild.id, {
    enabled: true, useAi: false, channelId: channel.id,
    template: 'Halo {user}!', displayMode: 'embed', bannerPath: null,
  });
  await welcomeMember(member as never);

  const p = sent.at(-1)!;
  assert.equal(p.content, '<@222222222222222223>', 'content hanya berisi mention');
  const embed = (p.embeds as Array<{ data?: { description?: string } }>)[0];
  assert.ok(String(embed?.data?.description).includes('Halo Rani'), 'teks sapaan ada di embed');
});

await testAsync('mode tampilan: DM tidak pernah menyertakan mention', async () => {
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const dm: Record<string, unknown>[] = [];
  const guild = {
    id: '888888888888888888',
    name: 'Komunitas Zypher',
    memberCount: 42,
    // ChannelId sengaja kosong: jalur DM.
    channels: { fetch: async () => null },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '9999999999999999999',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    send: async (payload: Record<string, unknown>) => {
      dm.push(payload);
      return { id: '1' };
    },
    user: {
      bot: false,
      username: 'sky',
      tag: 'sky#0000',
      displayAvatarURL: () => 'https://x/y.png',
    },
  };

  await saveWelcomeSettings(guild.id, {
    enabled: true,
    useAi: false,
    channelId: null,
    template: 'Halo {user}',
    displayMode: 'text',
    imageEnabled: false,
  });

  await welcomeMember(member as never);
  const kirim = dm.at(-1)!;
  assert.ok(String(kirim.content).includes('Halo Sky'), 'teks sampai ke DM');
  assert.ok(!String(kirim.content).includes('<@'), 'DM tidak memuat mention');
});

await testAsync('mode tampilan: database lama dimigrasi tanpa mengubah tampilan', async () => {
  // Server yang sudah berjalan punya tabel welcome/goodbye TANPA display_mode.
  // Kolomnya ditambahkan lewat ALTER, dan baris lama dibiarkan NULL — dibaca
  // sebagai mode yang setara dengan pengaturan lamanya.
  //
  // Diuji pada driver terpisah (bukan driver global milik smoke.ts): mengganti
  // driver global akan meninggalkan koneksi yang salah untuk test berikutnya.
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createSqliteDriver } = await import('../src/db/driver.js');
  const { modeFromLegacySettings } = await import('../src/features/display-mode.js');

  const dir = mkdtempSync(join(tmpdir(), 'zypher-migrasi-'));
  const file = join(dir, 'lama.db');
  try {
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE welcome (guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER NOT NULL DEFAULT 0,
        use_ai INTEGER NOT NULL DEFAULT 1, template TEXT, image_enabled INTEGER NOT NULL DEFAULT 1,
        style TEXT, example TEXT, include_avatar INTEGER NOT NULL DEFAULT 1, banner_path TEXT, updated_at INTEGER NOT NULL);
      INSERT INTO welcome (guild_id, enabled, image_enabled, updated_at) VALUES ('kartu', 1, 1, 1);
      INSERT INTO welcome (guild_id, enabled, image_enabled, updated_at) VALUES ('embed', 1, 0, 1);
    `);
    db.close();

    const driver = createSqliteDriver(file);
    try {
      // Statement migrasi yang sama persis dengan src/db/index.ts.
      await driver.exec('ALTER TABLE welcome ADD COLUMN display_mode TEXT');

      const rows = await driver.all<{ guild_id: string; display_mode: string | null; image_enabled: number }>(
        'SELECT guild_id, display_mode, image_enabled FROM welcome ORDER BY guild_id',
      );
      for (const row of rows) {
        assert.equal(row.display_mode, null, 'baris lama dibiarkan NULL, bukan diisi paksa');
        // Jalur baca menerjemahkannya jadi mode yang setara pengaturan lama.
        const mode = row.display_mode
          ? 'x'
          : modeFromLegacySettings(Boolean(row.image_enabled));
        assert.equal(mode, row.guild_id === 'kartu' ? 'card' : 'embed', `${row.guild_id} tetap setara`);
      }
    } finally {
      driver.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync('mode tampilan: settings menyimpan & membaca mode', async () => {
  const { getWelcomeSettings, saveWelcomeSettings } = await import('../src/db/repo.js');
  const guild = '777777777777777777';

  await saveWelcomeSettings(guild, { enabled: true, displayMode: 'text' });
  assert.equal((await getWelcomeSettings(guild)).displayMode, 'text');

  await saveWelcomeSettings(guild, { displayMode: 'card' });
  assert.equal((await getWelcomeSettings(guild)).displayMode, 'card');

  // Nilai aneh tidak boleh tersimpan mentah lalu mematikan sambutan.
  await saveWelcomeSettings(guild, { displayMode: 'ngawur' as never });
  assert.equal((await getWelcomeSettings(guild)).displayMode, 'embed');
});

await testAsync('mode tampilan: mode teks tidak dianggap pesan kosong', async () => {
  // Jaring pengaman dulu hanya memeriksa embeds/files. Mode text memang tidak
  // punya keduanya, jadi kalau diperiksa dengan cara lama sambutan mode teks
  // akan selalu dianggap kosong.
  const source = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(
    /plainText\.length > 0 \|\| embeds\.length > 0 \|\| files\.length > 0 \|\| Boolean\(payload\.components/.test(
      source,
    ),
    'isi diperiksa termasuk content DAN komponen',
  );
});

await testAsync('mode tampilan: mention tidak ditulis dua kali', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  // Dulu mention ditempel di pemanggil padahal composePayload sudah menulisnya
  // untuk mode text — hasilnya `<@id> <@id> Halo ...`.
  assert.ok(!/<@\$\{member\.id\}>\$\{plainText/.test(source), 'tidak menempel mention kedua kali');
  assert.ok(source.includes('content: plainText || undefined'), 'content dipakai apa adanya');
});

await testAsync('mode tampilan: perpisahan menyebut member sebagai mention', async () => {
  // Keputusan pemilik server: perpisahan juga menyapa member dengan mention.
  // Discord tidak memicu notifikasi untuk member yang sudah keluar, jadi yang
  // tampil hanya nama yang bisa diklik — tapi teksnya tetap mention, bukan
  // nama polos.
  const source = await readFile('src/features/welcome.ts', 'utf8');
  const goodbye = source.slice(source.indexOf('export async function goodbyeMember'));
  assert.ok(goodbye.includes('mentionUser: true'), 'perpisahan memakai mention');
  assert.ok(
    goodbye.includes('allowedMentions: { users: [member.id] }'),
    'hanya member itu yang diizinkan — @everyone tetap mati',
  );
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
  assert.ok(source.includes('fallbackMode'), 'izin diterjemahkan jadi mode yang bisa dipakai');

  const { fallbackMode } = await import('../src/features/display-mode.js');
  const hasil = fallbackMode('embed', { embed: false });
  assert.equal(hasil.mode, 'text', 'embed tanpa izin jatuh ke teks');
  assert.equal(hasil.fellBack, true);
});

await testAsync('sambutan: izin Attach Files kurang mematikan mode kartu saja', async () => {
  const source = await readFile('src/features/welcome.ts', 'utf8');
  assert.ok(source.includes('AttachFiles'), 'memeriksa izin AttachFiles');

  const { fallbackMode } = await import('../src/features/display-mode.js');
  // Tanpa AttachFiles, kartu tidak mungkin dikirim — tapi embed masih bisa.
  const hasil = fallbackMode('card', { card: false, embed: true });
  assert.equal(hasil.mode, 'embed', 'kartu tanpa lampiran jatuh ke embed');
  assert.ok(hasil.reason, 'alasan dicatat');
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

await testAsync('pemecah sepi: pratinjau memakai aturan timer yang sama', async () => {
  const { previewQuietBreak } = await import('../src/features/preview.js');
  const { emptyState } = await import('../src/features/agent-core.js');

  const now = new Date('2026-11-09T12:00:00+07:00').getTime();

  // Belum pernah ada obrolan: timer tidak akan menyapa ruangan kosong.
  const kosong = await previewQuietBreak({
    settings: agentSettings() as never,
    guildName: 'Komunitas Zypher',
    state: emptyState(),
    now,
  });
  assert.equal(kosong.wouldFire, false, 'timer tidak menyapa channel yang belum pernah ramai');
  assert.ok(kosong.reason.includes('Belum ada obrolan'), 'alasan dijelaskan');

  // Baru sunyi 5 menit, ambang 45 menit: belum waktunya.
  const baru = await previewQuietBreak({
    settings: agentSettings() as never,
    guildName: 'Komunitas Zypher',
    state: { ...emptyState(), traces: [{ userId: 'u1', at: now - 5 * 60_000 }] },
    now,
  });
  assert.equal(baru.wouldFire, false, 'belum waktunya');
  assert.ok(/baru sunyi|45 menit/.test(baru.reason), 'menyebut sisa waktu');

  // Sunyi 60 menit, ambang 45: timer akan menyapa.
  const siap = await previewQuietBreak({
    settings: agentSettings({ cooldownSeconds: 0 }) as never,
    guildName: 'Komunitas Zypher',
    state: { ...emptyState(), traces: [{ userId: 'u1', at: now - 60 * 60_000 }] },
    now,
  });
  assert.equal(siap.wouldFire, true, 'sudah waktunya menyapa');
});

await testAsync('pemecah sepi: prompt pratinjau identik dengan bot asli', async () => {
  const core = await readFile('src/features/agent-core.ts', 'utf8');
  const agent = await readFile('src/features/agent.ts', 'utf8');
  const preview = await readFile('src/features/preview.ts', 'utf8');

  // Dulu prompt ditulis dua kali dengan kalimat berbeda: yang dilihat admin di
  // dashboard bukan yang benar-benar dikirim bot.
  assert.ok(core.includes('export const QUIET_SYSTEM_PROMPT'), 'prompt punya satu sumber');
  assert.ok(agent.includes('QUIET_SYSTEM_PROMPT'), 'bot asli memakainya');
  assert.ok(preview.includes('QUIET_SYSTEM_PROMPT'), 'pratinjau memakainya');
  assert.equal(
    (agent.match(/Kamu anggota komunitas yang santai/g) ?? []).length,
    0,
    'prompt tidak lagi ditulis ulang di agent.ts',
  );
  assert.ok(preview.includes('shouldBreakSilence'), 'pratinjau memakai keputusan timer yang sama');
});

await testAsync('pemecah sepi: tidak mengulang kalimat yang sama', async () => {
  const { buildAntiRepeatBlock, pickQuietAngle, QUIET_ANGLES } = await import('../src/features/agent-core.js');
  const { buildQuietPrompt } = await import('../src/features/preview.js');

  // Tanpa riwayat: tidak ada blok larangan (jangan menulis kalimat kosong).
  assert.equal(buildAntiRepeatBlock([]), '', 'kosong kalau belum ada riwayat');

  const block = buildAntiRepeatBlock(['Sepi banget ya', 'Halo semua']);
  assert.ok(block.includes('Sepi banget ya'), 'menyebut kalimat lama');
  assert.ok(block.includes('Halo semua'), 'menyebut semua kalimat lama');
  assert.match(block, /JANGAN/, 'instruksi tegas');

  // Maksimal 5 kalimat terakhir — prompt tidak boleh membengkak.
  const many = buildAntiRepeatBlock(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
  assert.equal(many.includes('a1'), false, 'yang lama dibuang');
  assert.ok(many.includes('a7'), 'yang terbaru dipakai');

  // Prompt lengkap memuat sudut + larangan mengulang.
  const prompt = buildQuietPrompt('Server Uji', { angle: 'Tanya lagi pada sibuk apa', recent: ['Sepi banget'] });
  assert.ok(prompt.includes('Tanya lagi pada sibuk apa'), 'sudut masuk ke prompt');
  assert.ok(prompt.includes('Sepi banget'), 'riwayat masuk ke prompt');

  // Sudut selalu diambil dari daftar, dan bisa bervariasi.
  assert.ok(QUIET_ANGLES.length >= 5, 'cukup banyak sudut');
  assert.equal(pickQuietAngle(() => 0), QUIET_ANGLES[0]);
  assert.equal(pickQuietAngle(() => 0.999), QUIET_ANGLES[QUIET_ANGLES.length - 1]);
  const picks = new Set(Array.from({ length: 40 }, () => pickQuietAngle()));
  assert.ok(picks.size >= 3, `sudut bervariasi (dapat ${picks.size})`);
});

await testAsync('pemecah sepi: bot asli & pratinjau sama-sama pakai sudut acak', async () => {
  const agent = await readFile('src/features/agent.ts', 'utf8');
  const preview = await readFile('src/features/preview.ts', 'utf8');
  // Kalau hanya salah satu yang memakai, pratinjau kembali bukan cermin bot.
  assert.ok(agent.includes('pickQuietAngle'), 'bot asli memakai sudut acak');
  assert.ok(preview.includes('pickQuietAngle'), 'pratinjau memakai sudut acak');
  // Cek perilaku (argumen `angle` benar-benar diteruskan), bukan format satu
  // baris — dulu test ini merah hanya karena pemanggilnya dipecah ke banyak
  // baris saat menambah parameter `clock`.
  assert.ok(/buildQuietPrompt\(channel\.guild\.name,\s*\{[^}]*angle/.test(agent), 'bot meneruskan sudut');
  assert.ok(/buildQuietPrompt\(guildName,\s*\{[^}]*angle/.test(preview), 'pratinjau meneruskan sudut');
});

await testAsync('jam tenang malam menahan sapaan 23:00–06:00 WIB', async () => {
  const { emptyState, isQuietHour, shouldBreakSilence } = await import('../src/features/agent-core.js');

  // Zona waktu WIB, bukan zona server (hosting biasanya UTC).
  const at = (iso: string) => new Date(iso).getTime();
  assert.equal(isQuietHour(at('2026-11-09T23:30:00+07:00')), true, '23:30 tenang');
  assert.equal(isQuietHour(at('2026-11-09T03:00:00+07:00')), true, '03:00 tenang');
  assert.equal(isQuietHour(at('2026-11-09T06:00:00+07:00')), false, '06:00 sudah boleh');
  assert.equal(isQuietHour(at('2026-11-09T12:00:00+07:00')), false, 'siang boleh');
  assert.equal(isQuietHour(at('2026-11-09T22:59:00+07:00')), false, '22:59 masih boleh');

  // Channel sunyi 2 jam sebelum waktu uji (trace dibuat relatif, bukan jam
  // tetap — trace setelah `now` akan dianggap "masa depan" dan tidak sepi).
  const idleSince = (now: number) => ({ ...emptyState(), traces: [{ userId: 'u1', at: now - 2 * 60 * 60_000 }] });

  const malamAt = at('2026-11-09T23:30:00+07:00');
  const malam = shouldBreakSilence(
    agentSettings({ cooldownSeconds: 0 }) as never,
    idleSince(malamAt),
    malamAt,
  );
  assert.equal(malam, false, 'ditahan saat jam tenang');

  // Saklar dimatikan -> kembali menyapa.
  const mati = shouldBreakSilence(
    agentSettings({ cooldownSeconds: 0, quietHours: false }) as never,
    idleSince(malamAt),
    malamAt,
  );
  assert.equal(mati, true, 'menyapa kalau jam tenang dimatikan');

  // Siang hari tetap menyapa seperti biasa.
  const siangAt = at('2026-11-09T12:00:00+07:00');
  const siang = shouldBreakSilence(
    agentSettings({ cooldownSeconds: 0 }) as never,
    idleSince(siangAt),
    siangAt,
  );
  assert.equal(siang, true, 'siang tetap menyapa');
});

console.log('\nZona waktu Indonesia (WIB/WITA/WIT)');

await testAsync('zona waktu: tiga zona resmi Indonesia dikenali', async () => {
  const { TIME_ZONES, DEFAULT_TIME_ZONE, normalizeTimeZone, timeZoneLabel, hourInZone } = await import(
    '../src/lib/timezone.js'
  );

  assert.equal(TIME_ZONES.length, 3, 'tepat tiga zona');
  assert.deepEqual(
    TIME_ZONES.map((zone) => zone.label),
    ['WIB', 'WITA', 'WIT'],
    'label sesuai referensi',
  );
  assert.deepEqual(
    TIME_ZONES.map((zone) => zone.offset),
    [7, 8, 9],
    'offset 7/8/9 dari UTC',
  );
  assert.equal(DEFAULT_TIME_ZONE, 'Asia/Jakarta', 'bawaan WIB (perilaku lama)');

  // Normalisasi menerima nama IANA, label, dan label huruf kecil.
  assert.equal(normalizeTimeZone('Asia/Makassar'), 'Asia/Makassar');
  assert.equal(normalizeTimeZone('WITA'), 'Asia/Makassar', 'label diterima');
  assert.equal(normalizeTimeZone('wit'), 'Asia/Jayapura', 'huruf kecil oke');
  assert.equal(normalizeTimeZone('Asia/Jayapura'), 'Asia/Jayapura');
  // Nilai ngawur tidak boleh melempar / mengubah jam jadi acak.
  assert.equal(normalizeTimeZone('Mars/Olympus'), 'Asia/Jakarta', 'tak dikenal -> WIB');
  assert.equal(normalizeTimeZone(null), 'Asia/Jakarta');
  assert.equal(normalizeTimeZone(''), 'Asia/Jakarta');

  assert.equal(timeZoneLabel('Asia/Makassar'), 'WITA');
  assert.equal(timeZoneLabel(null), 'WIB');

  // Jam harus benar-benar berbeda 1 jam antar zona (12:00 UTC).
  const noon = Date.UTC(2026, 10, 9, 5, 0, 0); // 12:00 WIB
  assert.equal(hourInZone(noon, 'Asia/Jakarta'), 12);
  assert.equal(hourInZone(noon, 'Asia/Makassar'), 13, 'WITA +1 jam');
  assert.equal(hourInZone(noon, 'Asia/Jayapura'), 14, 'WIT +2 jam');
});

await testAsync('zona waktu: tengah malam dibaca 0, bukan 24', async () => {
  const { hourInZone } = await import('../src/lib/timezone.js');
  // 17:00 UTC = 00:00 WIB. Kalau jam dibaca 24, `24 >= 23` membuat seluruh
  // dini hari salah dianggap jam tenang — dan itu bug yang sulit terlihat.
  const midnight = Date.UTC(2026, 10, 8, 17, 0, 0);
  assert.equal(hourInZone(midnight, 'Asia/Jakarta'), 0);
});

await testAsync('zona waktu: jam tenang mengikuti zona server', async () => {
  const { isQuietHour } = await import('../src/features/agent-core.js');
  // 23:30 WIB = 00:30 WITA = 01:30 WIT (semua masih jam tenang).
  const at = (iso: string) => new Date(iso).getTime();
  const wib = at('2026-11-09T23:30:00+07:00');
  assert.equal(isQuietHour(wib, 'Asia/Jakarta'), true);

  // 22:30 WIB = 23:30 WITA: server WITA sudah tenang, WIB belum.
  const beda = at('2026-11-09T22:30:00+07:00');
  assert.equal(isQuietHour(beda, 'Asia/Makassar'), true, 'WITA sudah masuk batas');
  assert.equal(isQuietHour(beda, 'Asia/Jakarta'), false, 'WIB belum');
});

await testAsync('zona waktu: tersimpan per server & didahulukan dari .env', async () => {
  const { getGuildSettings, setGuildTimeZone, resolveTimeZone } = await import('../src/db/repo.js');
  const { config } = await import('../src/config.js');

  await setGuildTimeZone(GUILD, 'Asia/Makassar');
  assert.equal((await getGuildSettings(GUILD))?.timezone, 'Asia/Makassar', 'tersimpan');
  assert.equal(await resolveTimeZone(GUILD), 'Asia/Makassar', 'dipakai, menang atas .env');

  // Tanpa baris DB (server baru) -> default .env.
  assert.equal(await resolveTimeZone('guild-belum-ada-123'), config.features.timeZone);

  // Nilai ngawur dinormalisasi, bukan disimpan mentah.
  await setGuildTimeZone(GUILD, 'WIT');
  assert.equal((await getGuildSettings(GUILD))?.timezone, 'Asia/Jayapura', 'label -> IANA');

  await setGuildTimeZone(GUILD, 'Asia/Jakarta');
});

await testAsync('zona waktu: prompt & sambutan memakai zona server', async () => {
  const { buildSystemPrompt } = await import('../src/features/prompt.js');

  const prompt = buildSystemPrompt({
    botName: 'Zypher',
    guildName: 'Server Uji',
    userName: 'Bagas',
    persona: null,
    memories: [],
    keywords: [],
    now: new Date('2026-11-09T14:05:00+08:00'),
    timeZone: 'Asia/Makassar',
  });
  // Label zona harus tertulis supaya model tahu "pagi" itu jam berapa.
  assert.ok(prompt.includes('WITA'), 'label zona ada di prompt');
  assert.equal(prompt.includes('WIB'), false, 'tidak memakai WIB saat disetel WITA');

  const source = await readFile('src/features/prompt.ts', 'utf8');
  assert.equal(
    /timeZone: 'Asia\/Jakarta'/.test(source),
    false,
    'tidak ada lagi zona yang dipaku di prompt',
  );
});

await testAsync('zona waktu: transkrip & grafik ikut zona server', async () => {
  const { buildTranscriptHtml } = await import('../src/lib/transcript.js');
  const { messagesPerDay } = await import('../src/db/repo.js');

  const base = {
    guildName: 'Server Uji',
    guildIconUrl: null,
    userName: 'Bagas',
    userTag: 'bagas',
    channelName: 'DM',
    startedAt: new Date('2026-11-09T21:00:00+08:00'),
    endedAt: new Date('2026-11-09T22:00:00+08:00'),
    messages: [],
    memoryLines: [],
  };

  const wita = buildTranscriptHtml({ ...base, timeZone: 'Asia/Makassar' });
  const wib = buildTranscriptHtml({ ...base, timeZone: 'Asia/Jakarta' });
  assert.ok(wita.includes('WITA'), 'footer memakai label zona server');
  assert.ok(wib.includes('WIB'), 'WIB tetap benar');
  // Jam di WITA harus 1 jam lebih maju daripada WIB untuk waktu yang sama.
  assert.notEqual(wita.slice(0, 200), wib.slice(0, 200), 'tanggal/jam berbeda antar zona');

  // Grafik: pengelompokan tanggal mengikuti zona yang diberikan.
  const now = Date.now();
  const seriesWita = await messagesPerDay(GUILD, 3, 'Asia/Makassar');
  const seriesWib = await messagesPerDay(GUILD, 3, 'Asia/Jakarta');
  assert.equal(seriesWita.length, 3, 'tetap 3 hari');
  assert.ok(seriesWib.length === 3 && now > 0);

  // Server.ts harus meneruskan zona server, bukan default.
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(/messagesPerDay\(guildId, 7, await resolveTimeZone/.test(server), 'grafik pakai zona server');
});

await testAsync('zona waktu: tidak ada lagi jam yang dipaku ke WIB', async () => {
  // Pemindaian sumber: zona yang benar-benar memengaruhi perilaku harus lewat
  // `lib/timezone.ts`. Format tanggal murni-tampilan (label hari di dashboard)
  // memang tetap WIB — itu disengaja, karena dashboard dipakai admin Indonesia.
  const files = [
    'src/features/prompt.ts',
    'src/features/agent-core.ts',
    'src/features/preview.ts',
    'src/features/welcome.ts',
    'src/features/agent.ts',
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.equal(
      /timeZone: 'Asia\/Jakarta'/.test(source),
      false,
      `${file} masih memaku zona waktu`,
    );
  }

  // Fungsi zona harus punya satu sumber.
  const zone = await readFile('src/lib/timezone.ts', 'utf8');
  assert.ok(zone.includes('hourCycle'), 'pakai h23 supaya tengah malam = 0');
  assert.ok(zone.includes("DEFAULT_TIME_ZONE: TimeZoneId = 'Asia/Jakarta'"), 'bawaan WIB');
});

await testAsync('zona waktu: bisa diatur dari dashboard', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("path === '/api/timezone'"), 'endpoint ada');
  assert.ok(server.includes('Zona waktu tidak dikenal'), 'nilai ngawur ditolak');
  assert.ok(server.includes('setGuildTimeZone'), 'disimpan lewat repo');

  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('id="timeZone"'), 'ada pilihan di halaman pengaturan');
  assert.ok(pages.includes('async function saveTimeZone()'), 'fungsi simpan ada');
  assert.ok(pages.includes("'/api/timezone'"), 'menembak endpoint yang benar');
  for (const label of ['WIB', 'WITA', 'WIT']) {
    assert.ok(pages.includes(label), `pilihan ${label} ada`);
  }

  // Halaman pengaturan mengirim zona efektif, bukan hanya nilai tersimpan.
  assert.ok(server.includes('effectiveTimeZone'), 'zona efektif dikirim ke UI');

  const schema = await readFile('src/db/schema.ts', 'utf8');
  assert.ok(schema.includes('timezone'), 'kolom DB ada');
  const migrate = await readFile('src/db/index.ts', 'utf8');
  assert.ok(migrate.includes('ALTER TABLE guilds ADD COLUMN timezone'), 'database lama dimigrasi');
});

await testAsync('jam tenang: pratinjau menjelaskan alasannya', async () => {
  const { previewQuietBreak } = await import('../src/features/preview.js');
  const { emptyState } = await import('../src/features/agent-core.js');

  const hasil = await previewQuietBreak({
    settings: agentSettings({ cooldownSeconds: 0 }) as never,
    guildName: 'Komunitas Zypher',
    state: {
      ...emptyState(),
      traces: [{ userId: 'u1', at: new Date('2026-11-09T23:30:00+07:00').getTime() - 2 * 60 * 60_000 }],
    },
    now: new Date('2026-11-09T23:30:00+07:00').getTime(),
  });

  assert.equal(hasil.wouldFire, false, 'tidak menyapa');
  assert.ok(hasil.reason.includes('jam tenang'), 'alasan disebut');
  assert.ok(hasil.reason.includes('23:00'), 'jamnya jelas');
  assert.ok(hasil.reason.includes('mention'), 'menjelaskan batasnya');
});

await testAsync('jam tenang: tersimpan & bisa diatur dari dashboard', async () => {
  const { getAgentSettings, saveAgentSettings } = await import('../src/db/repo.js');
  await saveAgentSettings(GUILD, { quietHours: true });
  assert.equal((await getAgentSettings(GUILD)).quietHours, true, 'bisa dinyalakan');
  await saveAgentSettings(GUILD, { quietHours: false });
  assert.equal((await getAgentSettings(GUILD)).quietHours, false, 'bisa dimatikan');

  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('id="agentQuietHours"'), 'ada checkbox di halaman agent');
  assert.ok(pages.includes('quietHours: document.getElementById'), 'ikut terkirim saat simpan');
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes('quietHours: bool(payload.quietHours'), 'API menerimanya');
  const schema = await readFile('src/db/schema.ts', 'utf8');
  assert.ok(schema.includes('quiet_hours'), 'kolom DB ada');
  const migrate = await readFile('src/db/index.ts', 'utf8');
  assert.ok(migrate.includes('ALTER TABLE agent ADD COLUMN quiet_hours'), 'database lama ikut dimigrasi');
});

await testAsync('pemecah sepi: bisa dikirim nyata ke channel', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  const testSend = await readFile('src/features/test-send.ts', 'utf8');

  assert.ok(server.includes("kind === 'quiet'"), 'API send-test menerima jenis quiet');
  assert.ok(server.includes('sendQuietTest'), 'memanggil pengirim pemecah sepi');
  assert.ok(testSend.includes('export async function sendQuietTest'), 'fungsinya ada');
  assert.ok(testSend.includes('allowedMentions: { parse: [] as const }'), 'tidak men-tag siapa pun');
  assert.ok(testSend.includes('QUIET_TEST_MARK'), 'pesan diberi penanda uji');

  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('id="sendQuiet"'), 'tombol kirim ada di halaman agent');
  assert.ok(pages.includes('async function sendQuietTest()'), 'fungsi JS-nya ada');
  assert.ok(pages.includes("'/api/send-test/quiet'"), 'menembak endpoint kirim');
  // Label lama menyesatkan: kartunya berisi tombol kirim nyata juga.
  assert.ok(pages.includes('pratinjau gratis, atau kirim satu pesan nyata'), 'label kartu jujur');
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

await testAsync('banner: kartu tidak berubah tinggi, banner jadi latar penuh', async () => {
  // Dulu banner dipasang sebagai STRIP 110px di atas kartu sehingga tinggi kartu
  // bertambah. Sekarang banner menutupi seluruh kartu (gaya bot besar), jadi
  // ukurannya tetap sama dengan atau tanpa banner.
  const { cardHeight } = await import('../src/features/welcome-card.js');
  const tanpa = cardHeight({ bannerDataUri: null });
  const dengan = cardHeight({ bannerDataUri: 'data:image/png;base64,AAAA' });
  assert.equal(dengan, tanpa, 'tinggi kartu sama, banner hanya mengisi latar');
});

await testAsync('kartu: benar-benar digambar tanpa Chromium (bukan null)', async () => {
  // Ini inti keluhan user: bot referensi bisa membuat kartu di hosting tanpa
  // Chromium, sedangkan bot ini tidak pernah bisa. Kartu sekarang digambar
  // langsung lewat Skia, jadi hasilnya harus SELALU ada — termasuk di mesin
  // yang sama sekali tidak punya browser.
  const { renderWelcomeCard, cardRendererAvailable } = await import('../src/features/welcome-card.js');

  assert.equal(cardRendererAvailable(), true, 'renderer siap tanpa Chromium');

  const png = await renderWelcomeCard({
    userName: 'wahyuangga12',
    guildName: 'Xcution',
    message: 'Welcome to our Xcution',
    avatarDataUri: null,
    bannerDataUri: null,
    kicker: 'SELAMAT DATANG',
  });

  assert.ok(png, 'kartu dihasilkan, bukan null');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'berkasnya PNG asli');
  assert.ok(png.byteLength > 10_000, 'PNG berisi gambar, bukan kotak kosong');
});

await testAsync('kartu: banner dipakai sebagai latar penuh (pikselnya berubah)', async () => {
  // Menguji HAL YANG TERLIHAT, bukan sekadar "fungsi tidak melempar error".
  // Banner diuji dalam format webp karena itulah yang diunggah di server user.
  const { createCanvas } = await import('@napi-rs/canvas');
  const { renderWelcomeCard, cardHeight } = await import('../src/features/welcome-card.js');

  // Banner merah polos: kalau benar-benar jadi latar, sudut kartu ikut merah.
  const banner = createCanvas(400, 200);
  const bx = banner.getContext('2d');
  bx.fillStyle = '#ff0000';
  bx.fillRect(0, 0, 400, 200);
  const bannerUri = `data:image/webp;base64,${banner.toBuffer('image/webp').toString('base64')}`;

  const input = {
    userName: 'Sky',
    guildName: 'Komunitas Zypher',
    message: 'Halo',
    avatarDataUri: null,
    kicker: 'SELAMAT DATANG',
  } as const;

  const denganBanner = await renderWelcomeCard({ ...input, bannerDataUri: bannerUri });
  const tanpaBanner = await renderWelcomeCard({ ...input, bannerDataUri: null });
  assert.ok(denganBanner && tanpaBanner, 'kedua kartu tergambar');

  // Latar berbeda → byte PNG harus berbeda. Kalau banner diabaikan (bug lama),
  // dua-duanya akan identik.
  assert.equal(
    Buffer.compare(denganBanner, tanpaBanner) === 0,
    false,
    'banner benar-benar memengaruhi hasil gambar',
  );

  // Tinggi kartu tidak berubah: banner mengisi latar, bukan menambah strip.
  assert.equal(
    cardHeight({ bannerDataUri: bannerUri }),
    cardHeight({ bannerDataUri: null }),
    'ukuran kartu tetap sama',
  );
});

await testAsync('kartu: nama panjang & avatar rusak tidak menggagalkan sambutan', async () => {
  const { renderWelcomeCard } = await import('../src/features/welcome-card.js');
  const png = await renderWelcomeCard({
    userName: 'a'.repeat(60),
    guildName: 'Server Dengan Nama Yang Sangat Panjang Sekali '.repeat(2),
    message: 'Halo',
    // data URI rusak: tidak boleh melempar, kartu tetap jadi tanpa foto profil.
    avatarDataUri: 'data:image/png;base64,bukan-gambar-sungguhan',
    bannerDataUri: 'data:image/webp;base64,rusak-juga',
    kicker: 'SELAMAT DATANG',
  });
  assert.ok(png && png.byteLength > 5_000, 'kartu tetap dibuat walau gambar masukan rusak');
});

await testAsync('perpisahan: kartu PNG dikirim, bukan hanya embed', async () => {
  // Welcome & goodbye satu kesatuan: kalau sambutan punya kartu, perpisahan
  // harus sama. Dulu jalur perpisahan hanya diuji "ada file ATAU embed",
  // sehingga kartu yang gagal dibuat tidak pernah ketahuan.
  const { goodbyeMember } = await import('../src/features/welcome.js');
  const { saveGoodbyeSettings } = await import('../src/db/repo.js');
  const { saveBanner, deleteBanner } = await import('../src/features/banner.js');

  // Banner disimpan ke DB (bukan hanya disk) supaya kartu punya latar.
  const bannerPng = await buatPngMinimal(600, 300);
  const banner = await saveBanner(`data:image/png;base64,${bannerPng.toString('base64')}`, 'uji-goodbye-kartu');

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
    memberCount: 12,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild,
    displayAvatarURL: () => 'https://x/y.png',
    user: { username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };

  try {
    // Setelan disimpan dulu: goodbyeMember membaca dari database, bukan default.
    await saveGoodbyeSettings(guild.id, {
      enabled: true,
      useAi: false,
      channelId: channel.id,
      template: 'Sampai jumpa {user}',
      displayMode: 'card',
      includeAvatar: false,
      bannerPath: banner.name,
    });

    const ok = await goodbyeMember(member as never);
    assert.equal(ok, true, 'goodbye terkirim');

    const payload = sent.at(-1)!;
    const files = (payload.files ?? []) as Array<{ name?: string; attachment?: Buffer }>;
    const embeds = (payload.embeds ?? []) as Array<{ data?: { image?: { url?: string } } }>;

    assert.ok(files.length >= 1, 'perpisahan mengirim lampiran');
    const kartu = files.find((f) => /^sampai-jumpa-/.test(String(f.name)));
    assert.ok(kartu, 'lampirannya kartu sampai-jumpa-*.png');
    assert.ok((kartu!.attachment as Buffer).byteLength > 10_000, 'PNG kartunya berisi gambar');
    assert.deepEqual(embeds, [], 'kartu TIDAK dibungkus embed');
    assert.ok(
      String(payload.content).includes('<@222222222222222222>'),
      'perpisahan menyebut member sebagai mention',
    );
  } finally {
    await deleteBanner(banner.name).catch(() => undefined);
  }
});

await testAsync('perpisahan: pratinjau merender kartu seperti sambutan', async () => {
  // Bug nyata: pratinjau sambutan menampilkan kartu, pratinjau perpisahan tidak
  // pernah merender apa pun — admin memilih mode Card di perpisahan dan hanya
  // melihat teks. Diuji lewat PERILAKU, bukan cocok-cocokan teks sumber:
  // membandingkan dua fungsi pratinjau sekaligus supaya tidak bisa berbeda lagi.
  const { previewWelcome, previewGoodbye } = await import('../src/features/preview.js');
  const { WELCOME_DEFAULTS, GOODBYE_DEFAULTS } = await import('../src/db/repo.js');

  const pngPalsu = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const dipanggil: Array<{ name: string; kicker?: string }> = [];
  const renderCard = async (input: { name: string; kicker?: string }) => {
    dipanggil.push({ name: input.name, kicker: input.kicker });
    return pngPalsu;
  };

  const sambutan = await previewWelcome({
    settings: { ...WELCOME_DEFAULTS, guildId: '1', useAi: false } as never,
    name: 'Sky',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
    withCard: true,
    renderCard,
  });

  const perpisahan = await previewGoodbye({
    settings: { ...GOODBYE_DEFAULTS, guildId: '1', useAi: false } as never,
    name: 'Sky',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
    withCard: true,
    renderCard,
  });

  // Bentuk hasilnya harus sama untuk kedua halaman.
  assert.equal(perpisahan.card, true, 'perpisahan melaporkan kartu dibuat');
  assert.equal(perpisahan.cardBytes, pngPalsu.byteLength, 'ukuran kartu perpisahan ikut');
  assert.match(String(perpisahan.cardDataUri), /^data:image\/png;base64,/, 'gambar kartu dikirim ke dashboard');
  assert.equal(sambutan.card, perpisahan.card, 'welcome & goodbye sepakat soal kartu');

  // Renderer dipanggil dengan judul yang benar untuk masing-masing.
  assert.deepEqual(dipanggil.map((d) => d.kicker), ['SELAMAT DATANG', 'SAMPAI JUMPA']);

  // Tanpa withCard tidak ada render sama sekali (hemat waktu di dashboard).
  const tanpa = await previewGoodbye({
    settings: { ...GOODBYE_DEFAULTS, guildId: '1', useAi: false } as never,
    name: 'Sky',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
  });
  assert.equal(tanpa.card, undefined, 'tanpa withCard tidak merender apa pun');

  // Server harus meneruskan permintaan dashboard ke previewGoodbye, bukan
  // merender sendiri di tempat lain (itu sumber perbedaan perilaku dulu).
  const server = await readFile('src/web/server.ts', 'utf8');
  const blok = server.slice(
    server.indexOf("'/api/preview/goodbye'"),
    server.indexOf("'/api/preview/welcome'"),
  );
  assert.match(blok, /withCard,\s*\n/, 'withCard diteruskan apa adanya ke previewGoodbye');
  assert.ok(blok.includes("cardDetail('goodbye'"), 'baris detail kartu perpisahan');
});

await testAsync('perpisahan: tidak pernah menyebut "member ke-N"', async () => {
  // Member sudah keluar; angka member tidak lagi mencerminkan dirinya.
  const source = await readFile('../src/features/welcome.ts', 'utf8').catch(() =>
    readFile('src/features/welcome.ts', 'utf8'),
  );
  const card = source.slice(source.indexOf('async function buildCard'));
  assert.ok(card.includes('Terima kasih dari'), 'kartu perpisahan memakai kalimat terima kasih');
  assert.ok(card.includes('member ke-'), 'sambutan tetap memakai jumlah member');
});

await testAsync('kartu: baris detail welcome & goodbye satu sumber', async () => {
  // Dulu baris ini ditulis ulang di empat tempat (produksi, pesan uji, dua
  // pratinjau). Akibatnya kartu di pratinjau bisa tampil tanpa detail, dan
  // pesan uji perpisahan menampilkan "member ke-N" yang tidak dipakai produksi.
  const { cardDetail } = await import('../src/features/welcome.js');

  assert.equal(
    cardDetail('welcome', 'Komunitas Zypher', 1284),
    'Komunitas Zypher • member ke-1.284',
    'sambutan memakai jumlah member berformat Indonesia',
  );
  assert.equal(cardDetail('welcome', 'Komunitas Zypher'), 'Komunitas Zypher', 'tanpa angka tetap rapi');
  assert.equal(
    cardDetail('goodbye', 'Komunitas Zypher', 1284),
    'Terima kasih dari Komunitas Zypher',
    'perpisahan TIDAK memakai jumlah member walau angkanya dikirim',
  );

  // Tidak boleh ada jalur yang menulis kalimatnya sendiri lagi.
  for (const file of [
    'src/features/welcome.ts',
    'src/features/test-send.ts',
    'src/web/server.ts',
  ]) {
    const source = await readFile(file, 'utf8');
    assert.equal(
      source.includes('member ke-${') && file !== 'src/features/welcome.ts',
      false,
      `${file} memakai cardDetail(), bukan menyusun kalimat sendiri`,
    );
  }
});

await testAsync('kartu: pratinjau & produksi memakai baris detail yang sama', async () => {
  // Test ini mengunci SIMETRI, bukan isi satu file: apa pun yang dikirim
  // produksi harus bisa ditiru pratinjau, karena admin memutuskan dari pratinjau.
  const { previewWelcome, previewGoodbye } = await import('../src/features/preview.js');
  const { WELCOME_DEFAULTS, GOODBYE_DEFAULTS } = await import('../src/db/repo.js');

  const dipanggil: Array<{ detail?: string; kicker?: string }> = [];
  const renderCard = async (input: { detail?: string; kicker?: string }) => {
    dipanggil.push(input);
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  };

  await previewWelcome({
    settings: { ...WELCOME_DEFAULTS, guildId: '1', useAi: false } as never,
    name: 'Sky',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
    withCard: true,
    renderCard,
  });
  await previewGoodbye({
    settings: { ...GOODBYE_DEFAULTS, guildId: '1', useAi: false } as never,
    name: 'Sky',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
    withCard: true,
    renderCard,
  });

  assert.deepEqual(
    dipanggil.map((d) => d.kicker),
    ['SELAMAT DATANG', 'SAMPAI JUMPA'],
    'judul kartu berbeda sesuai jenisnya',
  );
  // Renderer pratinjau boleh tidak mengirim detail (server yang mengisi), tapi
  // server WAJIB memakai helper yang sama — diperiksa di bawah.
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(
    server.includes("cardDetail('welcome'") && server.includes("cardDetail('goodbye'"),
    'kedua endpoint pratinjau memakai cardDetail()',
  );
});

await testAsync('kartu: pesan uji perpisahan tidak menampilkan member ke-N', async () => {
  // Pesan uji adalah yang dilihat admin sebelum mempercayai fitur ini. Kalau di
  // situ tertulis "member ke-12" untuk member yang baru keluar, pesannya bohong.
  const source = await readFile('src/features/test-send.ts', 'utf8');
  const sambutan = source.slice(source.indexOf('SELAMAT DATANG') - 400, source.indexOf('SELAMAT DATANG') + 400);
  const perpisahan = source.slice(source.indexOf('SAMPAI JUMPA') - 400, source.indexOf('SAMPAI JUMPA') + 600);

  assert.ok(sambutan.includes("cardDetail('welcome'"), 'pesan uji sambutan memakai detail sambutan');
  assert.ok(perpisahan.includes("cardDetail('goodbye'"), 'pesan uji perpisahan memakai detail perpisahan');
  assert.equal(
    perpisahan.includes('member ke-'),
    false,
    'tidak ada "member ke-" di jalur perpisahan',
  );
});

await testAsync('container: kaki kartu memakai detail yang sama dengan PNG', async () => {
  // Mode Container punya baris kaki sendiri (`-# teks kecil`). Dulu baris itu
  // ditulis manual dan selalu menyebut "member ke-N" — termasuk untuk salam
  // perpisahan, padahal kartu PNG perpisahan tidak begitu.
  const source = await readFile('src/features/container-card.ts', 'utf8');
  assert.ok(
    source.includes('cardDetail(options.kind'),
    'kaki container memakai cardDetail(), bukan menyusun kalimat sendiri',
  );
  assert.equal(
    /member ke-\$\{options\.memberCount\}/.test(source),
    false,
    'tidak ada kalimat "member ke-" yang ditulis ulang di container',
  );
});

await testAsync('kartu: teks bisa dimatikan lewat setelan cardText', async () => {
  // Permintaan pemilik server: teks di dalam gambar bisa diaktifkan/dimatikan.
  // Diuji dari PIXEL: kartu tanpa teks harus berbeda dari kartu berteks, dan
  // bagian bawahnya (tempat tulisan berada) harus kosong.
  const { renderWelcomeCard } = await import('../src/features/welcome-card.js');

  const dasar = {
    userName: 'wahyuangga12',
    guildName: 'Zypher Server',
    message: 'Halo semua',
    avatarDataUri: null,
    bannerDataUri: null,
    kicker: 'SELAMAT DATANG',
    detail: 'Zypher Server • member ke-3',
  };

  const berteks = await renderWelcomeCard({ ...dasar, showText: true });
  const tanpaTeks = await renderWelcomeCard({ ...dasar, showText: false });
  assert.ok(berteks && tanpaTeks, 'kedua kartu tergambar');
  assert.equal(
    Buffer.compare(berteks, tanpaTeks) === 0,
    false,
    'mematikan teks benar-benar mengubah gambar',
  );
  assert.ok(
    tanpaTeks.byteLength < berteks.byteLength,
    'tanpa teks gambarnya lebih sederhana (lebih kecil)',
  );
});

await testAsync('kartu: tanpa teks, banner & avatar tetap tergambar', async () => {
  // Kalau teks dimatikan, yang dihapus HANYA teks — bukan seluruh isi kartu.
  const { renderWelcomeCard } = await import('../src/features/welcome-card.js');
  const { createCanvas } = await import('@napi-rs/canvas');

  const banner = createCanvas(400, 200);
  const bx = banner.getContext('2d');
  bx.fillStyle = '#ff0000';
  bx.fillRect(0, 0, 400, 200);
  const bannerUri = `data:image/webp;base64,${banner.toBuffer('image/webp').toString('base64')}`;

  const polos = await renderWelcomeCard({
    userName: 'Sky', guildName: 'Zypher', message: 'x', avatarDataUri: null,
    bannerDataUri: null, showText: false,
  });
  const denganBanner = await renderWelcomeCard({
    userName: 'Sky', guildName: 'Zypher', message: 'x', avatarDataUri: null,
    bannerDataUri: bannerUri, showText: false,
  });

  assert.equal(
    Buffer.compare(polos!, denganBanner!) === 0,
    false,
    'banner tetap jadi latar walau teks dimatikan',
  );
  assert.ok(denganBanner!.byteLength > 5_000, 'kartu tetap berisi gambar');
});

await testAsync('kartu: avatar dimatikan benar-benar hilang, bukan jadi placeholder', async () => {
  // Bug nyata saat cross-check: `showAvatar: false` tetap menggambar lingkaran
  // gradien di tengah. Yang diminta admin adalah kartu TANPA lingkaran.
  const { renderWelcomeCard } = await import('../src/features/welcome-card.js');

  const dasar = {
    userName: 'Sky', guildName: 'Zypher', message: 'x', bannerDataUri: null,
    kicker: 'SELAMAT DATANG', detail: 'Zypher',
  };

  const denganAvatar = await renderWelcomeCard({
    ...dasar,
    // rusak: avatar diminta tapi gagal dimuat -> gradasi + inisial
    avatarDataUri: 'data:image/png;base64,rusak',
    showAvatar: true,
  });
  const tanpaAvatar = await renderWelcomeCard({
    ...dasar,
    avatarDataUri: 'data:image/png;base64,rusak',
    showAvatar: false,
  });

  assert.ok(denganAvatar && tanpaAvatar, 'kedua kartu tergambar');
  assert.equal(
    Buffer.compare(denganAvatar, tanpaAvatar) === 0,
    false,
    'mematikan avatar mengubah gambar',
  );
  assert.ok(
    tanpaAvatar.byteLength < denganAvatar.byteLength,
    'tanpa avatar gambarnya lebih sederhana',
  );
});

await testAsync('kartu: avatar gagal dimuat tetap tampil, dengan inisial', async () => {
  // Komentar di kode menjanjikan "gradasi + inisial nama", tapi inisialnya
  // tidak pernah digambar — kartu hanya berisi lingkaran kosong.
  const { createCanvas } = await import('@napi-rs/canvas');
  const { renderWelcomeCard } = await import('../src/features/welcome-card.js');

  const dasar = {
    guildName: 'Zypher', message: 'x', bannerDataUri: null,
    kicker: 'SELAMAT DATANG', detail: 'Zypher',
  };

  // Teks kartu DIMATIKAN supaya satu-satunya yang bisa berbeda adalah inisial
  // di dalam lingkaran. Versi pertama test ini lupa itu: nama juga digambar
  // sebagai teks, sehingga dua gambar selalu berbeda walau inisialnya hilang —
  // test lolos padahal bug-nya ada.
  const a = await renderWelcomeCard({
    ...dasar, userName: 'Sky', avatarDataUri: null, showAvatar: true, showText: false,
  });
  const b = await renderWelcomeCard({
    ...dasar, userName: 'Budi', avatarDataUri: null, showAvatar: true, showText: false,
  });
  assert.equal(
    Buffer.compare(a!, b!) === 0,
    false,
    'inisial nama benar-benar digambar (Sky vs Budi harus beda)',
  );
  void createCanvas;
});

await testAsync('embed: avatar bisa dinyalakan lewat setelan embedAvatar', async () => {
  // Dulu embed tidak punya avatar sama sekali dan tidak ada sakelarnya.
  // Sekarang harus muncul sebagai thumbnail, dan bisa dimatikan lagi.
  const { welcomeMember } = await import('../src/features/welcome.js');
  const { saveWelcomeSettings } = await import('../src/db/repo.js');

  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: '777777777777777777', name: 'join-leave',
    isTextBased: () => true, isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p: Record<string, unknown>) => { sent.push(p); return { id: '1' }; },
  };
  const guild = {
    id: '156942477750257766', name: 'Zypher Server', memberCount: 4,
    channels: { fetch: async () => channel },
    members: { me: { id: '999999999999999999' } },
  };
  const member = {
    id: '222222222222222222', displayName: 'Sky', guild,
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/222/abc.png',
    user: { bot: false, username: 'sky', tag: 'sky#0000', displayAvatarURL: () => 'https://x/y.png' },
  };

  const thumbnailDari = () => {
    const embed = (sent.at(-1)!.embeds as Array<{ data?: { thumbnail?: { url?: string } } }>)[0];
    return embed?.data?.thumbnail?.url ?? null;
  };

  await saveWelcomeSettings(guild.id, { enabled: true, useAi: false, channelId: channel.id, displayMode: 'embed', embedAvatar: true });
  await welcomeMember(member as never);
  assert.match(String(thumbnailDari()), /^https:\/\/cdn\.discordapp\.com\//, 'embed menampilkan avatar member');

  await saveWelcomeSettings(guild.id, { embedAvatar: false });
  await welcomeMember(member as never);
  assert.equal(thumbnailDari(), null, 'avatar hilang saat dimatikan');
});

await testAsync('dashboard: sakelar kartu & embed terpisah, bukan satu checkbox', async () => {
  // Dulu hanya ada satu checkbox "avatar di kartu". Sekarang ada empat sakelar
  // yang jelas: avatar & teks untuk kartu, avatar untuk embed.
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  for (const id of [
    'welcomeCardAvatar', 'welcomeCardText', 'welcomeEmbedAvatar',
    'goodbyeCardAvatar', 'goodbyeCardText', 'goodbyeEmbedAvatar',
  ]) {
    assert.ok(pages.includes(`id="${id}"`), `sakelar ${id} ada`);
  }
  // id lama tidak boleh tersisa: elemennya sudah tidak ada, dan membaca
  // `.checked` dari null akan membuat tombol Simpan gagal diam-diam.
  assert.equal(pages.includes("'welcomeAvatar'"), false, 'id lama welcome sudah diganti');
  assert.equal(pages.includes("'goodbyeAvatar'"), false, 'id lama goodbye sudah diganti');

  // Kedua tombol (Simpan & Kirim tes) harus mengirim setelan yang sama.
  assert.equal(
    (pages.match(/cardAvatar: document\.getElementById\('welcomeCardAvatar'\)\.checked/g) ?? []).length,
    2,
    'Simpan & kirim tes sambutan sama-sama mengirim cardAvatar',
  );
});

await testAsync('setelan: kolom baru aman untuk database lama', async () => {
  // Baris lama belum punya card_text/embed_avatar. Nilai NULL harus dibaca
  // sebagai "teks aktif, avatar embed mati" supaya tampilan server yang sudah
  // berjalan tidak berubah diam-diam.
  const { getWelcomeSettings, saveWelcomeSettings } = await import('../src/db/repo.js');
  const guild = '888888888888888888';
  const awal = await getWelcomeSettings(guild);
  assert.equal(awal.cardText, true, 'teks kartu aktif secara bawaan');
  assert.equal(awal.cardAvatar, true, 'avatar kartu aktif secara bawaan');
  assert.equal(awal.embedAvatar, false, 'avatar embed mati secara bawaan');

  await saveWelcomeSettings(guild, { cardText: false, embedAvatar: true });
  const sesudah = await getWelcomeSettings(guild);
  assert.equal(sesudah.cardText, false, 'cardText tersimpan');
  assert.equal(sesudah.embedAvatar, true, 'embedAvatar tersimpan');
  assert.equal(sesudah.cardAvatar, true, 'nilai lain tidak ikut berubah');
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
  assert.ok(preview.includes('Kartu PNG tidak bisa dirender'), 'satu sumber catatan kartu');
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
  assert.ok(source.includes('Kartu PNG tidak bisa dibuat'), 'memberi tahu saat kartu gagal');
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

await testAsync('halaman sambutan: tab Sambutan & Perpisahan, bukan dua form menumpuk', async () => {
  // Keluhan pemilik server: dua form panjang berdampingan + pratinjau di bawah
  // membuat halaman harus di-scroll jauh hanya untuk melihat hasil satu sakelar.
  const { welcomePage } = await import('../src/web/ui/pages.js');
  const settings = {
    enabled: true, useAi: false, channelId: null, template: 'Halo {user}!',
    displayMode: 'embed' as const, imageEnabled: false, includeAvatar: false,
    cardAvatar: true, cardText: true, embedAvatar: false,
    style: null, example: null, bannerPath: null, hasBanner: false,
  };
  const html = welcomePage({
    guildId: '1', guildName: 'Server', welcome: settings, goodbye: settings,
    channels: [], botOnline: true, sampleName: 'Sky',
    cardRenderer: { available: true, path: null },
    persona: null, model: null, defaultModel: 'x', embedModel: null, ragEnabled: false,
    ttsReplyInRoom: null, ttsReplyInRoomDefault: true, ragEnabledSetting: null,
    ragEnabledDefault: true, autoMemorySetting: null, autoMemoryDefault: true,
    adminOnlyRoomsSetting: null, adminOnlyRoomsDefault: false, diskQuotaMb: null, diskQuotaEnvMb: null,
    stats: { rooms: 0, messages: 0, documents: 0 },
    status: { online: true, mode: 'bot', uptimeSeconds: 0 }, counts: {},
  } as never);

  // 1. Dua tab, keduanya benar-benar ada dan bisa dipanggil.
  assert.ok(html.includes('id="tab-welcome"'), 'tab sambutan ada');
  assert.ok(html.includes('id="tab-goodbye"'), 'tab perpisahan ada');
  assert.ok(/class="tab is-active"\s+id="tab-welcome"/.test(html), 'sambutan aktif saat halaman dibuka');
  assert.ok(html.includes('function showTab('), 'fungsi pindah tab ada');

  // 2. Panel perpisahan WAJIB sudah tersembunyi dari HTML. Kalau hanya
  //    menunggu JS, dua form sempat tampil bersamaan — persis yang dihindari.
  assert.ok(
    /<section class="tab-pane" id="pane-goodbye"[^>]*hidden>/.test(html),
    'panel perpisahan tersembunyi sejak HTML, bukan menunggu JS',
  );
  assert.ok(
    !/<section class="tab-pane" id="pane-welcome"[^>]*hidden>/.test(html),
    'panel sambutan tidak ikut tersembunyi',
  );

  // 3. Semua input tetap ada meski panelnya tersembunyi — kalau tidak,
  //    menyimpan tab yang tidak dibuka akan mengirim nilai kosong.
  for (const id of ['welcomeEnabled', 'welcomeTemplate', 'goodbyeEnabled', 'goodbyeTemplate',
                    'welcomeCardAvatar', 'goodbyeCardAvatar']) {
    assert.ok(html.includes(`id="${id}"`), `${id} tetap ada di DOM`);
  }

  // 4. Tidak boleh ada id ganda. Satu id ganda = getElementById() selalu
  //    mengembalikan elemen pertama, jadi status/isi tab kanan menulis ke kiri.
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
  const dupes = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(dupes, [], `id ganda di satu halaman: ${dupes.join(', ')}`);

  // 5. Pratinjau ada di dalam panel masing-masing, bukan satu blok di bawah.
  const paneWelcome = html.slice(html.indexOf('id="pane-welcome"'), html.indexOf('id="pane-goodbye"'));
  const paneGoodbye = html.slice(html.indexOf('id="pane-goodbye"'));
  assert.ok(paneWelcome.includes('id="outWelcome"'), 'pratinjau sambutan di tabnya sendiri');
  assert.ok(paneWelcome.includes('id="welcomePreviewName"'), 'nama contoh sambutan milik tab sambutan');
  assert.ok(paneGoodbye.includes('id="outGoodbye"'), 'pratinjau perpisahan di tabnya sendiri');
  assert.ok(paneGoodbye.includes('id="goodbyePreviewName"'), 'nama contoh perpisahan milik tab perpisahan');
  assert.equal(paneWelcome.includes('outGoodbye'), false, 'pratinjau perpisahan tidak ikut di tab sambutan');
});

await testAsync('sumber daya: disk memakai kuota container, bukan partisi mesin induk', async () => {
  // Bug nyata dari laporan pemilik server: panel menulis "353 GB dari 441 GB
  // (80%)" padahal panel hosting menulis 247 MB dari 1 GB. Penyebabnya
  // `statfs()` membaca partisi MESIN INDUK. cgroup tidak menyediakan kuota
  // kapasitas disk (io.max hanya membatasi kecepatan), jadi kuota harus
  // dinyatakan lewat env atau isian admin — tidak boleh ditebak.
  const { readResourceUsage } = await import('../src/web/resources.js');

  const tanpaKuota = await readResourceUsage({ workDir: process.cwd() });
  assert.equal(tanpaKuota.diskTotal, null, 'tanpa kuota: penyebut null, bukan kapasitas mesin');
  assert.equal(tanpaKuota.diskTotalSource, null, 'sumber kuota null');
  assert.ok(tanpaKuota.diskUsed !== null && tanpaKuota.diskUsed > 0, 'pemakaian folder terbaca');

  const dariEnv = await readResourceUsage({
    workDir: process.cwd(),
    diskLimitEnv: 1024 * 1024 * 1024,
  });
  assert.equal(dariEnv.diskTotal, 1024 * 1024 * 1024, 'kuota dari env dipakai');
  assert.equal(dariEnv.diskTotalSource, 'env', 'sumbernya dilaporkan');

  // env menang atas isian admin — supaya panel hosting tetap jadi acuan.
  const keduanya = await readResourceUsage({
    workDir: process.cwd(),
    diskLimitEnv: 1024 * 1024 * 1024,
    diskLimitSetting: 2 * 1024 * 1024 * 1024,
  });
  assert.equal(keduanya.diskTotal, 1024 * 1024 * 1024, 'env menang');
  assert.equal(keduanya.diskTotalSource, 'env');

  const hanyaSetting = await readResourceUsage({
    workDir: process.cwd(),
    diskLimitSetting: 2 * 1024 * 1024 * 1024,
  });
  assert.equal(hanyaSetting.diskTotalSource, 'setting', 'isian admin dipakai kalau env kosong');

  // Folder server yang diukur bukan partisi: nilainya harus JAUH di bawah
  // kapasitas partisi mesin (partisi bisa ratusan GB).
  const { readPartitionCapacity } = await import('../src/web/resources.js');
  const partisi = await readPartitionCapacity(process.cwd());
  if (partisi) {
    assert.ok(dariEnv.diskUsed! < partisi, 'pemakaian folder < kapasitas partisi');
  }
});

await testAsync('sumber daya: sampel kedua melaporkan CPU & kecepatan, sampel pertama jujur kosong', async () => {
  const { readResourceUsage } = await import('../src/web/resources.js');

  // Panggilan pertama tidak punya pembanding. Jangan mengarang angka: null,
  // dan UI menulis "menunggu sampel berikutnya".
  const pertama = await readResourceUsage({ workDir: process.cwd() });
  assert.equal(typeof pertama.sampledAt, 'number', 'ada cap waktu sampel');

  // Beri beban CPU supaya ada yang terukur.
  const end = Date.now() + 260;
  let x = 0;
  while (Date.now() < end) x += Math.sqrt(x + 1);
  await new Promise((resolve) => setTimeout(resolve, 220));

  const kedua = await readResourceUsage({ workDir: process.cwd() });
  assert.ok(kedua.cpuPercent !== null, 'sampel kedua punya angka CPU');
  assert.ok(kedua.cpuPercent! >= 0 && kedua.cpuPercent! <= 100, 'CPU dalam 0–100');

  // Kecepatan jaringan: 0 sah ("tidak ada lalu lintas"), bukan null.
  assert.ok(
    kedua.networkInRate !== null && kedua.networkInRate! >= 0,
    'kecepatan jaringan terukur (0 sah)',
  );
  assert.ok(kedua.networkOutRate !== null && kedua.networkOutRate! >= 0, 'keluar juga');

  // Memori = RSS proses ini, bukan anon cgroup bersama. Selisih dengan RSS
  // nyata harus kecil; kalau kode kembali memakai `anon`, angkanya bisa
  // berbeda puluhan MB karena proses lain di cgroup yang sama ikut dihitung.
  const statm = await readFile(`/proc/${process.pid}/statm`, 'utf8').catch(() => '');
  if (statm) {
    const rss = Number(statm.trim().split(/\s+/)[1]) * 4096;
    const selisih = Math.abs(kedua.memoryUsed - rss) / rss;
    assert.ok(selisih < 0.25, `memori sampel (${kedua.memoryUsed}) dekat RSS nyata (${rss})`);
  }
});

await testAsync('sumber daya: memori memakai RSS proses, bukan anon cgroup bersama', async () => {
  // Ini kesalahan yang nyata di laporan: dashboard menulis 86,4 MB sementara
  // panel hosting menulis 69 MB untuk proses yang sama. `anon` cgroup
  // menjumlahkan SEMUA proses yang berbagi container, jadi bukan pemakaian
  // bot. Diuji dengan nilai yang sengaja jauh berbeda — di mesin nyata kedua
  // angka sering terlalu dekat untuk membedakan benar/salah.
  const { pickMemoryUsed } = await import('../src/web/resources.js');

  assert.equal(
    pickMemoryUsed({ ownRss: 69 * 1024 * 1024, cgroupAnon: 86 * 1024 * 1024, fallback: 1 }),
    69 * 1024 * 1024,
    'RSS proses menang atas anon cgroup',
  );

  // /proc tidak terbaca (mis. Windows): pakai anon, jangan 0.
  assert.equal(
    pickMemoryUsed({ ownRss: null, cgroupAnon: 42, fallback: 7 }),
    42,
    'cadangan anon kalau RSS tak terbaca',
  );

  // Keduanya kosong: cadangan terakhir tetap angka wajar, bukan 0.
  assert.equal(pickMemoryUsed({ ownRss: null, cgroupAnon: null, fallback: 7 }), 7);

  // Nilai 0 dari /proc berarti "tidak terbaca", bukan "tidak memakai memori".
  assert.equal(
    pickMemoryUsed({ ownRss: 0, cgroupAnon: 42, fallback: 7 }),
    42,
    'nol tidak dipakai sebagai pemakaian',
  );
});

await testAsync('sumber daya: endpoint polling ada, tidak di-cache, dan dipakai halaman Ringkasan', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("path === '/api/resources'"), 'endpoint /api/resources ada');
  assert.ok(server.includes("'cache-control': 'no-store"), 'tidak boleh di-cache proxy panel');
  assert.ok(server.includes('diskLimitEnv: config.features.diskLimitBytes'),
    'kuota dari env diteruskan');
  assert.ok(server.includes('diskLimitSetting: settings?.diskQuotaMb'),
    'kuota dari isian admin diteruskan');

  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  // Halaman Ringkasan dulu hanya memotret sekali; tanpa polling angkanya basi.
  assert.ok(pages.includes("fetch('/api/resources'"), 'halaman memanggil endpoint sumber daya');
  assert.ok(pages.includes('setInterval'), 'memakai polling');
  assert.ok(pages.includes("addEventListener('visibilitychange'"), 'berhenti saat tab disembunyikan');
  assert.ok(pages.includes('INTERVAL_MS = 3000'), 'interval wajar (3 detik)');

  // Panel harus membawa data awal dari server, supaya tidak ada kedipan kosong.
  const base = await readFile('src/web/ui/base.ts', 'utf8');
  assert.ok(base.includes('id="resSeed"'), 'data awal disisipkan ke HTML');
});

await testAsync('sumber daya: kuota disk bisa disimpan dari halaman Pengaturan', async () => {
  const { setGuildDiskQuota, getGuildSettings } = await import('../src/db/repo.js');
  const guild = '141414141414141414';

  await setGuildDiskQuota(guild, 1024);
  assert.equal((await getGuildSettings(guild))?.diskQuotaMb, 1024, 'kuota tersimpan');

  await setGuildDiskQuota(guild, null);
  assert.equal((await getGuildSettings(guild))?.diskQuotaMb, null, 'bisa dikosongkan');

  // Nilai ngawur tidak boleh masuk: negatif & nol jadi null, raksasa dipotong.
  await setGuildDiskQuota(guild, -5 as never);
  assert.equal((await getGuildSettings(guild))?.diskQuotaMb, null, 'negatif ditolak');
  await setGuildDiskQuota(guild, 0);
  assert.equal((await getGuildSettings(guild))?.diskQuotaMb, null, 'nol = tidak diatur');
  await setGuildDiskQuota(guild, 99_999_999_999);
  assert.equal((await getGuildSettings(guild))?.diskQuotaMb, 10_485_760, 'dipotong di batas atas');

  const server = await readFile('src/web/server.ts', 'utf8');
  assert.ok(server.includes("path === '/api/disk-quota'"), 'endpoint simpan kuota ada');
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes("'/api/disk-quota'"), 'Pengaturan menembak endpoint yang benar');
  assert.ok(pages.includes('id="diskQuotaMb"'), 'ada kolom isian kuota');
  assert.ok(pages.includes('DISK_LIMIT_MB'), 'menjelaskan env yang mengunci nilainya');
});

await testAsync('halaman sambutan: penanda AKTIF di tab mengikuti sakelar, bukan tab yang dibuka', async () => {
  // Dua kesalahan nyata pada penanda ini:
  //   1. awalnya diikat ke "tab mana yang terbuka" → selalu muncul di kiri dan
  //      hilang saat pindah tab, tidak memberi informasi apa pun;
  //   2. bentuknya titik kecil → di layar sempit terbaca seperti bullet nyasar
  //      di samping teks tab, dan pemilik server mengira itu penanda tab aktif.
  // Sekarang bentuknya teks "aktif" dan isinya status enabled yang sebenarnya.
  const { welcomePage } = await import('../src/web/ui/pages.js');
  const base = {
    useAi: false, channelId: null, template: 'Halo {user}!',
    displayMode: 'embed' as const, imageEnabled: false, includeAvatar: false,
    cardAvatar: true, cardText: true, embedAvatar: false,
    style: null, example: null, bannerPath: null, hasBanner: false,
  };
  const render = (welcomeOn: boolean, goodbyeOn: boolean): string =>
    welcomePage({
      guildId: '1', guildName: 'Server',
      welcome: { ...base, enabled: welcomeOn },
      goodbye: { ...base, enabled: goodbyeOn },
      channels: [], botOnline: true, sampleName: 'Sky',
      cardRenderer: { available: true, path: null },
      persona: null, model: null, defaultModel: 'x', embedModel: null, ragEnabled: false,
      ttsReplyInRoom: null, ttsReplyInRoomDefault: true, ragEnabledSetting: null,
      ragEnabledDefault: true, autoMemorySetting: null, autoMemoryDefault: true,
      adminOnlyRoomsSetting: null, adminOnlyRoomsDefault: false,
      diskQuotaMb: null, diskQuotaEnvMb: null,
      stats: { rooms: 0, messages: 0, documents: 0 },
      status: { online: true, mode: 'bot', uptimeSeconds: 0 }, counts: {},
    } as never);

  const flag = (html: string, kind: string): string => {
    const at = html.indexOf(`id="tabFlag-${kind}"`);
    assert.ok(at > -1, `penanda tab ${kind} ada`);
    return html.slice(at, html.indexOf('</span>', at));
  };

  // Sambutan aktif, perpisahan mati.
  const satu = render(true, false);
  assert.equal(/\shidden/.test(flag(satu, 'welcome')), false, 'sambutan aktif → penanda tampil');
  assert.equal(/\shidden/.test(flag(satu, 'goodbye')), true, 'perpisahan mati → penanda disembunyikan');
  assert.ok(/aktif/i.test(flag(satu, 'welcome')), 'penanda berupa teks "aktif", bukan titik');

  // Dibalik: hanya perpisahan yang aktif.
  const dua = render(false, true);
  assert.equal(/\shidden/.test(flag(dua, 'welcome')), true, 'sambutan mati → penanda disembunyikan');
  assert.equal(/\shidden/.test(flag(dua, 'goodbye')), false, 'perpisahan aktif → penanda tampil');

  // Bentuk lama (titik) tidak boleh kembali — itulah yang disalahpahami.
  assert.equal(satu.includes('tab-dot'), false, 'titik kecil sudah diganti teks');

  // Kode harus membaca checkbox saat itu, bukan nilai beku hasil render.
  assert.ok(satu.includes('function syncTabFlags('), 'ada penyelaras penanda');
  assert.ok(satu.includes("'Enabled'"), 'penanda dibaca dari checkbox enabled');
  assert.ok(satu.includes("addEventListener('change', syncTabFlags)"),
    'penanda ikut berubah saat sakelar diubah sebelum disimpan');

  // Scroll otomatis saat pindah tab bisa menaruh judul panel di bawah topbar
  // yang sticky. Tab bar-nya ada di atas panel, jadi tidak perlu digulir.
  assert.equal(/scrollIntoView\(\{\s*block/.test(satu), false,
    'pindah tab tidak menggulir otomatis');
});

await testAsync('halaman sambutan: pratinjau menempel di kanan form (tanpa scroll)', async () => {
  const theme = await readFile('src/web/ui/theme.ts', 'utf8');

  const gridStart = theme.indexOf('.pane-grid {');
  assert.ok(gridStart > -1, 'ada grid panel');
  const grid = theme.slice(gridStart, theme.indexOf('}', gridStart));
  assert.ok(/grid-template-columns:\s*minmax\(0,\s*1\.5fr\)\s*minmax\(0,\s*1fr\)/.test(grid),
    'form kiri lebih lebar, pratinjau kanan');
  assert.ok(/align-items:\s*start/.test(grid), 'kartu tidak saling meregang');

  const stickyStart = theme.indexOf('.pane-preview {');
  assert.ok(stickyStart > -1, 'ada gaya pratinjau');
  const sticky = theme.slice(stickyStart, theme.indexOf('}', stickyStart));
  assert.ok(/position:\s*sticky/.test(sticky), 'pratinjau menempel saat form di-scroll');
  assert.ok(/top:\s*\d+px/.test(sticky), 'menempel di bawah topbar, bukan menutupinya');

  // Di layar sempit, sticky dilepas: pratinjau setinggi layar di HP akan
  // menghalangi form di bawahnya.
  const mobile = theme.slice(theme.indexOf('.pane-grid { grid-template-columns: minmax(0, 1fr); }'));
  assert.ok(/\.pane-preview\s*\{\s*position:\s*static/.test(mobile.slice(0, 400)),
    'di HP pratinjau kembali normal');
});

await testAsync('banner: halaman tidak menyisipkan data URI (bisa belasan MB)', async () => {
  // Dua banner 8 MB sebagai data URI = HTML belasan MB; di HP praktis mati.
  const { welcomePage } = await import('../src/web/ui/pages.js');
  const page = welcomePage({
    guildId: '1',
    guildName: 'Server',
    welcome: {
      enabled: true, useAi: false, channelId: null, template: 'Halo {user}!',
      displayMode: 'embed' as const, imageEnabled: false, includeAvatar: false, style: null, example: null,
      bannerPath: 'banner-abc.png', hasBanner: true,
    },
    goodbye: {
      enabled: false, useAi: false, channelId: null, template: 'Bye {user}!',
      displayMode: 'embed' as const, imageEnabled: false, includeAvatar: false, style: null, example: null,
      bannerPath: 'banner-def.png', hasBanner: true,
    },
    channels: [],
    botOnline: false,
    sampleName: 'Sky',
    cardRenderer: { available: false, path: null },
    persona: null, model: null, defaultModel: 'x', embedModel: null, ragEnabled: false,
    ttsReplyInRoom: null, ttsReplyInRoomDefault: true, ragEnabledSetting: null,
    ragEnabledDefault: true, autoMemorySetting: null, autoMemoryDefault: true,
    adminOnlyRoomsSetting: null, adminOnlyRoomsDefault: false, diskQuotaMb: null, diskQuotaEnvMb: null,
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
    // `id` wajib: mention dibangun dari id, bukan nama.
    id: '222222222222222999',
    displayName: 'Sky',
    user: { username: 'sky', tag: 'sky#0001' },
    displayAvatarURL: () => 'https://contoh.invalid/a.png',
    send: async () => ({ id: '3' }),
  } as never;

  const result = await sendGoodbyeTest(fakeClient, {
    guildId: guild.id,
    settings: {
      channelId: channel.id, useAi: false, displayMode: 'embed' as const, imageEnabled: false, includeAvatar: false,
      template: 'Sampai jumpa {user}!', style: '', example: '', bannerPath: null,
    } as never,
    member,
  });

  assert.equal(sent.length, 1, 'tepat satu pesan dikirim');
  assert.equal(result.where, 'channel', 'melaporkan tujuan sebenarnya');
  assert.equal(result.channelName, 'perpisahan', 'nama channel ikut dilaporkan');

  const payload = sent[0]!;
  assert.ok(String(payload.content).includes('Pesan uji dari dashboard'), 'pesan diberi penanda');
  // Mode embed: mention lewat content (dulu 'parse: []' sehingga tidak pernah ping).
  assert.ok(
    String(payload.content).includes('<@222222222222222999>'),
    'member di-mention di pesan uji',
  );
  assert.deepEqual(payload.allowedMentions, { users: ['222222222222222999'] }, 'hanya member itu yang diizinkan');
  assert.equal(result.text, 'Sampai jumpa Sky!', 'isi pesan = hasil pratinjau');
});

await testAsync('kirim tes: mention tetap ada di SEMUA mode (sambutan & perpisahan)', async () => {
  // Bug nyata: pesan uji mode embed memakai `content: TEST_MARK` +
  // `allowedMentions: { parse: [] }`, jadi admin menguji bentuk yang TIDAK
  // memuat mention — padahal pesan sungguhannya men-mention member. Pesan uji
  // harus memperlihatkan bentuk akhir, bukan versi yang lebih aman.
  const { sendWelcomeTest, sendGoodbyeTest } = await import('../src/features/test-send.js');

  const ID = '222222222222222777';
  for (const mode of ['card', 'embed', 'text', 'container'] as const) {
    const sent: Record<string, unknown>[] = [];
    const channel = {
      id: '111111111111111112', name: 'join-leave',
      isTextBased: () => true, isDMBased: () => false,
      permissionsFor: () => ({ has: () => true }),
      send: async (p: Record<string, unknown>) => { sent.push(p); return { id: '1' }; },
    };
    const guild = {
      id: '156942477750257800', name: 'Komunitas Zypher', memberCount: 7,
      channels: { fetch: async () => channel },
      members: { me: { id: '2' } },
    };
    const client = { guilds: { fetch: async () => guild } } as never;
    const member = {
      id: ID, displayName: 'Sky', guild,
      displayAvatarURL: () => 'https://x/y.png',
      user: { username: 'sky', tag: 'sky#0000' },
      send: async () => ({ id: '3' }),
    } as never;
    const settings = {
      guildId: guild.id, channelId: channel.id, useAi: false,
      displayMode: mode, imageEnabled: false,
      cardAvatar: true, cardText: true, embedAvatar: false,
      template: 'Halo {user}!', style: '', example: '', bannerPath: null,
    } as never;

    await sendWelcomeTest(client, { guildId: guild.id, settings, member, target: 'channel' });
    await sendGoodbyeTest(client, { guildId: guild.id, settings, member });

    const [masuk, keluar] = sent;
    for (const [label, p] of [['sambutan', masuk], ['perpisahan', keluar]] as const) {
      assert.ok(p, `${mode}/${label}: pesan terkirim`);
      // Container menyimpan mention di komponen; mode lain di `content`.
      const utuh = JSON.stringify({ c: p.content ?? '', comp: p.components ?? [] });
      assert.ok(utuh.includes(`<@${ID}>`), `${mode}/${label}: pesan uji men-mention member`);
      assert.ok(
        JSON.stringify(p.allowedMentions ?? {}).includes(ID),
        `${mode}/${label}: mention diizinkan`,
      );
      // Penanda uji tidak boleh hilang — mention bukan alasan menghapusnya.
      assert.ok(
        utuh.includes('Pesan uji dari dashboard'),
        `${mode}/${label}: penanda uji tetap ada`,
      );
    }
  }
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
      settings: { channelId: null, useAi: false, displayMode: 'embed' as const, imageEnabled: false, includeAvatar: false } as never,
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

await testAsync('dashboard: peringatan tampil kalau mesin gambar kartu gagal dimuat', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  assert.ok(pages.includes('Kartu PNG tidak akan terkirim'), 'peringatan ada');
  assert.ok(pages.includes('Mesin gambar kartu gagal dimuat'), 'menjelaskan penyebabnya');
  // Chromium sudah tidak dipakai: saran lama itu menyesatkan.
  assert.equal(pages.includes('CHROMIUM_PATH'), false, 'tidak lagi menyuruh set CHROMIUM_PATH');

  const card = await readFile('src/features/welcome-card.ts', 'utf8');
  assert.ok(card.includes('export function cardRendererAvailable'), 'status bisa dicek');
});


/* ------------------------------------------------------------------ */
/*  Pratinjau bentuk pesan + avatar embed/container                    */
/* ------------------------------------------------------------------ */

await testAsync('embed-mock: baris penulis & thumbnail dibaca dari embed jadi', async () => {
  const { embedToMock } = await import('../src/features/embed-mock.js');
  const { EmbedBuilder } = await import('discord.js');

  const embed = new EmbedBuilder()
    .setColor(0x6d8cff)
    .setDescription('Halo Sky!')
    .setAuthor({ name: 'Sky', iconURL: 'https://cdn/avatar.png' })
    .setThumbnail('https://cdn/thumb.png')
    .setFooter({ text: 'Member baru · Komunitas Zypher' });

  const mock = embedToMock(embed);
  assert.ok(mock, 'embed terbaca');
  assert.equal(mock!.color, '#6d8cff', 'warna aksen jadi CSS');
  assert.equal(mock!.author?.name, 'Sky', 'nama penulis terbaca');
  assert.equal(mock!.author?.iconUrl, 'https://cdn/avatar.png', 'avatar penulis terbaca');
  assert.equal(mock!.thumbnailUrl, 'https://cdn/thumb.png', 'thumbnail terbaca');
  assert.equal(mock!.description, 'Halo Sky!', 'deskripsi terbaca');
  assert.match(String(mock!.footer?.text), /Member baru/, 'footer terbaca');
});

await testAsync('embed-mock: embed kosong tidak dipratinjaukan', async () => {
  const { embedToMock } = await import('../src/features/embed-mock.js');
  // Embed tanpa judul/deskripsi/field tidak bisa ditampilkan — Discord pun
  // menolaknya. Pratinjau harus mengembalikan null, bukan kotak kosong.
  assert.equal(embedToMock({ toJSON: () => ({ color: 1 }) } as never), null, 'embed kosong = null');
});

await testAsync('embed-mock: container dibaca baris, aksen, dan teks kecilnya', async () => {
  const { containerToMock } = await import('../src/features/embed-mock.js');

  const mock = containerToMock({
    toJSON: () => ({
      type: 17,
      accent_color: 0x6d8cff,
      components: [
        { type: 10, content: 'Halo Sky!' },
        { type: 12, items: [{ media: { url: 'attachment://avatar.png' } }] },
        { type: 14 },
        { type: 10, content: '-# Member baru · Komunitas' },
      ],
    }),
  } as never);

  assert.ok(mock, 'container terbaca');
  assert.equal(mock!.accentColor, '#6d8cff', 'warna aksen terbaca');
  // Blok disimpan BERURUTAN, jadi urutan gambar & teks tidak bisa tertukar.
  assert.deepEqual(
    mock!.blocks.map((b) => b.kind),
    ['text', 'image', 'separator', 'small'],
    'urutan blok sama dengan urutan komponen',
  );
  // Dulu ada jenis blok 'thumbnail' yang berdiri sendiri; sekarang thumbnail
  // selalu menempel di dalam blok 'section'. Fixture ini punya galeri lepas
  // (bukan Section), jadi yang diperiksa: tidak ada blok bernama 'thumbnail'.
  assert.ok(
    ['text', 'small', 'image', 'section', 'separator'].includes(mock!.blocks[0]!.kind),
    'jenis blok hanya yang dikenal',
  );
  const teks = mock!.blocks[0];
  assert.equal(teks!.kind === 'text' ? teks!.text : '', 'Halo Sky!', 'isi teks terbaca');
  const kecil = mock!.blocks[3];
  assert.equal(kecil!.kind === 'small' ? kecil!.text : '', '-# Member baru · Komunitas', 'teks kecil terbaca');
  const gambar = mock!.blocks[1];
  assert.equal(gambar!.kind === 'image' ? gambar!.url : '', 'attachment://avatar.png', 'rujukan lampiran terbaca');
});

/* ------------------------------------------------------------------ */
/*  Pesan container buatan admin (halaman /pesan)                      */
/* ------------------------------------------------------------------ */

await testAsync('pesan: blok dirapikan, yang mustahil dikirim dibuang', async () => {
  const { sanitizeBlocks } = await import('../src/features/custom-post.js');

  const { blocks, dropped } = sanitizeBlocks([
    { kind: 'text', value: '  Selamat datang  ' },
    { kind: 'divider', value: '' },
    { kind: 'divider', value: '' }, // dobel -> digabung
    { kind: 'image', value: 'bukan-url' },
    { kind: 'image', value: 'https://contoh.test/a.png' },
    { kind: 'button', value: 'Gabung', url: 'https://discord.gg/x' },
    { kind: 'button', value: 'Rusak', url: 'javascript:alert(1)' },
    { kind: 'button', value: '', url: 'https://x.test' },
    { kind: 'entah', value: 'x' },
    { kind: 'text', value: '   ' },
  ]);

  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['text', 'divider', 'image', 'button'],
    'hanya blok yang sah tersisa',
  );
  assert.equal(blocks[0]!.kind === 'text' ? blocks[0]!.value : '', 'Selamat datang', 'teks dirapikan');
  // javascript: adalah celah XSS klasik — harus ditolak, bukan diizinkan.
  assert.ok(dropped.some((d) => d.includes('Rusak')), 'tombol ber-URL berbahaya dibuang');
  assert.ok(dropped.some((d) => d.includes('jenis blok tidak dikenal')), 'jenis asing dilaporkan');
  assert.equal(dropped.filter((d) => d.includes('gambar')).length, 1, 'gambar tanpa URL dibuang');
});

await testAsync('pesan: teks dipotong di batas satu pesan, bukan dibuang', async () => {
  const { sanitizeBlocks, LIMITS } = await import('../src/features/custom-post.js');
  const panjang = 'a'.repeat(LIMITS.totalText + 500);
  const { blocks } = sanitizeBlocks([{ kind: 'text', value: panjang }]);
  assert.equal(blocks.length, 1, 'tetap satu blok');
  const isi = blocks[0]!.kind === 'text' ? blocks[0]!.value : '';
  assert.equal(isi.length, LIMITS.totalText, 'dipotong tepat di batas');
});

await testAsync('pesan: data rusak di database tidak membuat halaman gagal', async () => {
  const { parseBlocks } = await import('../src/features/custom-post.js');
  // JSON rusak, kolom kosong, dan bentuk lama harus menghasilkan daftar kosong
  // — bukan melempar, karena halaman /pesan tetap harus bisa dibuka.
  for (const raw of ['{bukan json', '', null, undefined, 42, '{}']) {
    assert.deepEqual(parseBlocks(raw), [], `input ${String(raw)} aman`);
  }
  assert.equal(parseBlocks('[{"kind":"text","value":"Halo"}]')[0]?.value, 'Halo', 'JSON sah terbaca');
});

await testAsync('pesan: warna aksen divalidasi, bukan dipercaya', async () => {
  const { normalizeAccent, accentToNumber, DEFAULT_ACCENT } = await import(
    '../src/features/custom-post.js'
  );

  // Bentuk sah diterima dalam dua penulisan.
  assert.equal(normalizeAccent('#FF8800'), '#ff8800', 'huruf besar dinormalkan');
  assert.equal(normalizeAccent('ff8800'), '#ff8800', 'tanpa # tetap diterima');

  // Semua bentuk aneh jatuh ke bawaan — bukan warna acak atau #NaN.
  for (const aneh of ['', '   ', '#GGG', '#ff88', 'merah', 'rgb(1,2,3)', '#ff88001', null, 42]) {
    assert.equal(normalizeAccent(aneh), DEFAULT_ACCENT, `"${String(aneh)}" -> bawaan`);
  }

  // Angka untuk ContainerBuilder.
  assert.equal(accentToNumber('#ff8800'), 0xff8800);
  assert.equal(accentToNumber('bukan-warna'), 0x6d8cff);
});

await testAsync('pesan: gambar unggahan jadi lampiran, bukan data URI', async () => {
  const { sanitizeBlocks, buildPostPayload } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');

  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // Yang bukan gambar sungguhan ditolak.
  const jahat = sanitizeBlocks([
    { kind: 'image', value: '', data: 'data:text/html;base64,PHNjcmlwdD4=' },
    { kind: 'image', value: '', data: 'data:image/png;base64,bukan base64!!' },
  ]);
  assert.equal(jahat.blocks.length, 0, 'data URI non-gambar ditolak');
  assert.equal(jahat.dropped.length, 2, 'alasannya dilaporkan');

  const { blocks } = sanitizeBlocks([
    { kind: 'image', value: '', data: png },
    { kind: 'image', value: '', data: png },
  ]);
  assert.equal(blocks.length, 2, 'dua unggahan diterima');

  const built = buildPostPayload(blocks, {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  });
  assert.ok(built);
  // Dua gambar SAMA harus jadi dua lampiran bernama berbeda — kalau namanya
  // sama, Discord hanya menampilkan satu.
  assert.deepEqual(built.files.map((f) => f.name), ['post-image-1.png', 'post-image-2.png']);

  const json = JSON.stringify(
    (built.components[0] as { toJSON: () => unknown }).toJSON(),
  );
  assert.ok(!json.includes('base64'), 'data URI tidak ikut terkirim');
  assert.ok(json.includes('attachment://post-image-1.png'), 'merujuk lampiran');
});

await testAsync('pesan: pratinjau mengikuti urutan & batas tombol Discord', async () => {
  const { buildPostPreview } = await import('../src/features/post-preview.js');

  const preview = buildPostPreview(
    [
      { kind: 'text', value: 'Judul' },
      { kind: 'divider', value: '' },
      { kind: 'text', value: '-# catatan kecil' },
      { kind: 'image', value: 'https://contoh.test/a.png' },
      ...Array.from({ length: 7 }, (_, i) => ({
        kind: 'button' as const,
        value: `T${i + 1}`,
        url: 'https://contoh.test',
      })),
    ],
    {
      accent: '#ff8800',
      roleButtons: [{ id: 1, label: 'Gamer' }],
    },
  );

  assert.equal(preview.accentColor, '#ff8800');
  // Tujuh tombol tidak boleh jadi satu baris: Discord memotongnya 5 per baris.
  const barisTombol = preview.blocks.filter((b) => b.kind === 'buttons');
  assert.deepEqual(
    barisTombol.map((b) => (b.kind === 'buttons' ? b.buttons.length : 0)),
    [5, 2, 1],
    'tombol link 5+2, lalu tombol role',
  );

  // Tombol role selalu blok TERAKHIR.
  const terakhir = preview.blocks[preview.blocks.length - 1]!;
  assert.equal(terakhir.kind, 'buttons');
  assert.equal(terakhir.kind === 'buttons' ? terakhir.buttons[0]!.role : false, true);

  // Teks -# dikenali sebagai teks kecil.
  const kecil = preview.blocks.find((b) => b.kind === 'text' && b.small);
  assert.ok(kecil, 'teks -# jadi teks kecil');

  // Hanya pemisah = kosong, dan Discord akan menolaknya.
  assert.equal(buildPostPreview([{ kind: 'divider', value: '' }]).empty, true);
  assert.equal(buildPostPreview([{ kind: 'text', value: 'isi' }]).empty, false);
});

await testAsync('webhook: dibuat sekali, dipakai ulang, dibuat lagi kalau hilang', async () => {
  const { ensureChannelWebhook } = await import('../src/features/custom-post-send.js');
  const repo = await import('../src/db/repo.js');

  const G = 'g-webhook-uji';
  const C = '1400000000000000099';
  const TOKEN = 'X'.repeat(68);

  let dibuat = 0;
  let hookAda = true;
  const client = {
    channels: {
      async fetch() {
        return {
          id: C,
          isTextBased: () => true,
          isDMBased: () => false,
          async fetchWebhooks() {
            return hookAda ? new Map([['hook-1', {}]]) : new Map();
          },
          async createWebhook(options: { name: string }) {
            dibuat += 1;
            return { id: `hook-${dibuat}`, token: TOKEN, name: options.name };
          },
        };
      },
    },
  } as unknown as import('discord.js').Client;

  const identity = { username: 'Zypher Server', avatarURL: null };

  // Pertama: dibuat.
  const a = await ensureChannelWebhook({ client, guildId: G, channelId: C, identity });
  assert.equal(dibuat, 1);
  assert.equal(a.id, 'hook-1');

  // Kedua: DIPAKAI ULANG. Ini yang mencegah channel penuh webhook baru setiap
  // kali admin menekan kirim.
  const b = await ensureChannelWebhook({ client, guildId: G, channelId: C, identity });
  assert.equal(dibuat, 1, 'tidak membuat webhook kedua');
  assert.equal(b.id, 'hook-1');

  // Token tersimpan terenkripsi, tidak sebagai teks biasa.
  const tersimpan = await repo.getChannelWebhook(G, C);
  assert.ok(tersimpan, 'webhook tersimpan');
  assert.ok(tersimpan!.url.endsWith(TOKEN), 'token bisa dipakai lagi');

  // Webhook dihapus orang di Discord: bot membuat yang baru, tidak menyerah.
  hookAda = false;
  const c = await ensureChannelWebhook({ client, guildId: G, channelId: C, identity });
  assert.equal(dibuat, 2, 'membuat ulang saat webhook hilang');
  assert.equal(c.id, 'hook-2');

  // Tanpa izin Manage Webhooks: pesan yang berguna, bukan galat mentah.
  const clientTanpaIzin = {
    channels: {
      async fetch() {
        return {
          id: 'c-lain',
          isTextBased: () => true,
          isDMBased: () => false,
          async fetchWebhooks() {
            return new Map();
          },
          async createWebhook() {
            throw new Error('Missing Permissions');
          },
        };
      },
    },
  } as unknown as import('discord.js').Client;

  await assert.rejects(
    () =>
      ensureChannelWebhook({
        client: clientTanpaIzin,
        guildId: G,
        channelId: 'c-lain',
        identity,
      }),
    (error: unknown) => /Manage Webhooks/.test((error as Error).message),
    'izin kurang dijelaskan',
  );
});

await testAsync('webhook: tombol role ditolak SEBELUM menyentuh Discord', async () => {
  const { sendOrUpdatePostViaWebhook, PostSendError } = await import(
    '../src/features/custom-post-send.js'
  );

  // Client kosong: kalau penolakannya benar, Discord tidak pernah disentuh,
  // jadi tidak ada properti client yang dibaca.
  await assert.rejects(
    () =>
      sendOrUpdatePostViaWebhook({
        client: {} as never,
        guildId: '1',
        channelId: '2',
        messageId: null,
        blocks: [{ kind: 'text', value: 'isi' }],
        roleButtons: [{ id: 1, label: 'Gamer' }],
        identity: { username: 'Server', avatarURL: null },
      }),
    (error: unknown) =>
      error instanceof PostSendError && /tombol atau menu ambil role/i.test((error as Error).message),
    'pesan webhook + tombol role ditolak dengan penjelasan',
  );

  // Menu dropdown juga komponen interaktif: nasibnya sama dengan tombol,
  // karena yang mengirim komponen adalah webhook, bukan aplikasi bot.
  await assert.rejects(
    () =>
      sendOrUpdatePostViaWebhook({
        client: {} as never,
        guildId: '1',
        channelId: '2',
        messageId: null,
        blocks: [{ kind: 'text', value: 'isi' }],
        roleMenus: [
          {
            id: 1,
            placeholder: 'Pilih',
            minValues: 1,
            maxValues: 1,
            options: [{ roleId: '333333333333333333', label: 'A' }],
          },
        ],
        identity: { username: 'Server', avatarURL: null },
      }),
    (error: unknown) =>
      error instanceof PostSendError && /tombol atau menu ambil role/i.test((error as Error).message),
    'pesan webhook + menu role juga ditolak',
  );
});

await testAsync('webhook: token disimpan terenkripsi, tidak terbaca di database', async () => {
  const { encryptSecret, decryptSecret, isEncrypted, maskWebhookUrl } = await import(
    '../src/features/webhook-secret.js'
  );

  const token = 'AbCdEf-Token_Rahasia_Sekali';
  const enc = encryptSecret(token);

  // Inti perlindungannya: token tidak boleh terbaca dari isi kolom.
  assert.ok(isEncrypted(enc), 'ditandai terenkripsi');
  assert.ok(!enc.includes(token) && !enc.includes('AbCdEf'), 'token tidak terlihat');
  assert.equal(decryptSecret(enc), token, 'bisa dibuka kembali oleh bot');

  // Database lama berisi token teks biasa harus tetap terbaca.
  assert.equal(decryptSecret(token), token, 'token lama tetap jalan');
  assert.equal(isEncrypted(token), false);

  // Enkripsi dua kali memberi hasil berbeda (IV acak) tapi sama-sama sah.
  const lain = encryptSecret(token);
  assert.notEqual(lain, enc, 'IV acak');
  assert.equal(decryptSecret(lain), token);

  // Data yang diubah ditolak (AES-GCM mendeteksi perubahan).
  assert.equal(decryptSecret(`${enc.slice(0, -4)}AAAA`), '', 'data rusak ditolak');

  // Tampilan untuk log tidak membocorkan token.
  const url = 'https://discord.com/api/webhooks/123456789012345678/AbCdEf-Token_Rahasia';
  assert.ok(!maskWebhookUrl(url).includes('AbCdEf'), 'token tidak muncul di log');
  assert.ok(maskWebhookUrl(url).includes('123456789012345678'), 'id webhook tetap terbaca');
});

await testAsync('pesan: tombol role menolak role di atas bot atau member', async () => {
  const { roleBlocker, memberCanToggle, parseRoleButtonId, roleButtonId } = await import(
    '../src/features/role-buttons.js'
  );

  const gamer = { id: '111', name: 'Gamer', position: 3 };

  // Bot punya izin & posisinya di atas: boleh.
  assert.equal(roleBlocker({ role: gamer, botHighestPosition: 10, hasManageRoles: true }), null);

  // Tanpa Manage Roles: alasan paling sering, pesannya harus "bot-izin".
  assert.equal(
    roleBlocker({ role: gamer, botHighestPosition: 10, hasManageRoles: false }),
    'bot-izin',
  );

  // Role di posisi yang sama dengan role tertinggi bot: Discord menolak,
  // jadi kita juga harus menolak (posisi >= bot).
  assert.equal(
    roleBlocker({ role: { ...gamer, position: 10 }, botHighestPosition: 10, hasManageRoles: true }),
    'bot-posisi',
  );

  // @everyone dan role terkelola integrasi tidak pernah bisa dibagikan.
  assert.equal(
    roleBlocker({ role: { ...gamer, isEveryone: true }, botHighestPosition: 10, hasManageRoles: true }),
    'role-terlarang',
  );
  assert.equal(
    roleBlocker({ role: { ...gamer, managed: true }, botHighestPosition: 10, hasManageRoles: true }),
    'role-terlarang',
  );

  // INTI KEAMANAN: member biasa tidak boleh memberi role yang setara/lebih
  // tinggi dari dirinya — kalau tidak, siapa pun bisa jadi moderator.
  assert.equal(
    memberCanToggle({
      role: { ...gamer, position: 8 },
      botHighestPosition: 10,
      memberHighestPosition: 5,
      hasManageRoles: true,
    }),
    'member-posisi',
  );
  // Role di bawah member: boleh.
  assert.equal(
    memberCanToggle({
      role: gamer,
      botHighestPosition: 10,
      memberHighestPosition: 5,
      hasManageRoles: true,
    }),
    null,
  );

  // customId: prefix dinamis, dan yang bukan angka ditolak.
  assert.equal(roleButtonId(42), 'post-role:42');
  assert.equal(parseRoleButtonId('post-role:42'), 42);
  assert.equal(parseRoleButtonId('post-role:abc'), null);
  assert.equal(parseRoleButtonId('post-role:'), null);
  assert.equal(parseRoleButtonId('dm:start'), null);
  assert.equal(parseRoleButtonId('post-role:0'), null);
});

await testAsync('pesan: tombol role - keputusan beri vs lepas', async () => {
  const { planToggle } = await import('../src/features/role-button-handler.js');

  const dasar = {
    role: { id: '111', name: 'Gamer', position: 3 },
    botHighestPosition: 10,
    memberHighestPosition: 5,
    hasManageRoles: true,
  };

  // Mode toggle: belum punya -> beri, sudah punya -> lepas.
  assert.equal(
    planToggle({ ...dasar, button: { id: 1, postId: 1, roleId: '111', label: 'Gamer', emoji: null, style: 'primary', mode: 'toggle', position: 0 }, memberHasRole: false }).action,
    'give',
  );
  assert.equal(
    planToggle({ ...dasar, button: { id: 1, postId: 1, roleId: '111', label: 'Gamer', emoji: null, style: 'primary', mode: 'toggle', position: 0 }, memberHasRole: true }).action,
    'remove',
  );

  // Mode "hanya beri": klik kedua tidak melepas role.
  const hanyaBeri = planToggle({
    ...dasar,
    button: { id: 1, postId: 1, roleId: '111', label: 'Gamer', emoji: null, style: 'primary', mode: 'give', position: 0 },
    memberHasRole: true,
  });
  assert.equal(hanyaBeri.action, null, 'tidak melepas role');
  assert.equal(hanyaBeri.blocker, 'sudah-punya');

  // Blocker menang atas aksi: member di bawah role tidak boleh memberi.
  const ditolak = planToggle({
    ...dasar,
    memberHighestPosition: 1,
    button: { id: 1, postId: 1, roleId: '111', label: 'Gamer', emoji: null, style: 'primary', mode: 'toggle', position: 0 },
    memberHasRole: false,
  });
  assert.equal(ditolak.action, null);
  assert.equal(ditolak.blocker, 'member-posisi');
});

await testAsync('aksi: sanitizer menerima 3 jenis aksi & menolak yang tidak sah', async () => {
  const { sanitizeActions, ACTION_LIMITS } = await import('../src/features/post-actions.js');

  const { actions, dropped } = sanitizeActions([
    { kind: 'role', roleId: '900000000000000001', op: 'give' },
    { kind: 'reply', text: 'Halo {member.name}!', hidden: false },
    { kind: 'message', postId: 7, toChannel: false, followUp: 'Cek {member.mention}' },
    // Tidak sah: dibuang dengan alasan, bukan hilang diam-diam.
    { kind: 'role', roleId: 'bukan-angka' },
    { kind: 'reply', text: '   ' },
    { kind: 'message', postId: 0 },
    { kind: 'teleport' },
    null,
  ]);

  assert.deepEqual(
    actions.map((a) => a.kind).join(','),
    'role,reply,message',
    'tiga aksi sah lolos',
  );
  assert.equal(actions[0]!.op, 'give');
  assert.equal(actions[1]!.hidden, false, 'balasan publik dihormati');
  assert.equal(actions[2]!.toChannel, false);
  assert.equal(actions[2]!.followUp, 'Cek {member.mention}');
  assert.equal(dropped.length, 4, 'empat aksi ditolak dengan alasan');

  // Batas per komponen ditegakkan, bukan dipotong diam-diam.
  const banyak = sanitizeActions(
    Array.from({ length: ACTION_LIMITS.perComponent + 3 }, () => ({
      kind: 'reply',
      text: 'x',
    })),
  );
  assert.equal(banyak.actions.length, ACTION_LIMITS.perComponent);
  assert.equal(banyak.dropped.length, 1, 'kelebihan aksi dilaporkan');
});

await testAsync('aksi: rencana menjaga urutan, satu balasan, dan tidak mengirim diri sendiri', async () => {
  const { planActions, fillActionText, defaultRoleReply } = await import('../src/features/post-actions.js');

  const plan = planActions(
    [
      { kind: 'role', roleId: '1', op: 'toggle' },
      { kind: 'reply', text: 'Role {role} sudah {effect}', hidden: true },
      { kind: 'message', postId: 12 },
      // Balasan kedua: Discord hanya menerima satu — dilewati dengan alasan.
      { kind: 'reply', text: 'Terima kasih' },
      // Mengirim pesan ini sendiri akan berulang tanpa henti.
      { kind: 'message', postId: 5 },
    ],
    { selfPostId: 5 },
  );

  assert.deepEqual(
    plan.steps.map((s) => s.kind).join(','),
    'role,reply,message',
    'urutan dipertahankan, balasan kedua & pesan-sendiri dibuang',
  );
  assert.equal(plan.firstReply?.text, 'Role {role} sudah {effect}');
  assert.equal(plan.skipped.length, 2, 'dua langkah dilaporkan dilewati');

  // Template: token yang dikenal diganti, yang tidak dikenal dibiarkan.
  const teks = fillActionText('Hai {member.name} di {server.name}, role {role} {effect} untuk {member.mention}{unknown}', {
    member: 'Wahyu',
    mention: '<@2>',
    server: 'Zypher',
    role: 'Gamer',
    effect: 'ditambahkan',
  });
  assert.equal(teks, 'Hai Wahyu di Zypher, role Gamer ditambahkan untuk <@2>{unknown}');
  assert.equal(defaultRoleReply({ member: 'A', mention: '<@1>', server: 'S', role: 'Gamer', effect: 'dilepas' }), '✅ Role **Gamer** dilepas.');
});

await testAsync('aksi: tersimpan per target, menempel ke tombol tersimpan, & dijalankan berurutan', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';
  const ROLE = '900000000000000002';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Aksi uji',
    channelId: null,
    blocks: [{ kind: 'text', value: 'Klik' }],
  });

  const awal = await repo.replaceRoleButtons(GUILD, post.id, [{ label: 'Gamer', roleId: ROLE, mode: 'toggle' }]);
  const buttonId = awal.buttons[0]!.id;

  // Simpan aksi pada tombol itu.
  const simpan = await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'role', roleId: ROLE, op: 'toggle' },
      { kind: 'reply', text: '✅ {role} sudah {effect}, {member.mention}!', hidden: true },
    ],
    'select:role': [{ kind: 'reply', text: 'Menu role dipakai', hidden: true }],
    // Target asing tidak boleh menyelipkan baris yatim.
    'asal-asalan': [{ kind: 'reply', text: 'x' }],
  });
  assert.deepEqual(
    Object.keys(simpan.actions).sort().join(','),
    `button:${buttonId},select:role`,
    'dua target tersimpan, target asing ditolak',
  );
  assert.equal(simpan.actions[`button:${buttonId}`]!.length, 2);

  // ID tombol DIPERTAHANKAN saat disimpan ulang — aksi tetap menempel.
  const ulang = await repo.replaceRoleButtons(GUILD, post.id, [
    { id: buttonId, label: 'Gamer (baru)', roleId: ROLE, mode: 'toggle' },
  ]);
  assert.equal(ulang.buttons[0]!.id, buttonId, 'ID tombol lama dipakai ulang');
  assert.equal(
    (await repo.findActions(GUILD, `button:${buttonId}`))?.actions.length,
    2,
    'aksi ikut bertahan setelah simpan ulang',
  );

  /** Interaksi tiruan: mencatat role yang berubah & semua balasan. */
  const jalankan = async (target: string) => {
    const catatan = { add: [] as string[], remove: [] as string[], balasan: [] as string[] };
    const interaction = {
      customId: target.replace('button:', 'post-role:'),
      guildId: GUILD,
      deferred: false,
      replied: false,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      member: {
        displayName: 'Wahyu',
        roles: {
          cache: { has: () => false },
          highest: { position: 20 },
          add: async (id: string) => void catatan.add.push(id),
          remove: async (id: string) => void catatan.remove.push(id),
        },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: {
          cache: new Map([[ROLE, { id: ROLE, name: 'Gamer', position: 3, managed: false }]]),
          // Role yang tidak dikenal harus benar-benar null: kalau mock ini
          // selalu mengembalikan role, kasus "role sudah dihapus" tidak teruji.
          fetch: async (id: string) =>
            id === ROLE ? { id: ROLE, name: 'Gamer', position: 3, managed: false } : null,
        },
        members: {
          me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } },
          fetchMe: async () => null,
          fetch: async () => null,
        },
      },
      reply: async (payload: { content: string }) => void catatan.balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void catatan.balasan.push(payload.content),
    };
    const ditangani = await runComponentActions({
      client: {} as never,
      interaction: interaction as never,
      target,
    });
    return { ...catatan, ditangani };
  };

  const hasil = await jalankan(`button:${buttonId}`);
  assert.equal(hasil.ditangani, true, 'aksi dikenali');
  assert.deepEqual(hasil.add, [ROLE], 'role diberikan oleh aksi pertama');
  assert.equal(hasil.balasan.length, 1, 'hanya satu balasan');
  assert.equal(hasil.balasan[0], '✅ Gamer sudah ditambahkan, <@2>!', 'template terisi hasil role');

  // Komponen tanpa aksi: runner mengembalikan false supaya jalur lama dipakai.
  const tanpa = await jalankan('button:999999');
  assert.equal(tanpa.ditangani, false, 'komponen tanpa aksi tidak ditangani runner');

  // Aksi role yang gagal menghentikan sisa aksi (padanan Stop).
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'role', roleId: '900000000000000009', op: 'give' },
      { kind: 'reply', text: 'TIDAK BOLEH TERKIRIM' },
    ],
  });
  const gagal = await jalankan(`button:${buttonId}`);
  assert.equal(gagal.add.length, 0, 'tidak ada role yang berubah');
  assert.equal(gagal.balasan.length, 1);
  assert.match(gagal.balasan[0]!, /dihapus|tidak bisa|menolak/i, 'alasan kegagalan diteruskan');
  assert.notEqual(gagal.balasan[0], 'TIDAK BOLEH TERKIRIM', 'aksi sesudah kegagalan tidak dijalankan');
});

await testAsync('pesan: select menu membawa ID pesan supaya aksinya tidak tertukar', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const { targetSelectTampilan } = await import('../src/events/interactionCreate.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    RoleSelectMenuBuilder: d.RoleSelectMenuBuilder,
  };
  const blok = sanitizeBlocks([{ kind: 'select', selectKind: 'role' }]).blocks;

  const denganId = buildPostPayload(blok, { ...deps, contextPostId: 12 });
  const idBaru = (denganId!.components as Array<{ toJSON: () => any }>)[0]!
    .toJSON()
    .components[0].components[0].custom_id;
  assert.equal(idBaru, 'post-ctx:12:role', 'ID pesan ikut di customId');
  assert.deepEqual(
    targetSelectTampilan(idBaru),
    { postId: 12, target: 'select:role', fallbackTarget: 'select:role' },
    'router memisahkan ID pesan & jenis menu',
  );

  // Pesan lama (dikirim sebelum ID pesan disisipkan) tetap dikenali.
  const lama = buildPostPayload(blok, deps);
  const idLama = (lama!.components as Array<{ toJSON: () => any }>)[0]!
    .toJSON()
    .components[0].components[0].custom_id;
  assert.equal(idLama, 'post-ctx:role', 'tanpa postId memakai bentuk pendek');
  assert.deepEqual(targetSelectTampilan(idLama), {
    postId: null,
    target: 'select:role',
    fallbackTarget: 'select:role',
  });
  assert.equal(targetSelectTampilan('post-ctx:')?.target, undefined, 'customId rusak ditolak');
});

await testAsync('aksi: select berjenis sama di dua pesan tidak saling menjalankan aksi', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  // Dua pesan, keduanya punya menu role — kasus yang dulu tertukar.
  const a = await repo.createCustomPost(GUILD, {
    name: 'Menu A',
    channelId: null,
    blocks: [{ kind: 'text', value: 'A' }, { kind: 'select', selectKind: 'role' }],
  });
  const b = await repo.createCustomPost(GUILD, {
    name: 'Menu B',
    channelId: null,
    blocks: [{ kind: 'text', value: 'B' }, { kind: 'select', selectKind: 'role' }],
  });

  await repo.replacePostActions(GUILD, a.id, {
    'select:role': [{ kind: 'reply', text: 'BALASAN PESAN A', hidden: true }],
  });
  await repo.replacePostActions(GUILD, b.id, {
    'select:role': [{ kind: 'reply', text: 'BALASAN PESAN B', hidden: true }],
  });

  const balasan: string[] = [];
  const interaksi = (postId: number) => ({
    customId: `post-ctx:${postId}:role`,
    guildId: GUILD,
    deferred: false,
    replied: false,
    user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
    member: {
      displayName: 'Wahyu',
      roles: { cache: { has: () => false }, highest: { position: 20 } },
      permissions: { has: () => true },
    },
    guild: {
      id: GUILD,
      name: 'Server Uji',
      roles: { cache: new Map(), fetch: async () => null },
      members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
    },
    reply: async (payload: { content: string }) => void balasan.push(payload.content),
    followUp: async (payload: { content: string }) => void balasan.push(payload.content),
  });

  // Meniru router: ID pesan dari customId diteruskan ke runner.
  const { targetSelectTampilan } = await import('../src/events/interactionCreate.js');
  const tekan = async (postId: number) => {
    const customId = `post-ctx:${postId}:role`;
    const target = targetSelectTampilan(customId)!;
    return runComponentActions({
      client: {} as never,
      interaction: interaksi(postId) as never,
      target: target.target,
      postId: target.postId,
    });
  };

  assert.equal(await tekan(b.id), true);
  assert.deepEqual(balasan, ['BALASAN PESAN B'], 'hanya aksi pesan B yang jalan');

  await tekan(a.id);
  assert.deepEqual(balasan, ['BALASAN PESAN B', 'BALASAN PESAN A'], 'aksi pesan A tidak tertukar');

  // Tanpa ID pesan (pesan lama), perilaku lama dipertahankan: aksi pertama
  // yang cocok dipakai, bukan error. Menu lama tetap bekerja.
  const lama = await repo.findActions(GUILD, 'select:role', null);
  assert.ok(lama, 'bentuk lama masih menemukan aksi');
});

await testAsync('flow: penantian, syarat, dan variabel dihitung tanpa server', async () => {
  const flow = await import('../src/features/post-flow.js');

  // Penantian: batas bawah & atas ditegakkan, bukan dipotong diam-diam.
  assert.equal(flow.waitUntil(1000, 0), null, 'nol detik bukan penantian');
  assert.equal(flow.waitUntil(1000, -5), null, 'durasi negatif ditolak');
  assert.equal(flow.waitUntil(1000, 'abc'), null, 'durasi bukan angka ditolak');
  assert.equal(flow.waitUntil(1000, 60), 61_000, '60 detik = satu menit');
  assert.equal(flow.waitUntil(0, 10 ** 9), flow.FLOW_LIMITS.waitSeconds * 1000, 'dibatasi 7 hari');

  // Jatuh tempo: angka maupun string (Postgres mengembalikan BIGINT as string).
  assert.equal(flow.isDue({ dueAt: 100 }, 100), true);
  assert.equal(flow.isDue({ dueAt: 100 }, 99), false);
  assert.equal(flow.isDue({ dueAt: '100' }, 100), true, 'string dari Postgres diterima');
  assert.equal(flow.isDue({ dueAt: null }, 10 ** 12), false, 'tanpa jadwal = tidak jatuh tempo');

  // Pembanding.
  const uji = (comparator: string, value: string, expected?: string) =>
    flow.testCondition({ value, comparator: comparator as never, expected });
  assert.equal(uji('equals', 'a', 'a'), true);
  assert.equal(uji('notEquals', 'a', 'b'), true);
  assert.equal(uji('contains', 'halo dunia', 'dunia'), true);
  assert.equal(uji('contains', 'halo', ''), false, 'pembanding kosong tidak cocok dengan apa pun');
  assert.equal(uji('notContains', 'halo', ''), true);
  assert.equal(uji('empty', '   '), true);
  assert.equal(uji('notEmpty', 'x'), true);

  // Nama variabel: hanya bentuk yang aman dipakai di template.
  assert.equal(flow.isVariableName('kode'), true);
  assert.equal(flow.isVariableName('kode_2'), true);
  assert.equal(flow.isVariableName('2kode'), false);
  assert.equal(flow.isVariableName('kode salah'), false);

  assert.equal(flow.describeWait(45), '45 detik');
  assert.equal(flow.describeWait(300), '5 menit');
  assert.equal(flow.describeWait(7200), '2 jam');
  assert.equal(flow.describeWait(172800), '2 hari');
});

await testAsync('aksi: jenis baru divalidasi & aksi sesudah hapus dilaporkan', async () => {
  const { sanitizeActions, planActions } = await import('../src/features/post-actions.js');

  const { actions, dropped } = sanitizeActions([
    { kind: 'wait', seconds: 300 },
    { kind: 'variable', name: 'kode', value: '{member.id}' },
    { kind: 'condition', value: 'selected', comparator: 'equals', expected: 'gamer' },
    { kind: 'thread', threadName: 'Bantuan {member.name}' },
    { kind: 'delete' },
    // Tidak sah:
    { kind: 'wait', seconds: 0 },
    { kind: 'variable', name: '2salah' },
    { kind: 'condition', value: '' },
    { kind: 'condition', value: 'selected', comparator: 'equals' },
    { kind: 'thread', threadName: '  ' },
  ]);

  assert.deepEqual(
    actions.map((a) => a.kind).join(','),
    'wait,variable,condition,thread,delete',
    'lima jenis baru lolos',
  );
  assert.equal(actions[0]!.seconds, 300);
  assert.equal(actions[1]!.name, 'kode');
  assert.equal(actions[2]!.comparator, 'equals');
  assert.equal(actions[3]!.private, false, 'thread publik sebagai bawaan');
  assert.equal(dropped.length, 5, 'lima aksi tidak sah dilaporkan');

  // `wait` dibatasi 7 hari, bukan ditolak.
  const panjang = sanitizeActions([{ kind: 'wait', seconds: 10 ** 9 }]);
  assert.equal(panjang.actions[0]!.seconds, 604800);

  // Aksi sesudah "hapus pesan" tidak akan terlihat — harus dilaporkan.
  const plan = planActions([
    { kind: 'delete' },
    { kind: 'message', postId: 3 },
  ]);
  assert.ok(
    plan.skipped.some((alasan) => alasan.includes('hapus pesan')),
    'aksi sesudah hapus pesan dilaporkan',
  );
});

await testAsync('flow: sesi penantian tersimpan, jatuh tempo, & dilanjutkan', async () => {
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Flow uji',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });

  // Sesi yang SUDAH jatuh tempo harus muncul di daftar; yang belum, tidak.
  const sekarang = Date.now();
  const id = await repo.createFlowSession({
    guildId: GUILD,
    postId: post.id,
    channelId: '999',
    messageId: '111',
    userId: '2',
    userName: 'Wahyu',
    serverName: 'Server Uji',
    variables: { kode: 'abc' },
    steps: [{ kind: 'reply', text: 'lanjutan' }],
    dueAt: sekarang - 1000,
  });
  const belum = await repo.createFlowSession({
    guildId: GUILD,
    postId: post.id,
    channelId: '999',
    messageId: '111',
    userId: '3',
    userName: 'Besok',
    serverName: 'Server Uji',
    variables: {},
    steps: [{ kind: 'reply', text: 'nanti' }],
    dueAt: sekarang + 60_000,
  });

  const due = await repo.listDueFlowSessions(sekarang);
  assert.equal(due.length, 1, 'hanya sesi yang jatuh tempo diambil');
  assert.equal(due[0]!.id, id);
  assert.equal(due[0]!.variables.kode, 'abc', 'variabel ikut tersimpan');
  assert.equal((due[0]!.steps as Array<{ text: string }>)[0]!.text, 'lanjutan');

  assert.equal(await repo.countFlowSessions(GUILD), 2);

  // Dihapus SEBELUM dijalankan; kalau tidak, flow yang sama berjalan berulang.
  await repo.deleteFlowSession(id);
  assert.equal(await repo.countFlowSessions(GUILD), 1);
  assert.equal((await repo.listDueFlowSessions(sekarang)).length, 0);

  // Pemangkasan: yang jatuh temponya masih JAUH tidak boleh ikut terbuang oleh
  // batas yang wajar (30 hari), sedangkan batas yang jauh di depan membuangnya.
  await repo.pruneFlowSessions(sekarang - 10 ** 12);
  assert.equal(await repo.countFlowSessions(GUILD), 1, 'batas lampau tidak membuang sesi yang masih menunggu');
  await repo.pruneFlowSessions(sekarang + 10 ** 12);
  assert.equal(await repo.countFlowSessions(GUILD), 0, 'batas jauh di depan membuang sesi kedaluwarsa');

  // Menghapus pesan ikut membuang sesinya — jangan ada flow yatim.
  await repo.createFlowSession({
    guildId: GUILD,
    postId: post.id,
    channelId: '999',
    messageId: '111',
    userId: '2',
    userName: 'Wahyu',
    serverName: 'Server Uji',
    variables: {},
    steps: [],
    dueAt: sekarang + 1000,
  });
  await repo.deleteCustomPost(GUILD, post.id);
  assert.equal(await repo.countFlowSessions(GUILD), 0, 'sesi pesan terhapus ikut dibuang');
  void belum;
});

await testAsync('jadwal: sanitizer, pengulangan minimal 2 jam, & geser setelah kirim', async () => {
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Jadwal uji',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Pengingat' }],
  });

  const depan = Date.now() + 60 * 60 * 1000;
  const hasil = await repo.replaceSchedules(GUILD, post.id, '999', [
    { dueAt: depan, repeatMinutes: 0 },
    // 30 menit terlalu rapat -> dinaikkan ke batas, bukan ditolak.
    { dueAt: depan + 1000, repeatMinutes: 30 },
    // Waktu lampau tidak sah.
    { dueAt: Date.now() - 10 * 60 * 1000, repeatMinutes: 0 },
  ]);
  assert.equal(hasil.schedules.length, 2, 'dua jadwal sah');
  assert.equal(hasil.schedules[1]!.repeatMinutes, 120, 'pengulangan dinaikkan ke 2 jam');
  assert.equal(hasil.dropped.length, 1, 'jadwal lampau dilaporkan');

  // Jadwal sekali-kirim dihapus setelah dikirim.
  const sekali = hasil.schedules.find((s) => s.repeatMinutes === 0)!;
  await repo.markScheduleSent(sekali);
  assert.equal((await repo.listSchedules(GUILD, post.id)).length, 1);

  // Jadwal berulang digeser dari SEKARANG, bukan dari jadwal lama — bot yang
  // mati berhari-hari tidak boleh memuntahkan pesan susulan.
  const ulang = (await repo.listSchedules(GUILD, post.id))[0]!;
  const sekarang = Date.now();
  await repo.markScheduleSent(ulang, sekarang);
  const sesudah = (await repo.listSchedules(GUILD, post.id))[0]!;
  assert.equal(sesudah.dueAt, sekarang + 120 * 60_000, 'digeser dari waktu kirim sekarang');
  assert.equal(sesudah.lastSentAt, sekarang);

  // Menghapus pesan ikut membuang jadwalnya.
  await repo.deleteCustomPost(GUILD, post.id);
  assert.equal((await repo.listSchedules(GUILD, post.id)).length, 0);
});

await testAsync('jadwal: cron kalender per hari/senin/tanggal, batas rapat & zona waktu', async () => {
  const cron = await import('../src/features/schedule-cron.js');
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';

  // 2026-11-12 10:30 WIB (UTC+7) = 03:30 UTC. Tanggal 12 Nov 2026 = Kamis.
  const sekarang = Date.UTC(2026, 10, 12, 3, 30);
  const wib = (ms: number): string => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16);

  // Tiap hari 09:00: hari ini sudah lewat (10:30), jadi besok.
  assert.equal(wib(cron.nextCronTime('0 9 * * *', sekarang, 7)!), '2026-11-13T09:00', 'tiap hari 09:00');

  // Tiap Senin: 12 Nov 2026 Kamis -> Senin 16 Nov.
  assert.equal(wib(cron.nextCronTime('0 0 * * 1', sekarang, 7)!), '2026-11-16T00:00', 'tiap Senin');

  // Tiap tanggal 1 -> 1 Desember.
  assert.equal(wib(cron.nextCronTime('0 8 1 * *', sekarang, 7)!), '2026-12-01T08:00', 'tiap tanggal 1');

  // Zona ikut berpengaruh: "09:00" di WITA = 08:00 WIB.
  const wita = cron.nextCronTime('0 9 * * *', sekarang, 8)!;
  assert.equal(wib(wita), '2026-11-13T08:00', 'jam mengikuti offset zona server');

  // Pola tidak sah ditolak dengan ALASAN, bukan diam.
  const alasan: string[] = [];
  for (const salah of ['60 9 * * *', '* * * *', 'x 9 * * *', '5-1 * * * *', '*/0 * * * *']) {
    try {
      cron.parseCron(salah);
      alasan.push('LOLOS:' + salah);
    } catch (error) {
      alasan.push((error as Error).message);
    }
  }
  assert.equal(alasan.filter((t) => t.startsWith('LOLOS')).length, 0, 'semua pola salah ditolak');
  assert.ok(alasan.some((t) => t.includes('0-59')), 'batas menit dijelaskan');
  assert.ok(alasan.some((t) => t.includes('5 ruas')), 'jumlah ruas dijelaskan');

  // Tanggal mustahil (30 Februari) tidak pernah berbunyi — dilaporkan, bukan crash.
  assert.equal(cron.nextCronTime('0 0 30 2 *', sekarang, 7), null, 'tanggal mustahil = tidak pernah');
  assert.equal(cron.cronIntervalMinutes('0 9 * * *', sekarang, 7), 1440, 'jarak harian 1440 menit');
  assert.equal(cron.cronIntervalMinutes('0 9 * * 1', sekarang, 7), 10080, 'jarak mingguan');

  /* --- penyimpanan: dueAt dihitung server, bukan dari klien --- */
  const post = await repo.createCustomPost(GUILD, {
    name: 'Jadwal kalender',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Pengingat mingguan' }],
  });

  const disimpan = await repo.replaceSchedules(
    GUILD,
    post.id,
    '999',
    [
      // dueAt sengaja ngawur: server harus menghitungnya dari cron.
      { dueAt: 1, cron: '0 9 * * *' },
      // Lebih rapat dari 2 jam -> ditolak dengan alasan.
      { dueAt: 1, cron: '*/30 * * * *' },
      // Pola rusak -> ditolak dengan alasan, bukan diam.
      { dueAt: 1, cron: '99 9 * * *' },
    ],
    'Asia/Makassar',
  );

  assert.equal(disimpan.schedules.length, 1, 'hanya pola sah yang tersimpan');
  const jadwal = disimpan.schedules[0]!;
  assert.equal(jadwal.cron, '0 9 * * *', 'ekspresi disimpan');
  assert.equal(jadwal.cronOffset, 8, 'offset zona server ikut disimpan');
  assert.ok(jadwal.dueAt > Date.now(), 'dueAt dihitung dari ekspresi, bukan nilai klien');
  assert.equal(jadwal.repeatMinutes, 0, 'cron tidak memakai pengulangan menit');
  assert.equal(disimpan.dropped.length, 2, 'dua jadwal ditolak');
  assert.ok(disimpan.dropped.some((t) => t.includes('terlalu rapat')), 'alasan rapat dijelaskan');
  assert.ok(disimpan.dropped.some((t) => t.includes('0-59')), 'alasan pola rusak dijelaskan');

  /* --- setelah dikirim: due bergeser ke pola berikutnya, baris TETAP ada --- */
  const sebelum = jadwal.dueAt;
  await repo.markScheduleSent(jadwal, sebelum);
  const sesudahKirim = await repo.listSchedules(GUILD, post.id);
  assert.equal(sesudahKirim.length, 1, 'jadwal kalender tidak dihapus setelah dikirim');
  assert.equal(sesudahKirim[0]!.dueAt, sebelum + 24 * 3_600_000, 'bergeser tepat satu hari');
  assert.equal(sesudahKirim[0]!.lastSentAt, sebelum, 'waktu kirim terakhir dicatat');

  /*
   * Jam dinding tetap: dikirim jam 09:00 WITA hari ini, jadwal berikutnya juga
   * 09:00 WITA — bukan "24 jam dari sekarang" yang bisa melenceng kalau
   * pengiriman molor beberapa menit.
   */
  const berikut = cron.nextCronTime('0 9 * * *', sesudahKirim[0]!.dueAt, 8)!;
  assert.equal(wib(berikut), '2026-11-15T08:00', 'jadwal berikutnya tetap pukul 09:00 WITA (08:00 WIB)');

  await repo.deleteCustomPost(GUILD, post.id);
});

await testAsync('flow: tunggu menyimpan sesi, syarat menghentikan, hapus menghapus pesan', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Flow nyata',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });
  const tombol = await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Mulai', roleId: '900000000000000001', mode: 'toggle' },
  ]);
  const buttonId = tombol.buttons[0]!.id;

  /** Interaksi tiruan: mencatat balasan, pesan yang dihapus, & thread. */
  const buatInteraksi = () => {
    const catatan = {
      balasan: [] as string[],
      hapus: 0,
      thread: [] as string[],
    };
    const interaction = {
      customId: `post-role:${buttonId}`,
      guildId: GUILD,
      channelId: '999',
      message: {
        id: '555',
        delete: async () => {
          catatan.hapus += 1;
        },
      },
      deferred: false,
      replied: false,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      member: {
        displayName: 'Wahyu',
        roles: { cache: { has: () => false }, highest: { position: 20 } },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: { cache: new Map(), fetch: async () => null },
        members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
      },
      reply: async (payload: { content: string }) => void catatan.balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void catatan.balasan.push(payload.content),
    };
    return { catatan, interaction };
  };

  const jalankan = async () => {
    const { catatan, interaction } = buatInteraksi();
    const ditangani = await runComponentActions({
      client: {} as never,
      interaction: interaction as never,
      target: `button:${buttonId}`,
      postId: post.id,
    });
    return { ...catatan, ditangani };
  };

  // 1. "Tunggu": sesi tersimpan, sisa langkah TIDAK dijalankan sekarang.
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'variable', name: 'sapa', value: 'Hai {member.name}' },
      { kind: 'wait', seconds: 120 },
      { kind: 'reply', text: 'pengingat untuk {var.sapa}' },
    ],
  });
  const tunggu = await jalankan();
  assert.equal(tunggu.ditangani, true);
  assert.match(tunggu.balasan[0]!, /2 menit/, 'pengklik diberi tahu ada penantian');

  const sesi = await repo.listDueFlowSessions(Date.now() + 10 * 60 * 1000);
  const milikKita = sesi.filter((s) => s.postId === post.id);
  assert.equal(milikKita.length, 1, 'sesi penantian tersimpan');
  assert.equal(milikKita[0]!.variables.sapa, 'Hai Wahyu', 'variabel disimpan tanpa awalan var.');
  assert.equal((milikKita[0]!.steps as Array<{ text?: string }>)[0]!.text, 'pengingat untuk {var.sapa}');
  assert.equal(milikKita[0]!.userId, '2');

  // 2. Syarat yang tidak cocok: berhenti, tidak menjalankan sisa aksi.
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'condition', value: 'selected', comparator: 'equals', expected: 'gamer' },
      { kind: 'reply', text: 'TIDAK BOLEH' },
    ],
  });
  const syarat = await jalankan();
  assert.equal(syarat.balasan.length, 1);
  assert.match(syarat.balasan[0]!, /Syarat/, 'alasan berhenti dijelaskan');
  assert.notEqual(syarat.balasan[0], 'TIDAK BOLEH');

  // 3. Syarat yang cocok: lanjut.
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'condition', value: 'member.name', comparator: 'equals', expected: 'Wahyu' },
      { kind: 'reply', text: 'cocok' },
    ],
  });
  const cocok = await jalankan();
  assert.equal(cocok.balasan[0], 'cocok', 'syarat yang cocok melanjutkan flow');

  // 4. Hapus pesan: pesan benar-benar dihapus, tanpa balasan "Selesai".
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [{ kind: 'delete' }],
  });
  const hapus = await jalankan();
  assert.equal(hapus.hapus, 1, 'pesan pemicu dihapus');
  assert.equal(hapus.balasan.length, 0, 'tidak ada balasan sia-sia sesudah pesan hilang');

  // 5. Thread tanpa channel yang mendukung: gagal dengan penjelasan, bukan diam.
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [{ kind: 'thread', threadName: 'Bantuan' }],
  });
  const thread = await jalankan();
  assert.equal(thread.balasan.length, 1);
  assert.match(thread.balasan[0]!, /thread/i, 'kegagalan thread dijelaskan');
});

await testAsync('flow: aksi per pilihan select dipakai sebelum aksi seluruh menu', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const { targetSelectTampilan } = await import('../src/events/interactionCreate.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Menu pilihan',
    channelId: '999',
    blocks: [
      { kind: 'text', value: 'Pilih' },
      { kind: 'select', selectKind: 'string', options: [{ label: 'Gamer', value: 'gamer' }, { label: 'Musik', value: 'musik' }] },
    ],
  });
  await repo.replacePostActions(GUILD, post.id, {
    'sel:gamer': [{ kind: 'reply', text: 'Kamu memilih gamer' }],
    'select:string': [{ kind: 'reply', text: 'Pilihan lain' }],
  });

  // Router: pilihan tunggal memakai target `sel:<nilai>` + cadangan.
  const customId = `post-ctx:${post.id}:string`;
  const satu = targetSelectTampilan(customId, ['gamer'])!;
  assert.equal(satu.target, 'sel:gamer');
  assert.equal(satu.fallbackTarget, 'select:string');
  // Banyak pilihan sekaligus tidak bisa dipetakan ke satu aksi.
  assert.equal(targetSelectTampilan(customId, ['gamer', 'musik'])!.target, 'select:string');

  const balasan: string[] = [];
  const tekan = async (values: string[]) => {
    const target = targetSelectTampilan(customId, values)!;
    const interaction = {
      customId,
      guildId: GUILD,
      channelId: '999',
      deferred: false,
      replied: false,
      values,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      member: {
        displayName: 'Wahyu',
        roles: { cache: { has: () => false }, highest: { position: 20 } },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: { cache: new Map(), fetch: async () => null },
        members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
      },
      reply: async (payload: { content: string }) => void balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void balasan.push(payload.content),
    };
    return runComponentActions({
      client: {} as never,
      interaction: interaction as never,
      target: target.target,
      fallbackTarget: target.fallbackTarget,
      postId: target.postId,
    });
  };

  assert.equal(await tekan(['gamer']), true);
  assert.deepEqual(balasan, ['Kamu memilih gamer'], 'aksi per pilihan dipakai');

  await tekan(['musik']);
  assert.deepEqual(balasan, ['Kamu memilih gamer', 'Pilihan lain'], 'pilihan tanpa aksi jatuh ke aksi menu');
});

await testAsync('pesan: endpoint jadwal dikenali router (bukan 404)', async () => {
  /*
   * Regresi nyata: `/api/posts/:id/schedules` sempat tidak masuk pola router,
   * sehingga dashboard menerima "Tidak ditemukan" walaupun endpoint-nya sudah
   * ditulis. Menyimpan jadwal dari dashboard adalah satu-satunya jalan
   * memakainya, jadi kegagalannya harus tertangkap di sini.
   */
  const sumber = await readFile(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  /*
   * Diperiksa dengan `includes`, bukan regex bersarang: pesan kegagalan
   * assert.match mencetak seluruh source dan menenggelamkan laporan test.
   */
  assert.ok(sumber.includes('\\/roles|\\/schedules'), 'pola router menerima /schedules');
  assert.ok(sumber.includes("postMatch[2] === '/schedules'"), 'ada cabang yang menangani jadwal');
});

await testAsync('pesan: teks blok bisa memakai template, dan tanpa konteks tetap apa adanya', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  // Deps lengkap seperti yang dipakai pemanggil sungguhan: tipe deps mensyaratkan
  // semua builder, dan versi setengah jadi membuat build gagal padahal runtime-nya
  // tidak apa-apa — persis jenis kesalahan yang tidak boleh lolos.
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SectionBuilder: d.SectionBuilder,
    ThumbnailBuilder: d.ThumbnailBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    StringSelectMenuBuilder: d.StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder: d.StringSelectMenuOptionBuilder,
    UserSelectMenuBuilder: d.UserSelectMenuBuilder,
    RoleSelectMenuBuilder: d.RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder: d.MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder: d.ChannelSelectMenuBuilder,
  };
  const blok = sanitizeBlocks([
    { kind: 'container' },
    { kind: 'text', value: 'Hai {member.name} di {server.name}! Pilihanmu {selected}. Sisa {tidak.dikenal}' },
  ]).blocks;

  const denganTemplate = buildPostPayload(blok, {
    ...deps,
    template: { 'member.name': 'Wahyu', 'server.name': 'Zypher', selected: 'gamer' },
  });
  const teks = JSON.stringify(denganTemplate!.components.map((c) => (c as unknown as { toJSON: () => unknown }).toJSON()));
  assert.match(teks, /Hai Wahyu di Zypher/, 'template terisi');
  assert.match(teks, /Pilihanmu gamer/);
  assert.match(teks, /Sisa \{tidak\.dikenal\}/, 'token tak dikenal dibiarkan');

  /*
   * TANPA konteks, teks harus dikirim apa adanya. Ini yang menjaga pesan biasa
   * buatan admin tidak berubah hanya karena fitur template ada.
   */
  const tanpa = buildPostPayload(blok, deps);
  const teksTanpa = JSON.stringify(tanpa!.components.map((c) => (c as unknown as { toJSON: () => unknown }).toJSON()));
  assert.match(teksTanpa, /\{member\.name\}/, 'tanpa konteks token dibiarkan');
});

await testAsync('aksi: kirim teks mentah & hapus pesan bertarget', async () => {
  const { sanitizeActions, planActions, fillActionText } = await import('../src/features/post-actions.js');

  const { actions, dropped } = sanitizeActions([
    { kind: 'raw', rawText: '  Halo {member.name}  ', channelId: '123456789012345678' },
    { kind: 'raw', rawText: '   ' },
    { kind: 'raw', rawText: 'Halo', channelId: 'bukan-channel' },
    { kind: 'delete', what: 'sebelumnya' },
    { kind: 'delete' },
    { kind: 'delete', what: 'bukan-sasaran' },
  ]);

  // Teks kosong = pesan kosong, dan Discord menolaknya. Aksi seperti itu
  // dibuang sekarang, bukan gagal di Discord nanti.
  assert.deepEqual(
    actions.map((a) => a.kind + ':' + (a.what ?? '')).join(','),
    'raw:,raw:,delete:sebelumnya,delete:pesan,delete:pesan',
    'teks kosong dibuang, sasaran hapus tak dikenal jatuh ke pesan ini',
  );
  assert.equal(actions[0]!.rawText, 'Halo {member.name}', 'teks dirapikan');
  assert.equal(actions[0]!.channelId, '123456789012345678', 'channel sah dipertahankan');
  assert.equal(actions[1]!.channelId, undefined, 'channel bukan ID dibuang, aksinya tetap');
  assert.equal(dropped.length, 2, 'dua bagian dilaporkan');
  assert.ok(dropped.some((alasan) => alasan.includes('tanpa isi')), 'teks kosong dilaporkan');
  assert.ok(dropped.some((alasan) => alasan.includes('bukan ID channel')), 'channel salah dilaporkan');

  // Rencana: teks mentah membawa isi & channel, hapus membawa sasarannya.
  const plan = planActions([
    { kind: 'raw', rawText: 'Halo {member.mention}' },
    { kind: 'delete', what: 'sebelumnya' },
  ]);
  const [teks, hapus] = plan.steps as Array<Record<string, unknown>>;
  assert.equal(teks!.kind, 'raw');
  assert.equal(teks!.text, 'Halo {member.mention}');
  assert.equal(teks!.channelId, undefined, 'tanpa channel = ikut channel pemicu');
  assert.equal(hapus!.kind, 'delete');
  assert.equal(hapus!.what, 'sebelumnya', 'sasaran hapus ikut ke langkah');

  // Templat tetap berlaku di teks mentah.
  const terisi = fillActionText('Halo {member.name} di {server.name}', {
    member: 'Wahyu',
    mention: '<@1>',
    server: 'Zypher',
  } as never);
  assert.equal(terisi, 'Halo Wahyu di Zypher');
});

await testAsync('aksi: cabang bersyarat, dud, stop, & variabel adaptif', async () => {
  const { sanitizeActions, planActions } = await import('../src/features/post-actions.js');

  const { actions, dropped } = sanitizeActions([
    { kind: 'dud' },
    { kind: 'stop', stopMessage: 'Selesai di sini.' },
    {
      kind: 'condition',
      value: 'selected',
      comparator: 'equals',
      expected: 'gamer',
      then: [{ kind: 'reply', text: 'kamu gamer' }],
      else: [{ kind: 'reply', text: 'bukan gamer' }],
    },
    { kind: 'variable', name: 'pesan', value: 'messageId', source: 'adaptive' },
    { kind: 'variable', name: 'salinan', value: 'var.kode', source: 'get' },
    // adaptive tanpa nilai = menyesatkan, harus ditolak.
    { kind: 'variable', name: 'kosong', source: 'adaptive' },
  ]);

  assert.deepEqual(
    actions.map((a) => a.kind).join(','),
    'dud,stop,condition,variable,variable',
    'jenis baru lolos, variabel adaptive tanpa nilai ditolak',
  );
  assert.equal(actions[1]!.stopMessage, 'Selesai di sini.');
  assert.equal(actions[2]!.then!.length, 1, 'cabang cocok tersimpan');
  assert.equal(actions[2]!.else!.length, 1, 'cabang tidak cocok tersimpan');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!, /hasil aksi sebelumnya/);

  /*
   * Cabang bersarang: batasnya 5 tingkat (ACTION_LIMITS.branchDepth), jadi
   * contoh di bawah ini 6 tingkat dan harus dilaporkan. Angka 6 dipakai
   * dengan sengaja: contoh 4 tingkat dulu "terlalu dalam" saat batasnya 3,
   * dan sekarang justru sah.
   */
  const dalam = {
    kind: 'condition',
    value: 'a',
    comparator: 'notEmpty',
    then: [
      {
        kind: 'condition',
        value: 'b',
        comparator: 'notEmpty',
        then: [
          {
            kind: 'condition',
            value: 'c',
            comparator: 'notEmpty',
            then: [
              {
                kind: 'condition',
                value: 'd',
                comparator: 'notEmpty',
                then: [
                  {
                    kind: 'condition',
                    value: 'f',
                    comparator: 'notEmpty',
                    then: [{ kind: 'condition', value: 'g', comparator: 'notEmpty', then: [{ kind: 'dud' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const bersarang = sanitizeActions([dalam]);
  assert.equal(bersarang.actions.length, 1);
  assert.ok(
    bersarang.dropped.some((alasan) => alasan.includes('tingkat')),
    'cabang terlalu dalam dilaporkan, bukan dipotong diam-diam',
  );

  // Rencana: cabang diterjemahkan jadi langkah bersarang.
  const plan = planActions([
    {
      kind: 'condition',
      value: 'selected',
      comparator: 'equals',
      expected: 'gamer',
      then: [{ kind: 'reply', text: 'gamer!' }],
      else: [{ kind: 'stop', stopMessage: 'bukan gamer' }],
    },
    { kind: 'dud' },
  ]);
  const syarat = plan.steps[0] as { kind: string; then?: unknown[]; otherwise?: unknown[] };
  assert.equal(syarat.kind, 'condition');
  assert.equal(syarat.then!.length, 1, 'cabang "cocok" jadi langkah');
  assert.equal(syarat.otherwise!.length, 1, 'cabang "tidak cocok" jadi langkah');
  assert.equal(plan.steps[1]!.kind, 'dud', 'dud tetap jadi langkah (urutan terjaga)');
});

await testAsync('aksi: cabang bersarang 5 tingkat & kuota flow ala Discohook', async () => {
  const { sanitizeActions, planActions, hitungAksiFlow, ACTION_LIMITS } = await import(
    '../src/features/post-actions.js'
  );

  /* --- kedalaman: 5 tingkat diterima, tingkat keenam dilaporkan --- */
  const bersarang = (tingkat: number): Record<string, unknown> => {
    let dalam: Record<string, unknown> = { kind: 'dud' };
    for (let i = tingkat; i >= 1; i -= 1) {
      dalam = { kind: 'condition', value: 'member.name', comparator: 'notEmpty', then: [dalam] };
    }
    return dalam;
  };

  assert.equal(ACTION_LIMITS.branchDepth, 5, 'kedalaman cabang sama dengan yang dipakai UI');
  const lima = sanitizeActions([bersarang(5)]);
  assert.equal(lima.actions.length, 1, 'lima tingkat masih diterima');
  assert.equal(lima.dropped.length, 0, 'lima tingkat tidak dilaporkan sebagai terlalu dalam');

  const enam = sanitizeActions([bersarang(6)]);
  assert.ok(
    enam.dropped.some((alasan) => alasan.includes('tingkat')),
    'cabang keenam dilaporkan, bukan dipotong diam-diam',
  );

  /* --- hitungan: syarat & hentikan tidak dihitung, cabang ikut dihitung --- */
  const hitung = hitungAksiFlow([
    { kind: 'condition', value: 'a', comparator: 'notEmpty', then: [{ kind: 'reply', text: 'x' }] },
    { kind: 'stop' },
    { kind: 'wait', seconds: 5 },
    { kind: 'condition', value: 'b', comparator: 'notEmpty', else: [{ kind: 'dud' }] },
  ]);
  assert.deepEqual(hitung, { total: 6, berhitung: 3, pesan: 0 }, 'syarat/hentikan tidak dihitung, isi cabang dihitung');

  /* --- kuota 15 aksi kirim pesan per flow, termasuk yang di dalam cabang --- */
  /*
   * Tujuh belas aksi kirim pesan: lima di tingkat atas dan dua belas di dalam
   * cabang. Daftar tingkat atas sengaja 6 aksi (lima pesan + satu syarat),
   * tepat di batas per komponen — jadi yang menahan di sini benar-benar kuota
   * 15 aksi kirim pesan per flow, bukan batas 6 itu. Isi cabang tidak dibatasi
   * 6: cabang bukan komponen.
   */
  const banyakPesan = sanitizeActions([
    ...Array.from({ length: 5 }, () => ({ kind: 'message', postId: 1 })),
    {
      kind: 'condition',
      value: 'member.name',
      comparator: 'notEmpty',
      then: Array.from({ length: 12 }, () => ({ kind: 'message', postId: 2 })),
    },
  ]);
  const pesanSaja = hitungAksiFlow(banyakPesan.actions).pesan;
  assert.equal(pesanSaja, ACTION_LIMITS.messagePerFlow, 'kirim pesan dibatasi 15 per flow');
  assert.ok(
    banyakPesan.dropped.some((alasan) => alasan.includes('kirim pesan')),
    'kelebihan kirim pesan dilaporkan sekali',
  );
  assert.equal(
    banyakPesan.dropped.filter((alasan) => alasan.includes('kirim pesan')).length,
    1,
    'alasan kuota pesan tidak diulang 3 kali',
  );

  /* --- kuota 40 aksi berhitung, dihitung lintas cabang --- */
  const dibatasi = sanitizeActions([
    {
      kind: 'condition',
      value: 'member.name',
      comparator: 'notEmpty',
      then: Array.from({ length: ACTION_LIMITS.countedPerFlow + 5 }, () => ({ kind: 'dud' })),
    },
  ]);
  assert.equal(hitungAksiFlow(dibatasi.actions).berhitung, ACTION_LIMITS.countedPerFlow, 'kuota 40 ditegakkan');
  assert.ok(
    dibatasi.dropped.some((alasan) => alasan.includes('dihitung')),
    'kelebihan aksi berhitung dilaporkan',
  );

  /*
   * Syarat SESUDAH kuota habis: aksinya tetap ada (membuangnya akan membuang
   * cabangnya juga), tetapi isi cabangnya yang melewati kuota ikut hilang.
   * Cabang yang habis seluruhnya membuat syaratnya dibuang dengan alasan —
   * syarat tanpa cabang berarti "tidak cocok = hentikan flow", dan perubahan
   * arti diam-diam seperti itu tidak boleh terjadi.
   */
  const syaratDiUjung = sanitizeActions([
    {
      kind: 'condition',
      value: 'member.name',
      comparator: 'notEmpty',
      then: Array.from({ length: ACTION_LIMITS.countedPerFlow }, () => ({ kind: 'dud' })),
    },
    {
      kind: 'condition',
      value: 'member.id',
      comparator: 'notEmpty',
      then: [{ kind: 'dud' }, { kind: 'dud' }],
    },
  ]);
  assert.equal(syaratDiUjung.actions.length, 1, 'syarat yang cabangnya habis dibuang');
  assert.ok(
    syaratDiUjung.dropped.some((alasan) => alasan.includes('seluruh isi cabang')),
    'alasan syarat-dibuang dijelaskan',
  );

  // Syarat dengan cabang yang SEBAGIAN masih muat tetap dipertahankan.
  const sebagian = sanitizeActions([
    {
      kind: 'condition',
      value: 'member.name',
      comparator: 'notEmpty',
      then: Array.from({ length: ACTION_LIMITS.countedPerFlow - 1 }, () => ({ kind: 'dud' })),
    },
    { kind: 'condition', value: 'member.id', comparator: 'notEmpty', then: [{ kind: 'dud' }] },
  ]);
  assert.equal(sebagian.actions.length, 2, 'syarat kedua tetap ada');
  assert.equal(sebagian.actions[1]!.then!.length, 1, 'isi cabang yang masih muat dipertahankan');

  /* --- jaring pengaman: total aksi (termasuk yang tak dihitung) dibatasi --- */
  const totalBanyak = sanitizeActions([
    {
      kind: 'condition',
      value: 'member.name',
      comparator: 'notEmpty',
      then: Array.from({ length: ACTION_LIMITS.maxTotal + 20 }, () => ({ kind: 'stop' })),
    },
  ]);
  assert.equal(hitungAksiFlow(totalBanyak.actions).total, ACTION_LIMITS.maxTotal, 'batas total ditegakkan');
  assert.ok(
    totalBanyak.dropped.some((alasan) => alasan.includes('total')),
    'kelebihan total dilaporkan dengan alasannya sendiri',
  );

  /* --- rencana: cabang bertingkat jadi langkah bersarang, urutan tetap --- */
  const plan = planActions([
    {
      kind: 'condition',
      value: 'member.name',
      comparator: 'notEmpty',
      then: [
        {
          kind: 'condition',
          value: 'member.id',
          comparator: 'notEmpty',
          then: [{ kind: 'reply', text: 'dalam sekali' }],
        },
      ],
    },
    { kind: 'dud' },
  ]);
  const luar = plan.steps[0] as { then?: Array<{ kind: string; then?: unknown[] }> };
  assert.equal(luar.then![0]!.kind, 'condition', 'syarat di dalam cabang tetap syarat');
  assert.equal(luar.then![0]!.then!.length, 1, 'cabang tingkat ketiga ikut');
  assert.equal(plan.steps[1]!.kind, 'dud', 'aksi sesudah syarat tidak hilang');
});

await testAsync('syarat: and / or / not / in bertingkat', async () => {
  const flow = await import('../src/features/post-flow.js');

  // Nilai yang dipakai bersama oleh semua simpul di bawah.
  const nilai: Record<string, string> = {
    'member.name': 'Wahyu',
    'member.id': '123456789012345678',
    selected: 'gamer',
    'var.kode': 'B',
    kosong: '',
  };
  const ambil = (nama: string) => nilai[nama] ?? '';

  // `in`: nilai harus ADA di daftar — pencocokan persis, bukan "mengandung".
  assert.equal(
    flow.evaluateCondition({ type: 'in', value: 'selected', list: ['gamer', 'anime'] }, ambil),
    true,
  );
  assert.equal(
    flow.evaluateCondition({ type: 'in', value: 'var.kode', list: ['gamer'] }, ambil),
    false,
    'pencocokan `in` tidak boleh sebagian',
  );
  assert.equal(
    flow.evaluateCondition({ type: 'in', value: 'kosong', list: [''] }, ambil),
    false,
    'nilai kosong tidak pernah "termasuk"',
  );

  // `and` butuh SEMUA benar; `or` cukup satu.
  const dan = {
    type: 'and' as const,
    items: [
      { type: 'leaf' as const, value: 'member.name', comparator: 'equals' as const, expected: 'Wahyu' },
      { type: 'leaf' as const, value: 'selected', comparator: 'equals' as const, expected: 'gamer' },
    ],
  };
  assert.equal(flow.evaluateCondition(dan, ambil), true);
  assert.equal(
    flow.evaluateCondition(
      { ...dan, items: [...dan.items, { type: 'leaf', value: 'kosong', comparator: 'notEmpty' }] },
      ambil,
    ),
    false,
    'satu anak salah membuat `and` salah',
  );
  assert.equal(flow.evaluateCondition({ type: 'or', items: dan.items }, ambil), true);
  assert.equal(
    flow.evaluateCondition(
      {
        type: 'or',
        items: [
          { type: 'leaf', value: 'kosong', comparator: 'notEmpty' },
          { type: 'leaf', value: 'selected', comparator: 'equals', expected: 'gamer' },
        ],
      },
      ambil,
    ),
    true,
  );

  /*
   * `not` = NOR (semua anak salah), sama seperti Discohook. Ini yang paling
   * mudah salah diartikan, jadi diuji dua arah.
   */
  const bukan = {
    type: 'not' as const,
    items: [{ type: 'leaf' as const, value: 'kosong', comparator: 'notEmpty' as const }],
  };
  assert.equal(flow.evaluateCondition(bukan, ambil), true, '`not` benar saat anaknya salah');
  assert.equal(
    flow.evaluateCondition({ ...bukan, items: [...bukan.items, dan.items[0]!] }, ambil),
    false,
    '`not` salah saat ADA anak yang benar (bukan sekadar negasi satu syarat)',
  );
  assert.equal(flow.evaluateCondition({ type: 'not', items: [] }, ambil), true, '`not` tanpa anak = benar');

  // Bersarang: (nama=Wahyu DAN (id tidak kosong ATAU kode in [A,B]))
  assert.equal(
    flow.evaluateCondition(
      {
        type: 'and',
        items: [
          { type: 'leaf', value: 'member.name', comparator: 'equals', expected: 'Wahyu' },
          {
            type: 'or',
            items: [
              { type: 'leaf', value: 'member.id', comparator: 'notEmpty' },
              { type: 'in', value: 'var.kode', list: ['A', 'B'] },
            ],
          },
        ],
      },
      ambil,
    ),
    true,
  );

  // `and`/`or` tanpa anak tidak masuk akal; `not` tanpa anak tetap berarti.
  const { sanitizeActions } = await import('../src/features/post-actions.js');
  const kosong = sanitizeActions([
    { kind: 'condition', check: { type: 'and', items: [] } },
    { kind: 'condition', check: { type: 'not', items: [] }, then: [{ kind: 'dud' }] },
  ]);
  assert.equal(kosong.actions.length, 1, '`and` tanpa anak dibuang');
  assert.ok(
    kosong.dropped.some((alasan) => alasan.includes('tanpa syarat di dalamnya')),
    'alasannya dilaporkan',
  );
  assert.equal(kosong.actions[0]!.check!.type, 'not');

  // `in` tanpa daftar juga dibuang — bukan diam-diam selalu salah.
  const tanpaDaftar = sanitizeActions([{ kind: 'condition', check: { type: 'in', value: 'selected' } }]);
  assert.equal(tanpaDaftar.actions.length, 0);
  assert.ok(tanpaDaftar.dropped.some((alasan) => alasan.includes('daftar pembanding')));

  // Daftar `in` dirapikan: dipisah koma/baris, duplikat & kosong dibuang.
  assert.deepEqual(flow.normalizeList('gamer, anime\n gamer\n\nfilm'), ['gamer', 'anime', 'film']);
  assert.deepEqual(flow.normalizeList(['a', ' a ', 'b']), ['a', 'b']);
  assert.deepEqual(flow.normalizeList(undefined), []);

  // Kedalaman: pohon yang terlalu dalam dilaporkan, bukan dipotong diam-diam.
  let dalam: Record<string, unknown> = { type: 'leaf', value: 'a', comparator: 'notEmpty' };
  for (let i = 0; i < 6; i += 1) dalam = { type: 'and', items: [dalam] };
  const terlaluDalam = sanitizeActions([{ kind: 'condition', check: dalam }]);
  assert.ok(
    terlaluDalam.dropped.some((alasan) => alasan.includes('tingkat')),
    'pohon terlalu dalam dilaporkan',
  );

  // Ringkasan untuk log/dashboard tidak melempar untuk bentuk apa pun.
  assert.match(flow.describeCondition({ type: 'leaf', value: 'a', comparator: 'equals', expected: 'b' }), /a sama dengan "b"/);
  assert.match(flow.describeCondition({ type: 'in', value: 'x', list: ['1', '2'] }), /x termasuk \[1, 2\]/);
});

await testAsync('aksi: thread lengkap & kirim webhook divalidasi', async () => {
  const { sanitizeActions, planActions } = await import('../src/features/post-actions.js');

  const { actions, dropped } = sanitizeActions([
    {
      kind: 'thread',
      threadName: 'Bantuan {member.name}',
      private: true,
      autoArchiveMinutes: 10080,
      slowmodeSeconds: 30,
      invitable: false,
      appliedTags: ['111111111111111111', 'bukan-id', '111111111111111111'],
      threadMessage: 'Halo {member.mention}',
    },
    // Pilihan arsip di luar daftar Discord = dibuang, bukan dibulatkan.
    { kind: 'thread', threadName: 'Arsip salah', autoArchiveMinutes: 999 },
    { kind: 'thread', threadName: 'Slowmode salah', slowmodeSeconds: 99999 },
    { kind: 'webhook', postId: 7 },
    // Channel tujuan harus ID, bukan nama channel.
    { kind: 'webhook', postId: 8, channelId: '#umum' },
    { kind: 'message', postId: 9, channelId: '123456789012345678' },
    { kind: 'webhook' },
  ]);

  assert.deepEqual(
    actions.map((a) => a.kind).join(','),
    'thread,thread,thread,webhook,webhook,message',
    'aksi tetap ada; hanya bagian yang tidak sah yang dibuang & dilaporkan',
  );
  /*
   * Setelan yang tidak sah dibuang TANPA membuang aksinya: thread-nya tetap
   * dibuat dengan setelan bawaan Discord, dan admin diberi tahu. Ini keputusan
   * sadar — menghapus seluruh aksi karena satu angka salah akan membuat tombol
   * yang seharusnya membuat thread tidak melakukan apa pun.
   */
  assert.equal(actions[1]!.autoArchiveMinutes, undefined, 'arsip tidak sah dibuang, aksi tetap');
  assert.equal(actions[2]!.slowmodeSeconds, undefined, 'slowmode tidak sah dibuang, aksi tetap');
  assert.equal(actions[4]!.channelId, undefined, 'channel bukan ID dibuang, aksi tetap');
  assert.equal(actions[0]!.autoArchiveMinutes, 10080);
  assert.equal(actions[0]!.slowmodeSeconds, 30);
  assert.equal(actions[0]!.invitable, false);
  assert.deepEqual(actions[0]!.appliedTags, ['111111111111111111'], 'tag ganda & bukan angka dibuang');
  assert.equal(actions[0]!.threadMessage, 'Halo {member.mention}');
  assert.equal(dropped.length, 4, 'empat bagian tidak sah dilaporkan');

  /*
   * Rencana: `webhook` jadi langkah pesan dengan `viaWebhook`, dan channel
   * tujuan tetap dibawa. Tanpa penanda ini, aksi webhook diam-diam terkirim
   * lewat bot — pesan tampil atas nama bot padahal admin minta server.
   */
  const plan = planActions([
    { kind: 'webhook', postId: 7, toChannel: true },
    { kind: 'message', postId: 9, toChannel: true, channelId: '123456789012345678' },
    { kind: 'thread', threadName: 'T', private: true, autoArchiveMinutes: 60, slowmodeSeconds: 5, appliedTags: ['1'] },
  ]);
  const [webhook, pesan, thread] = plan.steps as Array<Record<string, unknown>>;
  assert.equal(webhook!.kind, 'message');
  assert.equal(webhook!.viaWebhook, true, 'penanda webhook ikut ke langkah');
  assert.equal(pesan!.channelId, '123456789012345678', 'channel tujuan ikut ke langkah');
  assert.equal(webhook!.channelId, undefined, 'tanpa channel tujuan = ikut channel pemicu');
  assert.equal(thread!.autoArchiveMinutes, 60);
  assert.equal(thread!.slowmodeSeconds, 5);
});

await testAsync('pesan: allowed_mentions & thread_name bertahan & bawaan aman', async () => {
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';

  // Bawaan: TANPA ping apa pun. Arah aman ini disengaja — pesan yang tidak
  // sengaja berisi @everyone tidak bisa ditarik kembali.
  const polos = await repo.createCustomPost(GUILD, {
    name: 'Tanpa ping',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Halo' }],
  });
  assert.deepEqual(polos.allowedMentions.parse, [], 'bawaan tanpa ping');
  assert.equal(polos.threadName, null, 'bawaan tanpa thread');

  // Izin ping & nama thread bertahan setelah dibaca ulang dari database.
  const denganPing = await repo.createCustomPost(GUILD, {
    name: 'Ping role',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Pengumuman' }],
    allowedMentions: { parse: ['roles', 'users', 'tidak-dikenal' as never] },
    threadName: '  Diskusi pengumuman  ',
  });
  const dibaca = await repo.getCustomPost(GUILD, denganPing.id);
  assert.deepEqual(dibaca?.allowedMentions.parse, ['roles', 'users'], 'jenis tak dikenal dibuang');
  assert.equal(dibaca?.threadName, 'Diskusi pengumuman', 'nama thread dirapikan');

  // Memperbarui TANPA menyebut izin ping = izin lama dipertahankan, bukan
  // direset jadi "tanpa ping" (itu akan mematikan ping yang sudah disusun).
  const tanpaUbah = await repo.updateCustomPost(GUILD, denganPing.id, { name: 'Nama baru' });
  assert.deepEqual(tanpaUbah?.allowedMentions.parse, ['roles', 'users'], 'izin lama bertahan');
  assert.equal(tanpaUbah?.threadName, 'Diskusi pengumuman', 'thread lama bertahan');

  // Menyebut daftar kosong = sengaja mematikan ping.
  const dimatikan = await repo.updateCustomPost(GUILD, denganPing.id, { allowedMentions: { parse: [] } });
  assert.deepEqual(dimatikan?.allowedMentions.parse, [], 'daftar kosong mematikan ping');

  /*
   * Kolom rusak (mis. disunting manual di database) dibaca sebagai "tanpa
   * ping" — bukan "semua boleh". Salah baca ke arah aman hanya membuat ping
   * tidak terjadi.
   */
  const { run } = await import('../src/db/index.js');
  await run('UPDATE custom_posts SET mentions = ? WHERE guild_id = ? AND id = ?', [
    '{bukan json',
    GUILD,
    denganPing.id,
  ]);
  const rusak = await repo.getCustomPost(GUILD, denganPing.id);
  assert.deepEqual(rusak?.allowedMentions.parse, [], 'kolom rusak = tanpa ping');

  /* --- Payload: allowed_mentions & thread_name sampai ke penyusun --- */
  const { buildPostPayload } = await import('../src/features/custom-post.js');
  const deps = {
    ContainerBuilder: (await import('discord.js')).ContainerBuilder,
    TextDisplayBuilder: (await import('discord.js')).TextDisplayBuilder,
    SeparatorBuilder: (await import('discord.js')).SeparatorBuilder,
    MediaGalleryBuilder: (await import('discord.js')).MediaGalleryBuilder,
    MediaGalleryItemBuilder: (await import('discord.js')).MediaGalleryItemBuilder,
    ActionRowBuilder: (await import('discord.js')).ActionRowBuilder,
    ButtonBuilder: (await import('discord.js')).ButtonBuilder,
    ButtonStyle: (await import('discord.js')).ButtonStyle,
    accent: 0x6d8cff,
    accentToNumber: () => 0x6d8cff,
    roleButtons: [],
    roleButtonId: (id: number) => `post-role:${id}`,
  };
  const blok = [{ kind: 'container' }, { kind: 'text', value: 'Hai' }];
  const bawaan = buildPostPayload(blok as never, deps as never);
  assert.deepEqual(bawaan!.allowedMentions.parse, [], 'penyusun payload bawaan tanpa ping');
  assert.equal(bawaan!.threadName, undefined, 'tanpa thread');

  const dipasang = buildPostPayload(blok as never, {
    ...deps,
    allowedMentions: { parse: ['users'] },
    threadName: 'Ruang diskusi',
  } as never);
  assert.deepEqual(dipasang!.allowedMentions.parse, ['users'], 'izin ping diteruskan');
  assert.equal(dipasang!.threadName, 'Ruang diskusi', 'nama thread diteruskan');

  /* --- default_values pada select --- */
  const { sanitizeBlocks } = await import('../src/features/custom-post.js');
  const select = sanitizeBlocks([
    { kind: 'select', selectKind: 'role', defaultValues: ['900000000000000001', 'bukan-id'] },
    { kind: 'select', selectKind: 'string', options: [{ label: 'A' }], defaultValues: ['1'] },
    { kind: 'select', selectKind: 'user', defaultValues: ['111111111111111111', '222222222222222222'] },
  ]);
  const pertama = select.blocks[0] as { defaultValues?: string[] };
  assert.deepEqual(pertama.defaultValues, ['900000000000000001'], 'ID tidak sah dibuang');
  assert.ok(
    select.dropped.some((alasan) => alasan.includes('select string')),
    'default_values pada select string dilaporkan',
  );
  const kedua = select.blocks[2] as { defaultValues?: string[] };
  assert.equal(kedua.defaultValues?.length, 1, 'single-select hanya menyimpan satu default');

  await repo.deleteCustomPost(GUILD, polos.id);
  await repo.deleteCustomPost(GUILD, denganPing.id);
});

await testAsync('pesan: riwayat versi & tautan berbagi', async () => {
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Versi awal',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Isi pertama' }],
    accent: '#5865f2',
  });

  // Penyimpanan PERTAMA tidak membuat revisi: tidak ada "sebelum" yang perlu
  // disimpan, dan revisi kosong hanya mengaburkan daftar.
  assert.equal((await repo.listPostRevisions(GUILD, post.id)).length, 0, 'belum ada versi lama');

  await repo.updateCustomPost(GUILD, post.id, { name: 'Versi kedua', blocks: [{ kind: 'text', value: 'Isi kedua' }] });
  const setelahDua = await repo.listPostRevisions(GUILD, post.id);
  assert.equal(setelahDua.length, 1, 'satu versi tersimpan');
  assert.equal(setelahDua[0]!.name, 'Versi awal', 'yang disimpan adalah isi SEBELUM diubah');
  assert.equal(
    (setelahDua[0]!.snapshot.blocks[0] as { value: string }).value,
    'Isi pertama',
    'isi lama ikut tersimpan',
  );

  await repo.updateCustomPost(GUILD, post.id, { name: 'Versi ketiga' });
  const setelahTiga = await repo.listPostRevisions(GUILD, post.id);
  assert.equal(setelahTiga.length, 2, 'dua versi');
  assert.equal(setelahTiga[0]!.name, 'Versi kedua', 'terbaru lebih dulu');

  // Kembalikan ke versi pertama. Versi "sekarang" harus ikut tersimpan,
  // sehingga mengembalikan versi lama bisa dibatalkan lagi.
  const kembali = await repo.restorePostRevision(GUILD, post.id, setelahTiga[1]!.id);
  assert.equal(kembali.post?.name, 'Versi awal', 'nama dikembalikan');
  assert.equal(
    (kembali.post?.blocks[0] as { value: string })?.value,
    'Isi pertama',
    'blok dikembalikan',
  );
  const setelahKembali = await repo.listPostRevisions(GUILD, post.id);
  assert.equal(setelahKembali.length, 3, 'versi sekarang tersimpan sebagai revisi baru');
  assert.ok(
    setelahKembali.some((satu) => satu.name === 'Versi ketiga'),
    'versi terbaru tidak hilang — bisa dibalik lagi',
  );

  // Versi yang tidak ada / milik pesan lain harus gagal, bukan mengembalikan
  // pesan kosong.
  const lain = await repo.createCustomPost(GUILD, {
    name: 'Pesan lain',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'x' }],
  });
  await repo.updateCustomPost(GUILD, lain.id, { name: 'Pesan lain v2' });
  const revisiLain = await repo.listPostRevisions(GUILD, lain.id);
  const salah = await repo.restorePostRevision(GUILD, post.id, revisiLain[0]!.id);
  assert.equal(salah.post, null, 'versi milik pesan lain ditolak');
  assert.ok(salah.error, 'alasan penolakan dijelaskan');

  const hantu = await repo.restorePostRevision(GUILD, post.id, 999999);
  assert.equal(hantu.post, null, 'versi yang tidak ada ditolak');

  /* --- tautan berbagi --- */
  const token = await repo.createPostShare(GUILD, post.id);
  assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(token), 'token aman dipakai di URL');
  assert.equal(await repo.createPostShare(GUILD, post.id), token, 'token yang sama dipakai ulang');

  const dibagikan = await repo.getSharedPost(token);
  assert.equal(dibagikan?.name, 'Versi awal', 'nama ikut dibagikan');
  assert.equal(
    (dibagikan?.blocks[0] as { value: string })?.value,
    'Isi pertama',
    'blok terbaru yang dibagikan',
  );

  /*
   * Yang dibagikan hanya blok & nama. Channel, messageId, dan daftar role
   * TIDAK boleh ikut — tautan ini bisa dibuka siapa saja yang memegangnya.
   */
  assert.equal('channelId' in (dibagikan as unknown as Record<string, unknown>), false, 'channel tidak ikut');
  assert.equal('messageId' in (dibagikan as unknown as Record<string, unknown>), false, 'id pesan tidak ikut');

  await repo.updateCustomPost(GUILD, post.id, { blocks: [{ kind: 'text', value: 'Isi terbaru' }] });
  assert.equal(
    ((await repo.getSharedPost(token))?.blocks[0] as { value: string })?.value,
    'Isi terbaru',
    'tautan selalu menampilkan isi terkini, bukan salinan beku',
  );

  // Token ngawur tidak membocorkan apa pun.
  assert.equal(await repo.getSharedPost('token-palsu-123'), null, 'token tidak dikenal = null');
  assert.equal(await repo.getSharedPost(''), null, 'token kosong = null');

  await repo.deletePostShare(GUILD, post.id);
  assert.equal(await repo.getSharedPost(token), null, 'tautan yang dicabut tidak bisa dibuka');

  /*
   * Halaman publik menyusun HTML dari isi pesan admin. Isi itu harus
   * di-escape, dan tombol hanya boleh jadi tautan kalau URL-nya http(s) —
   * URL javascript: akan membuat tautan berbahaya di halaman tanpa login.
   */
  const { sharePage } = await import('../src/web/ui/share.js');
  const halaman = sharePage({
    name: '<script>alert(1)</script>',
    blocks: [
      { kind: 'text', value: 'Halo **dunia** & <b>x</b>' },
      { kind: 'button', value: 'Klik', url: 'javascript:alert(1)' },
      { kind: 'button', value: 'Aman', url: 'https://example.com' },
    ] as never,
    notFound: false,
  });
  assert.equal(halaman.includes('<script>'), false, 'isi pesan tidak bisa menyelipkan script');
  assert.ok(halaman.includes('&lt;script&gt;'), 'tag ditampilkan sebagai teks');
  assert.ok(halaman.includes('<strong>dunia</strong>'), 'markdown tebal tetap dirender');
  assert.equal(halaman.includes('href="javascript:'), false, 'URL javascript: tidak jadi tautan');
  assert.ok(halaman.includes('href="https://example.com"'), 'URL http(s) tetap jadi tautan');
  assert.ok(
    halaman.includes('rel="noopener noreferrer nofollow"'),
    'tautan luar tidak membawa referrer & tidak diikuti mesin pencari',
  );
  const halaman404 = sharePage({ name: '', blocks: [], notFound: true });
  assert.ok(halaman404.includes('tidak berlaku lagi'), 'token mati dijelaskan, bukan halaman kosong');

  // Menghapus pesan ikut menghapus riwayat & tautannya (tidak ada baris yatim).
  await repo.deleteCustomPost(GUILD, post.id);
  assert.equal((await repo.listPostRevisions(GUILD, post.id)).length, 0, 'riwayat ikut terhapus');

  await repo.deleteCustomPost(GUILD, lain.id);
});

await testAsync('pesan: generator kode & payload JSON dari penyusun yang sama', async () => {
  const repo = await import('../src/db/repo.js');
  const { generateCodegen, quoteStr } = await import('../src/features/post-codegen.js');
  const { payloadUntukPesan } = await import('../src/features/custom-post-send.js');
  const GUILD = '123456789012345678';

  /* --- escaping: teks admin tidak boleh memutus kode yang dihasilkan --- */
  assert.equal(quoteStr('a"b'), '"a\\"b"', 'kutip ganda di-escape');
  assert.equal(quoteStr('baris\nbaru'), '"baris\\nbaru"', 'baris baru di-escape, bukan jadi kode rusak');
  assert.equal(quoteStr('kembali\\ke'), '"kembali\\\\ke"', 'garis miring di-escape');

  /* --- payload nyata dari database: builder -> JSON --- */
  const post = await repo.createCustomPost(GUILD, {
    name: 'Kode',
    channelId: '999',
    blocks: [
      { kind: 'container', accent: '#5865f2' },
      { kind: 'text', value: 'Halo "dunia"' },
      { kind: 'divider' },
      { kind: 'button', value: 'Buka', url: 'https://example.com' },
      { kind: 'close' },
    ],
  });
  await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Gamer', roleId: '900000000000000001', mode: 'toggle' },
  ]);

  const segar = await repo.getCustomPost(GUILD, post.id);
  const payload = await payloadUntukPesan(GUILD, segar!);
  assert.ok(payload, 'payload tersusun');
  const komponen = payload!.components as Array<Record<string, unknown>>;
  assert.equal(komponen.length, 1, 'satu container di tingkat atas');
  assert.equal(komponen[0]!.type, 17, 'container = tipe 17');
  // toJSON dipakai: hasilnya harus objek polos yang bisa ditempel ke REST API.
  assert.equal(typeof (komponen[0] as { toJSON?: unknown }).toJSON, 'undefined', 'bukan objek builder');

  const isi = komponen[0]!.components as Array<Record<string, unknown>>;
  const teks = isi.find((satu) => satu.type === 10)!;
  assert.equal(teks.content, 'Halo "dunia"', 'teks apa adanya');
  const semuaTombol = isi
    .filter((satu) => satu.type === 1)
    .flatMap((satu) => satu.components as Array<Record<string, unknown>>);
  // Tombol link admin & tombol role sama-sama ada; cari yang ber-customId bot.
  const tombolRole = semuaTombol.find((satu) => String(satu.custom_id ?? '').startsWith('post-role:'))!;
  assert.equal(tombolRole.style, 1, 'tombol role = Primary');
  assert.match(String(tombolRole.custom_id), /^post-role:\d+$/, 'customId tombol role memakai prefix bot');

  /* --- kode dari payload itu --- */
  const djs = generateCodegen(komponen, 'djs14');
  const kode = djs.code.join('\n');
  assert.ok(djs.imports.join('\n').includes('MessageFlags'), 'flag Components V2 ikut diimpor');
  assert.ok(kode.includes('new ContainerBuilder()'), 'container diterjemahkan');
  assert.ok(kode.includes('ButtonStyle.Primary'), 'gaya tombol diterjemahkan');
  assert.ok(kode.includes('\\"dunia\\"'), 'kutip di teks di-escape di kode');
  assert.ok(kode.includes('flags: MessageFlags.IsComponentsV2'), 'flag dikirim, bukan hanya diimpor');
  assert.equal(djs.dropped.length, 0, 'payload sah tidak ada yang dibuang');

  const py = generateCodegen(komponen, 'dpy2');
  const kodePy = py.code.join('\n');
  assert.ok(kodePy.includes('ui.Container('), 'discord.py memakai ui.Container');
  assert.ok(!kodePy.includes(',,'), 'tidak ada koma ganda');
  assert.ok(kodePy.includes('discord.ui.Button('), 'tombol role diterjemahkan');

  /*
   * Section dengan thumbnail & blok File: dua kasus yang mudah tertukar karena
   * nomor tipenya berdekatan (13 = Section, 15 = File).
   */
  const pelengkap = [
    {
      type: 13,
      components: [{ type: 10, content: 'Judul' }],
      accessory: { type: 11, media: { url: 'https://img.test/kecil.png' } },
    },
    { type: 15, file: { url: 'https://berkas.test/a.zip' }, spoiler: true },
  ];
  const djsLengkap = generateCodegen(pelengkap, 'djs14');
  const kodeLengkap = djsLengkap.code.join('\n');
  assert.equal(djsLengkap.dropped.length, 0, 'section & file dikenali, tidak dibuang');
  assert.ok(kodeLengkap.includes('setThumbnailAccessory'), 'thumbnail pada section diterjemahkan');
  assert.ok(kodeLengkap.includes('new FileBuilder()'), 'blok file diterjemahkan');
  assert.ok(kodeLengkap.includes('.setSpoiler(true)'), 'spoiler berkas ikut');

  const pyLengkap = generateCodegen(pelengkap, 'dpy2');
  const kodePyLengkap = pyLengkap.code.join('\n');
  assert.equal(pyLengkap.dropped.length, 0, 'discord.py mengenali section & file');
  assert.ok(kodePyLengkap.includes('ui.Thumbnail('), 'thumbnail discord.py diterjemahkan');
  assert.ok(kodePyLengkap.includes('ui.File('), 'berkas discord.py diterjemahkan');

  /* --- komponen tak dikenal dilaporkan, bukan hilang diam-diam --- */
  const asing = generateCodegen([{ type: 99 }], 'djs14');
  assert.equal(asing.dropped.length, 1, 'komponen asing dilaporkan');
  const kodeAsing = asing.code.join('\n');
  assert.ok(kodeAsing.includes('belum didukung'), 'alasan tampil di kode sebagai komentar');
  /*
   * Komentar harus gaya JavaScript dan berdiri sendiri: `.addComponents(# …)`
   * atau `# … ,` bukan kode yang bisa dijalankan.
   */
  assert.ok(kodeAsing.includes('// komponen tipe 99'), 'komentar memakai gaya JavaScript');
  assert.ok(!kodeAsing.includes('#'), 'tidak ada komentar gaya Python di kode JS');
  assert.ok(!/,\s*$/m.test(kodeAsing.split('//')[0] ?? ''), 'komentar tidak diberi koma');

  // Discord.py: komentar tetap `#`, dan juga tanpa koma.
  const asingPy = generateCodegen([{ type: 99 }], 'dpy2').code.join('\n');
  assert.ok(asingPy.includes('# komponen tipe 99'), 'discord.py memakai komentar #');
  assert.ok(!asingPy.includes('# komponen tipe 99 belum didukung generator kode — lihat JSON pesannya,'), 'komentar py tanpa koma');

  // Pesan tanpa komponen: penjelasan, bukan kode setengah jadi.
  const kosong = await repo.createCustomPost(GUILD, { name: 'Kosong', channelId: '999', blocks: [] });
  const kosongPayload = await payloadUntukPesan(GUILD, (await repo.getCustomPost(GUILD, kosong.id))!);
  assert.equal(kosongPayload, null, 'pesan tanpa komponen menghasilkan null, bukan payload kosong');

  await repo.deleteCustomPost(GUILD, post.id);
  await repo.deleteCustomPost(GUILD, kosong.id);
});

await testAsync('pesan: channel tambahan (targets[]) disaring & ID pesan dipertahankan', async () => {
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';
  const CH1 = '111111111111111111';
  const CH2 = '222222222222222222';

  const pesan = await repo.createCustomPost(GUILD, {
    name: 'Pengumuman',
    channelId: '999999999999999999',
    blocks: [{ kind: 'text', value: 'Halo semua' }],
  });

  /*
   * Penyaringan: hanya ID channel Discord (17-20 digit), tanpa duplikat, dan
   * dibatasi POST_TARGET_LIMITS.perPost. Tanpa ini, "channel" berisi nama atau
   * ID salah akan tersimpan dan baru gagal saat pengumuman dikirim.
   */
  const awal = await repo.replacePostTargets(GUILD, pesan.id, [
    CH1,
    CH1,
    'bukan-id',
    '',
    CH2,
  ]);
  assert.equal(awal.targets.length, 2, 'hanya dua channel sah yang disimpan');
  assert.equal(awal.targets[0]!.channelId, CH1, 'urutan dipertahankan');
  assert.equal(awal.targets[1]!.channelId, CH2, 'channel kedua ikut');
  assert.equal(awal.dropped.length, 3, 'tiga masukan dilaporkan (duplikat, bukan-id, kosong)');
  assert.ok(awal.dropped.some((satu) => satu.includes('dua kali')), 'duplikat disebut alasannya');
  assert.ok(awal.dropped.some((satu) => satu.includes('bukan ID channel')), 'nilai bukan ID ditolak');

  // ID pesan yang sudah terkirim dipertahankan saat daftar disimpan ulang.
  await repo.setPostTargetMessage(GUILD, pesan.id, CH1, '888888888888888888');
  const ulang = await repo.replacePostTargets(GUILD, pesan.id, [CH1, CH2]);
  assert.equal(ulang.targets[0]!.messageId, '888888888888888888', 'ID pesan lama tidak hilang');
  assert.equal(ulang.targets[1]!.messageId, null, 'channel baru belum punya ID pesan');

  // Menghapus channel dari daftar membuang barisnya, bukan menyisakan hantu.
  const sisa = await repo.replacePostTargets(GUILD, pesan.id, [CH2]);
  assert.equal(sisa.targets.length, 1, 'hanya channel yang dikirim yang tersimpan');
  assert.equal(sisa.targets[0]!.channelId, CH2, 'channel yang tersisa benar');

  // Batas jumlah channel tambahan ditegakkan di repo, bukan hanya di dashboard.
  // 18 digit: '30' + 16 digit nomor, supaya tiap ID unik dan sah.
  const banyak = Array.from({ length: 8 }, (_, i) => `30${String(i).padStart(16, '0')}`);
  const dibatasi = await repo.replacePostTargets(GUILD, pesan.id, banyak);
  assert.equal(dibatasi.targets.length, repo.POST_TARGET_LIMITS.perPost, 'dipotong sesuai batas');
  assert.ok(dibatasi.dropped.some((satu) => satu.includes('dibatasi')), 'pemotongan dilaporkan');

  /*
   * Menghapus pesan harus menghapus tujuan tambahannya: baris yang tertinggal
   * akan dikirimi lagi kalau ID pesannya dipakai ulang.
   */
  await repo.deleteCustomPost(GUILD, pesan.id);
  assert.equal((await repo.listPostTargets(GUILD, pesan.id)).length, 0, 'target ikut terhapus');
});

await testAsync('pesan: embed klasik dibangun dari blok & aturannya dijaga', async () => {
  const { buildClassicEmbed, validateEmbed, warnaDari } = await import('../src/features/post-embed.js');
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';

  /* Warna: hanya #rrggbb yang diterima; nilai lain = tanpa warna embed. */
  assert.equal(warnaDari('#5865f2'), 0x5865f2, 'hex enam digit dibaca');
  assert.equal(warnaDari('5865f2'), 0x5865f2, 'tanpa pagar tetap dibaca');
  assert.equal(warnaDari('#fff'), null, 'hex pendek ditolak, bukan ditebak');
  assert.equal(warnaDari(null), null, 'kosong = tanpa warna');

  const blok = [
    { kind: 'container', accent: '#ffffff' },
    { kind: 'text', value: 'Baris pertama' },
    { kind: 'text', value: 'Baris kedua' },
    { kind: 'divider' },
    { kind: 'image', value: 'https://img.test/utama.png' },
    { kind: 'image', value: 'https://img.test/kedua.png' },
    { kind: 'button', value: 'Buka', url: 'https://x.test' },
    { kind: 'file', value: 'https://x.test/a.pdf' },
    { kind: 'close' },
  ];
  const hasil = buildClassicEmbed(blok, { accent: '#5865f2', title: 'Pengumuman' })!;
  assert.ok(hasil, 'embed terbentuk');
  assert.equal(hasil.embed.title, 'Pengumuman', 'judul dari nama pesan');
  assert.equal(hasil.embed.color, 0x5865f2, 'warna dari aksen');
  assert.ok(hasil.embed.description!.includes('Baris pertama'), 'teks masuk keterangan');
  assert.ok(hasil.embed.description!.includes('Baris kedua'), 'semua teks ikut, bukan hanya yang pertama');
  assert.equal(hasil.embed.image!.url, 'https://img.test/utama.png', 'gambar pertama dipakai');
  /*
   * Embed hanya punya satu gambar. Menimpa diam-diam akan menghilangkan pilihan
   * admin, jadi gambar kedua dilaporkan sebagai bagian yang tidak muat.
   */
  assert.ok(
    hasil.dropped.some((satu) => satu.includes('gambar kedua')),
    'gambar kedua dilaporkan, bukan ditelan',
  );
  assert.ok(hasil.dropped.some((satu) => satu.includes('tombol')), 'tombol dijelaskan ada di luar embed');
  assert.equal(validateEmbed(hasil.embed).length, 0, 'embed yang dibangun lolos validasi');

  /* Tanpa isi = null, supaya pemanggil memberi tahu admin alih-alih mengirim kosong. */
  assert.equal(buildClassicEmbed([{ kind: 'container' }, { kind: 'close' }]), null, 'kosong = null');
  assert.equal(buildClassicEmbed([{ kind: 'text', value: '   ' }]), null, 'spasi saja = kosong');

  /* Validasi menolak yang akan ditolak Discord, dengan alasan yang bisa dibaca. */
  const kepanjangan = validateEmbed({ description: 'x'.repeat(5000) });
  assert.ok(kepanjangan.some((satu) => satu.includes('4096')), 'batas isi embed disebut angkanya');
  const tanpaIsi = validateEmbed({});
  assert.ok(tanpaIsi.some((satu) => satu.includes('tidak punya isi')), 'embed kosong ditolak');

  /*
   * Layout disimpan per pesan & nilai asing jatuh ke container: pesan lama tidak
   * boleh tiba-tiba berubah bentuk hanya karena kolomnya ada.
   */
  assert.equal(repo.parseLayout('embed'), 'embed', 'embed dikenali');
  assert.equal(repo.parseLayout('container'), 'container', 'container dikenali');
  assert.equal(repo.parseLayout(null), 'container', 'kosong = container (perilaku lama)');
  assert.equal(repo.parseLayout('klasik'), 'container', 'nilai asing tidak diteruskan');

  const pesan = await repo.createCustomPost(GUILD, {
    name: 'Embed uji',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Halo' }],
    layout: 'embed',
  });
  assert.equal(pesan.layout, 'embed', 'layout tersimpan saat dibuat');
  const diubah = await repo.updateCustomPost(GUILD, pesan.id, { layout: 'container' });
  assert.equal(diubah!.layout, 'container', 'layout bisa diubah');
  const lain = await repo.updateCustomPost(GUILD, pesan.id, { name: 'Embed uji 2' });
  assert.equal(lain!.layout, 'container', 'menyimpan field lain tidak mengubah layout');
  await repo.deleteCustomPost(GUILD, pesan.id);
});

await testAsync('pesan: pemicu member masuk/keluar tersimpan & dijalankan hanya untuk pemicunya', async () => {
  const repo = await import('../src/db/repo.js');
  const { runTriggers } = await import('../src/features/post-trigger.js');
  const GUILD = '123456789012345678';

  /* Nilai asing dibaca sebagai "hanya manual", bukan diteruskan apa adanya. */
  assert.equal(repo.parseTrigger('member_add'), 'member_add', 'nilai sah diterima');
  assert.equal(repo.parseTrigger('member_remove'), 'member_remove', 'pemicu keluar diterima');
  assert.equal(repo.parseTrigger('member_join'), null, 'nama pemicu yang salah tidak diteruskan');
  assert.equal(repo.parseTrigger(''), null, 'kosong = manual');
  assert.equal(repo.parseTrigger(null), null, 'null = manual');

  const blok = [{ kind: 'text', value: 'Selamat datang!' }];
  const masuk = await repo.createCustomPost(GUILD, {
    name: 'Sambutan pemicu',
    channelId: '999',
    blocks: blok,
    trigger: 'member_add',
  });
  const keluar = await repo.createCustomPost(GUILD, {
    name: 'Perpisahan pemicu',
    channelId: '999',
    blocks: blok,
    trigger: 'member_remove',
  });
  const manual = await repo.createCustomPost(GUILD, { name: 'Manual', channelId: '999', blocks: blok });

  assert.equal(masuk.trigger, 'member_add', 'pemicu tersimpan saat dibuat');
  assert.equal(manual.trigger, null, 'tanpa pemicu = manual (pesan lama tidak berubah perilaku)');

  /*
   * Pemisahan per pemicu: memasang pesan "member masuk" tidak boleh membuatnya
   * ikut terkirim saat ada yang keluar.
   */
  const daftarMasuk = await repo.listPostsByTrigger(GUILD, 'member_add');
  assert.equal(daftarMasuk.length, 1, 'hanya pesan ber-pemicu member_add');
  assert.equal(daftarMasuk[0]!.name, 'Sambutan pemicu', 'pesan yang benar');
  assert.ok(!daftarMasuk.some((satu) => satu.id === keluar.id), 'pesan member_remove tidak ikut');

  /* Mengubah pemicu jadi kosong mematikan kirim otomatis. */
  const dimatikan = await repo.updateCustomPost(GUILD, masuk.id, { trigger: null });
  assert.equal(dimatikan!.trigger, null, 'pemicu bisa dimatikan');
  assert.equal((await repo.listPostsByTrigger(GUILD, 'member_add')).length, 0, 'tidak lagi terdaftar');
  /* Menyimpan field lain tidak boleh menghapus pemicu yang sedang aktif. */
  const tanpaPerubahan = await repo.updateCustomPost(GUILD, keluar.id, { name: 'Perpisahan pemicu 2' });
  assert.equal(tanpaPerubahan!.trigger, 'member_remove', 'pemicu bertahan saat field lain diubah');

  /*
   * Pesan ber-pemicu TANPA channel tujuan: harus dilaporkan sebagai kegagalan
   * beralasan, bukan dilewati diam-diam dan bukan melempar sampai event mati.
   * Jalur ini juga tidak menyentuh Discord, jadi bisa diuji tanpa client asli.
   */
  const tanpaChannel = await repo.createCustomPost(GUILD, {
    name: 'Belum ada channel',
    channelId: null,
    blocks: blok,
    trigger: 'member_add',
  });
  const hasil = await runTriggers({
    client: {} as never,
    guildId: GUILD,
    trigger: 'member_add',
  });
  assert.equal(hasil.terkirim, 0, 'tidak ada yang bisa dikirim');
  assert.equal(hasil.gagal.length, 1, 'kegagalan dilaporkan');
  assert.ok(hasil.gagal[0]!.includes('Belum ada channel'), 'pesan yang bermasalah disebut namanya');
  assert.ok(hasil.gagal[0]!.includes('channel'), 'alasannya jelas: channel belum dipilih');

  for (const pesan of [keluar, manual, tanpaChannel]) {
    await repo.deleteCustomPost(GUILD, pesan.id);
  }
});

await testAsync('multi-pesan: rujukan, urutan kirim, & dokumen tersimpan', async () => {
  const series = await import('../src/features/post-series.js');

  // Rujukan ke pesan yang tidak ada dibuang — kalau tidak, pengiriman gagal
  // di tengah rangkaian (pesan pertama terkirim, sisanya tidak).
  const bersih = series.sanitizeSeries([
    { id: 'a', name: 'Pembuka', blocks: [{ kind: 'text', value: 'Halo' }] },
    {
      id: 'b',
      name: 'Isi',
      blocks: [{ kind: 'text', value: 'Isi kedua' }],
      reference: 'a',
      threadName: 'Diskusi',
    },
    { id: 'c', name: 'Hilang', blocks: [{ kind: 'text', value: 'x' }], reference: 'tidak-ada' },
  ]);
  /*
   * Pesan yang rujukannya mati TETAP disimpan, hanya rujukannya yang dilepas:
   * isi pesan sudah disusun admin, dan membuang seluruh pesan karena satu
   * rujukan salah akan menghilangkan bagian cerita yang sah.
   */
  assert.equal(bersih.messages.length, 3, 'ketiga pesan tetap ada');
  assert.equal(bersih.messages[2]!.reference, undefined, 'rujukan mati dilepas');
  assert.equal(bersih.messages[1]!.reference, 'a', 'rujukan yang sah dipertahankan');
  assert.equal(bersih.messages[1]!.threadName, 'Diskusi');
  assert.equal(bersih.messages[0]!.reference, undefined, 'tanpa rujukan = pesan biasa');
  assert.equal(
    (bersih.messages[0]!.blocks[0] as { value: string }).value,
    'Halo',
    'blok dibersihkan tapi isinya tetap',
  );
  assert.ok(
    bersih.dropped.some((alasan) => alasan.includes('tidak ada di dokumen')),
    'rujukan mati dilaporkan',
  );

  // ID wajib unik & aman: ID ganda membuat rujukan menunjuk pesan yang salah.
  const ganda = series.sanitizeSeries([
    { id: 'a', blocks: [{ kind: 'text', value: '1' }] },
    { id: 'a', blocks: [{ kind: 'text', value: '2' }] },
    { id: 'spasi salah', blocks: [{ kind: 'text', value: '3' }] },
  ]);
  assert.equal(ganda.messages.length, 1, 'ID ganda & ID tidak sah dibuang');
  assert.equal(ganda.dropped.length, 2);

  // Pesan kosong & pesan yang membalas dirinya sendiri.
  const kosong = series.sanitizeSeries([
    { id: 'a', blocks: [] },
    { id: 'b', blocks: [{ kind: 'text', value: 'isi' }], reference: 'b' },
  ]);
  assert.equal(kosong.messages.length, 1);
  assert.equal(kosong.messages[0]!.reference, undefined, 'membalas diri sendiri dilepas');
  assert.ok(kosong.dropped.some((alasan) => alasan.includes('kosong')));
  assert.ok(kosong.dropped.some((alasan) => alasan.includes('dirinya sendiri')));

  /*
   * Urutan: pesan yang membalas HARUS dikirim sesudah yang dibalas, walau
   * urutan di dokumen terbalik. Tanpa ini, pesan kedua akan menunggu induk
   * yang belum ada dan terkirim tanpa rujukan.
   */
  const terbalik = series.resolveSendOrder([
    { id: 'b', name: 'Balasan', blocks: [], reference: 'a' },
    { id: 'a', name: 'Induk', blocks: [] },
  ]);
  assert.deepEqual(terbalik.ordered.map((satu) => satu.id).join(','), 'a,b', 'induk dikirim lebih dulu');
  assert.equal(terbalik.warnings.length, 0);

  // Urutan yang sudah benar TIDAK diubah: admin menyusun cerita, bukan urutan acak.
  const wajar = series.resolveSendOrder([
    { id: 'a', name: '1', blocks: [] },
    { id: 'b', name: '2', blocks: [], reference: 'a' },
    { id: 'c', name: '3', blocks: [] },
  ]);
  assert.deepEqual(wajar.ordered.map((satu) => satu.id).join(','), 'a,b,c');

  // Rujukan melingkar tidak mungkin dikirim; dilepas & dilaporkan.
  const melingkar = series.sanitizeSeries([
    { id: 'a', blocks: [{ kind: 'text', value: '1' }], reference: 'b' },
    { id: 'b', blocks: [{ kind: 'text', value: '2' }], reference: 'a' },
  ]);
  assert.equal(melingkar.messages.length, 2);
  assert.equal(melingkar.messages[0]!.reference, undefined, 'rujukan melingkar dilepas');
  assert.ok(melingkar.dropped.some((alasan) => alasan.includes('melingkar')));

  // Ringkasan & penanda rangkaian.
  assert.equal(series.describeSeries([]), 'belum ada pesan');
  assert.equal(
    series.describeSeries([
      { id: 'a', name: '1', blocks: [] },
      { id: 'b', name: '2', blocks: [], reference: 'a', threadName: 'T' },
    ]),
    '2 pesan · 1 berbalas · 1 thread',
  );
  assert.equal(series.hasReferences([{ id: 'a', name: '1', blocks: [] }]), false);
  assert.equal(series.hasReferences([{ id: 'a', name: '1', blocks: [], reference: 'b' }]), true);

  /* --- Dokumen tersimpan (database) --- */
  const repo = await import('../src/db/repo.js');
  const GUILD = '123456789012345678';
  const disimpan = await repo.savePostDocument(GUILD, {
    name: 'Pengumuman berurutan',
    series: true,
    messages: [
      { id: 'p1', name: 'Pembuka', blocks: [{ kind: 'text', value: 'Halo' }] },
      { id: 'p2', name: 'Isi', blocks: [{ kind: 'text', value: 'Kedua' }], reference: 'p1' },
    ],
  });
  assert.ok(disimpan, 'dokumen tersimpan');
  assert.equal(disimpan!.document.series, true);
  assert.equal(disimpan!.document.messages.length, 2);

  const dibaca = await repo.getPostDocument(GUILD, disimpan!.document.id);
  assert.equal(dibaca?.messages[1]!.reference, 'p1', 'rujukan bertahan di database');

  // Diperbarui: ID sama, isi baru.
  const diperbarui = await repo.savePostDocument(GUILD, {
    id: disimpan!.document.id,
    name: 'Setelah diperbarui',
    series: false,
    messages: [{ id: 'p1', name: 'Tunggal', blocks: [{ kind: 'text', value: 'Baru' }] }],
  });
  assert.equal(diperbarui!.document.id, disimpan!.document.id, 'memperbarui, bukan membuat baru');
  assert.equal(diperbarui!.document.series, false);
  assert.equal(diperbarui!.document.messages.length, 1);

  // Dokumen tidak sah tidak menghapus data lama (nama kosong tetap disimpan
  // dengan nama cadangan, bukan melempar).
  const tanpaPesan = await repo.savePostDocument(GUILD, { name: '', series: false, messages: [] });
  assert.ok(tanpaPesan, 'dokumen kosong tetap bisa disimpan (untuk disusun bertahap)');
  assert.equal(tanpaPesan!.document.messages.length, 0);
  assert.equal(tanpaPesan!.document.name, 'Dokumen', 'nama kosong memakai cadangan');

  await repo.deletePostDocument(GUILD, disimpan!.document.id);
  assert.equal(await repo.getPostDocument(GUILD, disimpan!.document.id), null, 'dokumen terhapus');
  await repo.deletePostDocument(GUILD, tanpaPesan!.document.id);
});

await testAsync('flow: syarat bertingkat dijalankan lewat cabang nyata', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Syarat bertingkat',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });
  const tombol = await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Pilih', roleId: '900000000000000001', mode: 'toggle' },
  ]);
  const buttonId = tombol.buttons[0]!.id;

  const balasan: string[] = [];
  const jalankan = async (values?: string[]) => {
    const interaction = {
      customId: `post-role:${buttonId}`,
      guildId: GUILD,
      channelId: '999',
      deferred: false,
      replied: false,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      ...(values ? { values } : {}),
      member: {
        displayName: 'Wahyu',
        roles: { cache: { has: () => false }, highest: { position: 20 } },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: { cache: new Map(), fetch: async () => null },
        members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
      },
      reply: async (payload: { content: string }) => void balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void balasan.push(payload.content),
    };
    return runComponentActions({
      client: {} as never,
      interaction: interaction as never,
      target: `button:${buttonId}`,
      postId: post.id,
    });
  };

  /*
   * Syarat gabungan: (nama = "Wahyu" DAN selected termasuk [gamer, anime]).
   * Yang diuji bukan hanya "cocok/tidak", tetapi bahwa aksi cabang benar-benar
   * DIJALANKAN berdasarkan hasil pohonnya.
   */
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      {
        kind: 'condition',
        check: {
          type: 'and',
          items: [
            { type: 'leaf', value: 'member.name', comparator: 'equals', expected: 'Wahyu' },
            { type: 'in', value: 'selected', list: ['gamer', 'anime'] },
          ],
        },
        then: [{ kind: 'reply', text: 'masuk gamer' }],
        else: [{ kind: 'reply', text: 'bukan gamer' }],
      },
    ],
  });

  await jalankan(['gamer']);
  assert.deepEqual(balasan, ['masuk gamer'], 'pohon `and` + `in` benar-benar dievaluasi');

  balasan.length = 0;
  await jalankan(['film']);
  assert.deepEqual(balasan, ['bukan gamer'], 'nilai di luar daftar masuk cabang lain');

  /*
   * `not` = semua anak salah. Dengan satu syarat di dalamnya, ini berarti
   * "bukan X" — cara yang sama dipakai admin untuk menulis negasi.
   */
  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      {
        kind: 'condition',
        check: { type: 'not', items: [{ type: 'leaf', value: 'member.name', comparator: 'equals', expected: 'Orang Lain' }] },
        then: [{ kind: 'reply', text: 'bukan orang lain' }],
      },
    ],
  });
  await jalankan();
  assert.deepEqual(balasan, ['bukan orang lain'], '`not` menjalankan cabang saat anaknya salah');
});

await testAsync('aksi: teks mentah benar-benar terkirim & hapus bertarget jalan', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Teks mentah',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });
  const tombol = await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Mulai', roleId: '900000000000000001', mode: 'toggle' },
  ]);
  const buttonId = tombol.buttons[0]!.id;

  const balasan: string[] = [];
  const terkirim: Array<{ content: string }> = [];
  const dihapus: string[] = [];
  const pesanTerkirim = { id: 'pesan-baru', delete: async () => void dihapus.push('pesan-baru') };

  const jalankan = async (opsi: { pesanPemicu?: boolean } = {}) => {
    const interaction = {
      customId: `post-role:${buttonId}`,
      guildId: GUILD,
      channelId: '999',
      deferred: false,
      replied: false,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      member: {
        displayName: 'Wahyu',
        roles: { cache: { has: () => false }, highest: { position: 20 } },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: { cache: new Map(), fetch: async () => null },
        members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
      },
      ...(opsi.pesanPemicu
        ? { message: { id: 'pesan-pemicu', delete: async () => void dihapus.push('pesan-pemicu') } }
        : {}),
      reply: async (payload: { content: string }) => void balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void balasan.push(payload.content),
    };
    const client = {
      channels: {
        fetch: async () => ({
          id: '999',
          isTextBased: () => true,
          send: async (payload: { content: string }) => {
            terkirim.push(payload);
            return pesanTerkirim;
          },
          messages: { fetch: async () => pesanTerkirim },
        }),
      },
    };
    return runComponentActions({
      client: client as never,
      interaction: interaction as never,
      target: `button:${buttonId}`,
      postId: post.id,
    });
  };

  /* --- teks mentah: templat terisi & benar-benar dikirim --- */
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [{ kind: 'raw', rawText: 'Halo {member.name} di {server.name}' }],
  });
  await jalankan();
  assert.equal(terkirim.length, 1, 'teks mentah dikirim satu kali');
  assert.equal(terkirim[0]!.content, 'Halo Wahyu di Server Uji', 'templat terisi sebelum dikirim');

  /* --- hapus pesan hasil aksi sebelumnya --- */
  terkirim.length = 0;
  dihapus.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'raw', rawText: 'Pesan sementara' },
      { kind: 'delete', what: 'sebelumnya' },
    ],
  });
  await jalankan();
  assert.equal(terkirim.length, 1, 'pesan tetap terkirim dulu');
  assert.deepEqual(dihapus, ['pesan-baru'], 'pesan hasil aksi sebelumnya yang dihapus, bukan pesan pemicu');

  /* --- tidak ada yang bisa dihapus: dilaporkan, bukan diam --- */
  dihapus.length = 0;
  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [{ kind: 'delete', what: 'sebelumnya' }],
  });
  await jalankan();
  assert.equal(dihapus.length, 0, 'tidak ada pesan yang dihapus');
  assert.ok(
    balasan.some((teks) => teks.includes('Tidak ada pesan dari aksi sebelumnya')),
    'pengklik diberi tahu, bukan dibiarkan menebak',
  );

  /* --- hapus pesan pemicu tetap seperti sebelumnya --- */
  balasan.length = 0;
  dihapus.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [{ kind: 'delete', what: 'pesan' }],
  });
  await jalankan({ pesanPemicu: true });
  assert.deepEqual(dihapus, ['pesan-pemicu'], 'sasaran `pesan` menghapus pesan pemilik komponen');

  await repo.deleteCustomPost(GUILD, post.id);
});

await testAsync('flow: cabang dijalankan, lalu flow lanjut — bukan berhenti', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Cabang',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });
  const tombol = await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Cek', roleId: '900000000000000001', mode: 'toggle' },
  ]);
  const buttonId = tombol.buttons[0]!.id;

  const balasan: string[] = [];
  const jalankan = async () => {
    const interaction = {
      customId: `post-role:${buttonId}`,
      guildId: GUILD,
      channelId: '999',
      deferred: false,
      replied: false,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      member: {
        displayName: 'Wahyu',
        roles: { cache: { has: () => false }, highest: { position: 20 } },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: { cache: new Map(), fetch: async () => null },
        members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
      },
      reply: async (payload: { content: string }) => void balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void balasan.push(payload.content),
    };
    return runComponentActions({
      client: {} as never,
      interaction: interaction as never,
      target: `button:${buttonId}`,
      postId: post.id,
    });
  };

  /*
   * Cabang yang COCOK: aksi di dalam cabang jalan, lalu aksi SESUDAH syarat
   * juga jalan. Dulu syarat yang cocok hanya "lolos", dan cabangnya tidak ada.
   */
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      {
        kind: 'condition',
        value: 'member.name',
        comparator: 'equals',
        expected: 'Wahyu',
        then: [{ kind: 'variable', name: 'jalur', value: 'cocok' }],
        else: [{ kind: 'variable', name: 'jalur', value: 'lain' }],
      },
      { kind: 'reply', text: 'jalur={var.jalur}' },
    ],
  });
  await jalankan();
  assert.deepEqual(balasan, ['jalur=cocok'], 'cabang cocok dipakai, flow lanjut');

  // Cabang yang TIDAK cocok: cabang lain dipakai, flow tetap lanjut.
  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      {
        kind: 'condition',
        value: 'member.name',
        comparator: 'equals',
        expected: 'Orang Lain',
        then: [{ kind: 'variable', name: 'jalur', value: 'cocok' }],
        else: [{ kind: 'variable', name: 'jalur', value: 'lain' }],
      },
      { kind: 'reply', text: 'jalur={var.jalur}' },
    ],
  });
  await jalankan();
  assert.deepEqual(balasan, ['jalur=lain'], 'cabang "tidak cocok" dipakai');

  // Cabang kosong: tidak berhenti, lanjut seperti biasa (Check tanpa isi).
  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'condition', value: 'member.name', comparator: 'equals', expected: 'Wahyu', then: [{ kind: 'dud' }] },
      { kind: 'reply', text: 'lanjut' },
    ],
  });
  await jalankan();
  assert.deepEqual(balasan, ['lanjut'], 'cabang berisi "tanpa aksi" tetap melanjutkan flow');

  // Stop: berhenti dengan pesan sendiri, sisa aksi tidak jalan.
  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      { kind: 'stop', stopMessage: 'Berhenti di sini, {member.name}.' },
      { kind: 'reply', text: 'TIDAK BOLEH' },
    ],
  });
  await jalankan();
  assert.deepEqual(balasan, ['Berhenti di sini, Wahyu.'], 'stop memakai pesan sendiri & menghentikan sisa');
});

await testAsync('flow: tunggu di dalam cabang menyimpan sisa cabang DAN sisa flow', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions, resumeFlowSession } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Tunggu di cabang',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });
  const tombol = await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Mulai', roleId: '900000000000000001', mode: 'toggle' },
  ]);
  const buttonId = tombol.buttons[0]!.id;

  const balasan: string[] = [];
  const interaction = {
    customId: `post-role:${buttonId}`,
    guildId: GUILD,
    channelId: '999',
    message: { id: '555' },
    deferred: false,
    replied: false,
    user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
    member: {
      displayName: 'Wahyu',
      roles: { cache: { has: () => false }, highest: { position: 20 } },
      permissions: { has: () => true },
    },
    guild: {
      id: GUILD,
      name: 'Server Uji',
      roles: { cache: new Map(), fetch: async () => null },
      members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
    },
    reply: async (payload: { content: string }) => void balasan.push(payload.content),
    followUp: async (payload: { content: string }) => void balasan.push(payload.content),
  };

  /*
   * Penantian berada DI DALAM cabang. Yang harus tersimpan bukan hanya sisa
   * cabang, melainkan juga aksi SESUDAH syarat — dulu cabang dijalankan lewat
   * rekursi, `pending` hanya berisi sisa cabang, dan sapaan sesudah syarat
   * hilang selamanya begitu bot restart.
   */
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      {
        kind: 'condition',
        value: 'member.name',
        comparator: 'equals',
        expected: 'Wahyu',
        then: [
          { kind: 'variable', name: 'jalur', value: 'cocok' },
          { kind: 'wait', seconds: 600 },
          { kind: 'reply', text: 'di dalam cabang' },
        ],
      },
      { kind: 'reply', text: 'sesudah syarat ({var.jalur})' },
    ],
  });

  await runComponentActions({
    client: {} as never,
    interaction: interaction as never,
    target: `button:${buttonId}`,
    postId: post.id,
  });
  assert.equal(balasan.length, 1, 'hanya pemberitahuan penantian yang dikirim sekarang');
  assert.match(balasan[0]!, /10 menit/, 'durasi penantian dijelaskan');

  const sesi = (await repo.listDueFlowSessions(Date.now() + 60 * 60 * 1000)).filter((s) => s.postId === post.id);
  assert.equal(sesi.length, 1, 'sesi tersimpan');
  const sisa = sesi[0]!.steps as Array<{ kind: string; text?: string }>;
  assert.deepEqual(
    sisa.map((s) => s.kind),
    ['reply', 'reply'],
    'sisa cabang DAN sisa flow sesudah syarat ikut tersimpan',
  );
  assert.equal(sisa[0]!.text, 'di dalam cabang', 'urutan: cabang dulu');
  assert.equal(sisa[1]!.text, 'sesudah syarat ({var.jalur})', 'baru kemudian aksi sesudah syarat');
  assert.equal(sesi[0]!.variables.jalur, 'cocok', 'variabel dari dalam cabang tersimpan');

  /* --- lanjutan: timer mengirim dua sapaan itu, berurutan --- */
  const balasanTimer: string[] = [];
  const client = {
    guilds: { fetch: async () => ({ id: GUILD, members: { fetch: async () => ({ user: { tag: 'uji#0001' }, roles: { cache: { has: () => false }, highest: { position: 20 } }, permissions: { has: () => true } }) } }) },
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (p: { content: string }) => void balasanTimer.push(p.content) }) },
  };
  await resumeFlowSession(client as never, sesi[0]!);
  assert.deepEqual(
    balasanTimer,
    ['di dalam cabang', 'sesudah syarat (cocok)'],
    'sesudah penantian, cabang dan sisa flow sama-sama dijalankan',
  );
});

await testAsync('flow: cabang bertingkat tiga & stop di dalam cabang menghentikan seluruh flow', async () => {
  const repo = await import('../src/db/repo.js');
  const { runComponentActions } = await import('../src/features/post-action-runner.js');
  const GUILD = '123456789012345678';

  const post = await repo.createCustomPost(GUILD, {
    name: 'Cabang bertingkat',
    channelId: '999',
    blocks: [{ kind: 'text', value: 'Klik' }],
  });
  const tombol = await repo.replaceRoleButtons(GUILD, post.id, [
    { label: 'Pilih jalur', roleId: '900000000000000001', mode: 'toggle' },
  ]);
  const buttonId = tombol.buttons[0]!.id;

  const balasan: string[] = [];
  const jalankan = async (values?: string[]) => {
    const interaction = {
      customId: `post-role:${buttonId}`,
      guildId: GUILD,
      channelId: '999',
      deferred: false,
      replied: false,
      user: { id: '2', username: 'wahyu', globalName: 'Wahyu', tag: 'uji#0001' },
      ...(values ? { values } : {}),
      member: {
        displayName: 'Wahyu',
        roles: { cache: { has: () => false }, highest: { position: 20 } },
        permissions: { has: () => true },
      },
      guild: {
        id: GUILD,
        name: 'Server Uji',
        roles: { cache: new Map(), fetch: async () => null },
        members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetchMe: async () => null },
      },
      reply: async (payload: { content: string }) => void balasan.push(payload.content),
      followUp: async (payload: { content: string }) => void balasan.push(payload.content),
    };
    return runComponentActions({
      client: {} as never,
      interaction: interaction as never,
      target: `button:${buttonId}`,
      postId: post.id,
    });
  };

  /*
   * Tiga tingkat sarang, masing-masing memilih cabang yang berbeda. Yang
   * dibuktikan: cabang tingkat paling dalam benar-benar dijalankan, dan aksi
   * sesudah syarat TERLUAR tetap jalan sesudah semua cabang selesai (bukti
   * bahwa cabang disisipkan ke satu daftar kerja, bukan dijalankan terpisah).
   */
  const bertingkat = (pilihan: string) => [
    {
      kind: 'condition',
      value: 'selected',
      comparator: 'equals',
      expected: 'gamer',
      then: [
        {
          kind: 'condition',
          value: 'member.name',
          comparator: 'equals',
          expected: 'Wahyu',
          then: [
            {
              kind: 'condition',
              value: 'selected',
              comparator: 'equals',
              expected: pilihan,
              then: [{ kind: 'reply', text: 'paling dalam: ' + pilihan }],
              else: [{ kind: 'reply', text: 'bukan ' + pilihan }],
            },
          ],
        },
      ],
      else: [{ kind: 'reply', text: 'bukan gamer' }],
    },
    { kind: 'reply', text: 'sesudah semua cabang' },
  ];

  await repo.replacePostActions(GUILD, post.id, { [`button:${buttonId}`]: bertingkat('gamer') });
  await jalankan(['gamer']);
  /*
   * Hanya SATU balasan per interaksi (aturan Discord), jadi balasan kedua
   * dilaporkan sebagai follow-up: di sini keduanya tercatat, yang penting
   * urutannya benar.
   */
  assert.deepEqual(
    balasan,
    ['paling dalam: gamer', 'sesudah semua cabang'],
    'tiga tingkat cabang jalan, lalu lanjut ke aksi sesudah syarat terluar',
  );

  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, { [`button:${buttonId}`]: bertingkat('anime') });
  await jalankan(['gamer']);
  assert.deepEqual(balasan, ['bukan anime', 'sesudah semua cabang'], 'cabang tingkat tiga memilih jalur "tidak cocok"');

  // Berhenti di cabang DALAM: sisa flow di luar cabang juga tidak dijalankan.
  balasan.length = 0;
  await repo.replacePostActions(GUILD, post.id, {
    [`button:${buttonId}`]: [
      {
        kind: 'condition',
        value: 'member.name',
        comparator: 'equals',
        expected: 'Wahyu',
        then: [{ kind: 'stop', stopMessage: 'berhenti di dalam' }],
      },
      { kind: 'reply', text: 'TIDAK BOLEH' },
    ],
  });
  await jalankan();
  assert.deepEqual(balasan, ['berhenti di dalam'], 'stop di cabang menghentikan seluruh flow');
});

await testAsync('pesan: flag pesan disaring & digabung dengan flag Components V2', async () => {
  const { sanitizeMessageFlags, describeMessageFlags, MESSAGE_FLAGS, buildPostPayload, sanitizeBlocks } =
    await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SectionBuilder: d.SectionBuilder,
    ThumbnailBuilder: d.ThumbnailBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    StringSelectMenuBuilder: d.StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder: d.StringSelectMenuOptionBuilder,
    UserSelectMenuBuilder: d.UserSelectMenuBuilder,
    RoleSelectMenuBuilder: d.RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder: d.MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder: d.ChannelSelectMenuBuilder,
  };

  assert.equal(sanitizeMessageFlags(4 | 4096), 4 | 4096, 'dua flag sah dipertahankan');
  assert.equal(sanitizeMessageFlags(4 | 1), 4, 'flag asing (1) dibuang');
  assert.equal(sanitizeMessageFlags('bukan angka'), 0);
  assert.equal(sanitizeMessageFlags(0), 0);
  assert.deepEqual(describeMessageFlags(4 | 4096), ['tanpa kartu embed', 'tanpa notifikasi']);
  assert.equal(MESSAGE_FLAGS.suppressEmbeds, 1 << 2);
  assert.equal(MESSAGE_FLAGS.suppressNotifications, 1 << 12);

  // Flag never removes the Components V2 bit (1<<15) that the payload needs.
  const blok = sanitizeBlocks([{ kind: 'container' }, { kind: 'text', value: 'Hai' }]).blocks;
  const built = buildPostPayload(blok, deps);
  const flagsV2 = built!.flags;
  assert.ok(flagsV2 & (1 << 15), 'payload memakai flag Components V2');
  // Penggabungan terjadi di pengirim; di sini dipastikan bit-nya tidak bentrok.
  assert.equal((flagsV2 | 4) & (1 << 15), 1 << 15, 'menggabung flag admin tidak menghapus flag v2');
});

await testAsync('pesan: klik tombol role benar-benar memberi & melepas role', async () => {
  // Memakai database smoke yang sudah terbuka (:memory:). JANGAN menutupnya:
  // driver itu dipakai test-test sesudah ini — percobaan pertama menutupnya
  // dan membuat puluhan test berikutnya gagal dengan "database is not open".
  {
    const repo = await import('../src/db/repo.js');
    const { handleRoleButton } = await import('../src/features/role-button-handler.js');
    const GUILD = '123456789012345678';
    const ROLE = '900000000000000001';

    const post = await repo.createCustomPost(GUILD, {
      name: 'Ambil role',
      channelId: null,
      blocks: [{ kind: 'text', value: 'Pilih' }],
    });

    /** Jalankan satu klik dan kembalikan apa yang terjadi. */
    const klik = async (options: {
      buttonId: number;
      punyaRole?: boolean;
      izin?: boolean;
      posisiBot?: number;
      posisiMember?: number;
    }) => {
      const catatan = { add: [] as string[], remove: [] as string[], pesan: '' };
      const interaction = {
        isButton: () => true,
        customId: `post-role:${options.buttonId}`,
        guildId: GUILD,
        deferred: false,
        replied: false,
        user: { id: '2', tag: 'uji#0001' },
        member: {
          roles: {
            cache: { has: () => options.punyaRole ?? false },
            highest: { position: options.posisiMember ?? 5 },
            add: async (id: string) => void catatan.add.push(id),
            remove: async (id: string) => void catatan.remove.push(id),
          },
        },
        guild: {
          id: GUILD,
          roles: {
            cache: new Map([[ROLE, { id: ROLE, name: 'Gamer', position: 3, managed: false }]]),
            fetch: async () => ({ id: ROLE, name: 'Gamer', position: 3, managed: false }),
          },
          members: {
            me: {
              roles: { highest: { position: options.posisiBot ?? 10 } },
              permissions: { has: () => options.izin ?? true },
            },
            fetchMe: async () => null,
          },
        },
        reply: async (payload: { content: string }) => void (catatan.pesan = payload.content),
        editReply: async (payload: { content: string }) => void (catatan.pesan = payload.content),
      };
      const ditangani = await handleRoleButton(interaction as never);
      return { ...catatan, ditangani };
    };

    // 1. Belum punya -> role DIBERIKAN.
    const toggle = await repo.replaceRoleButtons(GUILD, post.id, [
      { label: 'Gamer', roleId: ROLE, mode: 'toggle' },
    ]);
    const id = toggle.buttons[0]!.id;

    const a = await klik({ buttonId: id });
    assert.deepEqual(a.add, [ROLE], 'role diberikan');
    assert.deepEqual(a.remove, [], 'tidak ada yang dilepas');
    assert.match(a.pesan, /sudah ditambahkan/);

    // 2. Sudah punya -> role DILEPAS (mode toggle).
    const b = await klik({ buttonId: id, punyaRole: true });
    assert.deepEqual(b.remove, [ROLE], 'role dilepas');
    assert.deepEqual(b.add, [], 'tidak menambah lagi');

    // 3. Mode "hanya beri": sudah punya -> tidak melepas.
    const hanyaBeri = await repo.replaceRoleButtons(GUILD, post.id, [
      { label: 'Gamer', roleId: ROLE, mode: 'give' },
    ]);
    const c = await klik({ buttonId: hanyaBeri.buttons[0]!.id, punyaRole: true });
    assert.deepEqual(c.remove, [], 'mode give tidak pernah melepas');

    // 4. Tanpa izin Manage Roles -> tidak menyentuh role sama sekali.
    // CATATAN: memakai ID dari `hanyaBeri`, bukan `id` lama — mengganti daftar
    // tombol memang membatalkan customId sebelumnya (perilaku yang diinginkan,
    // dan diuji di langkah 7).
    const d = await klik({ buttonId: hanyaBeri.buttons[0]!.id, izin: false });
    assert.deepEqual(d.add, [], 'tidak memberi tanpa izin');
    assert.match(d.pesan, /Manage Roles/);

    // 5. Role di atas posisi bot -> ditolak sebelum memanggil Discord.
    const e = await klik({ buttonId: hanyaBeri.buttons[0]!.id, posisiBot: 1 });
    assert.deepEqual(e.add, [], 'tidak memberi role di atas bot');
    assert.match(e.pesan, /di bawah role ini/);

    // 6. Member di bawah role -> ditolak (pencegahan eskalasi hak).
    const f = await klik({ buttonId: hanyaBeri.buttons[0]!.id, posisiMember: 1 });
    assert.deepEqual(f.add, [], 'member biasa tidak bisa menaikkan dirinya');

    // 7. Tombol lama yang sudah diganti -> tidak berlaku.
    const g = await klik({ buttonId: 999999 });
    assert.match(g.pesan, /sudah tidak berlaku/);

    // 8. customId bukan tombol role -> router tidak mengklaimnya.
    assert.equal(g.ditangani, true, 'customId post-role selalu diklaim');
  }
});

await testAsync('pesan: tombol role - input dashboard dirapikan', async () => {
  const { sanitizeRoleButtons, buildRoleOptions } = await import('../src/features/role-buttons.js');

  // Role sama dua kali: hanya satu yang dipakai (dua tombol untuk role yang
  // sama membingungkan member).
  const hasil = sanitizeRoleButtons([
    { label: 'Gamer', roleId: '123456789012345678' },
    { label: 'Gamer lagi', roleId: '123456789012345678' },
    { label: 'Tanpa role' },
    { label: 'Bukan angka', roleId: 'abc' },
    { label: '', roleId: '987654321098765432' },
  ]);
  assert.equal(hasil.buttons.length, 1, 'hanya satu tombol sah');
  assert.equal(hasil.buttons[0]!.roleId, '123456789012345678');
  assert.equal(hasil.buttons[0]!.mode, 'toggle', 'mode bawaan toggle');
  assert.equal(hasil.dropped.length, 4, 'sisanya dilaporkan');

  // Opsi role untuk dropdown: @everyone disembunyikan, urut posisi tertinggi.
  const opsi = buildRoleOptions({
    roles: [
      { id: '1', name: '@everyone', position: 0, isEveryone: true },
      { id: '2', name: 'Gamer', position: 3, color: 0x6d8cff },
      { id: '3', name: 'Admin', position: 20 },
    ],
    botHighestPosition: 10,
    hasManageRoles: true,
  });
  assert.deepEqual(opsi.options.map((o) => o.name), ['Admin', 'Gamer'], 'urut & tanpa @everyone');
  assert.equal(opsi.options[0]!.blockedBy, 'bot-posisi', 'Admin di atas bot -> diblokir');
  assert.equal(opsi.options[1]!.blockedBy, null, 'Gamer bisa dibagi');
  assert.equal(opsi.options[1]!.color, '#6d8cff', 'warna role diteruskan');
});

await testAsync('pesan: kirim memperbarui pesan lama, bukan mengirim ulang', async () => {
  const { sendOrUpdatePost, deletePostMessage, PostSendError } = await import(
    '../src/features/custom-post-send.js'
  );

  // Client tiruan: yang diuji adalah keputusan kirim-vs-edit, bukan Discord.
  let kirim = 0;
  let edit = 0;
  const client = (pesanAda: boolean, channelAda = true) =>
    ({
      channels: {
        async fetch(id: string) {
          if (!channelAda) throw new Error('Unknown Channel');
          return {
            id,
            isTextBased: () => true,
            isDMBased: () => false,
            async send() {
              kirim += 1;
              return { id: 'pesan-baru' };
            },
            messages: {
              async fetch(messageId: string) {
                if (!pesanAda) throw new Error('Unknown Message');
                return {
                  id: messageId,
                  async edit() {
                    edit += 1;
                    return { id: messageId };
                  },
                  async delete() {
                    return undefined;
                  },
                };
              },
            },
          };
        },
      },
    }) as unknown as import('discord.js').Client;

  const blocks = [{ kind: 'text' as const, value: 'Halo' }];

  // Pesan lama masih ada: harus EDIT. Ini inti janji halaman /pesan — member
  // yang sudah menyimpan tautan ke pesan itu tetap menemukannya.
  const a = await sendOrUpdatePost({ client: client(true), channelId: 'c1', messageId: 'lama', blocks });
  assert.equal(a.edited, true, 'pesan lama diperbarui');
  assert.equal(kirim, 0, 'tidak ada pesan baru dikirim');

  // Pesan lama sudah dihapus orang: jangan menyerah, kirim baru.
  const b = await sendOrUpdatePost({ client: client(false), channelId: 'c2', messageId: 'hilang', blocks });
  assert.equal(b.edited, false, 'pesan baru dikirim');
  assert.equal(kirim, 1, 'kirim baru terjadi sekali');

  // Isi kosong: kesalahan yang bisa dipahami admin, bukan crash.
  await assert.rejects(
    () => sendOrUpdatePost({ client: client(true), channelId: 'c3', messageId: null, blocks: [{ kind: 'divider', value: '' }] }),
    (error: unknown) => error instanceof PostSendError && /kosong/i.test((error as Error).message),
    'isi kosong ditolak dengan pesan jelas',
  );

  // Channel hilang: pesan jelas, bukan "Unknown Channel" mentah.
  await assert.rejects(
    () => sendOrUpdatePost({ client: client(true, false), channelId: 'c4', messageId: null, blocks }),
    (error: unknown) => error instanceof PostSendError,
    'channel hilang jadi PostSendError',
  );

  // Hapus pesan: benar kalau berhasil, dan TIDAK melempar kalau channel hilang.
  assert.equal(
    await deletePostMessage({ client: client(true), channelId: 'c5', messageId: 'm5' }),
    true,
    'pesan terhapus',
  );
  assert.equal(
    await deletePostMessage({ client: client(true, false), channelId: 'c6', messageId: 'm6' }),
    false,
    'channel hilang tidak melempar',
  );
});

await testAsync('pesan: tombol role tampil di baris bawah sebagai tombol interaktif', async () => {
  const { buildPostPayload } = await import('../src/features/custom-post.js');
  const { roleButtonId } = await import('../src/features/role-buttons.js');
  const d = await import('discord.js');

  const built = buildPostPayload([{ kind: 'text', value: 'Pilih role' }], {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    roleButtons: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: `R${i + 1}` })),
    roleButtonId,
  });
  assert.ok(built, 'payload terbentuk');

  const rows = (built.components[0] as { toJSON: () => { components: Array<{ type: number; components?: Array<Record<string, unknown>> }> } })
    .toJSON()
    .components.filter((c) => c.type === 1);

  // 7 tombol -> dua ActionRow (5 + 2). Discord menolak lebih dari 5 per baris.
  assert.deepEqual(rows.map((r) => r.components!.length), [5, 2], 'dibagi 5 per baris');

  // Tombol role harus INTERAKTIF (style Primary = 1) dengan customId, bukan
  // tombol link — kalau salah, klik member tidak akan sampai ke bot.
  const semua = rows.flatMap((r) => r.components!);
  for (const tombol of semua) {
    assert.equal(tombol.style, 1, 'style Primary');
    assert.match(String(tombol.custom_id), /^post-role:\d+$/, 'customId berprefix');
    assert.equal(tombol.url, undefined, 'bukan tombol link');
  }
  // customId harus di bawah batas Discord (100 karakter) bahkan untuk ID besar.
  assert.ok(roleButtonId(Number.MAX_SAFE_INTEGER).length < 100, 'customId pendek');
});

await testAsync('pesan: emoji & warna tombol role tersimpan dan sampai ke payload', async () => {
  const { sanitizeRoleButtons } = await import('../src/features/role-buttons.js');

  const { buttons, dropped } = sanitizeRoleButtons([
    { label: 'Gamer', roleId: '111111111111111111', mode: 'toggle', emoji: '🎮', style: 'success' },
    { label: 'Musik', roleId: '222222222222222222', mode: 'give', style: 'aneh' },
    // Emoji berbentuk teks biasa bukan emoji — harus dibuang, bukan menggagalkan
    // seluruh penyimpanan.
    { label: 'Film', roleId: '333333333333333333', emoji: 'halo', style: 'danger' },
    // Role dobel tetap ditolak.
    { label: 'Gamer lagi', roleId: '111111111111111111', emoji: '🎮', style: 'primary' },
  ]);

  assert.equal(buttons.length, 3, 'tiga tombol sah');
  assert.equal(buttons[0].emoji, '🎮');
  assert.equal(buttons[0].style, 'success');
  assert.equal(buttons[1].emoji, undefined, 'tanpa emoji = tidak ada properti');
  assert.equal(buttons[1].style, 'primary', 'gaya asing kembali ke primary');
  assert.equal(buttons[2].emoji, undefined, 'teks biasa bukan emoji');
  assert.equal(buttons[2].style, 'danger');
  assert.equal(dropped.length, 1, 'satu tombol dobel dibuang');
});

await testAsync('pesan: select menu role dibatasi & divalidasi sebelum disimpan', async () => {
  const { sanitizeRoleMenu, MENU_LIMITS } = await import('../src/features/role-buttons.js');
  const opsi = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `Role ${i}`, roleId: String(400000000000000000n + BigInt(i)) }));

  // Batas atas: 25 pilihan, sisanya dipotong.
  const penuh = sanitizeRoleMenu({ placeholder: 'Pilih', options: opsi(30) });
  assert.equal(penuh?.options.length, MENU_LIMITS.options, 'dipotong ke 25');

  // Role dobel dalam satu menu hanya dihitung sekali.
  const dobel = sanitizeRoleMenu({
    placeholder: 'Pilih',
    options: [
      { label: 'A', roleId: '444444444444444444' },
      { label: 'B', roleId: '444444444444444444' },
    ],
  });
  assert.equal(dobel?.options.length, 1, 'role dobel dibuang');

  // Tanpa pilihan sah = tidak ada menu sama sekali (bukan menu kosong).
  assert.equal(sanitizeRoleMenu({ placeholder: 'Kosong', options: [] }), null);
  assert.equal(sanitizeRoleMenu({ placeholder: 'Salah', options: [{ label: 'X', roleId: 'bukan-angka' }] }), null);

  // Placeholder kosong diganti teks bawaan, dan terlalu panjang dipotong.
  assert.equal(sanitizeRoleMenu({ options: opsi(1) })?.placeholder, 'Pilih role');
  const panjang = sanitizeRoleMenu({ placeholder: 'x'.repeat(400), options: opsi(1) });
  assert.equal(panjang?.placeholder.length, MENU_LIMITS.placeholder);

  // min/max: string dari form diterima, urutan dibetulkan, batas dijaga.
  assert.equal(sanitizeRoleMenu({ minValues: '1', maxValues: '3', options: opsi(4) })?.maxValues, 3);
  const terbalik = sanitizeRoleMenu({ minValues: 3, maxValues: 1, options: opsi(4) });
  assert.equal(terbalik?.minValues, 3);
  assert.equal(terbalik?.maxValues, 3, 'maks dinaikkan ke min');
  assert.equal(sanitizeRoleMenu({ maxValues: 99, options: opsi(2) })?.maxValues, 2, 'dibatasi jumlah pilihan');

  // Eksklusif harus boolean sungguhan: string "true" bukan true.
  assert.equal(sanitizeRoleMenu({ options: opsi(1) })?.exclusive, false, 'bawaan tidak eksklusif');
  assert.equal(sanitizeRoleMenu({ exclusive: 'true', options: opsi(1) })?.exclusive, false);
  assert.equal(sanitizeRoleMenu({ exclusive: true, options: opsi(1) })?.exclusive, true);
});

await testAsync('pesan: menu eksklusif mencabut role lain HANYA di menu yang sama', async () => {
  const { planMenuSelection } = await import('../src/features/role-button-handler.js');
  const menu = (exclusive: boolean, ids: string[]) => ({
    exclusive,
    options: ids.map((id) => ({ roleId: id, label: id, emoji: null, description: null })),
  });
  const tanpa = () => null;

  // Kasus inti: sedang pegang A, memilih B -> A dilepas, B diberikan.
  const ganti = planMenuSelection({
    menu: menu(true, ['r1', 'r2', 'r3']),
    selectedRoleIds: ['r2'],
    heldRoleIds: ['r1'],
    allow: tanpa,
  });
  assert.deepEqual(ganti.give, ['r2']);
  assert.deepEqual(ganti.remove, ['r1']);

  // Role di luar menu TIDAK boleh ikut dicabut.
  const luar = planMenuSelection({
    menu: menu(true, ['r1', 'r2']),
    selectedRoleIds: ['r2'],
    heldRoleIds: ['r1', 'staf'],
    allow: tanpa,
  });
  assert.deepEqual(luar.remove, ['r1'], 'role staf tetap terpasang');

  // Non-eksklusif: role lama dipertahankan.
  const tambah = planMenuSelection({
    menu: menu(false, ['r1', 'r2']),
    selectedRoleIds: ['r2'],
    heldRoleIds: ['r1'],
    allow: tanpa,
  });
  assert.deepEqual(tambah.give, ['r2']);
  assert.deepEqual(tambah.remove, []);

  // Nilai yang tidak ada di menu diabaikan (menu sudah disusun ulang).
  const asing = planMenuSelection({
    menu: menu(false, ['r1']),
    selectedRoleIds: ['r9'],
    heldRoleIds: [],
    allow: tanpa,
  });
  assert.deepEqual(asing.give, [], 'tidak memberi role asing');

  // Sudah punya role yang dipilih: tidak ada perubahan apa pun.
  const sama = planMenuSelection({
    menu: menu(false, ['r1']),
    selectedRoleIds: ['r1'],
    heldRoleIds: ['r1'],
    allow: tanpa,
  });
  assert.deepEqual(sama.give, []);
  assert.deepEqual(sama.remove, []);

  // Blocker dilaporkan, bukan diam-diam memberi role.
  const ditolak = planMenuSelection({
    menu: menu(false, ['r1']),
    selectedRoleIds: ['r1'],
    heldRoleIds: [],
    allow: () => 'member-posisi' as const,
  });
  assert.deepEqual(ditolak.give, []);
  assert.equal(ditolak.blocked[0]?.blocker, 'member-posisi');
});

await testAsync('pesan: select menu benar-benar dibentuk di payload', async () => {
  const { buildPostPayload } = await import('../src/features/custom-post.js');
  const { roleMenuId, roleButtonId } = await import('../src/features/role-buttons.js');
  const d = await import('discord.js');

  const built = buildPostPayload([{ kind: 'text', value: 'Halo' }], {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    StringSelectMenuBuilder: d.StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder: d.StringSelectMenuOptionBuilder,
    roleButtonId,
    roleMenuId,
    roleButtons: [{ id: 1, label: 'Gamer', emoji: '🎮', style: 'success' }],
    roleMenus: [
      {
        id: 7,
        placeholder: 'Pilih warna',
        minValues: 1,
        maxValues: 1,
        options: [
          { label: 'Merah', value: '555555555555555555', emoji: '🔴' },
          { label: 'Biru', value: '666666666666666666', description: 'Tenang' },
        ],
      },
    ],
  });
  assert.ok(built, 'payload terbentuk');
  type BarisJson = { type: number; components: Array<Record<string, any>> };
  const rows = (built!.components[0] as { toJSON: () => { components: BarisJson[] } })
    .toJSON()
    .components.filter((c) => c.type === 1);
  assert.equal(rows.length, 2, 'satu baris tombol + satu baris menu');

  const tombol = rows[0].components[0];
  assert.equal(tombol.style, 3, 'tombol hijau (Success)');
  assert.equal(tombol.emoji.name, '🎮');

  const menu = rows[1].components[0];
  assert.equal(menu.type, 3, 'tipe StringSelect');
  assert.equal(menu.custom_id, roleMenuId(7));
  assert.equal(menu.placeholder, 'Pilih warna');
  assert.equal(menu.min_values, 1);
  assert.equal(menu.max_values, 1, 'maks tidak melebihi jumlah opsi');
  assert.equal(menu.options.length, 2);
  assert.equal(menu.options[1].description, 'Tenang');
});

await testAsync('pesan: jalur kirim benar-benar menyertakan select menu (bukan dilewati)', async () => {
  // Penjaga regresi: penyusun payload MELEWATI menu tanpa error kalau
  // `StringSelectMenuBuilder` tidak disuntikkan. Akibatnya admin melihat menu
  // di dashboard dan di database, tapi pesan di Discord tidak pernah punya
  // dropdown — tanpa satu pun pesan error. Test ini memakai client palsu dan
  // memeriksa payload yang benar-benar dikirim.
  const { sendOrUpdatePost } = await import('../src/features/custom-post-send.js');

  const terkirim: Array<Record<string, any>> = [];
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    messages: { fetch: async () => null },
    send: async (body: Record<string, any>) => {
      terkirim.push(body);
      return { id: 'pesan-baru' };
    },
  };

  const hasil = await sendOrUpdatePost({
    client: { channels: { fetch: async () => channel } } as never,
    channelId: '123456789012345678',
    messageId: null,
    blocks: [{ kind: 'text', value: 'Pilih role' }],
    roleButtons: [{ id: 1, label: 'Gamer', emoji: '🎮', style: 'success' }],
    roleMenus: [
      {
        id: 4,
        placeholder: 'Pilih warna',
        minValues: 1,
        maxValues: 1,
        options: [
          { roleId: '222222222222222222', label: 'Merah', emoji: '🔴' },
          { roleId: '333333333333333333', label: 'Biru' },
        ],
      },
    ],
  });
  assert.equal(hasil.messageId, 'pesan-baru');
  assert.equal(terkirim.length, 1, 'satu payload dikirim');

  type Baris = { type: number; components: Array<Record<string, any>> };
  const rows = (
    terkirim[0]!.components![0] as { toJSON: () => { components: Baris[] } }
  )
    .toJSON()
    .components.filter((c) => c.type === 1);

  assert.equal(rows.length, 2, 'baris tombol DAN baris menu hadir');
  const select = rows[1]!.components[0]!;
  assert.equal(select.type, 3, 'komponennya StringSelect');
  assert.match(String(select.custom_id), /^post-menu:\d+$/);
  assert.equal(select.options.length, 2, 'dua opsi ikut terkirim');
  assert.equal(select.options[0].value, '222222222222222222', 'nilai opsi = role ID');
});

await testAsync('pesan: blok container menghasilkan beberapa container berwarna sendiri', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SectionBuilder: d.SectionBuilder,
    ThumbnailBuilder: d.ThumbnailBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    accent: 0x6d8cff,
    accentToNumber: (hex: string) => Number.parseInt(hex.slice(1), 16),
  };

  const { blocks } = sanitizeBlocks([
    { kind: 'text', value: 'Di luar container' },
    { kind: 'container', accent: '#58b9ff' },
    { kind: 'text', value: '### What is this?' },
    { kind: 'text', value: 'Isi pertama' },
    { kind: 'container', accent: '#ff8800' },
    { kind: 'text', value: '### Get started' },
  ]);
  const built = buildPostPayload(blocks, deps);
  assert.ok(built, 'payload terbentuk');

  type C = { type: number; accent_color?: number; components: Array<Record<string, any>> };
  const json = (built!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());

  /*
   * Sejak blok `close` ada, teks sebelum container pertama tampil DI LUAR
   * kartu (top-level), bukan lagi dibungkus container bawaan. Itu yang membuat
   * pesan bisa menyerupai Discohook: pembuka polos, lalu kartu-kartunya.
   * Karena itu hasilnya 1 TextDisplay + 2 Container, bukan 3 Container.
   */
  assert.equal(json.length, 3, 'teks pembuka + dua container');
  assert.equal(json[0]!.type, 10, 'teks pembuka di luar kartu');
  assert.equal(json[1]!.accent_color, 0x58b9ff, 'warna container sendiri dipakai');
  assert.equal(json[2]!.accent_color, 0xff8800);
  assert.equal(json[1]!.components.length, 2);

  // Pesan TANPA blok container harus tetap satu container — pesan lama tidak
  // boleh berubah tampilannya gara-gara fitur baru ini.
  const lama = buildPostPayload(
    sanitizeBlocks([{ kind: 'text', value: 'Halo' }, { kind: 'button', value: 'Buka', url: 'https://a.test' }]).blocks,
    deps,
  );
  const jsonLama = (lama!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());
  assert.equal(jsonLama.length, 1, 'tetap satu container');
});

await testAsync('pesan: section memakai SATU aksesori, tombol menang atas gambar', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SectionBuilder: d.SectionBuilder,
    ThumbnailBuilder: d.ThumbnailBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  };

  type C = { components: Array<Record<string, any>> };
  const ambilSection = (input: unknown) => {
    const built = buildPostPayload(sanitizeBlocks(input).blocks, deps);
    const json = (built!.components as Array<{ toJSON: () => C }>)[0]!.toJSON();
    return json.components.find((c) => c.type === 9);
  };

  const denganGambar = ambilSection([
    { kind: 'section', value: 'Teks', thumbnail: 'https://a.test/gambar.png' },
  ]);
  assert.equal(denganGambar?.accessory.type, 11, 'aksesori thumbnail (tipe 11)');
  assert.equal(denganGambar?.accessory.media.url, 'https://a.test/gambar.png');
  assert.equal(denganGambar?.components[0].content, 'Teks');

  // Keduanya diisi: Discord menolak dua aksesori, jadi tombol yang dipakai.
  const duaDua = ambilSection([
    {
      kind: 'section',
      value: 'Teks',
      thumbnail: 'https://a.test/gambar.png',
      accessoryLabel: 'Buka',
      url: 'https://b.test',
    },
  ]);
  assert.equal(duaDua?.accessory.type, 2, 'aksesori tombol (tipe 2)');
  assert.equal(duaDua?.accessory.label, 'Buka');
  assert.equal(duaDua?.accessory.url, 'https://b.test');
});

await testAsync('pesan: pemisah berjarak besar memakai spacing 2', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  };
  const built = buildPostPayload(
    sanitizeBlocks([{ kind: 'text', value: 'A' }, { kind: 'divider', spacing: 'large' }, { kind: 'text', value: 'B' }]).blocks,
    deps,
  );
  type C = { components: Array<Record<string, any>> };
  const json = (built!.components as Array<{ toJSON: () => C }>)[0]!.toJSON();
  const sep = json.components.find((c) => c.type === 14);
  assert.equal(sep?.spacing, 2, 'jarak besar');
  assert.equal(sep?.divider, true);
});

await testAsync('pesan: blok tutup-kartu menaruh komponen di luar container', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    accent: 0x6d8cff,
    accentToNumber: (hex: string) => parseInt(hex.slice(1), 16),
  };

  // Struktur pesan Discohook: pembuka polos, dua kartu berwarna, tombol penutup.
  const blok = sanitizeBlocks([
    { kind: 'text', value: 'Pembuka' },
    { kind: 'close' },
    { kind: 'container', accent: '#58b9ff' },
    { kind: 'text', value: 'Kartu satu' },
    { kind: 'container', accent: '#ff8800' },
    { kind: 'text', value: 'Kartu dua' },
    { kind: 'close' },
    { kind: 'button', value: 'Situs', url: 'https://example.com' },
  ]).blocks;
  type C = { type: number; accent_color?: number; components?: Array<{ content?: string; label?: string }> };
  const built = buildPostPayload(blok, deps);
  assert.ok(built, 'pesan tidak boleh dianggap kosong');
  const json = (built!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());

  // 10 = TextDisplay, 17 = Container, 1 = ActionRow
  assert.deepEqual(
    json.map((c) => c.type),
    [10, 17, 17, 1],
    'pembuka & tombol di luar kartu, dua kartu di tengah',
  );
  assert.equal(json[0]!.components, undefined, 'TextDisplay top-level tidak berisi komponen');
  assert.equal(json[1]!.accent_color, 0x58b9ff, 'kartu pertama biru');
  assert.equal(json[2]!.accent_color, 0xff8800, 'kartu kedua oranye');
  assert.equal(json[3]!.components?.[0]!.label, 'Situs', 'label tombol penutup');
});

await testAsync('pesan: tanpa blok container tetap satu kartu (pesan lama aman)', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  };
  const built = buildPostPayload(
    sanitizeBlocks([
      { kind: 'text', value: 'Halo' },
      { kind: 'text', value: 'Dunia' },
      { kind: 'button', value: 'Situs', url: 'https://example.com' },
    ]).blocks,
    deps,
  );
  type C = { type: number; components?: Array<{ type: number }> };
  const json = (built!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());
  assert.equal(json.length, 1, 'hanya satu container');
  assert.equal(json[0]!.type, 17, 'komponennya container');
});

await testAsync('pesan: dua blok tutup-kartu berurutan tidak menggandakan komponen', async () => {
  const { sanitizeBlocks } = await import('../src/features/custom-post.js');
  const { blocks, dropped } = sanitizeBlocks([
    { kind: 'container' },
    { kind: 'text', value: 'A' },
    { kind: 'close' },
    { kind: 'close' },
    { kind: 'text', value: 'B' },
  ]);
  assert.deepEqual(dropped, [], 'tidak ada blok yang dibuang');
  assert.equal(blocks.filter((b) => b.kind === 'close').length, 1, 'penutup ganda diringkas jadi satu');
});

await testAsync('pesan: teks beraksesori dikirim sebagai Section', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SectionBuilder: d.SectionBuilder,
    ThumbnailBuilder: d.ThumbnailBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  };
  type C = { type: number; components: Array<Record<string, any>> };
  const dalam = (input: unknown): Record<string, any> => {
    const built = buildPostPayload(sanitizeBlocks(input).blocks, deps);
    const json = (built!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());
    return json[0]!.components[0]!;
  };

  // Tombol link → Section, aksesori berupa tombol (tipe 2, gaya 5).
  const tombol = dalam([{ kind: 'text', value: 'Halo', accessoryLabel: 'Buka', url: 'https://a.test' }]);
  assert.equal(tombol.type, 9, 'teks bertombol jadi Section');
  assert.equal(tombol.accessory.style, 5, 'tombol link');
  assert.equal(tombol.accessory.label, 'Buka');

  // Thumbnail → Section dengan aksesori thumbnail.
  const thumb = dalam([{ kind: 'text', value: 'Halo', thumbnail: 'https://img.test/a.png' }]);
  assert.equal(thumb.type, 9, 'teks bergambar jadi Section');
  assert.equal(thumb.accessory.media.url, 'https://img.test/a.png');

  // Tanpa aksesori → tetap TextDisplay, jadi pesan lama tidak berubah.
  const polos = dalam([{ kind: 'text', value: 'Halo' }]);
  assert.equal(polos.type, 10, 'teks polos tetap TextDisplay');
});

await testAsync('pesan: blok file jadi komponen File di luar kartu', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    FileBuilder: d.FileBuilder,
  };
  type C = { type: number; components?: Array<Record<string, any>>; file?: { url: string } };

  const built = buildPostPayload(
    sanitizeBlocks([
      { kind: 'text', value: 'Unduh panduan:' },
      { kind: 'file', value: 'https://a.test/panduan.pdf', name: 'panduan.pdf' },
    ]).blocks,
    deps,
  );
  assert.ok(built, 'payload terbentuk');
  const json = (built!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());
  assert.deepEqual(
    json.map((c) => c.type),
    [17, 13],
    'container untuk teks, File berdiri sendiri di luar kartu',
  );
  // Berkas diunduh saat kirim lalu dirujuk lewat attachment://.
  assert.equal(json[1]!.file?.url, 'attachment://panduan.pdf');
  assert.equal(built!.remoteFiles.length, 1, 'URL dicatat untuk diunduh saat kirim');
  assert.equal(built!.remoteFiles[0]!.url, 'https://a.test/panduan.pdf');

  // Berkas sendirian tetap dianggap pesan berisi (bukan kosong).
  const sendiri = buildPostPayload(
    sanitizeBlocks([{ kind: 'file', value: 'https://a.test/a.zip' }]).blocks,
    deps,
  );
  assert.ok(sendiri, 'berkas sendirian tidak dianggap pesan kosong');
});

await testAsync('pesan: batas berkas dan spoiler dihormati', async () => {
  const { sanitizeBlocks, measureBlocks, LIMITS } = await import('../src/features/custom-post.js');

  // Lebih dari batas → dipotong dengan alasan, bukan error.
  const banyak = sanitizeBlocks(
    Array.from({ length: LIMITS.filesPerMessage + 2 }, (_, i) => ({ kind: 'file', value: `https://a.test/f${i}.pdf` })),
  );
  assert.equal(banyak.blocks.filter((b) => b.kind === 'file').length, LIMITS.filesPerMessage);
  assert.ok(banyak.dropped.some((d) => d.includes('berkas melebihi batas')), 'alasan disebutkan');

  // Spoiler dipertahankan pada gambar dan berkas.
  const spoiler = sanitizeBlocks([
    { kind: 'image', value: 'https://img.test/a.png', spoiler: true },
    { kind: 'file', value: 'https://a.test/b.pdf', spoiler: true },
  ]);
  assert.equal(spoiler.blocks[0]!.spoiler, true);
  assert.equal(spoiler.blocks[1]!.spoiler, true);

  // Penghitung membawa jumlah berkas.
  const ukur = measureBlocks(sanitizeBlocks([{ kind: 'file', value: 'https://a.test/c.pdf' }]).blocks);
  assert.equal(ukur.files, 1);
});

/* ------------------------------------------------------------------ */
/*  Impor Discohook                                                    */
/* ------------------------------------------------------------------ */

/** Contoh persis seperti respons https://discohook.app/api/v1/share/<id>. */
const discoSample = {
  data: {
    version: 'd2',
    messages: [
      {
        _id: 'iFJDZeVzD1',
        data: {
          flags: 32768,
          components: [
            { type: 10, content: 'Hey, welcome to <:discohook:736648398081622016> **Discohook**!' },
            {
              type: 17,
              accent_color: 5814783,
              spoiler: true,
              components: [
                { type: 10, content: '### What is this?' },
                { type: 10, content: 'At its core, Discohook is a message designer.' },
              ],
            },
            { type: 14, divider: false, spacing: 1 },
            {
              type: 17,
              accent_color: 5814783,
              components: [
                { type: 10, content: '### Get started' },
                {
                  type: 9,
                  components: [{ type: 10, content: 'Butuh bantuan?' }],
                  accessory: {
                    type: 2,
                    style: 5,
                    label: 'Support',
                    url: 'https://discohook.app/discord',
                    emoji: { name: '🎮' },
                  },
                },
                {
                  type: 12,
                  items: [{ media: { url: 'https://a.test/a.png' }, description: 'contoh gambar' }],
                },
              ],
            },
            {
              type: 1,
              components: [
                { type: 2, style: 5, label: 'Support Server', url: 'https://discohook.app/discord' },
                { type: 2, style: 5, label: 'Invite Bot', url: 'https://discohook.app/bot', disabled: true },
                { type: 2, style: 1, label: 'Role', custom_id: 'role-1' },
              ],
            },
          ],
        },
      },
    ],
    targets: [],
  },
  expires: '2026-11-19T03:59:26.448Z',
};

await testAsync('discohook: mengurai tautan share & hanya menerima host Discohook', async () => {
  const { parseDiscohookShareId, discohookShareApiUrl } = await import('../src/features/discohook-import.js');

  // Empat bentuk yang dipakai orang, semuanya harus menghasilkan ID yang sama.
  for (const tautan of [
    'https://discohook.app/?share=CpazsKTm',
    'https://discohook.app/share/CpazsKTm',
    'https://discohook.org/?share=CpazsKTm',
    'CpazsKTm',
  ]) {
    assert.equal(parseDiscohookShareId(tautan), 'CpazsKTm', `ID terbaca dari ${tautan}`);
  }

  // Host lain ditolak: tanpa ini, endpoint impor bisa disuruh mengunduh
  // alamat internal (SSRF) hanya dengan menempel tautan.
  for (const tautan of [
    'https://evil.test/?share=CpazsKTm',
    'http://127.0.0.1:8080/?share=CpazsKTm',
    'https://discohook.app.evil.test/?share=CpazsKTm',
    'bukan tautan',
    '',
  ]) {
    assert.equal(parseDiscohookShareId(tautan), null, `ditolak: ${tautan}`);
  }

  assert.equal(discohookShareApiUrl('CpazsKTm'), 'https://discohook.app/api/v1/share/CpazsKTm');
});

await testAsync('discohook: komponen v2 diterjemahkan jadi blok dengan kartu & batas yang benar', async () => {
  const { parseDiscohookShare, looksLikeDiscohook } = await import('../src/features/discohook-import.js');
  const { sanitizeBlocks, buildPostPayload } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');

  assert.equal(looksLikeDiscohook(discoSample), true, 'respons API dikenali');
  assert.equal(looksLikeDiscohook({ messages: [] }), true, 'QueryData mentah dikenali');
  assert.equal(looksLikeDiscohook({ blocks: [] }), false, 'format /pesan sendiri bukan Discohook');

  const hasil = parseDiscohookShare(discoSample);
  assert.equal(hasil.messages.length, 1);
  const blok = sanitizeBlocks(hasil.messages[0]!.blocks).blocks;

  // Urutan struktur: pembuka polos → kartu spoiler → tutup → pemisah →
  // kartu kedua → tutup → baris tombol.
  assert.deepEqual(
    blok.map((b) => b.kind),
    ['text', 'container', 'text', 'text', 'close', 'divider', 'container', 'text', 'section', 'image', 'close', 'button', 'button'],
    'susunan blok sesuai pesan Discohook',
  );

  // Properti yang dulu tidak ada di model blok.
  assert.equal(blok[1]!.accent, '#58b9ff', 'warna container dari accent_color');
  assert.equal(blok[1]!.spoiler, true, 'spoiler container ikut');
  assert.equal(blok[5]!.divider, false, 'pemisah tanpa garis ikut');
  assert.equal(blok[8]!.value, 'Butuh bantuan?', 'teks Section');
  assert.equal(blok[8]!.accessoryLabel, 'Support', 'tombol aksesori Section');
  assert.equal(blok[8]!.emoji, '🎮', 'emoji tombol aksesori ikut');
  assert.equal(blok[9]!.alt, 'contoh gambar', 'alt text gambar ikut');
  assert.equal(blok[12]!.disabled, true, 'tombol nonaktif ikut');

  // Tombol interaktif tidak bisa dipindah — dilaporkan, bukan hilang diam-diam.
  assert.ok(
    hasil.messages[0]!.warnings.some((isi) => isi.includes('Role')),
    'tombol customId dilaporkan ke admin',
  );

  // Dan hasilnya benar-benar bisa dikirim Discord: kartu spoiler, pemisah
  // tanpa garis, tombol nonaktif semuanya tampil di payload.
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SectionBuilder: d.SectionBuilder,
    ThumbnailBuilder: d.ThumbnailBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    FileBuilder: d.FileBuilder,
    accent: 0x6d8cff,
    accentToNumber: (hex: string) => Number.parseInt(hex.slice(1), 16),
  };
  type C = {
    type: number;
    spoiler?: boolean;
    accent_color?: number;
    divider?: boolean;
    components?: Array<Record<string, any>>;
  };
  const built = buildPostPayload(blok, deps);
  assert.ok(built, 'payload terbentuk');
  const json = (built!.components as Array<{ toJSON: () => C }>).map((c) => c.toJSON());
  assert.deepEqual(json.map((c) => c.type), [10, 17, 14, 17, 1], 'pembuka, dua kartu, pemisah, tombol');

  const kartuSpoiler = json[1]!;
  assert.equal(kartuSpoiler.spoiler, true, 'spoiler container sampai ke payload');
  assert.equal(kartuSpoiler.accent_color, 5814783, 'warna container sampai ke payload');
  assert.equal(json[2]!.divider, false, 'pemisah tanpa garis sampai ke payload');

  // json[4] = ActionRow; komponennya adalah tombol-tombolnya.
  const baris = json[4]!;
  assert.equal(baris.components![1]!.disabled, true, 'tombol nonaktif sampai ke payload');
});

await testAsync('pesan: select menu dilaporkan saat tak terdukung, bukan hilang diam-diam', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');

  /*
   * Versi discord.js lama tidak punya builder select menu. Komponennya memang
   * harus dilewati, tetapi alasannya WAJIB sampai ke pemanggil: dulu daftar
   * `dropped` hanya hidup di dalam fungsi dan hilang tanpa jejak.
   */
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    accent: 0x6d8cff,
    accentToNumber: (hex: string) => Number.parseInt(hex.slice(1), 16),
  };
  const built = buildPostPayload(
    sanitizeBlocks([
      { kind: 'text', value: 'Halo' },
      { kind: 'select', selectKind: 'user' },
    ]).blocks,
    deps,
  );
  assert.ok(built, 'pesan tetap terbentuk tanpa select');
  assert.equal(built!.dropped.length, 1, 'satu komponen dilaporkan');
  assert.match(built!.dropped[0]!, /select/, 'alasannya menyebut select');
});

await testAsync('pesan: select menu dikirim sebagai ActionRow penuh & row memotong baris tombol', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
    StringSelectMenuBuilder: d.StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder: d.StringSelectMenuOptionBuilder,
    UserSelectMenuBuilder: d.UserSelectMenuBuilder,
    RoleSelectMenuBuilder: d.RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder: d.MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder: d.ChannelSelectMenuBuilder,
    accent: 0x6d8cff,
    accentToNumber: (hex: string) => Number.parseInt(hex.slice(1), 16),
  };

  type C = { type: number; components?: Array<Record<string, any>> };

  // Row eksplisit: 3 tombol, satu Row, 2 tombol → dua ActionRow terpisah.
  const denganRow = buildPostPayload(
    sanitizeBlocks([
      { kind: 'text', value: 'Pilih' },
      { kind: 'button', value: 'A', url: 'https://a.test' },
      { kind: 'button', value: 'B', url: 'https://b.test' },
      { kind: 'button', value: 'C', url: 'https://c.test' },
      { kind: 'row', value: '' },
      { kind: 'button', value: 'D', url: 'https://d.test' },
      { kind: 'button', value: 'E', url: 'https://e.test' },
    ]).blocks,
    deps,
  );
  const isiRow = (denganRow!.components as Array<{ toJSON: () => C }>)[0]!.toJSON().components!;
  const barisTombol = isiRow.filter((c) => c.type === 1);
  assert.equal(barisTombol.length, 2, 'dua baris tombol karena ada Row');
  assert.equal(barisTombol[0]!.components!.length, 3, 'baris pertama 3 tombol');
  assert.equal(barisTombol[1]!.components!.length, 2, 'baris kedua 2 tombol');

  // Select selalu baris penuh: tombol yang menumpuk ditutup lebih dulu.
  const campur = buildPostPayload(
    sanitizeBlocks([
      { kind: 'button', value: 'A', url: 'https://a.test' },
      {
        kind: 'select',
        selectKind: 'string',
        placeholder: 'Pilih warna',
        minValues: 1,
        maxValues: 2,
        options: [{ label: 'Merah', value: 'merah' }, { label: 'Biru', emoji: '🔵' }],
      },
      { kind: 'button', value: 'B', url: 'https://b.test' },
    ]).blocks,
    deps,
  );
  const isiCampur = (campur!.components as Array<{ toJSON: () => C }>)[0]!.toJSON().components!;
  // Urutan yang dipertahankan: baris tombol A, select, baris tombol B.
  assert.deepEqual(isiCampur.map((c) => c.type), [1, 1, 1], 'tiga baris: tombol, select, tombol');
  const select = isiCampur[1]!.components![0]!;
  assert.equal(select.type, 3, 'komponennya StringSelect');
  assert.match(String(select.custom_id), /^post-ctx:string$/, 'customId menu tampilan');
  assert.equal(select.placeholder, 'Pilih warna');
  assert.equal(select.min_values, 1);
  assert.equal(select.max_values, 2);
  assert.equal(select.options.length, 2);
  assert.equal(select.options[1].value, 'Biru', 'nilai kosong memakai label');

  // Empat jenis select lain memakai builder yang sesuai Discord.
  for (const [jenis, tipe] of [
    ['user', 5],
    ['role', 6],
    ['mentionable', 7],
    ['channel', 8],
  ] as const) {
    const hasil = buildPostPayload(sanitizeBlocks([{ kind: 'select', selectKind: jenis }]).blocks, deps);
    const isi = (hasil!.components as Array<{ toJSON: () => C }>)[0]!.toJSON().components!;
    const komponen = isi[0]!.components![0]!;
    assert.equal(komponen.type, tipe, `select ${jenis} memakai tipe ${tipe}`);
    assert.equal(komponen.custom_id, `post-ctx:${jenis}`);
  }

  // Menu string tanpa pilihan ditolak Discord → dibuang, dengan alasan.
  const kosong = sanitizeBlocks([{ kind: 'select', selectKind: 'string' }]);
  assert.equal(kosong.blocks.length, 0, 'select string tanpa pilihan dibuang');
  assert.ok(kosong.dropped.length > 0, 'alasannya dilaporkan');
});

await testAsync('discohook: select menu & Row diimpor sebagai blok select/row, bukan dibuang', async () => {
  const { discohookComponentsToBlocks } = await import('../src/features/discohook-import.js');
  const { sanitizeBlocks } = await import('../src/features/custom-post.js');

  const hasil = discohookComponentsToBlocks([
    {
      type: 17,
      accent_color: 5814783,
      components: [
        { type: 10, content: 'Pilih di bawah' },
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: 'Satu', url: 'https://a.test' },
            { type: 2, style: 5, label: 'Dua', url: 'https://b.test' },
          ],
        },
        { type: 1, components: [{ type: 2, style: 5, label: 'Tiga', url: 'https://c.test' }] },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: 'menu-warna',
              placeholder: 'Pilih warna',
              min_values: 1,
              max_values: 2,
              options: [
                { label: 'Merah', value: 'merah' },
                { label: 'Biru', description: 'dingin', emoji: { name: '🔵' } },
              ],
            },
          ],
        },
        { type: 1, components: [{ type: 6, custom_id: 'menu-role', max_values: 3 }] },
        { type: 1, components: [{ type: 5, custom_id: 'menu-user' }] },
        { type: 1, components: [{ type: 7, custom_id: 'menu-dua' }] },
        { type: 1, components: [{ type: 8, custom_id: 'menu-channel' }] },
      ],
    },
  ]);

  assert.deepEqual(hasil.warnings, [], 'tidak ada menu yang dibuang diam-diam');
  assert.equal(
    hasil.blocks.map((b) => (b.kind === 'select' ? 'select:' + b.selectKind : b.kind)).join(' | '),
    // Row disisipkan karena dua ActionRow berisi tombol berdampingan: di
    // Discohook keduanya baris terpisah, bukan digabung lima per baris.
    'container | text | button | button | row | button | select:string | select:role | select:user | select:mentionable | select:channel',
    'semua jenis menu jadi blok select, baris tombol dipisah Row',
  );

  const selectString = hasil.blocks.find((b) => b.kind === 'select' && b.selectKind === 'string')!;
  assert.equal(selectString.placeholder, 'Pilih warna');
  assert.equal(selectString.minValues, 1);
  assert.equal(selectString.maxValues, 2);
  assert.equal(selectString.options?.length, 2, 'dua pilihan ikut');
  assert.equal(selectString.options?.[1]!.emoji, '🔵', 'emoji pilihan ikut');
  assert.equal(selectString.options?.[1]!.description, 'dingin', 'keterangan pilihan ikut');

  /*
   * Sanitizer server harus meloloskan hasil impor apa adanya — dan di sanalah
   * nilai kosong diisi dengan label (Discord menolak opsi tanpa value).
   */
  const bersih = sanitizeBlocks(hasil.blocks);
  assert.deepEqual(bersih.dropped, [], 'tidak ada blok impor yang dibuang sanitizer');
  assert.equal(bersih.blocks.filter((b) => b.kind === 'select').length, 5, 'lima select lolos');
  const stringBersih = bersih.blocks.find((b) => b.kind === 'select' && b.selectKind === 'string')!;
  assert.equal(stringBersih.options?.[1]!.value, 'Biru', 'nilai kosong memakai label');
  assert.equal(stringBersih.maxValues, 2, 'batas maksimal ikut tersimpan');
});

await testAsync('discohook: pesan tanpa container tetap di luar kartu, embed jadi kartu teks', async () => {
  const { parseDiscohookShare } = await import('../src/features/discohook-import.js');
  const { sanitizeBlocks } = await import('../src/features/custom-post.js');

  const hasil = parseDiscohookShare({
    version: 'd2',
    messages: [
      {
        data: {
          content: 'Halo dunia',
          components: [{ type: 10, content: 'Tanpa container' }],
        },
      },
      {
        name: 'Embed lama',
        data: {
          embeds: [
            {
              title: 'Judul',
              description: 'Isi embed',
              color: 0x58b4ff,
              fields: [{ name: 'Bidang', value: 'Nilai' }],
              footer: { text: 'kaki' },
              image: { url: 'https://a.test/x.png' },
            },
          ],
        },
      },
    ],
  });

  assert.equal(hasil.messages.length, 2);

  // Pesan tanpa container: satu `close` di awal menahan pembungkusan kartu,
  // supaya tampilannya tetap seperti Discohook (polos di pesan).
  const pertama = sanitizeBlocks(hasil.messages[0]!.blocks).blocks;
  assert.equal(pertama[0]!.kind, 'close', 'penanda di luar kartu');
  assert.deepEqual(pertama.map((b) => b.kind), ['close', 'text', 'text']);

  // Embed: diterjemahkan menjadi kartu teks + gambar + footer kecil, dengan
  // peringatan bahwa bentuknya berubah.
  const kedua = sanitizeBlocks(hasil.messages[1]!.blocks).blocks;
  assert.equal(kedua[0]!.kind, 'container', 'embed jadi kartu');
  assert.equal(kedua[0]!.accent, '#58b4ff', 'warna embed dipakai');
  assert.ok(kedua.some((b) => b.kind === 'image'), 'gambar embed ikut');
  assert.ok(
    kedua.some((b) => b.kind === 'text' && b.value.startsWith('-# ')),
    'footer jadi teks kecil',
  );
  assert.ok(
    hasil.messages[1]!.warnings.some((isi) => isi.includes('Embed')),
    'perubahan bentuk embed dilaporkan',
  );
});

await testAsync('discohook: data asing & lampiran attachment:// dilaporkan, bukan gagal senyap', async () => {
  const { parseDiscohookShare } = await import('../src/features/discohook-import.js');

  const asing = parseDiscohookShare({ hello: 'world' });
  assert.equal(asing.messages.length, 0);
  assert.ok(asing.warnings[0]!.includes('messages'), 'alasan jelas');

  const lampiran = parseDiscohookShare({
    messages: [
      {
        data: {
          components: [
            {
              type: 12,
              items: [{ media: { url: 'attachment://gambar.png' } }],
            },
            { type: 10, content: 'Teks asli' },
          ],
        },
      },
    ],
  });
  assert.ok(
    lampiran.messages[0]!.warnings.some((isi) => isi.includes('attachment://')),
    'lampiran Discohook dijelaskan, bukan dibuang tanpa kabar',
  );
  assert.equal(lampiran.messages[0]!.blocks.some((b) => b.kind === 'image'), false);
  assert.equal(lampiran.messages[0]!.blocks.some((b) => b.kind === 'text'), true, 'sisa isi tetap diimpor');
});

await testAsync('pesan: penghitung batas komponen menghitung seperti Discord', async () => {
  const { measureBlocks, sanitizeBlocks, LIMITS } = await import('../src/features/custom-post.js');
  const ukur = (input: unknown) => measureBlocks(sanitizeBlocks(input).blocks);

  assert.equal(ukur([]).total, 0, 'pesan kosong tidak memakai komponen');

  // Teks + 2 tombol = 1 TextDisplay + 1 ActionRow.
  const duaTombol = ukur([
    { kind: 'text', value: 'Halo' },
    { kind: 'button', value: 'A', url: 'https://a.test' },
    { kind: 'button', value: 'B', url: 'https://b.test' },
  ]);
  assert.equal(duaTombol.total, 2);
  assert.equal(duaTombol.topLevel, 1);

  // 7 tombol = 2 baris.
  const tujuh = ukur([
    { kind: 'text', value: 'A' },
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'button', value: `T${i}`, url: 'https://x.test' })),
  ]);
  assert.equal(tujuh.total, 3, '1 teks + 2 baris tombol');

  // 41 blok teks = melewati batas 40.
  const banyak = ukur(Array.from({ length: 41 }, (_, i) => ({ kind: 'text', value: `b${i}` })));
  assert.equal(banyak.total, 41);
  assert.equal(banyak.over, true);
  assert.ok(banyak.masalah[0]?.includes(String(LIMITS.totalComponents)), 'menyebut batasnya');

  // Container kosong tidak dihitung sebagai container yang dikirim.
  const kosong = ukur([{ kind: 'text', value: 'A' }, { kind: 'container' }]);
  assert.equal(kosong.topLevel, 1, 'container kosong dibuang');

  // 11 container dipotong ke 10 oleh sanitizeBlocks, dengan alasan jelas.
  const sebelas = sanitizeBlocks(
    Array.from({ length: 11 }, (_, i) => [{ kind: 'container' }, { kind: 'text', value: `isi ${i}` }]).flat(),
  );
  assert.equal(sebelas.blocks.filter((b) => b.kind === 'container').length, 10);
  assert.ok(sebelas.dropped.some((d) => d.includes('container ke-11')), 'alasan disebutkan');
});

await testAsync('pesan: isi blok tidak bisa keluar dari tag <script>', async () => {
  const { pesanPage } = await import('../src/web/ui/pesan.js');

  // Serangan klasik: tutup <script> lebih awal, lalu suntik HTML. Isi blok
  // berasal dari admin, jadi tidak boleh dipercaya.
  const evil = '</script><img src=x onerror="alert(1)">';
  const html = pesanPage({
    guildId: '123456789012345678',
    guildName: 'Server',
    status: { online: false, mode: 'standalone', uptimeSeconds: 1 },
    posts: [
      {
        id: 1,
        name: '</script><b>nama</b>',
        channelId: null,
        blocks: [{ kind: 'text', value: evil }],
        messageId: null,
        updatedAt: Date.now(),
        accent: null,
        sender: 'bot' as const,
      },
    ],
    channels: [],
    botReady: false,
    roles: [],
    hasManageRoles: false,
    roleButtons: {},
    roleMenus: {},
  });

  // Yang diperiksa: TIDAK ADA penutup script yang diikuti tag HTML.
  assert.ok(!/<\/script>\s*<img/i.test(html), 'penutup script tidak bisa disuntik');
  assert.ok(!html.includes('onerror="alert(1)"'), 'atribut onerror tidak muncul mentah');
  // Dan isinya masih ada dalam bentuk aman, jadi admin tetap melihat teksnya.
  assert.ok(html.includes('u003c/script'), 'isi di-encode, bukan dibuang');
  // Nama pesan di daftar tetap harus ter-escape sebagai HTML biasa.
  assert.ok(!html.includes('<b>nama</b>'), 'nama tidak dirender sebagai tag');
});

await testAsync('pesan: payload container berisi Section/ActionRow sesuai urutan', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const { blocks } = sanitizeBlocks([
    { kind: 'text', value: 'Aturan server' },
    { kind: 'divider' },
    { kind: 'image', value: 'https://contoh.test/a.png' },
    { kind: 'button', value: 'Gabung', url: 'https://discord.gg/x' },
  ]);

  const built = buildPostPayload(blocks, {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  });
  assert.ok(built, 'payload terbentuk');
  const json = (built!.components[0] as { toJSON: () => { components: Array<Record<string, unknown>> } }).toJSON();
  // 10 = teks, 14 = pemisah, 12 = galeri, 1 = action row (tombol)
  assert.deepEqual(json.components.map((c) => c.type), [10, 14, 12, 1], 'urutan blok dijaga');
  // Flag Components V2 wajib; tanpa itu Discord menganggap pesan kosong.
  assert.equal(built!.flags, d.MessageFlags.IsComponentsV2, 'flag V2 dipasang');

  const row = json.components[3] as { components: Array<Record<string, unknown>> };
  assert.equal(row.components[0]!.label, 'Gabung', 'label tombol');
  assert.equal(row.components[0]!.style, d.ButtonStyle.Link, 'tombol memakai gaya link');
});

await testAsync('pesan: pesan kosong tidak menghasilkan payload', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const deps = {
    ContainerBuilder: d.ContainerBuilder,
    TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder,
    MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder,
    ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder,
    ButtonStyle: d.ButtonStyle,
  };
  assert.equal(buildPostPayload([], deps), null, 'tanpa blok = null');
  const hanyaGaris = sanitizeBlocks([{ kind: 'divider' }, { kind: 'button', value: 'a', url: 'https://x.test' }]);
  assert.equal(
    buildPostPayload(hanyaGaris.blocks, deps),
    null,
    'hanya pemisah + tombol = tidak ada isi, ditolak',
  );
});

await testAsync('pesan: tombol dipecah maksimum 5 per baris', async () => {
  const { buildPostPayload, sanitizeBlocks } = await import('../src/features/custom-post.js');
  const d = await import('discord.js');
  const tombol = Array.from({ length: 7 }, (_, i) => ({
    kind: 'button',
    value: `Tombol ${i + 1}`,
    url: `https://contoh.test/${i}`,
  }));
  const { blocks } = sanitizeBlocks([{ kind: 'text', value: 'Pilih role' }, ...tombol]);
  const built = buildPostPayload(blocks, {
    ContainerBuilder: d.ContainerBuilder, TextDisplayBuilder: d.TextDisplayBuilder,
    SeparatorBuilder: d.SeparatorBuilder, MediaGalleryBuilder: d.MediaGalleryBuilder,
    MediaGalleryItemBuilder: d.MediaGalleryItemBuilder, ActionRowBuilder: d.ActionRowBuilder,
    ButtonBuilder: d.ButtonBuilder, ButtonStyle: d.ButtonStyle,
  });
  const json = (built!.components[0] as { toJSON: () => { components: Array<Record<string, unknown>> } }).toJSON();
  const rows = json.components.filter((c) => c.type === 1);
  // Discord menolak lebih dari 5 tombol per ActionRow.
  assert.equal(rows.length, 2, 'dua baris tombol');
  assert.equal((rows[0] as { components: unknown[] }).components.length, 5, 'baris pertama 5 tombol');
  assert.equal((rows[1] as { components: unknown[] }).components.length, 2, 'baris kedua 2 tombol');
});

await testAsync('container: banner di ATAS teks, avatar jadi thumbnail kanan', async () => {
  const { buildContainerCard } = await import('../src/features/container-card.js');

  const card = buildContainerCard({
    kind: 'welcome',
    text: 'Selamat datang Sky',
    guildName: 'Komunitas Zypher',
    memberCount: 7,
    banner: { name: 'banner-abc.png' },
    avatar: { name: 'avatar-abc.png' },
  });
  assert.ok(card, 'kartu terbentuk');

  const json = card!.toJSON() as unknown as { components: Array<Record<string, unknown>> };
  const types = json.components.map((c) => c.type);
  // Urutan ini yang dilihat member: banner menyambut lebih dulu, lalu teks.
  assert.equal(types[0], 12, 'blok pertama = MediaGallery (banner)');
  assert.equal(types[1], 9, 'blok kedua = Section (teks + avatar)');

  const banner = json.components[0] as { items: Array<{ media: { url: string } }> };
  assert.equal(banner.items[0]!.media.url, 'attachment://banner-abc.png', 'banner dirujuk lampiran');

  const section = json.components[1] as {
    components: Array<{ type: number; content: string }>;
    accessory: { type: number; media: { url: string } };
  };
  assert.equal(section.components[0]!.type, 10, 'di dalam Section ada TextDisplay');
  // Thumbnail (11) = avatar kecil di KANAN teks. Dulu avatar jadi MediaGallery
  // selebar penuh di tengah, sehingga tampak seperti kotak kosong besar.
  assert.equal(section.accessory.type, 11, 'avatar memakai Thumbnail, bukan galeri penuh');
  assert.equal(section.accessory.media.url, 'attachment://avatar-abc.png', 'avatar dirujuk lampiran');
});

await testAsync('container: tanpa avatar, teks dikirim tanpa Section', async () => {
  const { buildContainerCard } = await import('../src/features/container-card.js');
  const card = buildContainerCard({
    kind: 'goodbye',
    text: 'Sampai jumpa',
    guildName: 'Z',
    avatar: null,
  });
  const json = card!.toJSON() as unknown as { components: Array<Record<string, unknown>> };
  assert.ok(
    json.components.every((c) => c.type !== 9),
    'tidak ada Section kosong saat avatar dimatikan',
  );
  assert.ok(json.components.some((c) => c.type === 10), 'teks tetap ada');
});

await testAsync('embed-mock: Section jadi SATU blok teks + thumbnail', async () => {
  const { containerToMock } = await import('../src/features/embed-mock.js');

  const mock = containerToMock({
    toJSON: () => ({
      type: 17,
      components: [
        { type: 12, items: [{ media: { url: 'attachment://banner' } }] },
        {
          type: 9,
          components: [{ type: 10, content: 'Halo Sky!' }],
          accessory: { type: 11, media: { url: 'attachment://avatar' } },
        },
        { type: 14 },
      ],
    }),
  } as never);

  assert.ok(mock, 'container terbaca');
  assert.deepEqual(mock!.blocks.map((b) => b.kind), ['image', 'section', 'separator'], 'urutan blok');
  const section = mock!.blocks[1];
  assert.ok(section!.kind === 'section', 'blok kedua adalah section');
  if (section!.kind === 'section') {
    // Teks & thumbnail SATU blok: kalau dipisah, pratinjau menggambar avatar
    // di baris sendiri di kanan bawah, padahal Discord menaruhnya di samping.
    assert.equal(section!.text, 'Halo Sky!', 'teks section terbaca');
    assert.equal(section!.thumbnailUrl, 'attachment://avatar', 'thumbnail section terbaca');
  }
});

await testAsync('pratinjau: banner tidak digambar dua kali', async () => {
  const { buildContainerCard } = await import('../src/features/container-card.js');
  const { containerToMock } = await import('../src/features/embed-mock.js');

  const card = buildContainerCard({
    kind: 'welcome',
    text: 'Halo',
    guildName: 'Z',
    banner: { name: 'banner-abc.png' },
  });
  const mock = containerToMock(card)!;
  const gambar = mock.blocks.filter((b) => b.kind === 'image');
  // Dulu banner dari disk ditambahkan lagi sebagai blok baru, sehingga
  // pratinjau menampilkan dua banner sementara Discord menampilkan satu.
  assert.equal(gambar.length, 1, 'tepat satu gambar banner');
  assert.equal(
    gambar[0]!.kind === 'image' ? gambar[0]!.url : '',
    'attachment://banner-abc.png',
    'rujukan lampiran, bukan URL tambahan',
  );
});

await testAsync('embed-mock: colorToCss aman untuk nilai rusak', async () => {
  const { colorToCss } = await import('../src/features/embed-mock.js');
  assert.equal(colorToCss(0), '#000000', 'nol = hitam');
  assert.equal(colorToCss(0xffffff), '#ffffff', 'putih');
  assert.equal(colorToCss('bukan angka'), null, 'string = null, bukan #NaN');
  assert.equal(colorToCss(-5), '#000000', 'negatif dijepit');
});

await testAsync('sambutan: embed produksi memasang baris penulis & thumbnail', async () => {
  const { composePayload } = await import('../src/features/welcome.js');
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild: { name: 'Komunitas Zypher' },
    displayAvatarURL: () => 'https://cdn/avatar.png',
  } as never;

  const dasar = {
    mode: 'embed' as const,
    text: 'Halo!',
    member,
    kind: 'welcome' as const,
    channelName: null,
    attachment: null,
    includeAvatar: false,
    bannerPath: null,
    allowed: { embed: true, attach: false },
    mentionUser: true,
  };

  const denganAuthor = await composePayload({ ...dasar, embedAuthor: true });
  const author = denganAuthor.embeds[0]!.data.author;
  assert.equal(author?.name, 'Sky', 'nama member jadi nama penulis');
  assert.equal(author?.icon_url, 'https://cdn/avatar.png', 'avatar member jadi ikon penulis');

  const denganThumb = await composePayload({ ...dasar, embedAvatar: true });
  assert.equal(
    denganThumb.embeds[0]!.data.thumbnail?.url,
    'https://cdn/avatar.png',
    'thumbnail terpasang',
  );

  // Dua sakelar berdiri sendiri: tanpa keduanya, tidak ada avatar sama sekali.
  const tanpaAvatar = await composePayload(dasar);
  assert.equal(tanpaAvatar.embeds[0]!.data.author, undefined, 'tanpa sakelar = tanpa penulis');
  assert.equal(tanpaAvatar.embeds[0]!.data.thumbnail, undefined, 'tanpa sakelar = tanpa thumbnail');
});

await testAsync('sambutan: mention tetap di content, bukan di dalam embed', async () => {
  const { composePayload } = await import('../src/features/welcome.js');
  const member = {
    id: '222222222222222222',
    displayName: 'Sky',
    guild: { name: 'Komunitas Zypher' },
    displayAvatarURL: () => 'https://cdn/avatar.png',
  } as never;

  const payload = await composePayload({
    mode: 'embed',
    text: 'Halo Sky!',
    member,
    kind: 'welcome',
    channelName: null,
    attachment: null,
    includeAvatar: false,
    embedAuthor: true,
    embedAvatar: true,
    bannerPath: null,
    allowed: { embed: true, attach: false },
    mentionUser: true,
  });

  assert.match(payload.content, /<@222222222222222222>/, 'mention ada di content');
  assert.ok(
    !String(payload.embeds[0]!.data.description).includes('<@'),
    'mention TIDAK ditulis di deskripsi embed (di sana ia tidak memicu notifikasi)',
  );
});

await testAsync('pratinjau: membawa bentuk embed untuk dashboard, bukan hanya teks', async () => {
  const { previewWelcome } = await import('../src/features/preview.js');
  const result = await previewWelcome({
    settings: {
      ...welcomeSettings({ displayMode: 'embed', embedAuthor: true, embedAvatar: true }),
    } as never,
    name: 'Rani',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
  });

  assert.ok(result.embedMock, 'pratinjau embed menghasilkan embedMock');
  // Tanpa data member dari server, pratinjau memakai member tiruan bawaan —
  // nama yang diketik admin tetap harus muncul sebagai nama penulis.
  assert.ok(
    String(result.embedMock!.author?.name ?? '').includes('Rani'),
    `baris penulis memakai nama contoh (dapat: ${result.embedMock!.author?.name})`,
  );
  assert.ok(result.embedMock!.color, 'warna aksen ikut');
  assert.equal(result.mode, 'embed', 'mode yang dipakai dilaporkan');
  assert.match(String(result.contentText), /<@/, 'mention contoh ada di content');
});

await testAsync('pratinjau: perpisahan juga mendapat mock, dengan warna sendiri', async () => {
  const { previewGoodbye } = await import('../src/features/preview.js');
  const result = await previewGoodbye({
    settings: { ...goodbyeSettings({ displayMode: 'embed', embedAuthor: true }) } as never,
    name: 'Budi',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
  });
  assert.ok(result.embedMock, 'perpisahan punya embedMock');
  // Warna perpisahan (0x716c98) sengaja beda dari sambutan (0x6d8cff).
  assert.equal(result.embedMock!.color, '#716c98', 'warna perpisahan, bukan sambutan');
});

await testAsync('pratinjau: mode container menghasilkan containerMock', async () => {
  const { previewWelcome } = await import('../src/features/preview.js');
  const result = await previewWelcome({
    settings: { ...welcomeSettings({ displayMode: 'container' }) } as never,
    name: 'Rani',
    guildName: 'Komunitas Zypher',
    templateOnly: true,
  });
  assert.ok(result.containerMock, 'pratinjau container menghasilkan containerMock');
  assert.ok(result.containerMock!.blocks.length > 0, 'ada blok yang bisa digambar');
  assert.equal(result.embedMock ?? null, null, 'mode container tidak memakai embed');
});

await testAsync('kirim tes: memakai composePayload, bukan embed buatan sendiri', async () => {
  // Akar bug "avatar tidak muncul di pesan uji": test-send.ts menyusun
  // EmbedBuilder sendiri lalu lupa setThumbnail/setAuthor. Test ini mengunci
  // bahwa jalur itu TIDAK kembali lagi.
  const source = await readFile('src/features/test-send.ts', 'utf8');
  assert.ok(source.includes('composePayload('), 'pesan uji memakai composePayload');
  assert.ok(
    source.includes('embedAuthor: settings.embedAuthor'),
    'sakelar baris penulis diteruskan ke pesan uji',
  );
  assert.ok(
    source.includes('embedAvatar: settings.embedAvatar'),
    'sakelar thumbnail diteruskan ke pesan uji',
  );
  // Tidak boleh ada lagi embed yang disusun manual dari deskripsi + footer.
  assert.ok(
    !/new EmbedBuilder\(\)\s*\n\s*\.setDescription\(preview\.text\)/.test(source),
    'tidak ada embed rakitan sendiri di jalur pesan uji',
  );
});

await testAsync('sakelar: embedAuthor tersimpan & terbaca dari database', async () => {
  const { getWelcomeSettings, saveWelcomeSettings, getGoodbyeSettings, saveGoodbyeSettings } =
    await import('../src/db/repo.js');

  await saveWelcomeSettings(GUILD, { embedAuthor: true });
  assert.equal((await getWelcomeSettings(GUILD)).embedAuthor, true, 'setelan sambutan tersimpan');

  await saveWelcomeSettings(GUILD, { embedAuthor: false });
  assert.equal((await getWelcomeSettings(GUILD)).embedAuthor, false, 'bisa dimatikan lagi');

  await saveGoodbyeSettings(GUILD, { embedAuthor: true });
  assert.equal((await getGoodbyeSettings(GUILD)).embedAuthor, true, 'setelan perpisahan tersimpan');
});

await testAsync('dashboard: dua sakelar avatar ada di dua tab & terkirim ke server', async () => {
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  for (const kind of ['welcome', 'goodbye']) {
    assert.ok(
      pages.includes(`id="${kind}EmbedAuthor"`),
      `tab ${kind} punya sakelar baris penulis`,
    );
    assert.ok(
      pages.includes(`id="${kind}EmbedAvatar"`),
      `tab ${kind} punya sakelar thumbnail`,
    );
    assert.ok(
      pages.includes(`embedAuthor: document.getElementById('${kind}EmbedAuthor').checked`),
      `sakelar ${kind} ikut dikirim saat menyimpan`,
    );
  }
  // Pratinjau harus punya wadah untuk mock bentuk pesan.
  assert.ok(pages.includes('id="shapeWelcome"'), 'wadah pratinjau sambutan ada');
  assert.ok(pages.includes('id="shapeGoodbye"'), 'wadah pratinjau perpisahan ada');
  assert.ok(pages.includes('embedMock'), 'halaman membaca embedMock dari server');
});

/* ------------------------------------------------------------------ */
/*  Beban CPU: pemindaian folder tidak boleh tiap polling              */
/* ------------------------------------------------------------------ */

await testAsync('disk: pemindaian folder dipakai ulang, bukan tiap polling', async () => {
  const { shouldRescanFolder } = await import('../src/web/resources.js');
  const TTL = 5 * 60_000;
  const now = 1_000_000;

  // Belum ada hasil = harus pindai.
  assert.equal(shouldRescanFolder(null, now, TTL), true, 'cache kosong = pindai');

  // Baru saja dipindai: TIDAK boleh pindai lagi. Inilah inti perbaikan —
  // dulu setiap polling 3 detik memindai seluruh node_modules (~345 ms CPU).
  assert.equal(
    shouldRescanFolder({ at: now - 1000, complete: true }, now, TTL),
    false,
    '1 detik lalu = pakai cache',
  );
  assert.equal(
    shouldRescanFolder({ at: now - TTL + 1000, complete: true }, now, TTL),
    false,
    'hampir 5 menit = masih pakai cache',
  );
  assert.equal(
    shouldRescanFolder({ at: now - TTL, complete: true }, now, TTL),
    true,
    'lewat 5 menit = pindai ulang',
  );
});

await testAsync('disk: hasil tidak lengkap dihitung ulang lebih cepat', async () => {
  const { shouldRescanFolder } = await import('../src/web/resources.js');
  const TTL = 5 * 60_000;
  const now = 1_000_000;
  // Kena batas 60.000 berkas = angka kurang. Jangan disimpan 5 menit.
  assert.equal(
    shouldRescanFolder({ at: now - 31_000, complete: false }, now, TTL),
    true,
    'tidak lengkap = pindai ulang sesudah 30 detik',
  );
  assert.equal(
    shouldRescanFolder({ at: now - 5_000, complete: false }, now, TTL),
    false,
    'tidak lengkap tapi baru 5 detik = masih pakai cache',
  );
});

await testAsync('disk: panggilan berulang tidak memindai ulang folder', async () => {
  const { readResourceUsage, resetFolderCache } = await import('../src/web/resources.js');
  resetFolderCache();

  const pertama = await readResourceUsage({ workDir: process.cwd() });
  const kedua = await readResourceUsage({ workDir: process.cwd() });

  assert.ok(pertama.diskUsed !== null, 'panggilan pertama mengisi angka disk');
  assert.equal(kedua.diskUsed, pertama.diskUsed, 'angka disk sama (dari cache)');
  // Waktu ukur TIDAK berubah: bukti bahwa folder tidak dipindai lagi.
  assert.equal(kedua.diskUsedAt, pertama.diskUsedAt, 'waktu ukur tidak bergerak');
  resetFolderCache();
});

await testAsync('disk: ukur ulang membuang cache', async () => {
  const { readResourceUsage, resetFolderCache } = await import('../src/web/resources.js');
  resetFolderCache();
  const pertama = await readResourceUsage({ workDir: process.cwd() });
  // Beri jeda supaya `Date.now()` pasti bergerak.
  await new Promise((resolve) => setTimeout(resolve, 5));
  resetFolderCache();
  const kedua = await readResourceUsage({ workDir: process.cwd() });
  assert.ok(kedua.diskUsedAt! > pertama.diskUsedAt!, 'waktu ukur bergerak setelah cache dibuang');
  resetFolderCache();
});

await testAsync('disk: dashboard menyebut umur angka, bukan berpura-pura segar', async () => {
  const base = await readFile('src/web/ui/base.ts', 'utf8');
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  // Seed harus membawa waktu ukur, kalau tidak panel tidak bisa jujur.
  assert.ok(base.includes('diskUsedAt'), 'seed panel membawa diskUsedAt');
  assert.ok(pages.includes('diskAgeLabel'), 'ada label umur angka disk');
  assert.ok(pages.includes('diukur '), 'panel menulis kapan disk diukur');
  // Tombol paksa ukur ulang harus ada dan terhubung.
  assert.ok(base.includes('id="resRefreshDisk"'), 'tombol ukur ulang ada di panel');
  assert.ok(pages.includes('function refreshDisk'), 'fungsinya ada');
  assert.ok(pages.includes('/api/resources/refresh-disk'), 'menembak endpoint yang benar');
});

await testAsync('disk: endpoint ukur ulang & simpan kuota membuang cache', async () => {
  const server = await readFile('src/web/server.ts', 'utf8');
  const resources = await readFile('src/web/resources.ts', 'utf8');
  assert.ok(resources.includes('export function resetFolderCache'), 'cache bisa dibuang');
  assert.ok(
    /api\/resources\/refresh-disk/.test(server),
    'endpoint refresh-disk terdaftar',
  );
  // Simpan kuota juga harus membuang cache: admin baru mengubah angka, dan
  // angka pemakaian lama bisa membingungkan.
  const blokKuota = server.slice(server.indexOf("'/api/disk-quota'"));
  assert.ok(
    blokKuota.slice(0, 1200).includes('resetFolderCache()'),
    'simpan kuota membuang cache disk',
  );
});

await testAsync('disk: readResourceUsage memakai jalur ber-cache', async () => {
  // Pengunci perilaku: kalau seseorang mengembalikan pemanggilan folderBytes()
  // langsung ke readResourceUsage(), beban CPU 11% kembali tanpa test lain
  // yang gagal — persis kejadian yang mematikan server di hosting.
  const resources = await readFile('src/web/resources.ts', 'utf8');
  const blok = resources.slice(resources.indexOf('export async function readResourceUsage'));
  assert.ok(
    blok.includes('cachedFolderBytes('),
    'readResourceUsage memakai cachedFolderBytes',
  );
  assert.ok(
    !/^\s*folderBytes\(options\.workDir\)/m.test(blok),
    'tidak memanggil folderBytes langsung tiap sampel',
  );
});

await testAsync('ringkasan: render halaman TIDAK menunggu pemindaian folder', async () => {
  // Keluhan nyata: "buka dashboard jadi lemot saat masuk Ringkasan, halaman
  // lain aman". Penyebabnya render halaman menunggu pemindaian folder (~580 ms).
  const { readResourceUsage, resetFolderCache } = await import('../src/web/resources.js');
  resetFolderCache();

  const t0 = Date.now();
  const hasil = await readResourceUsage({ workDir: process.cwd(), backgroundFolder: true });
  const ms = Date.now() - t0;

  assert.ok(ms < 150, `render halaman tidak menunggu pemindaian (dapat ${ms} ms)`);
  assert.equal(hasil.diskUsed, null, 'angka disk boleh kosong dulu');
  assert.equal(hasil.diskUsedAt, null, 'belum ada waktu ukur');

  // Pemindaian berjalan di latar belakang: panggilan berikutnya mendapat angka.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const berikutnya = await readResourceUsage({ workDir: process.cwd() });
  assert.ok(berikutnya.diskUsed !== null, 'panggilan berikutnya sudah punya angka disk');
  resetFolderCache();
});

await testAsync('ringkasan: halaman & polling memakai jalur yang benar', async () => {
  // Dua jalur berbeda dan keduanya penting:
  //   render halaman -> backgroundFolder: true   (jangan tahan HTML)
  //   polling        -> tanpa opsi itu           (angka harus ada)
  // Mutasi yang menghapus `backgroundFolder: true` dari server.ts TIDAK
  // tertangkap test perilaku di atas (fungsi tetap benar), jadi pemanggilnya
  // dikunci di sini.
  const server = await readFile('src/web/server.ts', 'utf8');
  const blokHalaman = server.slice(server.indexOf('resources: await readResourceUsage'));
  assert.ok(
    blokHalaman.slice(0, 900).includes('backgroundFolder: true'),
    'render halaman Ringkasan memakai backgroundFolder',
  );

  const blokApi = server.slice(server.indexOf("path === '/api/resources' && method === 'GET'"));
  assert.ok(
    !blokApi.slice(0, 900).includes('backgroundFolder'),
    'polling /api/resources TIDAK memakai background (angka harus ada)',
  );
});

await testAsync('ringkasan: pemindaian latar belakang tidak menumpuk', async () => {
  const resources = await readFile('src/web/resources.ts', 'utf8');
  // Tanpa penjaga `folderScan`, satu halaman yang di-refresh berulang kali bisa
  // memicu banyak pemindaian bersamaan — persis beban yang ingin dihindari.
  assert.ok(resources.includes('let folderScan'), 'ada penanda pemindaian berjalan');
  assert.ok(
    /if \(!folderScan\)/.test(resources),
    'pemindaian baru hanya dimulai kalau belum ada yang berjalan',
  );
});

await testAsync('ringkasan: panel jujur saat angka disk belum ada', async () => {
  const base = await readFile('src/web/ui/base.ts', 'utf8');
  const pages = await readFile('src/web/ui/pages.ts', 'utf8');
  // "— terpakai" akan terbaca seperti kerusakan; ganti dengan penjelasan.
  assert.ok(
    base.includes('menghitung ukuran folder'),
    'render server menjelaskan angka disk belum siap',
  );
  assert.ok(
    pages.includes('menghitung ukuran folder'),
    'polling di browser memakai kalimat yang sama',
  );
});

await testAsync('disk: pemindaian folder paralel per folder, bukan per berkas', async () => {
  // 7.331 berkas dengan `await` berurutan = ~580 ms. Mengelompokkan stat per
  // folder memangkasnya jadi ~240 ms tanpa mengubah hasil.
  const resources = await readFile('src/web/resources.ts', 'utf8');
  const blok = resources.slice(
    resources.indexOf('async function folderBytes('),
    resources.indexOf('async function folderBytes(') + 3000,
  );
  assert.ok(blok.includes('statJobs.push('), 'ukuran berkas dikumpulkan dulu');
  assert.ok(blok.includes('await Promise.all(statJobs)'), 'lalu dijalankan bersamaan');
  assert.ok(
    !/bytes \+= \(await stat\(full\)\)\.size/.test(blok),
    'tidak lagi meng-await stat satu per satu',
  );
});

await testAsync('perintah produksi memakai dist, bukan tsx', async () => {
  // tsx memuat transpiler TypeScript ke dalam proses: diukur 276,7 MB / 4
  // proses vs 108,1 MB / 1 proses untuk `node dist`. Di container 589 MB itu
  // sepertiga RAM — terlalu mahal untuk sekadar menjalankan kode yang sudah
  // dikompilasi.
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };

  assert.match(pkg.scripts.start, /^node dist\//, 'start memakai node dist');
  assert.match(pkg.scripts.dashboard, /^node dist\//, 'dashboard memakai node dist');

  // Yang MEMANG butuh tsx: watch mode dan skrip uji yang menjalankan .ts.
  assert.match(pkg.scripts.dev, /tsx/, 'dev tetap tsx (perlu watch)');
  assert.match(pkg.scripts.smoke, /tsx/, 'smoke tetap tsx (menjalankan .ts)');

  // Berkas yang dirujuk harus benar-benar ada setelah build.
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync('dist/index.js'), 'dist/index.js ada');
  assert.ok(existsSync('dist/web/standalone.js'), 'dist/web/standalone.js ada');
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
