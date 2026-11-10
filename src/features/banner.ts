import { AttachmentBuilder } from 'discord.js';

/**
 * Banner kartu sambutan & salam perpisahan.
 *
 * Admin bisa mengunggah gambar sendiri dari dashboard; gambar ini dipakai
 * sebagai **latar kartu PNG** (menimpa latar gradien bawaan) dan sebagai
 * **gambar embed** kalau kartu dimatikan.
 *
 * Kenapa disimpan sebagai file, bukan BLOB di database:
 *   - database tetap kecil dan cepat di-backup,
 *   - gambar bisa diganti/dihapus dengan menghapus satu file,
 *   - screenshot & test tidak perlu membaca kolom besar.
 *
 * Lokasi: `data/banners/<nama-acak>.<ext>` (`data/` sudah di-.gitignore, jadi
 * banner milik admin tidak pernah ikut ter-commit).
 *
 * Validasi sengaja ketat karena ini file yang datang dari browser:
 *   - hanya PNG / JPEG / WebP (format yang pasti didukung Discord),
 *   - maksimal 8 MB,
 *   - harus benar-benar gambar (magic bytes diperiksa, bukan cuma ekstensi),
 *   - ukuran piksel dibaca dari header untuk memberi pesan yang berguna.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, logger } from '../lib/logger.js';

/** Folder penyimpanan banner. Dibuat saat pertama dibutuhkan. */
export const BANNER_DIR = join(process.cwd(), 'data', 'banners');

/** Batas ukuran file — Discord sendiri membatasi 10 MB, kita lebih ketat. */
export const MAX_BANNER_BYTES = 8 * 1024 * 1024;

/** Nama file hanya boleh huruf/angka/titik/dash — mencegah path traversal. */
const SAFE_NAME = /^[a-z0-9][a-z0-9.-]{0,60}\.(png|jpg|jpeg|webp)$/;

export class BannerError extends Error {}

export interface BannerInfo {
  /** true = banner tersimpan (data URI base64), false = dihapus. */
  ok: boolean;
  name: string | null;
  width?: number;
  height?: number;
  bytes?: number;
}

/* ------------------------------------------------------------------ */
/*  Deteksi format                                                     */
/* ------------------------------------------------------------------ */

interface ImageMeta {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
}

/**
 * Kenali format dari magic bytes lalu baca dimensi dari header.
 *
 * Tidak memakai library gambar: cukup membaca beberapa byte pertama. Kalau
 * dimensi tidak bisa dibaca, `width`/`height` = 0 (banner tetap diterima
 * selama formatnya sah).
 */
