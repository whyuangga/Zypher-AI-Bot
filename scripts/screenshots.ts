/**
 * Ambil screenshot dokumentasi dashboard dari build yang sedang berjalan.
 *
 * Skrip ini butuh Chromium. Di mesin biasa:
 *
 *   npx playwright install chromium     # sekali saja
 *   npm run screenshots
 *
 * Kalau tidak memakai Playwright, arahkan `CHROMIUM_PATH` ke binary Chromium
 * atau Chrome yang sudah ada:
 *
 *   CHROMIUM_PATH=/usr/bin/chromium npm run screenshots
 *
 * Alur lengkap (dashboard demo + screenshot):
 *
 *   DATABASE_PATH=./data/screenshot.db npm run screenshots:seed
 *   DATABASE_PATH=./data/screenshot.db DASHBOARD_PORT=8899 npm run dashboard &
 *   DASHBOARD_TOKEN=... npm run screenshots
 *
 * Semua halaman yang tampil hanya berisi data demo tanpa isi percakapan,
 * memori member, atau cuplikan pesan member.
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.SCREENSHOT_URL ?? `http://127.0.0.1:${process.env.DASHBOARD_PORT ?? 8899}`;
const TOKEN = process.env.DASHBOARD_TOKEN ?? '';
const OUT_DIR = process.env.SCREENSHOT_DIR ?? 'docs/screenshots';

if (!TOKEN) {
  console.error('DASHBOARD_TOKEN kosong — isi DASHBOARD_TOKEN (sama dengan yang dipakai dashboard).');
  process.exit(1);
}

/** Halaman yang difoto: [slug, path, judul]. */
const PAGES: Array<[string, string, string]> = [
  ['ringkasan', '/', 'Ringkasan'],
  ['panel', '/panel', 'Panel'],
  ['dokumen', '/dokumen', 'Dokumen RAG'],
  ['keyword', '/keyword', 'Keyword'],
  ['moderasi', '/moderasi', 'Moderasi'],
  ['pengaturan', '/pengaturan', 'Pengaturan'],
];

/** Dua ukuran layar: desktop 1440px dan HP 390px (sesuai README lama). */
const VIEWPORTS: Array<[string, number, number]> = [
  ['desktop', 1440, 1000],
  ['mobile', 390, 844],
];

async function resolveBrowser(): Promise<{ path: string; args: string[] }> {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return { path: explicit, args: [] };

  // Playwright menyimpan browser di cache-nya sendiri. Dimuat lewat nama
  // variabel supaya paket opsional ini tidak diwajibkan saat typecheck.
  try {
    const mod = 'playwright-core';
    const { chromium } = (await import(mod)) as { chromium: { executablePath(): string } };
    return { path: chromium.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  } catch {
    /* lanjut ke pencarian manual */
  }

  for (const candidate of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/tmp/chromium',
  ]) {
    const { existsSync } = await import('node:fs');
    if (existsSync(candidate)) return { path: candidate, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  }

  console.error(
    'Chromium tidak ditemukan.\n' +
      'Pasang dengan "npx playwright install chromium", atau set CHROMIUM_PATH ke binary Chromium/Chrome.',
  );
  process.exit(1);
}

const browserInfo = await resolveBrowser();
const puppeteer = await import('puppeteer-core');

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.default.launch({
  executablePath: browserInfo.path,
  headless: true,
  args: [...browserInfo.args, '--font-render-hinting=none'],
});

try {
  const page = await browser.newPage();

  // Halaman login difoto SEBELUM login, karena setelah masuk tidak bisa dibuka lagi.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.evaluate('document.fonts.ready');
  await new Promise((resolve) => setTimeout(resolve, 250));
  await page.screenshot({ path: join(OUT_DIR, 'login-mobile.png'), fullPage: true });
  console.log(`  ${join(OUT_DIR, 'login-mobile.png')}  (390px) — Login`);

  // Login lewat form supaya cookie sesi (httpOnly) terpasang seperti pemakaian nyata.
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="token"]', TOKEN);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);

  console.log(`Login OK — ${page.url()}`);

  for (const [slugPath, path, title] of PAGES) {
    // Dashboard hanya punya satu server (GUILD_ID) — tidak ada query ?guild= lagi.
    const url = `${BASE_URL}${path}`;

    for (const [size, width, height] of VIEWPORTS) {
      await page.setViewport({ width, height, deviceScaleFactor: 2 });
      await page.goto(url, { waitUntil: 'networkidle0' });

      // Beri waktu font self-host selesai dimuat sebelum memotret.
      await page.evaluate('document.fonts.ready');
      await new Promise((resolve) => setTimeout(resolve, 250));

      const file = join(OUT_DIR, `${slugPath}-${size}.png`);
      await page.screenshot({ path: file, fullPage: true });

      const buffer = await import('node:fs/promises').then((fs) => fs.stat(file));
      console.log(`  ${file}  (${width}px, ${Math.round(buffer.size / 1024)} KB) — ${title}`);
    }
  }
} finally {
  await browser.close();
}

console.log(`\nSelesai. ${PAGES.length * VIEWPORTS.length + 1} file di ${OUT_DIR}/`);
