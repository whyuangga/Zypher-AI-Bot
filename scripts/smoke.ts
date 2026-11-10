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
const { listGuildIds, countGuildRows, countGuildMessages, listMemoryOwners, listGuildMemories, messagesPerDay } =
  await import('../src/db/repo.js');
const { ringkasanPage, keywordPage, memoriPage } = await import('../src/web/ui/pages.js');
const { matchKeywords } = await import('../src/features/keywords.js');
const { buildSystemPrompt } = await import('../src/features/prompt.js');
const { buildTranscriptHtml, transcriptFileName } = await import('../src/lib/transcript.js');
const { chunkMessage, truncate, normalize } = await import('../src/lib/text.js');
const { checkRateLimit } = await import('../src/lib/ratelimit.js');
const { parseFallbackSpec, providerNameForBaseUrl, buildProviderChain } = await import('../src/lib/providers.js');
const { chunkText, extractText, htmlToText, DocumentError } = await import('../src/lib/chunker.js');
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
test('menyimpan fakta baru', () => {
  const result = addMemory(GUILD, USER, 'Namanya Bagas, desainer grafis di Bogor.');
  assert.equal(result.inserted, true);
  assert.equal(listMemories(GUILD, USER).length, 1);
});
test('mencegah duplikat', () => {
  const result = addMemory(GUILD, USER, 'Namanya Bagas, desainer grafis di Bogor.');
  assert.equal(result.inserted, false);
  assert.equal(listMemories(GUILD, USER).length, 1);
});
test('memisahkan memori antar user', () => {
  addMemory(GUILD, '999999999999999999', 'Suka kopi.');
  assert.equal(listMemories(GUILD, USER).length, 1);
});
test('menghapus satu memori', () => {
  const [memory] = listMemories(GUILD, USER);
  assert.ok(memory);
  assert.equal(deleteMemory(GUILD, USER, memory.id), true);
  assert.equal(listMemories(GUILD, USER).length, 0);
});
test('menghapus semua memori', () => {
  addMemory(GUILD, USER, 'Satu.');
  addMemory(GUILD, USER, 'Dua.');
  assert.equal(clearMemories(GUILD, USER), 2);
});

console.log('\nKeyword');
test('menambah & mendeteksi duplikat trigger', () => {
  const first = addKeyword(GUILD, 'server ini apa', 'Komunitas Akademi Discord untuk belajar dan mabar.', USER);
  assert.equal(first.ok, true);
  const dup = addKeyword(GUILD, 'Server Ini Apa', 'Duplikat.', USER);
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
});
test('mencocokkan pertanyaan dengan kalimat berbeda', () => {
  const matches = matchKeywords(GUILD, 'Halo kak, server ini apa ya?');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.trigger, 'server ini apa');
});
test('mencocokkan dengan kata yang dibalik', () => {
  const matches = matchKeywords(GUILD, 'ini server buat apa sih');
  assert.equal(matches.length, 1);
});
test('tidak mencocokkan pertanyaan tak relevan', () => {
  assert.equal(matchKeywords(GUILD, 'tolong buatkan puisi tentang hujan').length, 0);
});
test('daftar & hapus keyword', () => {
  const [keyword] = listKeywords(GUILD);
  assert.ok(keyword);
  assert.equal(deleteKeyword(GUILD, keyword.id), true);
  assert.equal(listKeywords(GUILD).length, 0);
});

console.log('\nPrompt');
test('menyusun system prompt lengkap', () => {
  setPersona(GUILD, 'Kamu guru bahasa Inggris yang sabar.');
  addMemory(GUILD, USER, 'Namanya Bagas.');
  addKeyword(GUILD, 'jam mabar', 'Mabar setiap Jumat 20.00 WIB.', USER);

  const prompt = buildSystemPrompt({
    botName: 'Zypher',
    guildName: 'Akademi Discord',
    userName: 'Bagas',
    persona: getGuildSettings(GUILD)?.persona ?? null,
    memories: listMemories(GUILD, USER),
    keywords: listKeywords(GUILD),
    now: new Date('2026-11-09T10:00:00+07:00'),
  });

  assert.match(prompt, /Zypher/);
  assert.match(prompt, /Akademi Discord/);
  assert.match(prompt, /guru bahasa Inggris/);
  assert.match(prompt, /Namanya Bagas/);
  assert.match(prompt, /jam mabar/);
  assert.match(prompt, /variasikan|bervariasi|variasi/i);
});

