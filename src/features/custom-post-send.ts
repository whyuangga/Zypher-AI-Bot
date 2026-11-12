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
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  WebhookClient,
  type Client,
  type Message,
  type TextChannel,
} from 'discord.js';
import { accentToNumber, buildPostPayload, type PostBlock } from './custom-post.js';
import { roleButtonId, roleMenuId } from './role-buttons.js';
import { deleteChannelWebhook, getChannelWebhook, saveChannelWebhook } from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';

/** Error yang pesannya aman ditampilkan ke admin. */
export class PostSendError extends Error {}

/** Tombol role seperti yang dibutuhkan penyusun payload. */
export interface SendRoleButton {
  id: number;
  label: string;
  emoji?: string | null;
  style?: string | null;
}

/** Dropdown role seperti yang dibutuhkan penyusun payload. */
export interface SendRoleMenu {
  id: number;
  placeholder: string;
  minValues: number;
  maxValues: number;
  options: Array<{ roleId: string; label: string; emoji?: string | null; description?: string | null }>;
}

async function buildPayload(
  blocks: PostBlock[],
  roleButtons: SendRoleButton[] = [],
  accentHex?: string,
  roleMenus: SendRoleMenu[] = [],
): Promise<{
  components: ContainerBuilder[];
  flags: number;
  files: AttachmentBuilder[];
  droppedFiles: string[];
  dropped: string[];
} | null> {
  const built = buildPostPayload(blocks, {
    ContainerBuilder,
    TextDisplayBuilder,
    // Section/thumbnail dipakai blok `section`. Tanpa keduanya, blok section
    // dilewati diam-diam — bug yang sama seperti select menu sebelumnya.
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    // Warna aksen sengaja bisa diatur pemanggil kelak; hari ini memakai warna
    // brand yang sama dengan sambutan supaya pesan bot terlihat satu keluarga.
    accent: 0x6d8cff,
    accentHex,
    accentToNumber,
    // `emoji`/`style` dibiarkan apa adanya: penyusun payload yang memvalidasi,
    // dan kolom lama (sebelum fitur emoji) bernilai kosong.
    roleButtons: roleButtons.map((button) => ({
      id: button.id,
      label: button.label,
      ...(button.emoji ? { emoji: button.emoji } : {}),
      ...(button.style ? { style: button.style } : {}),
    })),
    roleButtonId,
    // Tanpa dua builder ini, blok menu dilewati diam-diam oleh penyusun
    // payload (fitur tampak tersimpan tapi tidak pernah sampai ke Discord).
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    roleMenus: roleMenus.map((menu) => ({
      id: menu.id,
      placeholder: menu.placeholder,
      minValues: menu.minValues,
      maxValues: menu.maxValues,
      // `value` = role ID: nilai itulah yang dikirim Discord saat dipilih,
      // dan handler memakainya langsung tanpa perlu tabel terjemahan.
      options: menu.options.map((option) => ({
        label: option.label,
        value: option.roleId,
        ...(option.emoji ? { emoji: option.emoji } : {}),
        ...(option.description ? { description: option.description } : {}),
      })),
    })),
    roleMenuId,
  });
  if (!built) return null;

  /** Berkas yang gagal diunduh — dikembalikan agar admin tahu, bukan hilang diam-diam. */
  const droppedFiles: string[] = [];

  /*
   * Lampiran sungguhan.
   *
   * Dua sumber:
   *  - unggahan dashboard (data URI): diubah jadi Buffer di sini, karena
   *    Discord menolak data URI mentah di komponen V2;
   *  - berkas dari URL: diunduh lebih dulu. `FileBuilder` hanya menerima
   *    attachment://, jadi berkas jarak-jauh harus jadi lampiran sungguhan.
   */
  const files: AttachmentBuilder[] = [];
  for (const file of built.files) {
    if (file.remoteUrl) {
      try {
        const res = await fetch(file.remoteUrl, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const isi = Buffer.from(await res.arrayBuffer());
        // Batas aman: berkas besar bisa memakan memori bot (container kecil).
        if (isi.length > 8 * 1024 * 1024) {
          throw new Error('berkas lebih dari 8 MB');
        }
        files.push(new AttachmentBuilder(isi, { name: file.name }));
      } catch (error) {
        // Satu berkas gagal tidak boleh menggagalkan seluruh pesan: komponennya
        // dirujuk lewat attachment:// yang tidak ada, jadi komponen itu dibuang
        // dengan alasan yang bisa dibaca admin.
        const sebab = error instanceof Error ? error.message : String(error);
        droppedFiles.push(`${file.name} tidak bisa diunduh (${sebab})`);
      }
      continue;
    }
    const base64 = file.dataUri.slice(file.dataUri.indexOf(',') + 1);
    files.push(new AttachmentBuilder(Buffer.from(base64, 'base64'), { name: file.name }));
  }

  return {
    components: built.components as ContainerBuilder[],
    flags: built.flags,
    files,
    droppedFiles,
    dropped: built.dropped,
  };
}

/**
 * Bagian hasil kirim yang hanya muncul kalau memang ada yang dilewati.
 *
 * Dipisah supaya tiga jalur (perbarui, kirim baru, webhook) melaporkan hal yang
 * sama — tanpa ini, jalur webhook diam-diam menghilangkan daftarnya.
 */
function laporan(payload: { dropped: string[]; droppedFiles: string[] }): Pick<SendResult, 'dropped' | 'droppedFiles'> {
  return {
    ...(payload.dropped.length ? { dropped: payload.dropped } : {}),
    ...(payload.droppedFiles.length ? { droppedFiles: payload.droppedFiles } : {}),
  };
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
  /**
   * Berkas yang gagal diunduh/dilampirkan.
   *
   * Pesan tetap terkirim tanpa berkas itu; daftar ini supaya admin tahu dan
   * bisa memperbaiki URL-nya, bukan mengira berkasnya terkirim.
   */
  droppedFiles?: string[];
  /**
   * Komponen yang dilewati penyusun payload (mis. select yang tidak didukung).
   *
   * Daftar ini dulu berhenti di dalam penyusun payload, jadi admin tidak pernah
   * tahu ada komponen yang tidak ikut terkirim. Sekarang diteruskan sampai
   * dashboard.
   */
  dropped?: string[];
}

/**
 * Kirim pesan baru, atau perbarui yang lama kalau `messageId` masih ada.
 *
 * `messageId` yang sudah tidak ada (dihapus manual di Discord) tidak
 * menggagalkan apa pun: pesan baru dikirim dan ID-nya dikembalikan.
 */
export async function sendOrUpdatePost(options: {
  client: Client;
  /** Tombol ambil role milik pesan ini (opsional). */
  roleButtons?: SendRoleButton[];
  /** Dropdown role milik pesan ini (opsional). */
  roleMenus?: SendRoleMenu[];
  /** Warna aksen `#rrggbb` pilihan admin. */
  accent?: string;
  channelId: string;
  messageId: string | null;
  blocks: PostBlock[];
}): Promise<SendResult> {
  const built = await buildPayload(options.blocks, options.roleButtons, options.accent, options.roleMenus);
  const payload = built;
  if (!payload) {
    throw new PostSendError('Pesan masih kosong — isi minimal satu teks atau gambar.');
  }
  // Saat memperbarui pesan, lampiran lama harus dibuang dulu: kalau tidak,
  // Discord menyimpan gambar lama DAN gambar baru, sehingga pesan terus
  // bertambah lampiran setiap kali admin menekan "Simpan & kirim ulang".
  const editPayload = { ...payload, attachments: [] as [] };

  const channel = await resolveChannel(options.client, options.channelId);

  // Coba perbarui pesan lama lebih dulu.
  if (options.messageId) {
    const lama = await channel.messages.fetch(options.messageId).catch((): null => null);
    if (lama) {
      await lama.edit(editPayload);
      return { messageId: lama.id, edited: true, ...laporan(payload) };
    }
    logger.info(`Pesan kustom ${options.messageId} sudah tidak ada di channel — mengirim baru.`);
  }

  const sent: Message = await channel.send(payload);
  return { messageId: sent.id, edited: false, ...laporan(payload) };
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

/* ------------------------------------------------------------------ */
/*  Kirim lewat webhook (pesan atas nama server)                       */
/* ------------------------------------------------------------------ */

/**
 * Identitas pengirim webhook: diambil dari server Discord itu sendiri.
 *
 * Dibuat helper supaya dashboard dan pengirim tidak perlu tahu bentuk objek
 * guild discord.js.
 */
export async function webhookIdentityFor(client: Client, guildId: string): Promise<WebhookIdentity> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { username: 'Server', avatarURL: null };
  return {
    username: guild.name,
    avatarURL: guild.iconURL({ size: 256 }) ?? null,
  };
}

/** Nama & avatar pengirim saat memakai webhook — diisi pemanggil dari server. */
export interface WebhookIdentity {
  username: string;
  avatarURL?: string | null;
}

/**
 * Ambil webhook untuk channel, atau buat baru kalau belum ada.
 *
 * Kenapa webhook, bukan bot biasa: hanya webhook yang bisa membuat pesan
 * tampil atas nama server sendiri. Konsekuensinya bot butuh izin
 * **Manage Webhooks**, dan token webhook harus disimpan (terenkripsi).
 *
 * Kalau webhook yang tersimpan ternyata sudah dihapus di Discord (orang lain
 * membersihkannya, atau channel-nya dihapus lalu dibuat ulang), bot membuat
 * yang baru alih-alih gagal terus.
 */
export async function ensureChannelWebhook(options: {
  client: Client;
  guildId: string;
  channelId: string;
  identity: WebhookIdentity;
  /** Pakai ulang webhook yang tersimpan kalau ada. */
  reuse?: boolean;
}): Promise<{ id: string; token: string }> {
  const channel = await options.client.channels.fetch(options.channelId).catch(() => null);
  if (!channel) {
    throw new PostSendError('Channel tidak ditemukan. Pastikan ID-nya benar dan bot ada di server.');
  }
  if (!channel.isTextBased() || channel.isDMBased()) {
    throw new PostSendError('Channel itu bukan channel teks di server.');
  }
  const textChannel = channel as TextChannel;

  if (options.reuse !== false) {
    const saved = await getChannelWebhook(options.guildId, options.channelId);
    if (saved) {
      // Periksa ke Discord bahwa webhook-nya benar-benar masih ada.
      //
      // Versi pertama memakai `webhook.fetchMessage('1')` lalu menebak dari
      // teks galat. Itu rapuh: pesan galat bisa berubah, dan perbedaannya
      // halus — "Unknown Webhook" (webhook hilang) vs "Unknown Message"
      // (webhook sah, pesannya saja yang tidak ada). Sekarang dicek langsung
      // lewat jalur bot, yang mengembalikan objek atau null tanpa menebak.
      const masihAda = await textChannel
        .fetchWebhooks()
        .then((hooks) => hooks.has(saved.webhookId))
        .catch(() => true); // Discord sedang bermasalah: anggap masih ada, jangan buat duplikat
      if (masihAda) return { id: saved.webhookId, token: saved.url.split('/').pop() ?? '' };
      await deleteChannelWebhook(options.channelId);
      logger.warn(`Webhook lama untuk channel ${options.channelId} sudah tidak ada — membuat baru.`);
    }
  }

  const webhook = await textChannel
    .createWebhook({
      name: options.identity.username.slice(0, 80),
      avatar: options.identity.avatarURL ?? undefined,
      reason: 'Pesan /pesan dari dashboard Zypher',
    })
    .catch((error: unknown) => {
      // Penyebab paling sering: izin Manage Webhooks belum diberikan.
      if (/Missing Permissions|50013/i.test(errorMessage(error))) {
        throw new PostSendError(
          'Bot tidak bisa membuat webhook di channel itu. Beri izin **Manage Webhooks** ke bot, lalu coba lagi.',
        );
      }
      throw new PostSendError(`Gagal membuat webhook: ${errorMessage(error).slice(0, 160)}`);
    });

  await saveChannelWebhook({
    guildId: options.guildId,
    channelId: options.channelId,
    webhookId: webhook.id,
    token: webhook.token!,
  });

  return { id: webhook.id, token: webhook.token! };
}

/**
 * Kirim atau perbarui pesan lewat webhook.
 *
 * Perhatikan: pesan webhook tidak bisa membawa tombol INTERAKTIF yang diproses
 * bot kita. Discord mengirim interaksi tombol ke aplikasi pemilik komponen;
 * untuk pesan webhook, komponen dikirim oleh webhook itu sendiri. Karena itu
 * pesan yang memakai webhook dan punya tombol role akan ditolak lebih awal
 * dengan penjelasan — bukan mengirim tombol yang diam saat diklik.
 */
export async function sendOrUpdatePostViaWebhook(options: {
  client: Client;
  guildId: string;
  channelId: string;
  messageId: string | null;
  blocks: PostBlock[];
  roleButtons?: SendRoleButton[];
  roleMenus?: SendRoleMenu[];
  accent?: string;
  identity: WebhookIdentity;
}): Promise<SendResult> {
  // Komponen interaktif dikirim oleh WEBHOOK, bukan oleh bot kita. Discord
  // hanya meneruskan klik ke aplikasi pemilik komponen — jadi tombol/menu di
  // pesan webhook akan diam saja. Lebih jujur menolak di sini.
  if ((options.roleButtons ?? []).length > 0 || (options.roleMenus ?? []).length > 0) {
    throw new PostSendError(
      'Pesan lewat webhook tidak bisa memakai tombol atau menu ambil role — Discord hanya mengirim interaksi komponen ke aplikasi pengirim. Matikan mode webhook untuk pesan ini, atau hapus komponen role-nya.',
    );
  }

  const built = await buildPayload(options.blocks, [], options.accent, []);
  if (!built) {
    throw new PostSendError('Pesan masih kosong — isi minimal satu teks atau gambar.');
  }

  /*
   * Select menu di pesan webhook TIDAK bisa dijawab bot.
   *
   * Discord mengirim interaksi ke aplikasi PEMILIK komponen — untuk pesan
   * webhook, pemiliknya webhook itu sendiri, bukan bot kita. Menunya tetap
   * tampil, tetapi memilih tidak menghasilkan apa pun (sama seperti
   * Discohook). Admin perlu tahu itu sebelum mengira menunya rusak.
   */
  if ((options.blocks ?? []).some((blok) => blok.kind === 'select')) {
    built.dropped.push(
      'select menu di pesan webhook tidak bisa dijawab bot — menunya tampil, tetapi memilih tidak mengubah apa pun',
    );
  }

  const hook = await ensureChannelWebhook(options);
  const webhook = new WebhookClient({ id: hook.id, token: hook.token });

  /*
   * Payload webhook disusun dari field yang dikenal Discord saja.
   *
   * `dropped`/`droppedFiles` adalah laporan untuk admin, bukan bagian payload —
   * menyebarkan seluruh objek `built` akan mengirim dua field asing itu juga.
   */
  const body = {
    components: built.components,
    flags: built.flags,
    files: built.files,
    username: options.identity.username.slice(0, 80),
    ...(options.identity.avatarURL ? { avatarURL: options.identity.avatarURL } : {}),
  };

  try {
    if (options.messageId) {
      const edited = await webhook
        .editMessage(options.messageId, { ...body, attachments: [] })
        .catch((): null => null);
      if (edited) return { messageId: options.messageId, edited: true, ...laporan(built) };
    }
    const sent = await webhook.send(body);
    return { messageId: sent.id, edited: false, ...laporan(built) };
  } catch (error) {
    throw new PostSendError(`Gagal mengirim lewat webhook: ${errorMessage(error).slice(0, 160)}`);
  }
}
