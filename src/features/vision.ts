import type { Message } from 'discord.js';
import { config } from '../config.js';
import { getGuildSettings } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';

/**
 * Vision: mengambil gambar dari pesan Discord dan mengubahnya jadi data URI
 * supaya bisa dikirim ke model multimodal lewat protokol OpenAI-compatible.
 *
 * Batas ukuran dari `VISION_MAX_MB` supaya bot tidak menarik file raksasa.
 */

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const DOWNLOAD_TIMEOUT_MS = 15_000;

/** Apakah lampiran ini gambar yang bisa dipakai model vision? */
export function isImageAttachment(name: string, contentType?: string | null): boolean {
  if (contentType?.startsWith('image/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function mimeForAttachment(name: string, contentType?: string | null): string {
  if (contentType?.startsWith('image/')) return contentType;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? 'image/png';
}

/** Ubah byte gambar jadi `data:<mime>;base64,...` untuk field `image_url`. */
export function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export interface CollectedImages {
  /** data URI siap kirim ke model, urut sesuai pesan */
  dataUris: string[];
  /** nama lampiran yang dilewati (terlalu besar / gagal diunduh) */
  skipped: Array<{ name: string; reason: string }>;
}

const EMPTY: CollectedImages = { dataUris: [], skipped: [] };

/**
 * Ambil maksimal 3 gambar dari sebuah pesan. Gagal di satu lampiran tidak
 * menggagalkan yang lain — pesan tetap dijawab dengan gambar yang berhasil.
 */
export async function collectImages(message: Message, limit = 3): Promise<CollectedImages> {
  if (!message.guildId) return EMPTY;
  const settings = await getGuildSettings(message.guildId);
  if (!(settings?.visionEnabled ?? config.vision.enabled) || message.attachments.size === 0) return EMPTY;

  const candidates = [...message.attachments.values()]
    .filter((attachment) => isImageAttachment(attachment.name, attachment.contentType))
    .slice(0, limit);

  if (candidates.length === 0) return EMPTY;

  const result: CollectedImages = { dataUris: [], skipped: [] };

  for (const attachment of candidates) {
    if (attachment.size > config.vision.maxBytes) {
      const maxMb = Math.round(config.vision.maxBytes / (1024 * 1024));
      result.skipped.push({ name: attachment.name, reason: `lebih dari ${maxMb} MB` });
      continue;
    }

    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error('file kosong');
      if (bytes.byteLength > config.vision.maxBytes) throw new Error('ukuran melebihi batas');

      result.dataUris.push(toDataUri(bytes, mimeForAttachment(attachment.name, attachment.contentType)));
    } catch (error) {
      logger.warn(`Vision: gagal mengunduh ${attachment.name}`, errorMessage(error));
      result.skipped.push({ name: attachment.name, reason: 'gagal diunduh' });
    }
  }

  return result;
}

/** Pesan pengguna multimodal: teks + daftar gambar. */
export function visionUserContent(
  text: string,
  dataUris: string[],
): Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  return [
    { type: 'text', text },
    ...dataUris.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
}
