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
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  FileBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  WebhookClient,
  type Client,
  type Message,
  type TextChannel,
} from 'discord.js';
import {
  accentToNumber,
  buildPostPayload,
  type BuiltPost,
  type PostBlock,
} from './custom-post.js';
import type { SeriesMessage } from './post-series.js';
import { buildClassicEmbeds, validateEmbeds, type EmbedExtra,
  embedAttachments,
  flagsUntukEmbed,
} from './post-embed.js';
import { roleButtonId, roleMenuId } from './role-buttons.js';
import {
  deleteChannelWebhook,
  getChannelWebhook,
  listRoleButtons,
  listRoleMenus,
  saveChannelWebhook,
  type CustomPost,
} from '../db/repo.js';
import { errorMessage, logger } from '../lib/logger.js';

/**
 * Susun payload Discord untuk satu pesan, TANPA mengirim.
 *
 * Dipakai endpoint JSON/generator kode. Sengaja memakai penyusun yang sama
 * dengan pengiriman: kalau JSON yang ditampilkan berasal dari jalur lain, ia
 * akan menyimpang dari yang benar-benar diterima Discord — dan JSON itu justru
 * dipakai developer untuk memeriksa kenapa pesannya gagal.
 */
export async function payloadUntukPesan(
  guildId: string,
  post: CustomPost,
): Promise<{
  components: unknown[];
  dropped: string[];
} | null> {
  /*
   * Tombol & menu role dibaca dari database di sini (bukan diterima sebagai
   * argumen): endpoint JSON hanya punya `post`, dan daftar role yang dipakai
   * penyusun payload harus yang TERSIMPAN — kalau dibaca dari state editor,
   * JSON yang ditampilkan bisa memuat tombol yang belum disimpan.
   */
  const tombol = await listRoleButtons(guildId, post.id).catch(() => []);
  const menu = await listRoleMenus(guildId, post.id).catch(() => []);

  const built = buildPostPayload(post.blocks, {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ...(FileBuilder ? { FileBuilder } : {}),
    accent: accentToNumber(post.accent),
    accentToNumber,
    accentHex: post.accent ?? undefined,
    roleButtons: tombol.map((satu) => ({
      id: satu.id,
      label: satu.label,
      emoji: satu.emoji ?? undefined,
      style: satu.style ?? undefined,
    })),
    roleButtonId,
    roleMenus: menu.map((satu) => ({
      id: satu.id,
      placeholder: satu.placeholder,
      minValues: satu.minValues,
      maxValues: satu.maxValues,
      options: satu.options.map((opsi) => ({
        label: opsi.label,
        value: opsi.roleId,
        emoji: opsi.emoji ?? undefined,
        ...(opsi.description ? { description: opsi.description } : {}),
      })),
    })),
    roleMenuId,
    contextPostId: post.id,
    allowedMentions: post.allowedMentions,
    ...(post.threadName ? { threadName: post.threadName } : {}),
  });
  if (!built) return null;

  /*
   * `toJSON()` dipakai, bukan objek builder: builder membawa properti internal
   * yang tidak ada di payload Discord, dan JSON di dashboard harus bisa
   * ditempel langsung ke REST API.
   */
  return {
    components: built.components.map((satu) =>
      typeof (satu as { toJSON?: () => unknown }).toJSON === 'function'
        ? (satu as { toJSON: () => unknown }).toJSON()
        : satu,
    ),
    dropped: built.dropped,
  };
}

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

/**
 * Ubah daftar berkas hasil penyusun payload menjadi lampiran Discord.
 *
 * Dipakai DUA jalur: Components V2 dan embed klasik. Sebelumnya logika ini
 * hanya hidup di jalur V2, sehingga pesan bergaya embed membuang setiap blok
 * `file` dengan alasan "berkas jadi lampiran" — padahal lampirannya tidak
 * pernah dibuat. Discohook sendiri mengirim lampiran bersama embed.
 *
 * Satu berkas gagal tidak menggagalkan pesan: namanya dilaporkan, karena
 * komponen yang merujuk `attachment://` itu akan hilang bersama lampirannya.
 */
