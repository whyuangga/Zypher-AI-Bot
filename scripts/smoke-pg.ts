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
process.env.GUILD_ID = '123456789012345678';
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
});

await test('nama server tersimpan & bisa dibaca dashboard', async () => {
  await repo.setGuildName(GUILD, 'Server pg-mem');
  assert.equal((await repo.getGuildSettings(GUILD))?.name, 'Server pg-mem');
  assert.equal(await repo.getGuildName(GUILD), 'Server pg-mem');
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

await test('sesi DM: upsert, riwayat berurutan, statistik', async () => {
  const dmKey = `dm:${USER}`;

  await repo.setDmSession(USER, GUILD);
  await repo.setDmSession(USER, GUILD); // upsert, tidak boleh error

  assert.equal((await repo.getDmSession(USER))?.userId, USER);
  assert.equal((await repo.getDmSession(USER))?.guildId, GUILD);
  assert.equal((await repo.listDmSessions(GUILD)).length, 1);

  await repo.appendMessage(dmKey, 'user', 'Halo');
  await repo.appendMessage(dmKey, 'assistant', 'Hai!');
  await repo.touchDmSession(USER, 2);

  const history = await repo.getHistory(dmKey, 2);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.content, 'Halo');
  assert.equal(history[1]?.role, 'assistant');
  assert.equal((await repo.getDmSession(USER))?.messageCount, 2);

  assert.equal(await repo.countGuildMessages(GUILD), 2);
  assert.equal(await repo.countGuildRows(GUILD, 'dm_sessions'), 1);

  const series = await repo.messagesPerDay(GUILD, 7);
  assert.equal(series.length, 7);
  assert.equal(series[6]?.count, 2);

  assert.equal(await repo.clearHistory(dmKey), 2);
  await repo.deleteDmSession(USER);
  assert.equal(await repo.getDmSession(USER), null);
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
/*  Sambutan, perpisahan & AI Agent (kolom baru)                       */
/* ------------------------------------------------------------------ */

// Fitur ini menambah kolom & tabel baru (banner_path, image_enabled,
// include_avatar, tabel goodbye). Tanpa test di sini, Postgres bisa gagal
// hanya di produksi sementara SQLite tetap hijau.
await test('welcome: kolom banner_path ada & bisa disimpan', async () => {
  const repo = await import('../src/db/repo.js');
  const guild = 'g-welcome-pg';

  const awal = await repo.getWelcomeSettings(guild);
  assert.equal(awal.bannerPath, null, 'default tanpa banner');

  await repo.saveWelcomeSettings(guild, { enabled: true, bannerPath: 'banner-abc.png', style: 'santai' });
  const saved = await repo.getWelcomeSettings(guild);
  assert.equal(saved.enabled, true);
  assert.equal(saved.bannerPath, 'banner-abc.png');
  assert.equal(saved.style, 'santai');

  await repo.saveWelcomeSettings(guild, { bannerPath: null });
  assert.equal((await repo.getWelcomeSettings(guild)).bannerPath, null, 'banner bisa dihapus');
});

await test('goodbye: tabel ada di Postgres & patch sebagian aman', async () => {
  const repo = await import('../src/db/repo.js');
  const guild = 'g-goodbye-pg';

  const awal = await repo.getGoodbyeSettings(guild);
  assert.equal(awal.enabled, false);
  assert.equal(awal.imageEnabled, false, 'kartu perpisahan default mati');
  assert.equal(awal.includeAvatar, true);

  await repo.saveGoodbyeSettings(guild, {
    enabled: true,
    channelId: '1400000000000000002',
    bannerPath: 'banner-xyz.webp',
    imageEnabled: true,
  });
  await repo.saveGoodbyeSettings(guild, { enabled: false });

  const saved = await repo.getGoodbyeSettings(guild);
  assert.equal(saved.enabled, false);
  assert.equal(saved.channelId, '1400000000000000002', 'channel lama dipertahankan');
  assert.equal(saved.bannerPath, 'banner-xyz.webp', 'banner lama dipertahankan');
  assert.equal(saved.imageEnabled, true, 'toggle kartu dipertahankan');
});

await test('agent: gallery_channel_id ada di Postgres', async () => {
  const repo = await import('../src/db/repo.js');
  const guild = 'g-agent-pg';

  await repo.saveAgentSettings(guild, {
    channelId: '1400000000000000003',
    galleryChannelId: '1400000000000000004',
  });
  const saved = await repo.getAgentSettings(guild);
  assert.equal(saved.channelId, '1400000000000000003');
  assert.equal(saved.galleryChannelId, '1400000000000000004', 'channel galeri tersimpan');

  await repo.saveAgentSettings(guild, { galleryChannelId: null });
  assert.equal((await repo.getAgentSettings(guild)).galleryChannelId, null);
});

await test('guilds: timezone ada di PostgreSQL', async () => {
  const repo = await import('../src/db/repo.js');
  const guild = 'g-timezone-pg';

  await repo.setGuildTimeZone(guild, 'Asia/Makassar');
  assert.equal((await repo.getGuildSettings(guild))?.timezone, 'Asia/Makassar', 'tersimpan');
  assert.equal(await repo.resolveTimeZone(guild), 'Asia/Makassar', 'dipakai');

  // Normalisasi berlaku juga di jalur Postgres.
  await repo.setGuildTimeZone(guild, 'WIT');
  assert.equal((await repo.getGuildSettings(guild))?.timezone, 'Asia/Jayapura', 'label -> IANA');
});

await test('agent: quiet_hours ada di Postgres', async () => {
  const repo = await import('../src/db/repo.js');
  const guild = 'g-agent-quiet-pg';

  await repo.saveAgentSettings(guild, { quietHours: true });
  assert.equal((await repo.getAgentSettings(guild)).quietHours, true, 'bisa dinyalakan');

  await repo.saveAgentSettings(guild, { quietHours: false });
  assert.equal((await repo.getAgentSettings(guild)).quietHours, false, 'bisa dimatikan');
});

/* ------------------------------------------------------------------ */
/*  Pesan container (tabel custom_posts)                               */
/* ------------------------------------------------------------------ */

console.log('\nPesan container');

await test('posting: simpan, baca, perbarui, hapus', async () => {
  const guild = 'g-posts-pg';

  const dibuat = await repo.createCustomPost(guild, {
    name: 'Rules',
    channelId: '1400000000000000001',
    blocks: [
      { kind: 'text', value: 'Aturan server' },
      { kind: 'divider' },
      { kind: 'button', value: 'Gabung', url: 'https://discord.gg/x' },
    ],
  });
  // `insert()` memakai RETURNING id di Postgres — kalau pemetaan itu salah,
  // id akan NaN dan semua operasi berikutnya ikut gagal.
  assert.ok(Number.isInteger(dibuat.id) && dibuat.id > 0, `id berupa angka, dapat ${dibuat.id}`);
  assert.equal(dibuat.name, 'Rules');
  assert.deepEqual(dibuat.blocks.map((b) => b.kind), ['text', 'divider', 'button']);
  assert.equal(dibuat.messageId, null, 'belum pernah dikirim');

  // Tahap "dikirim": ID pesan Discord disimpan supaya bisa diperbarui.
  await repo.setCustomPostMessage(guild, dibuat.id, '999888777666555444');
  const terkirim = await repo.getCustomPost(guild, dibuat.id);
  assert.equal(terkirim!.messageId, '999888777666555444', 'ID pesan tersimpan');

  const diubah = await repo.updateCustomPost(guild, dibuat.id, {
    name: 'Rules v2',
    blocks: [{ kind: 'text', value: 'Versi kedua' }],
  });
  assert.equal(diubah!.name, 'Rules v2');
  assert.equal(diubah!.blocks.length, 1, 'blok lama diganti');
  assert.equal(diubah!.messageId, '999888777666555444', 'ID pesan dipertahankan saat isi diubah');

  await repo.deleteCustomPost(guild, dibuat.id);
  assert.equal(await repo.getCustomPost(guild, dibuat.id), null, 'terhapus');
});

await test('posting: blok berbahaya dibuang sebelum disimpan', async () => {
  const guild = 'g-posts-pg-jahat';
  const dibuat = await repo.createCustomPost(guild, {
    name: 'Uji',
    channelId: null,
    blocks: [
      { kind: 'text', value: 'Aman' },
      { kind: 'button', value: 'Jahat', url: 'javascript:alert(1)' },
      { kind: 'image', value: 'bukan-url' },
    ],
  });
  // Yang disimpan hanya bentuk yang mungkin dikirim Discord.
  assert.deepEqual(dibuat.blocks.map((b) => b.kind), ['text'], 'hanya blok sah');
});

/* ------------------------------------------------------------------ */

await driver.close();

console.log(`\n${failed === 0 ? '🎉' : '⚠️'} Selesai — ${passed} lulus, ${failed} gagal.\n`);
