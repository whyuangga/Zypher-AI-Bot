/**
 * Kartu **Components V2** untuk sambutan & salam perpisahan.
 *
 * Components V2 (Container, Text Display, Separator) memungkinkan pesan
 * bertema tanpa memakai embed sama sekali — tampilannya lebih seperti panel
 * Discord baru: blok berwarna aksen, teks, dan garis pemisah.
 *
 * Dua batasan penting:
 *
 * 1. **Pesan ber-flag `IsComponentsV2` tidak boleh memuat `content`, `embeds`,
 *    maupun `files`.** Discord menolaknya. Artinya mode ini tidak bisa
 *    me-*ping* member kecuali mention-nya ikut di dalam Text Display.
 * 2. Kalau pustaka tidak mendukung (discord.js < 14.19), fungsi ini
 *    mengembalikan `null` dan pemanggil mundur ke embed — bukan melempar.
 *
 * Karena itu seluruh pembuatan komponen dibungkus try/catch: satu perubahan
 * bentuk API di masa depan tidak boleh membuat sambutan hilang sama sekali.
 */
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
} from 'discord.js';
import { cardDetail } from './welcome.js';

/** Warna aksen per jenis pesan — sama dengan warna embed yang sudah dipakai. */
const ACCENT = { welcome: 0x6d8cff, goodbye: 0x716c98 } as const;

export interface ContainerCardOptions {
  kind: 'welcome' | 'goodbye';
  /** Teks utama. Sudah termasuk token yang diganti dan (opsional) mention. */
  text: string;
  /** Nama server untuk baris kaki. */
  guildName: string;
  /** Jumlah member saat ini; 0 = tidak ditampilkan. */
  memberCount?: number;
  /** Baris tambahan di bawah teks, mis. `dibuat dengan AI`. */
  extra?: string[];
  /**
   * Nama lampiran banner (mis. `banner-abc.png`). Ditampilkan lewat Media
   * Gallery dengan rujukan `attachment://`.
   *
   * `files` tetap boleh dikirim bersama Components V2 — yang dilarang hanya
   * `content`, `embeds`, `stickers`, dan `poll`.
   */
  bannerName?: string | null;
  /**
   * Teks yang ditaruh di PALING ATAS kartu, sebelum teks utama.
   *
   * Dipakai pesan uji untuk menempelkan penanda "ini pesan uji" + mention:
   * pesan Components V2 dilarang punya `content`, jadi penanda tidak bisa
   * dikirim sebagai teks pesan biasa seperti mode lain. Dibiarkan kosong oleh
   * produksi, jadi bentuk sambutan sungguhan tidak berubah.
   */
  lead?: string | null;
  /**
   * Avatar member di dalam kartu.
   *
   * Components V2 tidak punya `setThumbnail()`; satu-satunya cara menampilkan
   * gambar adalah Media Gallery yang butuh URL. Di produksi avatar dikirim
   * sebagai lampiran (`name`, dirujuk lewat attachment://), sedangkan pratinjau
   * memakai URL biasa (`url`). Tanpa keduanya, tidak ada avatar sama sekali.
   */
  avatar?: { name: string } | { url: string } | null;
}

/**
 * Batas karakter teks dalam satu Text Display.
 *
 * Discord membatasi total 4000 karakter per pesan; 3500 memberi ruang untuk
 * baris kaki dan pemisah, sekaligus mencegah penolakan dari API.
 */
const MAX_TEXT = 3500;

/**
 * Bangun satu kartu Components V2.
 *
 * `null` = lingkungan ini tidak mendukung, pemanggil harus mundur ke embed.
 */
export function buildContainerCard(options: ContainerCardOptions): ContainerBuilder | null {
  try {
    const text = options.text.trim().slice(0, MAX_TEXT);
    if (!text) return null;

    const container = new ContainerBuilder()
      .setAccentColor(ACCENT[options.kind]);

    // Penanda uji lebih dulu, supaya terbaca sebelum isi kartu.
    const lead = options.lead?.trim();
    if (lead) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lead.slice(0, 500)));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

    // Avatar member di ATAS teks: bentuk yang sama dengan baris penulis di
    // embed, karena Components V2 tidak punya penulis/thumbnail sendiri.
    if (options.avatar) {
      const url = 'url' in options.avatar ? options.avatar.url : `attachment://${options.avatar.name}`;
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(url).setDescription('avatar'),
        ),
      );
    }

    // Banner sebagai gambar besar. Dulu mode ini mengabaikan banner sama
    // sekali tanpa memberi tahu — padahal admin sudah mengunggahnya.
    if (options.bannerName) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(`attachment://${options.bannerName}`),
        ),
      );
    }

    const extra = (options.extra ?? []).map((line) => line.trim()).filter(Boolean);
    if (extra.length > 0) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(extra.join('\n').slice(0, 800)),
        );
    }

    // Baris kaki memakai sintaks `-#` (teks kecil) — satu-satunya cara membuat
    // teks sekunder di dalam container, karena footer embed tidak tersedia.
    //
    // Isinya memakai cardDetail() yang sama dengan kartu PNG: dulu container
    // menulis sendiri "member ke-N", sehingga salam perpisahan menyebut jumlah
    // member yang tersisa — sedangkan kartu perpisahan tidak. Dua bentuk pesan
    // untuk hal yang sama harus sepakat.
    const foot = `-# ${cardDetail(options.kind, options.guildName, options.memberCount)}`;
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(foot.slice(0, 200)));

    return container;
  } catch {
    // Pustaka lama / API berubah: pemanggil memakai embed.
    return null;
  }
}

/**
 * Payload siap kirim untuk `channel.send()`.
 *
 * Flag wajib — tanpa `IsComponentsV2`, Discord mengabaikan container dan
 * menganggap pesan tidak punya isi.
 */
export function containerPayload(
  card: ContainerBuilder,
): { components: ContainerBuilder[]; flags: number } {
  return { components: [card], flags: MessageFlags.IsComponentsV2 as number };
}