export async function buatLampiran(
  daftar: ReadonlyArray<{ dataUri?: string; remoteUrl?: string; name: string }>,
): Promise<{ files: AttachmentBuilder[]; droppedFiles: string[] }> {
  const droppedFiles: string[] = [];
  const files: AttachmentBuilder[] = [];

  for (const file of daftar) {
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
        const sebab = error instanceof Error ? error.message : String(error);
        droppedFiles.push(`${file.name} tidak bisa diunduh (${sebab})`);
      }
      continue;
    }
    const base64 = (file.dataUri ?? '').slice((file.dataUri ?? '').indexOf(',') + 1);
    files.push(new AttachmentBuilder(Buffer.from(base64, 'base64'), { name: file.name }));
  }

  return { files, droppedFiles };
}

async function buildPayload(
  blocks: PostBlock[],
  roleButtons: SendRoleButton[] = [],
  accentHex?: string,
  roleMenus: SendRoleMenu[] = [],
  /** ID pesan /pesan — disisipkan ke customId select supaya aksi bisa dicari. */
  contextPostId?: number | null,
  /** Nilai template teks (`{member.name}`, …). Kosong = apa adanya. */
  template?: Record<string, string> | null,
  /** Izin ping & nama thread: bagian dari isi pesan, bukan komponen. */
  extra?: {
    allowedMentions?: { parse?: Array<'users' | 'roles' | 'everyone'>; users?: string[]; roles?: string[]; repliedUser?: boolean };
    threadName?: string;
  },
): Promise<{
  components: ContainerBuilder[];
  flags: number;
  files: AttachmentBuilder[];
  droppedFiles: string[];
  dropped: string[];
  allowedMentions: BuiltPost['allowedMentions'];
  threadName?: string;
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
    contextPostId,
    template: template ?? null,
    ...(extra?.allowedMentions ? { allowedMentions: extra.allowedMentions } : {}),
    ...(extra?.threadName ? { threadName: extra.threadName } : {}),
  });
  if (!built) return null;

  /*
   * Lampiran sungguhan: unggahan dashboard (data URI) diubah jadi Buffer, dan
   * berkas dari URL diunduh lebih dulu — `FileBuilder` hanya menerima
   * `attachment://`, jadi berkas jarak-jauh harus jadi lampiran sungguhan.
   */
  const { files, droppedFiles } = await buatLampiran(built.files);

  return {
    components: built.components as ContainerBuilder[],
    flags: built.flags,
    files,
    droppedFiles,
    dropped: built.dropped,
    allowedMentions: built.allowedMentions,
    ...(built.threadName ? { threadName: built.threadName } : {}),
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
  /** ID pesan /pesan — dipakai untuk customId select menu. */
  postId?: number;
  /** Flag pesan dari admin (suppress embeds/notifikasi). 0 = tanpa flag. */
  flags?: number;
  /**
   * Kirim sebagai balasan pesan tertentu, bukan pesan channel baru.
   *
   * Dipakai aksi "kirim pesan" pada flow: Discohook menyebutnya nesting —
   * tombol mengirim pesan berisi tombol lain, ditempel di bawah pesan asal
   * supaya percakapannya tetap terlihat satu rangkaian.
   *
   * Pesan yang dikirim dengan cara ini TIDAK bisa diperbarui (tidak ada
   * messageId tersimpan), jadi pemanggil selalu mengirim baru.
   */
  replyTo?: string;
  /**
   * Nilai template teks (`{member.name}`, `{server.name}`, …).
   *
   * Kosong = teks dikirim apa adanya, jadi pesan biasa tidak berubah.
   */
  template?: Record<string, string> | null;
  /** Izin ping (allowed_mentions). Kosong = tanpa ping apa pun. */
  allowedMentions?: BuiltPost['allowedMentions'];
  /** Nama thread bila pesan ini membuka thread (thread_name). */
  threadName?: string;
}): Promise<SendResult> {
  const built = await buildPayload(
    options.blocks,
    options.roleButtons,
    options.accent,
    options.roleMenus,
    options.postId ?? null,
    options.template ?? null,
    {
      ...(options.allowedMentions ? { allowedMentions: options.allowedMentions } : {}),
      ...(options.threadName ? { threadName: options.threadName } : {}),
    },
  );
  if (!built) {
    throw new PostSendError('Pesan masih kosong — isi minimal satu teks atau gambar.');
  }
  /*
   * Flag admin DIGABUNG dengan flag Components V2 yang sudah dipasang penyusun
   * payload. Tanpa penggabungan, memilih "tanpa kartu embed" akan menghapus
   * flag v2 dan pesan ditolak Discord.
   */
  const payload = options.flags
    ? { ...built, flags: built.flags | options.flags }
    : built;
  // Saat memperbarui pesan, lampiran lama harus dibuang dulu: kalau tidak,
  // Discord menyimpan gambar lama DAN gambar baru, sehingga pesan terus
  // bertambah lampiran setiap kali admin menekan "Simpan & kirim ulang".
  const editPayload = { ...payload, attachments: [] as [] };

  const channel = await resolveChannel(options.client, options.channelId);

  /*
   * Balasan (nesting): selalu kirim BARU. Memperbarui pesan balasan bukan
   * tujuan aksi ini, dan messageId balasan tidak pernah disimpan — jadi
   * `options.messageId` sengaja diabaikan di jalur ini.
   */
  if (options.replyTo) {
    const induk = await channel.messages.fetch(options.replyTo).catch((): null => null);
    if (!induk) {
      throw new PostSendError(
        'Pesan induk untuk balasan sudah tidak ada di channel — kirim ulang pesannya dulu, atau matikan opsi "sebagai balasan".',
      );
    }
    const balasan: Message = await induk.reply({
      ...payload,
      allowedMentions: { ...payload.allowedMentions, repliedUser: false },
    });
    return { messageId: balasan.id, edited: false, ...laporan(payload) };
  }

  // Coba perbarui pesan lama lebih dulu.
  if (options.messageId) {
    const lama = await channel.messages.fetch(options.messageId).catch((): null => null);
    if (lama) {
      await lama.edit(editPayload);
      return { messageId: lama.id, edited: true, ...laporan(payload) };
    }
    logger.info(`Pesan kustom ${options.messageId} sudah tidak ada di channel — mengirim baru.`);
  }

  /*
   * `threadName` dipakai lewat opsi kanal (`send` lalu `startThread`), bukan
   * payload: Discord membuat thread SESUDAH pesan ada, jadi tidak ada field
   * payload untuk itu. Kalau gagal, pesannya tetap terkirim dan kegagalannya
   * dilaporkan — membuang pesan hanya karena thread gagal akan menghilangkan
   * isi yang sudah disusun admin.
   */
  const sent: Message = await channel.send(payload);
  const dropped = [...payload.dropped];
  if (payload.threadName) {
    const thread = await sent
      .startThread({ name: payload.threadName.slice(0, 100) })
      .catch((): null => null);
    if (!thread) dropped.push('thread tidak bisa dibuat (izin Create Public Threads?)');
  }
  return {
    messageId: sent.id,
    edited: false,
    ...laporan({ dropped, droppedFiles: payload.droppedFiles }),
  };
}

