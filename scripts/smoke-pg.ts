/**
 * Smoke test jalur **Postgres** tanpa server Postgres sungguhan.
 *
 * Memakai `pg-mem` (Postgres in-memory) supaya SQL, skema, dan pemetaan hasil
 * benar-benar diuji — bukan hanya SQLite. Cocok untuk CI yang tidak punya
 * database.
 *
 * Jalankan: npm run smoke:pg
 */
process.env.DISCORD_TOKEN = 'smoke-test-token-0000000000000000';
process.env.CLIENT_ID = '123456789012345678';
process.env.AI_API_KEY = 'smoke-test-key-0000';
process.env.DATABASE_URL = 'postgres://smoke:smoke@localhost:5432/smoke';

// Modul proyek diimpor dinamis: config dibaca saat import, jadi env di atas
// harus sudah terpasang (import statis akan di-hoist sebelum baris ini).
import assert from 'node:assert/strict';

const { newDb } = await import('pg-mem');
const { createPostgresDriver, toPostgresPlaceholders } = await import('../src/db/driver.js');
const { SCHEMA_PG } = await import('../src/db/schema.js');
const { setDriverForTests } = await import('../src/db/index.js');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log('\n🐘 Zypher AI Bot — smoke test Postgres (pg-mem)\n');

/* ------------------------------------------------------------------ */
/*  Driver                                                             */
/* ------------------------------------------------------------------ */

console.log('Driver');

await test('placeholder ? diterjemahkan ke $1..$n, string literal tidak disentuh', () => {
  assert.equal(toPostgresPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?'), 'SELECT * FROM t WHERE a = $1 AND b = $2');
  assert.equal(
    toPostgresPlaceholders("SELECT '?' AS tanda, ? AS nilai"),
    "SELECT '?' AS tanda, $1 AS nilai",
  );
  assert.equal(toPostgresPlaceholders('SELECT "kolom?ah" FROM t'), 'SELECT "kolom?ah" FROM t');
});

/* ------------------------------------------------------------------ */
/*  Siapkan database                                                   */
/* ------------------------------------------------------------------ */

const memory = newDb({ autoCreateForeignKeyIndices: true });
const adapter = memory.adapters.createPg();
const pool = new adapter.Pool();
const driver = await createPostgresDriver({ pool });

assert.equal(driver.dialect, 'pg');

await test('skema Postgres bisa dibuat', async () => {
  await driver.exec(SCHEMA_PG);
});

// Semua fungsi repo membaca driver dari sini.
setDriverForTests(driver);

const repo = await import('../src/db/repo.js');

const GUILD = '1569424777750257766';
const USER = '900000000000000001';
const CHANNEL = '1400000000000000001';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

console.log('\nGuild & memori');

await test('guild dibuat sekali (idempotent)', async () => {
  await repo.ensureGuild(GUILD);
  await repo.ensureGuild(GUILD);
  const settings = await repo.getGuildSettings(GUILD);
  assert.equal(settings?.guildId, GUILD);
  assert.equal((await repo.listGuilds()).some((guild) => guild.id === GUILD), true);
});

await test('nama server tersimpan & muncul di daftar server', async () => {
  await repo.setGuildName(GUILD, 'Server pg-mem');
  assert.equal((await repo.getGuildSettings(GUILD))?.name, 'Server pg-mem');
  const listed = (await repo.listGuilds()).find((guild) => guild.id === GUILD);
  assert.equal(listed?.name, 'Server pg-mem');
});

await test('panel: upsert pesan + toggle aktif/nonaktif', async () => {
  const initial = await repo.getPanel(GUILD);
  assert.equal(initial.enabled, true);
  assert.equal(initial.messageId, null);

  await repo.setPanelMessage(GUILD, CHANNEL, '1500000000000000001');
  await repo.setPanelMessage(GUILD, CHANNEL, '1500000000000000002');
  const state = await repo.getPanel(GUILD);
  assert.equal(state.channelId, CHANNEL);
  assert.equal(state.messageId, '1500000000000000002');

  assert.equal((await repo.setPanelEnabled(GUILD, false)).enabled, false);
  assert.equal((await repo.getPanel(GUILD)).enabled, false);
  // Mematikan panel tidak menghapus referensi pesannya.
  assert.equal((await repo.getPanel(GUILD)).channelId, CHANNEL);
});

await test('persona tersimpan & terbaca', async () => {
  await repo.setPersona(GUILD, 'Kamu asisten ramah.');
  assert.equal((await repo.getGuildSettings(GUILD))?.persona, 'Kamu asisten ramah.');
});

await test('memori: simpan, tolak duplikat, hapus', async () => {
  const first = await repo.addMemory(GUILD, USER, 'Suka kopi.');
  assert.equal(first.inserted, true);
  assert.ok(typeof first.id === 'number' && first.id > 0, 'id harus angka dari RETURNING id');

  const duplicate = await repo.addMemory(GUILD, USER, 'Suka kopi.');
  assert.equal(duplicate.inserted, false);
  assert.equal((await repo.listMemories(GUILD, USER)).length, 1);

  assert.equal(await repo.deleteMemory(GUILD, USER, first.id!), true);
  assert.equal((await repo.listMemories(GUILD, USER)).length, 0);
});

console.log('\nKeyword & room');

await test('keyword: tambah, duplikat, hapus', async () => {
  const added = await repo.addKeyword(GUILD, 'jam mabar', 'Jumat 20.00 WIB.', USER);
  assert.equal(added.ok, true);

  const duplicate = await repo.addKeyword(GUILD, 'JAM MABAR', 'Lain.', USER);
  assert.equal(duplicate.reason, 'duplicate');

  assert.equal((await repo.listKeywords(GUILD)).length, 1);
  assert.equal(await repo.deleteKeyword(GUILD, added.id!), true);
  assert.equal((await repo.listKeywords(GUILD)).length, 0);
});

await test('room: upsert, riwayat berurutan, statistik', async () => {
  await repo.createRoom(CHANNEL, GUILD, USER);
  await repo.createRoom(CHANNEL, GUILD, USER); // upsert, tidak boleh error

  assert.equal((await repo.getRoomByChannel(CHANNEL))?.userId, USER);
  assert.equal((await repo.getRoomByUser(GUILD, USER))?.channelId, CHANNEL);

  await repo.appendMessage(CHANNEL, 'user', 'Halo');
  await repo.appendMessage(CHANNEL, 'assistant', 'Hai!');
  await repo.touchRoom(CHANNEL, 2);

  const history = await repo.getHistory(CHANNEL, 2);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.content, 'Halo');
  assert.equal(history[1]?.role, 'assistant');
  assert.equal((await repo.getRoomByChannel(CHANNEL))?.messageCount, 2);

  assert.equal(await repo.countGuildMessages(GUILD), 2);
  assert.equal(await repo.countGuildRows(GUILD, 'rooms'), 1);

  const series = await repo.messagesPerDay(GUILD, 7);
  assert.equal(series.length, 7);
  assert.equal(series[6]?.count, 2);

  assert.equal(await repo.clearHistory(CHANNEL), 2);
  await repo.deleteRoom(CHANNEL);
  assert.equal(await repo.getRoomByChannel(CHANNEL), null);
});

