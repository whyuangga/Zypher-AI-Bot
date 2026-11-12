/**
 * Kirim pesan /pesan otomatis saat event keanggotaan terjadi.
 *
 * Padanan "trigger event" Discohook: pesan yang sudah disusun di `/pesan`
 * dipasangi pemicu, lalu dikirim sendiri tiap ada member masuk/keluar.
 *
 * Aturan yang dipegang:
 *   - **Pesan yang sama, bukan salinan baru.** ID pesan Discord yang tersimpan
 *     diperbarui, jadi channel tidak dipenuhi versi lama tiap ada orang
 *     bergabung. Kalau pesannya sudah dihapus seseorang, kirim baru.
 *   - **Satu pesan gagal tidak menghentikan sisanya.** Tiap pesan dibungkus
 *     try/catch sendiri; error dilaporkan per pesan.
 *   - **Tidak ada template otomatis di sini.** Teks pesan dikirim apa adanya
 *     (`{member.name}` dibiarkan) karena sambutan ber-AI sudah punya modulnya
 *     sendiri (`welcome.ts`). Kalau harga template diisi tanpa diminta, pesan
 *     "Rules" akan berubah sendiri — itu bukan yang diminta admin.
 */
import type { Client } from 'discord.js';
import { listPostsByTrigger, listRoleButtons, listRoleMenus, type PostTrigger } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';
import {
  sendOrUpdateEmbedPost,
  sendOrUpdatePost,
  sendOrUpdatePostViaWebhook,
  webhookIdentityFor,
} from './custom-post-send.js';
import { setCustomPostMessage } from '../db/repo.js';

export interface TriggerResult {
  /** Jumlah pesan yang berhasil dikirim/diperbarui. */
  terkirim: number;
  /** Alasan per pesan yang gagal — ditampilkan di log, bukan ditelan. */
  gagal: string[];
}

/**
 * Jalankan semua pesan yang terpasang pada satu pemicu.
 *
 * `guildId` dipisah dari member supaya fungsi ini bisa dipanggil dari test
 * tanpa membuat objek member Discord.
 */
export async function runTriggers(options: {
  client: Client;
  guildId: string;
  trigger: PostTrigger;
}): Promise<TriggerResult> {
  const { client, guildId, trigger } = options;
  const daftar = await listPostsByTrigger(guildId, trigger);
  const hasil: TriggerResult = { terkirim: 0, gagal: [] };

  for (const post of daftar) {
    /*
     * Pesan tanpa channel tujuan dilewati dengan ALASAN, bukan diam-diam:
     * pesan yang dipasangi pemicu tapi belum punya channel adalah kesalahan
     * penyusunan yang harus terlihat di log, bukan teka-teki "kenapa tidak
     * pernah muncul".
     */
    if (!post.channelId) {
      hasil.gagal.push(`${post.name}: channel tujuan belum dipilih`);
      logger.warn(`Pemicu ${trigger}: "${post.name}" belum punya channel tujuan.`);
      continue;
    }

    try {
      const tombol = await listRoleButtons(guildId, post.id);
      const menu = await listRoleMenus(guildId, post.id);
      const roleMenus = menu.map((satu) => ({
        id: satu.id,
        placeholder: satu.placeholder,
        minValues: satu.minValues,
        maxValues: satu.maxValues,
        options: satu.options.map((opsi) => ({
          label: opsi.label,
          roleId: opsi.roleId,
          emoji: opsi.emoji ?? null,
          description: opsi.description ?? null,
        })),
      }));

      /*
       * Pesan bergaya embed: jalur sendiri, dan TIDAK memakai webhook.
       * Embed klasik sudah tampil rapi di bawah nama bot; mengirimnya lewat
       * webhook hanya menambah satu kegagalan (izin Manage Webhooks) tanpa
       * menambah apa pun yang terlihat.
       */
      if (post.layout === 'embed') {
        const hasilEmbed = await sendOrUpdateEmbedPost({
          client,
          channelId: post.channelId,
          messageId: post.messageId,
          blocks: post.blocks,
          accent: post.accent,
          title: post.name,
          postId: post.id,
          flags: post.flags,
          allowedMentions: post.allowedMentions,
          roleButtons: tombol.map((satu) => ({
            id: satu.id,
            label: satu.label,
            emoji: satu.emoji ?? null,
            style: satu.style ?? null,
          })),
          roleMenus,
        });
        if (hasilEmbed.messageId !== post.messageId) {
          await setCustomPostMessage(guildId, post.id, hasilEmbed.messageId);
        }
        hasil.terkirim += 1;
        continue;
      }

      if (post.sender === 'webhook') {
        await sendOrUpdatePostViaWebhook({
          client,
          guildId,
          identity: await webhookIdentityFor(client, guildId),
          channelId: post.channelId,
          messageId: post.messageId,
          blocks: post.blocks,
          accent: post.accent ?? undefined,
          postId: post.id,
          flags: post.flags,
          ...(post.threadName ? { threadName: post.threadName } : {}),
          roleButtons: tombol.map((satu) => ({
            id: satu.id,
            label: satu.label,
            emoji: satu.emoji ?? null,
            style: satu.style ?? null,
          })),
          roleMenus,
        });
      } else {
        const dikirim = await sendOrUpdatePost({
          client,
          channelId: post.channelId,
          messageId: post.messageId,
          blocks: post.blocks,
          accent: post.accent ?? undefined,
          postId: post.id,
          flags: post.flags,
          allowedMentions: post.allowedMentions,
          ...(post.threadName ? { threadName: post.threadName } : {}),
          roleButtons: tombol.map((satu) => ({
            id: satu.id,
            label: satu.label,
            emoji: satu.emoji ?? null,
            style: satu.style ?? null,
          })),
          roleMenus,
        });
        /*
         * ID pesan disimpan lagi kalau berubah (pesan lama dihapus orang).
         * Tanpa ini, tiap member baru akan membuat pesan BARU selamanya.
         */
        if (dikirim.messageId !== post.messageId) {
          await setCustomPostMessage(guildId, post.id, dikirim.messageId);
        }
      }
      hasil.terkirim += 1;
    } catch (error) {
      const alasan = `${post.name}: ${errorMessage(error)}`;
      hasil.gagal.push(alasan);
      logger.error(`Pemicu ${trigger} gagal untuk pesan "${post.name}"`, errorMessage(error));
    }
  }

  if (daftar.length > 0) {
    logger.info(
      `Pemicu ${trigger}: ${hasil.terkirim}/${daftar.length} pesan dikirim` +
        (hasil.gagal.length ? `, ${hasil.gagal.length} gagal` : ''),
    );
  }
  return hasil;
}
