/**
 * Kirim & perbarui pesan container buatan admin ke Discord.
 *
 * Berbeda dari `welcome.ts` (yang dipicu event), modul ini dipanggil dari
 * dashboard: satu kali kirim, lalu bisa DIPERBARUI tanpa mengirim ulang.
 * Itu sebabnya ID pesan disimpan di database.
 *
 * Aturan yang dipegang:
 *   - Tidak ada pesan kosong. Payload tanpa teks/gambar dianggap gagal.
 *   - Kalau pesan lama sudah dihapus di Discord, kirim baru — jangan menyerah.
 *   - Pesan ber-flag Components V2 tidak boleh membawa `content`/`embeds`.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  type Client,
  type Message,
  type TextChannel,
} from 'discord.js';
import { buildPostPayload, type PostBlock } from './custom-post.js';
import { logger } from '../lib/logger.js';

/** Error yang pesannya aman ditampilkan ke admin. */
export class PostSendError extends Error {}

function buildPayload(blocks: PostBlock[]): { components: ContainerBuilder[]; flags: number } | null {
  const built = buildPostPayload(blocks, {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    // Warna aksen sengaja bisa diatur pemanggil kelak; hari ini memakai warna
    // brand yang sama dengan sambutan supaya pesan bot terlihat satu keluarga.
    accent: 0x6d8cff,
  });
  if (!built) return null;
  return { components: built.components as ContainerBuilder[], flags: built.flags };
}

async function resolveChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new PostSendError('Channel tidak ditemukan. Pastikan ID-nya benar dan bot ada di server.');
  if (!channel.isTextBased() || channel.isDMBased()) {
    throw new PostSendError('Channel itu bukan channel teks di server.');
  }
  return channel as TextChannel;
}

export interface SendResult {
  messageId: string;
  /** true = pesan lama diperbarui, false = pesan baru dikirim. */
  edited: boolean;
}

/**
 * Kirim pesan baru, atau perbarui yang lama kalau `messageId` masih ada.
 *
 * `messageId` yang sudah tidak ada (dihapus manual di Discord) tidak
 * menggagalkan apa pun: pesan baru dikirim dan ID-nya dikembalikan.
 */
export async function sendOrUpdatePost(options: {
  client: Client;
  channelId: string;
  messageId: string | null;
  blocks: PostBlock[];
}): Promise<SendResult> {
  const payload = buildPayload(options.blocks);
  if (!payload) {
    throw new PostSendError('Pesan masih kosong — isi minimal satu teks atau gambar.');
  }

  const channel = await resolveChannel(options.client, options.channelId);

  // Coba perbarui pesan lama lebih dulu.
  if (options.messageId) {
    const lama = await channel.messages.fetch(options.messageId).catch((): null => null);
    if (lama) {
      await lama.edit(payload);
      return { messageId: lama.id, edited: true };
    }
    logger.info(`Pesan kustom ${options.messageId} sudah tidak ada di channel — mengirim baru.`);
  }

  const sent: Message = await channel.send(payload);
  return { messageId: sent.id, edited: false };
}

/** Hapus pesan yang pernah dikirim, kalau masih ada. Diam kalau sudah hilang. */
export async function deletePostMessage(options: {
  client: Client;
  channelId: string | null;
  messageId: string | null;
}): Promise<boolean> {
  if (!options.channelId || !options.messageId) return false;
  const channel = await options.client.channels.fetch(options.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;
  const pesan = await (channel as TextChannel).messages.fetch(options.messageId).catch((): null => null);
  if (!pesan) return false;
  await pesan.delete().catch(() => undefined);
  return true;
}