console.log('\nDokumen RAG');

await test('dokumen: insert, chunk, hitung, hapus', async () => {
  const documentId = await repo.insertDocument({
    guildId: GUILD,
    name: 'faq.md',
    chars: 120,
    createdBy: USER,
  });
  assert.ok(documentId > 0);

  await repo.insertChunks(documentId, GUILD, [
    { content: 'Jam operasional 08.00-22.00 WIB.' },
    { content: 'Giveaway setiap Jumat.' },
  ]);

  const documents = await repo.listDocuments(GUILD);
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.chunkCount, 2, 'subquery COUNT(*) harus terbaca sebagai angka');

  const chunks = await repo.listChunks(GUILD);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.documentName, 'faq.md');

  assert.equal((await repo.findDocumentByName(GUILD, 'FAQ.MD'))?.id, documentId);
  assert.equal(await repo.countChunks(GUILD), 2);

  assert.equal(await repo.deleteDocument(GUILD, documentId), true);
  assert.equal((await repo.listDocuments(GUILD)).length, 0);
});

console.log('\nModerasi');

await test('moderasi: pengaturan upsert + log', async () => {
  assert.equal(await repo.getModerationSettings(GUILD), null);

  await repo.setModerationSettings({
    guildId: GUILD,
    enabled: true,
    words: ['anjing', 'bangsat'],
    action: 'timeout',
    timeoutMinutes: 30,
  });
  await repo.setModerationSettings({
    guildId: GUILD,
    enabled: false,
    words: ['anjing'],
    action: 'warn',
    timeoutMinutes: 5,
  });

  const settings = await repo.getModerationSettings(GUILD);
  assert.equal(settings?.enabled, false);
  assert.deepEqual(settings?.words, ['anjing']);
  assert.equal(settings?.action, 'warn');

  const logId = await repo.addModerationLog({
    guildId: GUILD,
    channelId: CHANNEL,
    userId: USER,
    userName: 'Bagas',
    content: 'dasar anjing',
    matched: 'anjing',
    action: 'warn',
  });

  assert.equal(await repo.countModerationLogs(GUILD), 1);
  const [log] = await repo.listModerationLogs(GUILD);
  assert.equal(log?.id, logId);
  assert.equal(log?.matched, 'anjing');

  assert.equal(await repo.deleteModerationLog('g-lain', logId), false);
  assert.equal(await repo.deleteModerationLog(GUILD, logId), true);
  assert.equal(await repo.countModerationLogs(GUILD), 0);
});

/* ------------------------------------------------------------------ */

await driver.close();

console.log(`\n${failed === 0 ? '🎉' : '⚠️'} Selesai — ${passed} lulus, ${failed} gagal.\n`);
