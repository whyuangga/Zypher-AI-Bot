/**
 * Kartu sambutan member baru (PNG).
 *
 * Kartu digambar langsung ke bitmap lewat `@napi-rs/canvas` (Skia), bukan lewat
 * browser. Alasannya konkret: versi sebelumnya merender SVG memakai Chromium,
 * dan Chromium **tidak tersedia di panel hosting** (Pterodactyl/Wispbyte tidak
 * memasangnya). Akibatnya mode "Card" tidak pernah menghasilkan kartu di server
 * sungguhan — yang terkirim selalu embed teks. Bot referensi bisa membuat kartu
 * di hosting yang sama karena menggambar dengan Pillow, bukan browser.
 *
 * `@napi-rs/canvas` adalah binding Skia yang membawa semua yang dibutuhkan di
 * dalam paketnya (nol library sistem, tidak perlu `apt install`), sehingga
 * kartu tetap jadi di hosting mana pun.
 *
 * Susunan kartu mengikuti gaya yang diminta: banner jadi **latar penuh**,
 * avatar bulat di tengah, "SELAMAT DATANG" besar, lalu nama member di bawahnya.
 */
import { join } from 'node:path';
import { createCanvas, GlobalFonts, type Image, loadImage } from '@napi-rs/canvas';
import { errorMessage, logger } from '../lib/logger.js';

const CARD_WIDTH = 1024;
const CARD_HEIGHT = 460;

/** Lokasi font yang dipakai kartu (self-host, tidak boleh ambil dari internet). */
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');
const FONT_FAMILY = 'General Sans';

let fontsRegistered = false;

/**
 * Daftarkan font kartu sekali saja.
 *
 * Font disimpan di repo supaya hasil kartu sama di semua server, tidak
 * bergantung pada font yang kebetulan terpasang di hosting.
 */
function registerFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const [file, weight] of [
    ['GeneralSans-Regular.woff2', 400],
    ['GeneralSans-Medium.woff2', 500],
  ] as const) {
    try {
      GlobalFonts.registerFromPath(join(FONT_DIR, file), FONT_FAMILY);
      void weight;
    } catch (error) {
      // Tanpa font kartu, Skia memakai font bawaan — kartu tetap jadi, hanya
      // bentuk hurufnya berbeda. Lebih baik begitu daripada tidak ada kartu.
      logger.warn(`Font kartu ${file} gagal dimuat`, errorMessage(error));
    }
  }
}

/**
 * Apakah renderer kartu siap dipakai.
 *
 * Sejak kartu digambar sendiri (bukan lewat browser), jawabannya praktis selalu
 * `true`. Fungsi ini tetap ada supaya dashboard dan test tidak perlu diubah
 * sekaligus, dan supaya kegagalan memuat modul native terdeteksi lebih awal
 * sebagai "tidak tersedia" alih-alih error saat member pertama bergabung.
 */
export function cardRendererAvailable(): boolean {
  try {
    registerFonts();
    return true;
  } catch (error) {
    logger.warn('Renderer kartu tidak bisa dipakai', errorMessage(error));
    return false;
  }
}

/**
 * Keterangan renderer untuk dashboard.
 *
 * Dulu isinya path Chromium. Sekarang tidak ada binary luar yang dicari, jadi
 * yang dilaporkan adalah mesin gambarnya — dipakai halaman Sambutan untuk
 * memastikan kartu memang bisa dibuat di server ini.
 */
export function chromiumPath(): string | null {
  return cardRendererAvailable() ? '@napi-rs/canvas (Skia)' : null;
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
  /** PNG/JPG/WebP yang sudah diunduh, dalam bentuk data URI. */
  avatarDataUri: string | null;
  /** Banner unggahan admin (data URI) — dipakai sebagai latar penuh kartu. */
  bannerDataUri?: string | null;
  /**
   * Judul utama di kartu. Sambutan: "SELAMAT DATANG", perpisahan: "SAMPAI JUMPA".
   */
  kicker?: string;
  /** Baris kecil di bawah nama, mis. "member ke-1.284". */
  detail?: string;
}

/**
 * Tinggi kartu.
 *
 * Kartu sekarang selalu sama tinggi: banner dipakai sebagai latar penuh (bukan
 * strip tambahan di atas), jadi kehadiran banner tidak lagi mengubah ukuran.
 * Dibiarkan sebagai fungsi supaya pemanggil dan test lama tetap jalan.
 */
export function cardHeight(_input?: { bannerDataUri?: string | null }): number {
  return CARD_HEIGHT;
}

/** Ubah data URI jadi gambar Skia. `null` bila kosong atau rusak. */
async function decode(uri: string | null | undefined): Promise<Image | null> {
  if (!uri) return null;
  try {
    return await loadImage(uri);
  } catch (error) {
    // Banner/avatar rusak tidak boleh menggagalkan sambutan: kartu tetap
    // dibuat dengan latar gradasi dan tanpa foto profil.
    logger.warn('Gambar kartu tidak bisa dibaca — dilewati', errorMessage(error));
    return null;
  }
}