/**
 * Kirim/perbarui pesan BERGAYA EMBED KLAISIK.
 *
 * Dipisah dari `sendOrUpdatePost` karena aturannya berlawanan: pesan
 * Components V2 WAJIB tanpa `embeds`, dan pesan embed TIDAK boleh membawa
 * flag V2. Mencampur keduanya di satu jalur membuat salah satu pesan ditolak
 * Discord dengan galat yang tidak menyebut penyebabnya.
 *
 * Tombol & menu role tetap dikirim sebagai komponen di luar embed: keduanya
 * bisa hidup berdampingan dengan embed di Discord, dan mematikannya berarti
 * pesan pengumuman tidak bisa dipakai untuk membagikan role.
 */
export async function sendOrUpdateEmbedPost(options: {
  client: Client;
  channelId: string;
  messageId: string | null;
  blocks: PostBlock[];
  accent?: string | null;
  /** Judul embed — diambil dari nama pesan oleh pemanggil. */
  title?: string | null;
  roleButtons?: SendRoleButton[];
  roleMenus?: SendRoleMenu[];
  postId?: number;
  /** Flag admin (suppress notifikasi). Flag V2 TIDAK ikut dipasang di sini. */
  flags?: number;
  allowedMentions?: BuiltPost['allowedMentions'];
  /**
   * Bagian embed yang diisi admin (penulis, footer, bidang, stempel waktu,
   * URL judul), sampai 10 embed per pesan. Sudah disaring saat disimpan.
   *
   * Elemen pertama melengkapi embed dari blok; sisanya menjadi embed tambahan.
   */
  embed?: EmbedExtra[] | null;
  /** Nilai template teks (`{member.name}`, …) — berlaku juga di footer/bidang. */
  template?: Record<string, string> | null;
  /**
   * Nama thread yang dibuka dari pesan ini (`thread_name` di Discohook).
   *
   * Hanya dipakai saat pesan BARU dikirim: Discord membuat thread sesudah
   * pesan ada, dan memperbarui pesan tidak membuka thread kedua.
   */
  threadName?: string | null;
}): Promise<SendResult> {
  const daftar = buildClassicEmbeds(options.blocks, {
    accent: options.accent ?? null,
    title: options.title ?? null,
    embedList: options.embed ?? null,
    template: options.template ?? null,
  });
  if (daftar.length === 0) {
    throw new PostSendError('Embed masih kosong — isi minimal satu teks atau gambar.');
  }
  const masalah = validateEmbeds(daftar.map((satu) => satu.embed));
  if (masalah.length) {
    throw new PostSendError(`Embed tidak bisa dikirim: ${masalah[0]}`);
  }

  /*
   * Komponen di luar embed: hanya tombol/menu. Penyusun payload biasa dipakai
   * supaya customId dan gaya tombolnya persis sama dengan pesan container —
   * dua cara menyusun tombol akan menghasilkan tombol yang berperilaku beda.
   */
  const komponen = await komponenInteraktif(options);
  /*
   * `tanpa kartu embed` tidak boleh ikut bersama embed (lihat flagsUntukEmbed).
   * Disaring di SUMBERNYA — di sini — supaya semua jalur kirim (manual,
   * jadwal, pemicu member, aksi flow, channel tambahan) mendapat aturan yang
   * sama tanpa perlu mengingatnya satu per satu.
   */
  const aturFlag = flagsUntukEmbed(options.flags);
  /*
   * Lampiran: blok `file` di pesan embed IKUT terkirim (Discohook pun begitu).
   * Dulu jalur ini mengirim `attachments: []` dan hanya melaporkan "berkas jadi
   * lampiran" — padahal tidak ada lampiran yang dibuat, jadi berkas yang
   * diunggah admin tidak pernah sampai ke Discord.
   */
  const berkas = embedAttachments(options.blocks);
  const lampiran = await buatLampiran(berkas.attachments);
  const payload = {
    embeds: daftar.map((satu) => satu.embed),
    ...(komponen.length ? { components: komponen } : {}),
    ...(aturFlag.flags ? { flags: aturFlag.flags } : {}),
    ...(options.allowedMentions ? { allowedMentions: { ...options.allowedMentions, repliedUser: false } } : {}),
    ...(lampiran.files.length ? { files: lampiran.files } : {}),
  };

  const channel = await resolveChannel(options.client, options.channelId);
  const dropped = [
    ...daftar.flatMap((satu) => satu.dropped),
    ...aturFlag.dropped,
    ...berkas.dropped,
    ...lampiran.droppedFiles,
  ];
  const droppedFiles = lampiran.droppedFiles;

  if (options.messageId) {
    const lama = await channel.messages.fetch(options.messageId).catch((): null => null);
    if (lama) {
      /*
       * Saat memperbarui, lampiran lama harus diganti seluruhnya — sama seperti
       * jalur V2. Tanpa `attachments: []`, Discord MENAMBAH lampiran baru di
       * samping yang lama, jadi pesan bertambah gambar setiap kali dikirim
       * ulang.
       */
      await lama.edit({ ...payload, attachments: [] });
      return { messageId: lama.id, edited: true, dropped, droppedFiles };
    }
    logger.info(`Pesan embed ${options.messageId} sudah tidak ada di channel — mengirim baru.`);
  }

  const sent: Message = await channel.send(payload);
  /*
   * Thread dibuat SESUDAH pesan ada (Discord tidak punya field payload untuk
   * ini). Kegagalannya dilaporkan, bukan menggagalkan pesan: isi yang sudah
   * tersusun admin tidak boleh hilang hanya karena izin Create Public Threads
   * belum ada.
   */
  const namaThread = String(options.threadName ?? '').trim();
  if (namaThread) {
    const thread = await sent
      .startThread({ name: namaThread.slice(0, 100) })
      .catch((): null => null);
    if (!thread) dropped.push('thread tidak bisa dibuat (izin Create Public Threads?)');
  }
  return { messageId: sent.id, edited: false, dropped, droppedFiles };
}