export function detectImage(buffer: Buffer): ImageMeta | null {
  // 12 byte cukup untuk mengenali ketiga format; JPEG yang sah pun bisa sangat
  // kecil, jadi batas bawah dibuat rendah dan tiap parser memeriksa sendiri.
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, lalu IHDR di offset 16.
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      mime: 'image/png',
      ext: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG: FF D8 FF, dimensi dicari di penanda SOFn.
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1]!;
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 (bukan DHT/DAC/RST).
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return {
          mime: 'image/jpeg',
          ext: 'jpg',
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
    return { mime: 'image/jpeg', ext: 'jpg', width: 0, height: 0 };
  }

  // WebP: RIFF....WEBP, lalu varian VP8/VP8L/VP8X.
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const variant = buffer.subarray(12, 16).toString('ascii');
    let width = 0;
    let height = 0;
    if (variant === 'VP8 ' && buffer.length > 30) {
      width = buffer.readUInt16LE(26) & 0x3fff;
      height = buffer.readUInt16LE(28) & 0x3fff;
    } else if (variant === 'VP8L' && buffer.length > 25) {
      const bits = buffer.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (variant === 'VP8X' && buffer.length > 30) {
      width = buffer.readUIntLE(24, 3) + 1;
      height = buffer.readUIntLE(27, 3) + 1;
    }
    return { mime: 'image/webp', ext: 'webp', width, height };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Simpan / baca / hapus                                              */
/* ------------------------------------------------------------------ */

function bannerPath(name: string): string {
  return join(BANNER_DIR, name);
}

/** Pastikan nama file aman sebelum dipakai untuk apa pun. */
export function isSafeBannerName(name: string | null | undefined): name is string {
  return Boolean(name && SAFE_NAME.test(name));
}

/**
 * Simpan gambar unggahan.
 *
 * `dataUri` datang dari dashboard dalam bentuk `data:image/png;base64,...`.
 * Nama file dibuat acak supaya unggahan baru tidak menimpa yang lama dan tidak
 * bergantung pada nama asli dari user (yang bisa berisi apa saja).
 */
export async function saveBanner(dataUri: string, randomId: string): Promise<BannerInfo> {
  const match = /^data:image\/([a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUri.trim());
  if (!match) {
    throw new BannerError('Format gambar tidak dikenali. Unggah file PNG, JPG, atau WebP.');
  }

  const base64 = match[2]!.replace(/\s/g, '');
  // Perkiraan ukuran sebelum decode: 4 karakter base64 ≈ 3 byte.
  if (base64.length * 0.75 > MAX_BANNER_BYTES + 1024) {
    throw new BannerError(`Gambar terlalu besar. Maksimal ${Math.round(MAX_BANNER_BYTES / 1024 / 1024)} MB.`);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw new BannerError('Data gambar rusak — coba unggah ulang.');
  }
  if (buffer.byteLength === 0) throw new BannerError('Gambar kosong.');
  if (buffer.byteLength > MAX_BANNER_BYTES) {
    throw new BannerError(`Gambar terlalu besar (${Math.round(buffer.byteLength / 1024)} KB). Maksimal 8 MB.`);
  }

  // Format ditentukan dari ISI file, bukan dari MIME yang dikirim browser.
  const meta = detectImage(buffer);
  if (!meta) {
    throw new BannerError('File ini bukan gambar PNG/JPG/WebP yang sah.');
  }

  // Banner yang sangat kecil akan terlihat pecah saat dipakai sebagai latar.
  if (meta.width && meta.width < 300) {
    throw new BannerError(`Gambar terlalu kecil (${meta.width}px). Minimal 300px lebar.`);
  }

  await mkdir(BANNER_DIR, { recursive: true });
  const name = `banner-${randomId.replace(/[^a-z0-9]/gi, '').slice(0, 16)}.${meta.ext}`;
  if (!isSafeBannerName(name)) throw new BannerError('Nama file tidak valid.');

  await writeFile(bannerPath(name), buffer);
  logger.info(`Banner disimpan: ${name} (${buffer.byteLength} B, ${meta.width}x${meta.height})`);
  return { ok: true, name, width: meta.width, height: meta.height, bytes: buffer.byteLength };
}

/**
 * Baca banner sebagai byte + mime, untuk disajikan lewat HTTP
 * (mis. `<img src="/api/banner/welcome">` di dashboard).
 */
export async function readBannerBytes(
  name: string | null,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!isSafeBannerName(name)) return null;
  try {
    const buffer = await readFile(bannerPath(name));
    const meta = detectImage(buffer);
    if (!meta) return null;
    return { bytes: buffer, mime: meta.mime };
  } catch {
    return null;
  }
}

/**
 * Baca banner sebagai lampiran Discord.
 *
 * Penting: Discord **menolak** `embed.setImage()` berisi data URI dengan pesan
 * samar "Received one or more errors". Banner harus dikirim sebagai lampiran
 * lalu dirujuk lewat `attachment://<nama>`. Itu sebabnya fungsi ini
 * mengembalikan AttachmentBuilder, bukan data URI.
 */
export async function readBannerAttachment(
  name: string | null,
): Promise<{ attachment: AttachmentBuilder; name: string } | null> {
  if (!isSafeBannerName(name)) return null;
  try {
    const buffer = await readFile(bannerPath(name));
    const meta = detectImage(buffer);
    if (!meta) return null;
    return { attachment: new AttachmentBuilder(buffer, { name }), name };
  } catch {
    return null;
  }
}

/** Baca banner sebagai data URI — hanya untuk `<img>` di dashboard/SVG kartu. */
export async function readBannerDataUri(name: string | null): Promise<string | null> {
  if (!isSafeBannerName(name)) return null;
  try {
    const buffer = await readFile(bannerPath(name));
    const meta = detectImage(buffer);
    if (!meta) return null;
    return `data:${meta.mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Hapus banner. File yang sudah tidak ada dianggap berhasil dihapus. */
export async function deleteBanner(name: string | null): Promise<void> {
  if (!isSafeBannerName(name)) return;
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(bannerPath(name));
    logger.info(`Banner dihapus: ${name}`);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      logger.warn(`Gagal menghapus banner ${name}`, errorMessage(error));
    }
  }
}

/** Apakah file banner benar-benar ada (dipakai dashboard untuk status). */
export function bannerExists(name: string | null): boolean {
  return isSafeBannerName(name) && existsSync(bannerPath(name));
}
