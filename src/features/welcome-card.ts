/**
 * Kartu sambutan member baru (PNG).
 *
 * Kartu dirender dari SVG lalu dikonversi lewat Chromium bila tersedia
 * (`CHROMIUM_PATH` atau Chromium di lokasi standar). Alasan memakai Chromium:
 * Discord hanya mau menerima PNG/JPG; konversi SVG→PNG butuh renderer, dan
 * menambah library gambar baru dilarang (lihat aturan proyek: tanpa dependency
 * UI tambahan). Kalau Chromium tidak ada, pemanggil jatuh ke embed teks biasa —
 * sambutan tetap terkirim, hanya tanpa kartu.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage, logger } from '../lib/logger.js';

const CARD_WIDTH = 900;
const CARD_HEIGHT = 320;

/**
 * Tinggi strip banner di bagian atas kartu.
 *
 * Kalau banner dipakai, kartu jadi lebih tinggi supaya teks tetap punya ruang
 * dan tidak menimpa gambar. 110px cukup untuk menampilkan potongan gambar yang
 * masih bisa dikenali pada lebar 900px.
 */
const BANNER_HEIGHT = 110;

/** Lokasi font yang dipakai kartu (self-host, tidak boleh ambil dari internet). */
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

let cachedBrowserPath: string | null | undefined;

/** Cari Chromium sekali saja, lalu ingat hasilnya (termasuk "tidak ada"). */
function findChromium(): string | null {
  if (cachedBrowserPath !== undefined) return cachedBrowserPath;

  const explicit = process.env.CHROMIUM_PATH?.trim();
  const candidates = [
    explicit,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/tmp/chromium',
  ].filter((value): value is string => Boolean(value));

  cachedBrowserPath = candidates.find((candidate) => existsSync(candidate)) ?? null;
  if (!cachedBrowserPath) {
    logger.info('Kartu sambutan PNG dilewati: Chromium tidak ditemukan (pakai embed teks).');
  }
  return cachedBrowserPath;
}

/**
 * Apakah Chromium tersedia untuk merender kartu.
 *
 * Dipakai dashboard untuk memberi peringatan lebih awal: tanpa Chromium, kartu
 * PNG tidak pernah terkirim dan admin perlu tahu itu **sebelum** mengira fiturnya
 * rusak. Fungsi ini tidak memuat Chromium, hanya memeriksa keberadaan file.
 */
export function cardRendererAvailable(): boolean {
  return findChromium() !== null;
}

/** Path Chromium yang dipakai (null = tidak ditemukan). Untuk diagnosa. */
export function chromiumPath(): string | null {
  return findChromium();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Bungkus teks agar tidak melewati lebar kartu.
 *
 * Mengembalikan maksimal `maxLines` baris; kalau teksnya lebih panjang,
 * baris terakhir dipotong dan diberi elipsis.
 */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let consumed = 0; // jumlah kata yang sudah masuk baris

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine || !current) {
      current = candidate;
      consumed += 1;
      continue;
    }
    lines.push(current);
    current = word;
    consumed += 1;
    if (lines.length === maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);

  // Masih ada kata yang belum ditampilkan → tandai dengan elipsis.
  const truncated = consumed < words.length;
  if (truncated && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, perLine - 1)).trimEnd()}…`;
  }
  return lines;
}

export interface CardInput {
  userName: string;
  guildName: string;
  message: string;
  /** PNG/JPG yang sudah diunduh, dalam bentuk data URI. */
  avatarDataUri: string | null;
  /** Banner unggahan admin (data URI) — dipakai sebagai latar kartu. */
  bannerDataUri?: string | null;
  /**
   * Judul kecil di atas nama server. Sambutan: "SELAMAT DATANG",
   * perpisahan: "SAMPAI JUMPA".
   */
  kicker?: string;
}

/** Tinggi kartu untuk input tertentu (banner membuat kartu lebih tinggi). */
export function cardHeight(input: { bannerDataUri?: string | null }): number {
  return CARD_HEIGHT + (input.bannerDataUri ? BANNER_HEIGHT : 0);
}

function buildSvg(input: CardInput): string {
  // Kalau ada banner, semua teks digeser ke bawah selebar strip banner.
  const offset = input.bannerDataUri ? BANNER_HEIGHT : 0;
  const height = CARD_HEIGHT + offset;
  const name = input.userName.slice(0, 28);
  const lines = wrap(input.message, 52, 3);
  const hasAvatar = Boolean(input.avatarDataUri);
  const avatar = hasAvatar
    ? `<circle cx="126" cy="${172 + offset}" r="70" fill="none" stroke="#716c98" stroke-width="2" opacity="0.5"/>
  <image href="${input.avatarDataUri}" x="60" y="${106 + offset}" width="132" height="132" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
    : '';
  // Tanpa avatar, teks dirapatkan ke kiri supaya tidak ada ruang kosong besar.
  const textX = hasAvatar ? 232 : 60;
  const textLines = lines
    .map(
      (line, index) =>
        `<text x="${textX}" y="${202 + offset + index * 38}" font-family="General Sans, sans-serif" font-size="26" fill="#e2d1cc" opacity="0.94">${escapeXml(
          line,
        )}</text>`,
    )
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}">
  <defs>
    <clipPath id="avatarClip"><circle cx="126" cy="${172 + offset}" r="66"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#17141d"/>
      <stop offset="100%" stop-color="#0d0d0f"/>
    </linearGradient>
    <linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#141119" stop-opacity="0"/>
      <stop offset="100%" stop-color="#141119" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#716c98"/>
      <stop offset="100%" stop-color="#d0b2b7"/>
    </linearGradient>
  </defs>

  <rect width="${CARD_WIDTH}" height="${height}" fill="url(#bg)"/>
  ${
    // Banner dipasang sebagai STRIP di bagian atas, bukan latar penuh.
    // Alasannya: dengan latar penuh, teks milik banner (judul, logo) akan
    // bertabrakan dengan nama member dan sapaan — tidak ada penempatan yang
    // aman untuk semua gambar. Strip membuat batas jelas: gambar di atas,
    // teks di area gelap di bawahnya.
    input.bannerDataUri
      ? `<image href="${input.bannerDataUri}" x="0" y="0" width="${CARD_WIDTH}" height="${BANNER_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${BANNER_HEIGHT - 44}" width="${CARD_WIDTH}" height="44" fill="url(#fadeDown)"/>`
      : ''
  }
  <rect x="0" y="0" width="${CARD_WIDTH}" height="4" fill="url(#accent)"/>

  <text x="60" y="${62 + offset}" font-family="General Sans, sans-serif" font-size="15" letter-spacing="4" fill="#d0b2b7">${escapeXml(
    (input.kicker ?? 'SELAMAT DATANG').toUpperCase().slice(0, 24),
  )}</text>
  <text x="60" y="${94 + offset}" font-family="General Sans, sans-serif" font-size="34" font-weight="500" fill="#e2d1cc">${escapeXml(
    input.guildName.slice(0, 40),
  )}</text>

  ${avatar}
  <text x="${textX}" y="${160 + offset}" font-family="General Sans, sans-serif" font-size="40" font-weight="500" fill="#ffffff">${escapeXml(
    name,
  )}</text>
  ${textLines}