/** Tombol & menu role sebagai komponen di luar embed. */
async function komponenInteraktif(options: {
  roleButtons?: SendRoleButton[];
  roleMenus?: SendRoleMenu[];
  postId?: number;
}): Promise<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[]> {
  const baris: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  const tombol = (options.roleButtons ?? []).slice(0, 25).map((satu) => {
    const builder = new ButtonBuilder()
      .setCustomId(roleButtonId(satu.id))
      .setLabel(satu.label.slice(0, 80));
    if (satu.emoji) {
      try {
        builder.setEmoji(satu.emoji);
      } catch {
        // Emoji tidak sah diabaikan: labelnya tetap tampil.
      }
    }
    return builder.setStyle(gayaTombol(satu.style));
  });
  if (tombol.length) {
    baris.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...tombol) as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
  }

  for (const menu of (options.roleMenus ?? []).slice(0, 4)) {
    const pilihan = menu.options.slice(0, 25).map((opsi) =>
      new StringSelectMenuOptionBuilder().setLabel(opsi.label.slice(0, 100)).setValue(opsi.roleId),
    );
    if (!pilihan.length) continue;
    baris.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(roleMenuId(menu.id))
          .setPlaceholder(menu.placeholder.slice(0, 150))
          .setMinValues(Math.max(1, menu.minValues))
          .setMaxValues(Math.max(1, menu.maxValues))
          .addOptions(...pilihan),
      ),
    );
  }
  return baris;
}

