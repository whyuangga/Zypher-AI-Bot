/**
 * Pengirim pesan `/pesan` yang dijadwalkan (padanan "Schedule" di Discohook).
 *
 * Kenapa terpisah dari penjalan aksi: jadwal TIDAK dipicu interaksi. Ia
 * berjalan dari timer, dan kegagalannya tidak bisa dilaporkan ke pengklik mana
 * pun — jadi laporannya masuk log + keterangan di jadwal berikutnya.
 *
 * Aturan yang dipegang:
 *
 *   - Pesan dikirim lewat jalur yang SAMA dengan tombol "Kirim ke Discord"
 *     (`sendOrUpdatePost` / `sendOrUpdatePostViaWebhook`), supaya batas
 *     komponen, berkas, dan pemetaan tombol role tidak punya dua perilaku.
 *   - Jadwal SELALU mengirim pesan BARU, bukan memperbarui pesan lama. Admin
 *     yang menjadwalkan pengingat mingguan menginginkan pesan baru tiap kali,
 *     bukan satu pesan yang isinya berubah diam-diam.
 *   - Jadwal berulang digeser dari waktu KIRIM SEKARANG, bukan jadwal lama.
 *     Bot yang mati seminggu tidak boleh memuntahkan puluhan pesan susulan.
 */
import type { Client } from 'discord.js';
import {
  getCustomPost,
  listDueSchedules,
  listRoleButtons,
  listRoleMenus,
  markScheduleSent,
  type PostSchedule,
} from '../db/repo.js';
import {
  identitasPost,
  sendOrUpdatePost,
  sendOrUpdatePostViaWebhook,
  webhookIdentityFor,
} from './custom-post-send.js';
import { errorMessage, logger } from '../lib/logger.js';

/** Kirim satu pesan sesuai jadwal. Mengembalikan `true` kalau terkirim. */
export async function sendScheduledPost(client: Client, schedule: PostSchedule, guildId: string): Promise<boolean> {
  const post = await getCustomPost(guildId, schedule.postId).catch((): null => null);
  if (!post) {
    /*
     * Pesan sudah dihapus. Jadwalnya ikut dibuang oleh `deleteCustomPost`,
     * tetapi bisa tersisa kalau database diedit manual — jadi tetap ditangani.
     */
    logger.warn(`Jadwal ${schedule.id}: pesan ${schedule.postId} sudah tidak ada — jadwal dihentikan.`);
    await markScheduleSent(schedule);
    return false;
  }
  if (!post.channelId) {
    logger.warn(`Jadwal ${schedule.id}: pesan ${schedule.postId} belum punya channel — dilewati.`);
    await markScheduleSent(schedule);
    return false;
  }

  try {
    if (post.sender === 'webhook') {
      /*
       * Pesan webhook tidak bisa punya tombol role maupun aksi. Dijadwalkan
       * tetap boleh — tetapi kalau pesannya memuat komponen interaktif,
       * member akan menekan tombol yang tidak dijawab siapa pun. Jadi
       * komponennya dilewati dan alasannya dicatat.
       */
      await sendOrUpdatePostViaWebhook({
        client,
        guildId,
        channelId: post.channelId,
        messageId: null,
        blocks: post.blocks,
        accent: post.accent ?? undefined,
        identity: identitasPost(post, await webhookIdentityFor(client, guildId)),
        postId: post.id,
      });
    } else {
      const roleButtons = await listRoleButtons(guildId, post.id);
      const roleMenus = await listRoleMenus(guildId, post.id);
      const hasil = await sendOrUpdatePost({
        client,
        channelId: post.channelId,
        // Selalu pesan baru: lihat catatan di atas.
        messageId: null,
        blocks: post.blocks,
        accent: post.accent ?? undefined,
        postId: post.id,
        roleButtons: roleButtons.map((b) => ({
          id: b.id,
          label: b.label,
          emoji: b.emoji ?? null,
          style: b.style ?? null,
        })),
        roleMenus: roleMenus.map((menu) => ({
          id: menu.id,
          placeholder: menu.placeholder,
          minValues: menu.minValues,
          maxValues: menu.maxValues,
          options: menu.options.map((option) => ({
            roleId: option.roleId,
            label: option.label,
            emoji: option.emoji,
            description: option.description,
          })),
        })),
      });
      const dilewati = hasil.dropped ?? [];
      if (dilewati.length > 0) {
        logger.warn(`Jadwal ${schedule.id}: komponen dilewati — ${dilewati.join('; ')}`);
      }
    }
    logger.info(
      `Jadwal ${schedule.id}: pesan "${post.name}" (${post.id}) terkirim ke channel ${post.channelId}.`,
    );
    await markScheduleSent(schedule);
    return true;
  } catch (error) {
    logger.error(`Jadwal ${schedule.id} gagal dikirim`, errorMessage(error));
    /*
     * Penjadwalan TETAP digeser walaupun gagal: tanpa itu, satu channel yang
     * izinnya dicabut akan dicoba terus tiap putaran timer, memenuhi log dan
     * rate limit. Kegagalannya sudah tercatat untuk admin.
     */
    await markScheduleSent(schedule);
    return false;
  }
}

/** Satu putaran: kirim semua jadwal yang jatuh tempo. */
export async function runDueSchedules(client: Client, guildId: string, now = Date.now()): Promise<number> {
  const daftar = await listDueSchedules(now).catch((error: unknown) => {
    logger.warn('Gagal membaca jadwal pesan', errorMessage(error));
    return [];
  });
  let terkirim = 0;
  for (const jadwal of daftar) {
    if (await sendScheduledPost(client, jadwal, guildId)) terkirim += 1;
  }
  return terkirim;
}
