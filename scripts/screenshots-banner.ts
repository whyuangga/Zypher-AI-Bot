/**
 * Banner contoh untuk screenshot dokumentasi.
 *
 * Dipisah dari `screenshots-seed.ts` supaya logika Chromium (opsional) tidak
 * mengotori skrip seed. Banner dipakai halaman Sambutan sebagai contoh nyata —
 * supaya pembaca dokumentasi melihat fitur unggah banner dalam keadaan terpakai,
 * bukan kotak kosong.
 *
 * Kalau Chromium tidak tersedia, fungsi ini mengembalikan `null` dan screenshot
 * tetap dibuat tanpa banner. Dokumentasi tidak boleh gagal hanya karena itu.
 */
import { existsSync } from 'node:fs';
import { logger } from '../src/lib/logger.js';

const WIDTH = 1200;
const HEIGHT = 400;

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH?.trim(),
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/tmp/chromium',
].filter((value): value is string => Boolean(value));

function findChromium(): string | null {
  return CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** Gradien gelap dengan nama komunitas — netral, tidak meniru foto siapa pun. */
function buildSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2b1b4d"/>
      <stop offset="50%" stop-color="#6d4f8f"/>
      <stop offset="100%" stop-color="#c98b7a"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)"/>
  <text x="56" y="${HEIGHT - 56}" font-family="sans-serif" font-size="42" font-weight="600" fill="#ffffff" opacity="0.92">Komunitas Zypher</text>
</svg>`;
}

/**
 * Render PNG. `null` = Chromium tidak ada / gagal.
 *
 * Nama modul lewat variabel karena `puppeteer-core` bukan dependency resmi
 * (sama seperti `welcome-card.ts`) — typecheck tidak boleh bergantung padanya.
 */
export async function renderDemoBanner(): Promise<Buffer | null> {
  const executablePath = findChromium();
  if (!executablePath) {
    logger.info('Banner contoh dilewati: Chromium tidak ditemukan.');
    return null;
  }

  try {
    const moduleName = 'puppeteer-core';
    const puppeteer = (await import(moduleName)) as unknown as {
      launch(options: Record<string, unknown>): Promise<{
        newPage(): Promise<{
          setViewport(options: Record<string, unknown>): Promise<void>;
          setContent(html: string, options?: Record<string, unknown>): Promise<void>;
          screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
        }>;
        close(): Promise<void>;
      }>;
    };

    const browser = await puppeteer.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      env: process.env as Record<string, string>,
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
      await page.setContent(
        `<html><body style="margin:0">${buildSvg()}</body></html>`,
        { waitUntil: 'load' },
      );
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      });
      return Buffer.from(png);
    } finally {
      await browser.close();
    }
  } catch (error) {
    logger.warn('Gagal merender banner contoh', (error as Error).message);
    return null;
  }
}