/** Nama gaya tombol → ButtonStyle. Nilai asing jadi Secondary, bukan gagal. */
function gayaTombol(style: string | null | undefined): ButtonStyle {
  switch (style) {
    case 'primary':
      return ButtonStyle.Primary;
    case 'success':
      return ButtonStyle.Success;
    case 'danger':
      return ButtonStyle.Danger;
    default:
      return ButtonStyle.Secondary;
  }
}

/**
 * Kirim pesan yang sama ke beberapa channel tambahan (padanan `targets[]`).
 *
 * Aturan yang dipegang:
 *   - **Channel utama bukan urusan fungsi ini.** Ia dikirim lewat jalur biasa
 *     (dengan penyimpanan ID pesannya sendiri), jadi tidak ada dua jalur yang
 *     mengklaim pesan yang sama.
 *   - **Gagal di satu channel tidak menghentikan sisanya.** Channel yang
 *     bot-nya tidak punya izin bukan alasan tiga channel lain tidak menerima
 *     pengumuman.
 *   - **ID pesan per channel dipakai lagi**, jadi mengirim ulang memperbarui
 *     pesan lama di channel itu, bukan menumpuk salinan.
 */
export async function sendToTargets(options: {
  client: Client;
  /** Penyusun payload: mengembalikan cara mengirim ke satu channel. */
  kirim: (channelId: string, messageId: string | null) => Promise<SendResult>;
  targets: Array<{ channelId: string; messageId: string | null }>;
}): Promise<{ hasil: Array<{ channelId: string; messageId?: string; error?: string }>; dropped: string[] }> {
  const hasil: Array<{ channelId: string; messageId?: string; error?: string }> = [];
  const dropped: string[] = [];

  for (const target of options.targets) {
    try {
      const dikirim = await options.kirim(target.channelId, target.messageId);
      hasil.push({ channelId: target.channelId, messageId: dikirim.messageId });
      if (dikirim.dropped?.length) {
        dropped.push(`#${target.channelId}: ${dikirim.dropped[0]}`);
      }
    } catch (error) {
      // Alasan disimpan per channel: admin perlu tahu channel MANA yang gagal,
      // bukan hanya bahwa "sebagian gagal".
      hasil.push({ channelId: target.channelId, error: errorMessage(error) });
      logger.warn(`Gagal mengirim ke channel tambahan ${target.channelId}`, errorMessage(error));
    }
  }
  return { hasil, dropped };
}