console.log('\nRoom & riwayat');
test('membuat room dan menemukannya kembali', () => {
  createRoom(CHANNEL, GUILD, USER);
  assert.equal(getRoomByChannel(CHANNEL)?.userId, USER);
  assert.equal(getRoomByUser(GUILD, USER)?.channelId, CHANNEL);
});
test('menyimpan & mengambil riwayat berurutan', () => {
  appendMessage(CHANNEL, 'user', 'Halo');
  appendMessage(CHANNEL, 'assistant', 'Hai! Ada yang bisa dibantu?');
  appendMessage(CHANNEL, 'user', 'Ajarin Inggris dong');
  touchRoom(CHANNEL, 3);

  const history = getHistory(CHANNEL, 2);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.content, 'Hai! Ada yang bisa dibantu?');
  assert.equal(history[1]?.role, 'user');
  assert.equal(getRoomByChannel(CHANNEL)?.messageCount, 3);
});
test('reset tidak menghapus memori', () => {
  clearHistory(CHANNEL);
  assert.equal(getHistory(CHANNEL, 10).length, 0);
  assert.equal(listMemories(GUILD, USER).length, 1);
});
test('hapus room membersihkan data', () => {
  deleteRoom(CHANNEL);
  assert.equal(getRoomByChannel(CHANNEL), null);
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
test('server yang hanya punya data tetap muncul di daftar server', () => {
  // Kasus nyata: room sudah ada, tapi tabel `guilds` belum pernah terisi.
  // Dashboard dulu menampilkan "(belum ada server)" dan semua panel kosong.
  const dataOnlyGuild = '444444444444444444';
  addKeyword(dataOnlyGuild, 'jam buka', 'Setiap hari 08.00–22.00 WIB.', USER);
  assert.ok(listGuildIds().includes(dataOnlyGuild), 'guild dengan data harus ikut terdaftar');
});
test('createRoom mendaftarkan server ke tabel guilds', () => {
  const freshGuild = '555555555555555555';
  assert.equal(getGuildSettings(freshGuild), null);
  createRoom('666666666666666666', freshGuild, USER);
  assert.ok(getGuildSettings(freshGuild), 'server harus punya baris guilds setelah room dibuat');
});
test('statistik dashboard dipisah per server', () => {
  const guildA = '777777777777777777';
  const guildB = '888888888888888888';
  const channelA = '999999999999999991';

  createRoom(channelA, guildA, USER);
  appendMessage(channelA, 'user', 'Halo dari server A');

  assert.equal(countGuildRows(guildA, 'rooms'), 1);
  assert.equal(countGuildRows(guildB, 'rooms'), 0, 'server B tidak boleh ikut menghitung room A');
  assert.equal(countGuildMessages(guildA), 1);
  assert.equal(countGuildMessages(guildB), 0);
});

test('grafik aktivitas menghitung pesan 7 hari terakhir', () => {
  const guildId = '121212121212121212';
  const channelId = '131313131313131313';
  createRoom(channelId, guildId, USER);
  appendMessage(channelId, 'user', 'Halo');
  appendMessage(channelId, 'assistant', 'Hai');

  const series = messagesPerDay(guildId, 7);
  assert.equal(series.length, 7, 'harus tepat 7 batang');
  assert.equal(series[6]?.count, 2, 'pesan hari ini masuk batang terakhir');
  assert.equal(series.reduce((sum, item) => sum + item.count, 0), 2);
});
test('memori dikelompokkan per user', () => {
  const guildId = '141414141414141414';
  addMemory(guildId, '151515151515151515', 'Fakta A');
  addMemory(guildId, '151515151515151515', 'Fakta B');
  addMemory(guildId, '161616161616161616', 'Fakta C');

  const owners = listMemoryOwners(guildId);
  assert.equal(owners.length, 2);
  assert.equal(owners[0]?.count, 2, 'user dengan memori terbanyak di atas');
  assert.equal(listGuildMemories(guildId).length, 3);
});

console.log('\nHalaman dashboard');
const pageContext = {
  guildId: '1569424777750257766',
  guilds: ['1569424777750257766'],
  status: { online: true, mode: 'bot' as const, uptimeSeconds: 3600 },
};
test('ringkasan merender sidebar, kartu statistik, dan grafik', () => {
  const html = ringkasanPage({
    ...pageContext,
    stats: { rooms: 3, documents: 2, chunks: 9, keywords: 4, memories: 6, messages: 84 },
    rooms: [{ channelId: '1400000000000000001', userId: USER, messageCount: 12, lastActiveAt: Date.now() }],
    documents: [{ id: 1, name: 'faq.md', chunkCount: 6, chars: 4200, createdAt: Date.now() }],
    series: messagesPerDay('1569424777750257766', 7),
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
test('extractText menolak PDF dengan pesan yang jelas', () => {
  assert.throws(() => extractText('brosur.pdf', '%PDF-1.4 ...'), DocumentError);
  try {
    extractText('brosur.pdf', '%PDF-1.4');
  } catch (error) {
    assert.match((error as Error).message, /PDF/);
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
  assert.equal(listGuildDocuments('g-rag').length, 1);

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
  assert.equal(listGuildDocuments('g-rag').length, 1, 'tidak boleh duplikat');

  const hits = await searchKnowledge('g-rag', 'jam operasional');
  assert.match(hits[0]?.content ?? '', /24 jam/);
});

await testAsync('RAG: dokumen yang salah server tidak ikut terpakai', async () => {
  const hits = await searchKnowledge('g-lain', 'jam operasional');
  assert.equal(hits.length, 0);
});

await testAsync('RAG: dokumen bisa dihapus dan hasil pencarian hilang', async () => {
  const documents = listGuildDocuments('g-rag');
  assert.equal(removeDocument('g-rag', documents[0]!.id), true);
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