</svg>`;
}

/** Ubah SVG jadi PNG. `null` berarti Chromium tidak tersedia / gagal render. */
export async function renderWelcomeCard(input: CardInput): Promise<Buffer | null> {
  const executablePath = findChromium();
  if (!executablePath) return null;

  try {
    // Nama modul lewat variabel: paket ini opsional (tidak ada di package.json),
    // jadi typecheck tidak boleh bergantung pada deklarasinya.
    const puppeteerModule = 'puppeteer-core';
    const puppeteer = (await import(puppeteerModule)) as unknown as {
      launch(options: Record<string, unknown>): Promise<{
        newPage(): Promise<{
          setViewport(options: Record<string, unknown>): Promise<void>;
          setContent(html: string, options?: Record<string, unknown>): Promise<void>;
          evaluate(expression: string): Promise<unknown>;
          screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
        }>;
        close(): Promise<void>;
      }>;
    };
    const svg = buildSvg(input);
    const height = cardHeight(input);

    // Font di-embed sebagai data URI supaya kartu tidak bergantung pada
    // font yang terpasang di server.
    let svgWithFonts = svg;
    try {
      const [regular, medium] = await Promise.all([
        readFile(join(FONT_DIR, 'GeneralSans-Regular.woff2')),
        readFile(join(FONT_DIR, 'GeneralSans-Medium.woff2')),
      ]);
      const toUri = (buffer: Buffer) => `data:font/woff2;base64,${buffer.toString('base64')}`;
      svgWithFonts = svg.replace(
        '<defs>',
        `<defs><style>
          @font-face { font-family: "General Sans"; font-weight: 400; src: url("${toUri(regular)}") format("woff2"); }
          @font-face { font-family: "General Sans"; font-weight: 500 700; src: url("${toUri(medium)}") format("woff2"); }
        </style>`,
      );
    } catch {
      // Font tidak ada — Chromium tetap bisa render dengan font sistem.
    }

    const browser = await puppeteer.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      env: process.env as Record<string, string>,
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: CARD_WIDTH, height, deviceScaleFactor: 2 });
      await page.setContent(
        `<html><body style="margin:0">${svgWithFonts}</body></html>`,
        { waitUntil: 'load' },
      );
      await page.evaluate('document.fonts.ready');
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CARD_WIDTH, height } });
      return Buffer.from(png);
    } finally {
      await browser.close();
    }
  } catch (error) {
    logger.warn('Gagal merender kartu sambutan — pakai embed teks', errorMessage(error));
    return null;
  }
}
