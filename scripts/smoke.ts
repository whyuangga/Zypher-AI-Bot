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
const { matchKeywords } = await import('../src/features/keywords.js');
const { buildSystemPrompt } = await import('../src/features/prompt.js');
const { buildTranscriptHtml, transcriptFileName } = await import('../src/lib/transcript.js');
const { chunkMessage, truncate, normalize } = await import('../src/lib/text.js');
const { checkRateLimit } = await import('../src/lib/ratelimit.js');
const { parseFallbackSpec, providerNameForBaseUrl, buildProviderChain } = await import('../src/lib/providers.js');

let passed = 0;
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
test('ollama tidak butuh API key', () => {
  const { providers } = parseFallbackSpec('ollama:llama3.1', {});
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.baseUrl, 'http://localhost:11434/v1');
});
test('mendeteksi nama provider dari base URL', () => {
  assert.equal(providerNameForBaseUrl('https://api.groq.com/openai/v1'), 'groq');
  assert.equal(providerNameForBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai/'), 'gemini');
  assert.equal(providerNameForBaseUrl('http://127.0.0.1:11434/v1'), 'ollama');
});
test('rantai provider: utama di depan, fallback hanya yang ada key-nya', () => {
  const chain = buildProviderChain();
  assert.equal(chain[0]?.name, 'groq');
  assert.equal(chain.length, 2, 'openrouter harus dilewati karena OPENROUTER_API_KEY kosong');
  assert.equal(chain[1]?.name, 'gemini');
});

console.log(`\n${process.exitCode ? '❌ Ada test gagal' : '🎉 Semua test lulus'} — ${passed} test.\n`);