/** Gambar `image` menutupi seluruh kotak (`object-fit: cover`), terpotong di tengah. */
function drawCover(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  image: Image,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function roundRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Avatar bulat dengan cincin terang, digambar di tengah `centerY`. */
function drawAvatar(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  avatar: Image | null,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  // Cincin luar: gelap dulu supaya avatar terpisah dari banner yang terang.
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 8, 18, 0.55)';
  ctx.fill();
  ctx.restore();

  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    // `drawCover` menggambar mulai dari (0,0); geser origin ke pojok kotak
    // lingkaran supaya hasil potongannya tepat di tengah avatar.
    ctx.translate(centerX - radius, centerY - radius);
    drawCover(ctx, avatar, radius * 2, radius * 2);
    ctx.restore();
  } else {
    // Tanpa foto profil: isi dengan gradasi tema + inisial nama.
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();
    const gradient = ctx.createLinearGradient(
      centerX - radius,
      centerY - radius,
      centerX + radius,
      centerY + radius,
    );
    gradient.addColorStop(0, '#6d4f8f');
    gradient.addColorStop(1, '#c98b7a');
    ctx.fillStyle = gradient;
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(240, 233, 230, 0.92)';
  ctx.lineWidth = 6;
  ctx.stroke();
}

/** Gambar kartu ke canvas baru. */
async function drawCard(input: CardInput): Promise<Buffer> {
  registerFonts();

  const [banner, avatar] = await Promise.all([
    decode(input.bannerDataUri),
    decode(input.avatarDataUri),
  ]);

  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  // --- Latar -------------------------------------------------------------
  // Banner menutupi SELURUH kartu. Tanpa banner, gradasi tema dipakai supaya
  // bentuk kartunya tetap sama (bukan kartu kosong).
  if (banner) {
    drawCover(ctx, banner, CARD_WIDTH, CARD_HEIGHT);
  } else {
    const base = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    base.addColorStop(0, '#1d1830');
    base.addColorStop(0.55, '#3a2b52');
    base.addColorStop(1, '#6d4a4a');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  // Overlay gelap dua lapis. Lapis pertama merata supaya teks putih selalu
  // terbaca di atas banner seterang apa pun; lapis kedua lebih pekat di tengah
  // ke bawah, tempat avatar dan judul berada.
  ctx.fillStyle = 'rgba(9, 8, 16, 0.34)';
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const shade = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  shade.addColorStop(0, 'rgba(9, 8, 16, 0.15)');
  shade.addColorStop(0.45, 'rgba(9, 8, 16, 0.55)');
  shade.addColorStop(1, 'rgba(6, 5, 11, 0.88)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // --- Avatar ------------------------------------------------------------
  const avatarRadius = 86;
  const avatarY = 152;
  drawAvatar(ctx, avatar, CARD_WIDTH / 2, avatarY, avatarRadius);

  // --- Teks --------------------------------------------------------------
  ctx.textAlign = 'center';

  // Judul besar ("SELAMAT DATANG"). Dikecilkan otomatis kalau kepanjangan.
  const kicker = (input.kicker ?? 'SELAMAT DATANG').toUpperCase().slice(0, 26);
  let kickerSize = 62;
  ctx.font = `500 ${kickerSize}px "${FONT_FAMILY}"`;
  while (kickerSize > 34 && ctx.measureText(kicker).width > CARD_WIDTH - 120) {
    kickerSize -= 2;
    ctx.font = `500 ${kickerSize}px "${FONT_FAMILY}"`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(kicker, CARD_WIDTH / 2, avatarY + avatarRadius + 82);

  // Nama member.
  const name = input.userName.slice(0, 28);
  let nameSize = 40;
  ctx.font = `500 ${nameSize}px "${FONT_FAMILY}"`;
  while (nameSize > 24 && ctx.measureText(name).width > CARD_WIDTH - 140) {
    nameSize -= 2;
    ctx.font = `500 ${nameSize}px "${FONT_FAMILY}"`;
  }
  ctx.fillStyle = '#f0e9e6';
  ctx.fillText(name, CARD_WIDTH / 2, avatarY + avatarRadius + 136);

  // Baris detail: nama server + jumlah member. Diberi kapsul gelap supaya tetap
  // terbaca kalau bagian bawah banner berwarna terang.
  const detail = (input.detail ?? `di ${input.guildName}`).slice(0, 64);
  ctx.font = `400 24px "${FONT_FAMILY}"`;
  const detailWidth = Math.min(ctx.measureText(detail).width + 52, CARD_WIDTH - 120);
  const detailY = avatarY + avatarRadius + 190;
  ctx.fillStyle = 'rgba(8, 6, 14, 0.55)';
  roundRect(ctx, CARD_WIDTH / 2 - detailWidth / 2, detailY - 30, detailWidth, 48, 24);
  ctx.fill();
  ctx.fillStyle = '#e6dad7';
  ctx.fillText(detail, CARD_WIDTH / 2, detailY + 2);

  return canvas.toBuffer('image/png');
}

/**
 * Render kartu jadi PNG.
 *
 * `null` hanya dikembalikan kalau penggambaran benar-benar gagal (mis. modul
 * native tidak bisa dimuat). Pemanggil memperlakukannya sebagai "jatuh ke
 * embed", tapi di hosting mana pun jalur itu seharusnya tidak terpakai lagi.
 */
export async function renderWelcomeCard(input: CardInput): Promise<Buffer | null> {
  try {
    return await drawCard(input);
  } catch (error) {
    logger.warn('Gagal merender kartu sambutan — pakai embed teks', errorMessage(error));
    return null;
  }
}

/** Dipakai skrip dokumentasi: SVG kecil yang tidak lagi butuh browser. */
export { escapeXml };