/**
 * Kirim BEBERAPA pesan sebagai satu rangkaian (multi-pesan).
 *
 * Aturan yang dipegang, dan alasannya:
 *
 *   1. **Urutan dihormati.** Pesan dikirim sesuai urutan yang sudah diputuskan
 *      `resolveSendOrder` di post-series.ts — pesan yang membalas pesan lain
 *      tidak mungkin dikirim lebih dulu.
 *   2. **Pesan yang gagal tidak menghentikan sisanya**, tetapi DILAPORKAN.
 *      Satu pesan berisi berkas yang sudah dihapus tidak boleh membuat lima
 *      pesan lain hilang dari channel.
 *   3. **Balasan memakai `reply` hanya bila induknya bagian dari rangkaian
 *      ini.** Rujukan ke pesan Discord lain akan menghasilkan balasan tanpa
 *      induk yang terlihat seperti kesalahan bot.
 *   4. **Thread dimulai dari pesan yang menyebutnya**, sesudah pesan itu
 *      terkirim — bukan dari pesan pertama dokumen.
 *
 * Mengembalikan ID pesan per `id` dokumen, supaya pemanggil bisa menyimpan
 * atau menampilkannya.
 */
export async function sendPostSeries(options: {
  client: Client;
  channelId: string;
  messages: SeriesMessage[];
  /** ID pesan /pesan — dipakai customId komponen di semua pesan. */
  postId?: number;
  /** Nilai template teks ({member.name}, …). */
  template?: Record<string, string> | null;
  /** Berhenti kalau pemanggil membatalkan (mis. bot mati di tengah jalan). */
  shouldStop?: () => boolean;
}): Promise<{
  sent: Array<{ id: string; messageId: string; name: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
  threads: Array<{ id: string; threadId: string }>;
}> {
  const channel = await resolveChannel(options.client, options.channelId);
  const sent: Array<{ id: string; messageId: string; name: string }> = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];
  const threads: Array<{ id: string; threadId: string }> = [];
  const idPesan = new Map<string, string>();

  for (const pesan of options.messages) {
    if (options.shouldStop?.()) break;

    const built = await buildPayload(
      pesan.blocks,
      [],
      undefined,
      [],
      options.postId ?? null,
      options.template ?? null,
    );
    if (!built) {
      failed.push({ id: pesan.id, name: pesan.name, error: 'pesan kosong' });
      continue;
    }
    const payload = {
      ...built,
      ...(pesan.flags ? { flags: built.flags | pesan.flags } : {}),
    };

    try {
      let terkirim: Message;
      const induk = pesan.reference ? idPesan.get(pesan.reference) : undefined;
      if (induk) {
        const pesanInduk = await channel.messages.fetch(induk).catch((): null => null);
        if (pesanInduk) {
          terkirim = await pesanInduk.reply({
            ...payload,
            allowedMentions: { repliedUser: false },
          });
        } else {
          /*
           * Induk hilang (mis. dihapus orang lain di antara dua pesan).
           * Pesannya TETAP dikirim sebagai pesan biasa dan itu dilaporkan —
           * membuangnya berarti isi yang sudah disusun admin hilang diam-diam.
           */
          terkirim = await channel.send(payload);
          failed.push({
            id: pesan.id,
            name: pesan.name,
            error: 'pesan induk sudah tidak ada — dikirim tanpa balasan',
          });
        }
      } else {
        terkirim = await channel.send(payload);
      }

      idPesan.set(pesan.id, terkirim.id);
      sent.push({ id: pesan.id, messageId: terkirim.id, name: pesan.name });

      if (pesan.threadName) {
        const thread = await terkirim
          .startThread({ name: pesan.threadName.slice(0, 100) })
          .catch((): null => null);
        if (thread) threads.push({ id: pesan.id, threadId: thread.id });
        else {
          failed.push({
            id: pesan.id,
            name: pesan.name,
            error: 'thread gagal dibuat (izin Create Public Threads?)',
          });
        }
      }
    } catch (error) {
      /*
       * Kegagalan satu pesan TIDAK menghentikan sisanya: rangkaian yang
       * berhenti di tengah meninggalkan cerita yang menggantung, dan admin
       * tidak punya cara mengirim ulang satu pesan saja.
       */
      failed.push({ id: pesan.id, name: pesan.name, error: errorMessage(error).slice(0, 160) });
    }
  }

  return { sent, failed, threads };
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
 * Identitas webhook untuk SATU pesan: isian per pesan menang, sisanya identitas
 * server.
 *
 * Dipakai semua jalur kirim webhook — kirim manual, jadwal, pemicu member, dan
 * aksi flow. Dulu hanya jalur manual yang memakainya; jalur lain selalu memakai
 * nama server, jadi pesan terjadwal yang disetel "Tim Pengumuman" muncul atas
 * nama server tanpa penjelasan apa pun.
 */
export function identitasPost(
  post: { webhookName?: string | null; webhookAvatar?: string | null },
  bawaan: WebhookIdentity,
): WebhookIdentity {
  return {
    username: post.webhookName ?? bawaan.username,
    avatarURL: post.webhookAvatar ?? bawaan.avatarURL ?? null,
  };
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
  /** ID pesan /pesan — dipakai untuk customId select menu. */
  postId?: number;
  /** Flag pesan dari admin (suppress embeds/notifikasi). */
  flags?: number;
  /** Nilai template teks (`{member.name}`, …). Kosong = apa adanya. */
  template?: Record<string, string> | null;
}): Promise<SendResult> {
  // Komponen interaktif dikirim oleh WEBHOOK, bukan oleh bot kita. Discord
  // hanya meneruskan klik ke aplikasi pemilik komponen — jadi tombol/menu di
  // pesan webhook akan diam saja. Lebih jujur menolak di sini.
  if ((options.roleButtons ?? []).length > 0 || (options.roleMenus ?? []).length > 0) {
    throw new PostSendError(
      'Pesan lewat webhook tidak bisa memakai tombol atau menu ambil role — Discord hanya mengirim interaksi komponen ke aplikasi pengirim. Matikan mode webhook untuk pesan ini, atau hapus komponen role-nya.',
    );
  }

  const built = await buildPayload(
    options.blocks,
    [],
    options.accent,
    [],
    options.postId ?? null,
    options.template ?? null,
  );
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
    flags: options.flags ? built.flags | options.flags : built.flags,
    files: built.files,
    allowedMentions: built.allowedMentions,
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
