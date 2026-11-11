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
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MessageFlags,
} from 'discord.js';
import { cardDetail } from './welcome.js';

/**
 * Rujukan pengganti untuk pratinjau.
 *
 * Pratinjau mengirim gambar sebagai data URI, dan Discord MENOLAK data URI di
 * Media Gallery/Thumbnail. Jadi komponen dibangun dengan penanda ini, lalu
 * `preview.ts` menukarnya dengan gambar sungguhan. Nama sengaja tidak sama
 * dengan nama file asli supaya tidak mungkin tertukar dengan lampiran produksi.
 */
const PREVIEW_BANNER_REF = 'attachment://preview-banner';
const PREVIEW_AVATAR_REF = 'attachment://preview-avatar';

/** URL yang boleh dipakai apa adanya: http(s) saja, bukan data URI. */
function isPublicUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

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
   * Banner di paling atas kartu.
   *
   * Dua bentuk, sama seperti `avatar`: produksi mengirim lampiran (`name`),
   * pratinjau mengirim URL langsung (`url`). Tanpa bentuk `url`, pratinjau
   * tidak punya file untuk dirujuk — dan dulu itu ditambal dengan menyuntik
   * gambar ekstra di akhir, yang membuat banner tampil DUA kali.
   *
   * `files` tetap boleh dikirim bersama Components V2 — yang dilarang hanya
   * `content`, `embeds`, `stickers`, dan `poll`.
   */
  banner?: { name: string } | { url: string } | null;
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

    // Urutan blok: banner -> teks (+ avatar di kanan) -> pemisah -> kaki.
    //
    // Banner ditaruh PALING ATAS: ia yang memperkenalkan pesan, seperti sampul.
    // Sebelumnya banner berada di bawah teks DAN di bawah avatar, sehingga
    // avatar tampil sebagai kotak lebar berisi gambar kecil di tengah —
    // terlihat seperti kotak kosong besar, bukan foto profil.
    //
    // Banner sebagai gambar besar. Dulu mode ini mengabaikan banner sama
    // sekali tanpa memberi tahu — padahal admin sudah mengunggahnya.
    // Data URI DITOLAK Discord di Media Gallery ("Received one or more
    // errors"), sama seperti setImage di embed. Pratinjau mengirim gambar
    // sebagai data URI, jadi yang dipakai adalah rujukan lampiran bertanda —
    // bentuknya tetap benar (satu banner di paling atas), dan pratinjau
    // menggantinya dengan gambar sungguhan lewat `attachmentName()`.
    const bannerUrl = options.banner
      ? 'name' in options.banner
        ? // Produksi: nama file ASLI wajib dipertahankan — Discord mencocokkan
          // rujukan ini dengan lampiran yang ikut dikirim. Nama generik akan
          // menunjuk lampiran yang tidak ada, dan banner gagal tampil.
          `attachment://${options.banner.name}`
        : isPublicUrl(options.banner.url)
          ? options.banner.url
          : PREVIEW_BANNER_REF
      : null;

    if (bannerUrl) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(bannerUrl)),
      );
    }

    // Teks utama. Kalau ada avatar, teks dibungkus Section sehingga avatar
    // menjadi Thumbnail KECIL DI KANAN teks — bentuk yang sama dengan embed.
    //
    // Section (tipe 9) + Thumbnail (tipe 11) tersedia sejak discord.js 14.19;
    // pustaka lama membuat blok ini gagal dan ditangkap catch di bawah, jadi
    // pemanggil mundur ke embed. Tidak ada jalur yang menghasilkan pesan kosong.
    // Aturan sama seperti banner: data URI ditolak Discord, jadi pratinjau
    // memakai rujukan bertanda yang diganti gambarnya oleh `preview.ts`.
    const avatarUrl = options.avatar
      ? 'name' in options.avatar
        ? `attachment://${options.avatar.name}`
        : isPublicUrl(options.avatar.url)
          ? options.avatar.url
          : PREVIEW_AVATAR_REF
      : null;

    if (avatarUrl) {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(text),
      );
      // `true` = thumbnail; `false` = tombol. Avatar selalu thumbnail.
      section.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(avatarUrl).setDescription('avatar'),
      );
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
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
