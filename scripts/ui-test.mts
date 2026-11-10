/**
 * Uji tombol dashboard dari sisi browser sungguhan.
 *
 * Kenapa perlu: typecheck hanya melihat TypeScript, sedangkan JS yang dikirim
 * ke browser ada di dalam template literal. Bug seperti `postJson` yang tidak
 * pernah didefinisikan lolos dari typecheck dan smoke test server — hanya
 * ketahuan saat tombol diklik. Skrip ini mengklik tombol tes/simpan di halaman
 * Sambutan dan AI Agent, lalu gagal kalau ada error JS di console.
 *
 * Jalankan setelah dashboard hidup (lihat docs/screenshots/README.md untuk
 * resep Chromium di sandbox):
 *   DASHBOARD_TOKEN=... DASHBOARD_PORT=8899 CHROMIUM_PATH=... \
 *   LD_LIBRARY_PATH=... npx tsx scripts/ui-test.mts
 *
 * Tidak masuk `npm run smoke` karena butuh dashboard + Chromium (lambat dan
 * tidak tersedia di semua mesin).
 */
import puppeteer from 'puppeteer-core';

const PORT = process.env.DASHBOARD_PORT ?? '8899';
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.DASHBOARD_TOKEN ?? '';
const CHROMIUM = process.env.CHROMIUM_PATH || '/tmp/chromium';

if (!TOKEN) {
  console.error('DASHBOARD_TOKEN wajib diisi.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROMIUM,
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (error: Error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message: { type(): string; text(): string }) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.type('input[name="token"]', TOKEN);
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type="submit"]')]);

/* ---------------- halaman Sambutan ---------------- */
await page.goto(`${BASE}/sambutan`, { waitUntil: 'networkidle2' });
const hasPostJson = await page.evaluate(() => typeof (window as unknown as { postJson?: unknown }).postJson);
console.log('typeof postJson di browser:', hasPostJson);

await page.click('button[onclick="runTest(\'welcome\', true)"]');
await page.waitForFunction(() => document.getElementById('outWelcome')?.hidden === false, { timeout: 25000 });
const welcome = await page.evaluate(() => ({
  text: document.getElementById('textWelcome')?.textContent,
  meta: document.getElementById('metaWelcome')?.textContent,
  cardShown: document.getElementById('cardWelcome')?.hidden === false,
}));
console.log('tes sambutan (tanpa AI):', JSON.stringify(welcome));

await page.click('button[onclick="runTest(\'goodbye\', true)"]');
await page.waitForFunction(() => document.getElementById('outGoodbye')?.hidden === false, { timeout: 25000 });
const goodbye = await page.evaluate(() => document.getElementById('textGoodbye')?.textContent);
console.log('tes perpisahan (tanpa AI):', goodbye);

/* ---------------- halaman AI Agent ---------------- */
await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle2' });
await page.click('#testChat');
await page.waitForFunction(() => document.getElementById('outAgent')?.hidden === false, { timeout: 25000 });
const agent = await page.evaluate(() => ({
  meta: document.getElementById('metaAgent')?.textContent,
  text: document.getElementById('textAgent')?.textContent,
}));
console.log('tes balasan agent:', JSON.stringify(agent));

await page.click('#testQuiet');
// Hasil bisa "kalimat pemecah sepi" (AI jalan) atau "gagal membuat kalimat"
// (provider menolak) — dua-duanya sah, yang penting UI berubah dari keadaan awal.
await page.waitForFunction(
  () => {
    const meta = document.getElementById('metaAgent')?.textContent ?? '';
    return meta.includes('sepi') || meta.includes('tidak akan menyapa') || meta.includes('gagal');
  },
  { timeout: 25000 },
);
console.log('tes pemecah sepi:', await page.evaluate(() => document.getElementById('metaAgent')?.textContent));

/* ---------------- tombol Simpan benar-benar menyimpan ---------------- */
await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle2' });
await page.evaluate(() => {
  (document.getElementById('agentQuiet') as HTMLInputElement).value = '30';
});
await page.click('button[onclick="saveAgent()"]');
await page.waitForFunction(
  () => (document.getElementById('toast')?.textContent ?? '').includes('disimpan'),
  { timeout: 15000 },
);
console.log('simpan agent:', await page.evaluate(() => document.getElementById('toast')?.textContent));

console.log('error JS di browser:', errors.length ? errors : 'tidak ada');
await browser.close();
if (errors.length) process.exitCode = 1;
