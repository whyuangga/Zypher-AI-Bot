/**
 * Uji tombol dashboard dari sisi browser sungguhan.
 *
 * Kenapa perlu: typecheck hanya melihat TypeScript, sedangkan JS yang dikirim
 * ke browser ada di dalam template literal. Bug seperti `postJson` yang tidak
 * pernah didefinisikan lolos dari typecheck dan smoke test server — hanya
 * ketahuan saat tombol diklik. Skrip ini mengklik tombol tes/simpan di halaman
 * Sambutan dan AI Agent, lalu gagal kalau ada error JS di console.
 *
 * Kenapa tidak masuk `npm run smoke`: butuh Chromium (~150 MB) dan dashboard
 * yang hidup, jadi terlalu lambat untuk dijalankan tiap kali. Yang selalu
 * jalan di CI adalah `npm run test:ui` (tanpa browser) — skrip ini adalah
 * lapis kedua untuk memeriksa hal yang hanya terlihat di browser sungguhan:
 * layout, posisi, dan interaksi yang bergantung pada CSS.
 *
 * Cara pakai:
 *
 *   # 1. pasang Chromium sekali saja
 *   npx playwright install chromium   (atau pakai Chrome yang sudah ada)
 *
 *   # 2. nyalakan dashboard di terminal lain
 *   DASHBOARD_TOKEN=rahasia DASHBOARD_PORT=8899 npm run dashboard
 *
 *   # 3. jalankan uji
 *   DASHBOARD_TOKEN=rahasia npm run test:browser
 *
 * Variabel opsional: CHROMIUM_PATH (default dicari otomatis), DASHBOARD_PORT.
 */
import puppeteer from 'puppeteer-core';

const PORT = process.env.DASHBOARD_PORT ?? '8899';
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.DASHBOARD_TOKEN ?? '';

if (!TOKEN) {
  console.error('DASHBOARD_TOKEN wajib diisi (token yang sama dengan dashboard).');
  process.exit(1);
}

/**
 * Cari Chromium tanpa menyuruh user mengatur path manual: variabel lingkungan
 * lebih dulu, lalu lokasi unduhan Playwright, lalu binary sistem.
 */
async function findChromium(): Promise<string> {
  const { existsSync } = await import('node:fs');
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/tmp/chromium',
  ].filter((value): value is string => Boolean(value));

  // Unduhan Playwright: ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome
  const { homedir } = await import('node:os');
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium-')) continue;
      candidates.push(join(cache, entry, 'chrome-linux', 'chrome'));
      candidates.push(join(cache, entry, 'chrome-linux', 'headless_shell'));
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  console.error(
    'Chromium tidak ditemukan.\n' +
      '  Pasang sekali saja:  npx playwright install chromium\n' +
      '  Atau tunjuk binary:  CHROMIUM_PATH=/path/ke/chrome npm run test:browser',
  );
  process.exit(2);
}

const CHROMIUM = await findChromium();

/**
 * Buat PNG uji 320x180 tanpa dependency gambar: PNG minimal dengan satu IDAT
 * berisi baris yang diulang. Ditulis ke file sementara agar bisa diunggah
 * lewat input file di browser.
 */
async function writeTestBanner(): Promise<string> {
  const { writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { deflateSync } = await import('node:zlib');

  const width = 320;
  const height = 180;

  // Setiap baris: 1 byte filter (0 = none) + width * 3 byte RGB.
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 3;
      raw[at] = 60 + Math.round((x / width) * 120);
      raw[at + 1] = 90 + Math.round((y / height) * 90);
      raw[at + 2] = 180;
    }
  }

  const crcTable: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const path = join(tmpdir(), `banner-uji-${Date.now()}.png`);
  await writeFile(path, png);
  return path;
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

/* ---------------- unggah banner ---------------- */
await page.goto(`${BASE}/sambutan`, { waitUntil: 'networkidle2' });

// Buat gambar uji sendiri supaya skrip tidak bergantung file di /tmp.
// 320x180 (16:9) supaya lolos validasi "gambar terlalu kecil".
const bannerPath = await writeTestBanner();
const fileInput = await page.$('#bannerFile-welcome');
if (fileInput) {
  await (fileInput as unknown as { uploadFile(path: string): Promise<void> }).uploadFile(bannerPath);
  await page.waitForFunction(() => document.getElementById('bannerImg-welcome')?.hidden === false, {
    timeout: 25000,
  });
  const banner = await page.evaluate(() => {
    const image = document.getElementById('bannerImg-welcome') as HTMLImageElement;
    return { shown: !image.hidden, src: image.src.slice(0, 30), width: image.naturalWidth };
  });
  console.log('unggah banner:', JSON.stringify(banner));
  if (!banner.shown) errors.push('banner tidak tampil setelah diunggah');
} else {
  errors.push('input banner tidak ditemukan');
}

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
