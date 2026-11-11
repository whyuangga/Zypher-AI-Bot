/**
 * Bentuk pesan untuk **pratinjau** di dashboard.
 *
 * Dashboard perlu menunjukkan bagaimana pesan akan terlihat di Discord, bukan
 * hanya teksnya. Sebelum ini, kotak pratinjau hanya menampilkan kalimat sapaan
 * telanjang: admin memilih mode Embed atau Container, menekan "Tes sambutan",
 * dan tidak melihat warna aksen, posisi banner, avatar, maupun footernya. Yang
 * bisa dinilai hanya kalimatnya.
 *
 * Kenapa data mentah, bukan HTML langsung:
 *
 *   - Fungsi di sini murni: tidak menyentuh database, Discord, atau browser.
 *     Akibatnya bisa diuji tanpa jaringan, dan hasilnya bisa dibandingkan
 *     dengan payload produksi (itulah yang dikunci test "pratinjau = produksi").
 *   - escape HTML dilakukan pemanggil (`pages.ts`) karena hanya di sana ada
 *     konteks halaman. Warna, nama, dan URL member adalah data yang tidak boleh
 *     dipercaya — nama member bisa berisi `<script>`.
 *
 * Aturan yang dijaga modul ini: **tidak ada aturan Discord baru di sini.**
 * Semua keputusan (mention hanya di luar embed, banner lewat attachment://,
 * container tanpa content) tetap milik `composePayload()` di `welcome.ts`. Modul
 * ini hanya MEMBACA payload yang sudah jadi.
 */
import type { EmbedBuilder } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

/** Satu baris di dalam kartu container. */
export type MockLineKind = 'text' | 'small';

export interface MockLine {
  kind: MockLineKind;
  /** Isi teks. Masih boleh berisi sintaks Discord (`<@id>`, `-#`, markdown). */
  text: string;
}

export interface EmbedMock {
  /** Warna aksen embed dalam format CSS (`#6d8cff`), null = tidak ada/absen. */
  color: string | null;
  /** Baris penulis: avatar + nama di atas teks (setAuthor). */
  author: { name: string; iconUrl: string | null } | null;
  /** Thumbnail kecil di kanan atas. */
  thumbnailUrl: string | null;
  /** Judul embed, kalau ada. */
  title: string | null;
  /** Teks utama. */
  description: string;
  /** Gambar besar di bawah teks (banner). `attachment://` sudah diterjemahkan. */
  imageUrl: string | null;
  footer: { text: string; iconUrl: string | null } | null;
  /** Isi field embed, kalau ada. */
  fields: Array<{ name: string; value: string; inline: boolean }>;
}

/**
 * Satu blok di dalam container, DALAM URUTAN ASLINYA.
 *
 * Dulu bentuk ini memisahkan `lines` dan `imageUrls` lalu pratinjau menggambar
 * semua teks lebih dulu, baru semua gambar. Akibatnya pratinjau berbohong
 * tentang urutan sebenarnya: teks yang di Discord muncul SETELAH gambar ikut
 * tergambar di atasnya. Sekarang satu daftar berurutan, jadi tidak mungkin
 * melenceng lagi.
 */
export type ContainerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'small'; text: string }
  | { kind: 'image'; url: string }
  /**
   * Section (tipe 9): teks dan thumbnail-nya SATU blok, bukan dua.
   *
   * Dulu thumbnail dikirim sebagai blok terpisah sesudah teks, sehingga
   * pratinjau menggambarnya di baris sendiri di kanan bawah — padahal Discord
   * menampilkannya DI SAMPING teks. Kalau satu kesatuan, tidak mungkin
   * melenceng.
   */
  | { kind: 'section'; text: string; thumbnailUrl: string | null }
  | { kind: 'separator' };

export interface ContainerMock {
  /** Warna garis aksen di kiri kartu (`#6d8cff`), null = bawaan. */
  accentColor: string | null;
  /** Blok berurutan persis seperti yang dikirim ke Discord. */
  blocks: ContainerBlock[];
}

/** Batas atas isi pratinjau — melindungi halaman dari payload raksasa. */
const MAX_TEXT = 4000;

/**
 * Ubah angka warna Discord menjadi warna CSS.
 *
 * `0x6d8cff` -> `#6d8cff`. Nilai di luar jangkauan (mis. hasil rusak) menjadi
 * null, bukan `#NaN` yang membuat CSS diam-diam diabaikan.
 */
export function colorToCss(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

/**
 * Terjemahkan `attachment://nama.png` menjadi nama file saja.
 *
 * Di Discord, rujukan ini berarti "gambar yang ikut di pesan ini". Di browser
 * tidak ada lampiran, jadi pemanggil menampilkannya sebagai kotak berlabel
 * nama file — bukan gambar rusak. Mengembalikan `null` untuk URL biasa.
 */
export function attachmentName(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^attachment:\/\/(.+)$/.exec(url);
  return match ? match[1]! : null;
}

/**
 * Baca satu embed yang sudah jadi menjadi bentuk untuk pratinjau.
 *
 * Menerima `EmbedBuilder` maupun objek `data` mentah supaya bisa dipakai di
 * test tanpa membangun Discord client.
 */
export function embedToMock(source: EmbedBuilder | { toJSON?: () => unknown; data?: unknown } | null): EmbedMock | null {
  if (!source) return null;
  const raw = readData(source);
  if (!raw) return null;

  const description = typeof raw.description === 'string' ? raw.description : '';
  const title = typeof raw.title === 'string' ? raw.title : null;
  const author = readAuthor(raw.author);
  const footer = readFooter(raw.footer);
  const fields = Array.isArray(raw.fields)
    ? raw.fields.slice(0, 25).map((field) => ({
        name: String((field as Record<string, unknown>).name ?? ''),
        value: String((field as Record<string, unknown>).value ?? ''),
        inline: Boolean((field as Record<string, unknown>).inline),
      }))
    : [];

  // Embed tanpa isi apa pun tidak bisa dipratinjau — Discord juga menolaknya.
  if (!description && !title && fields.length === 0) return null;

  return {
    color: colorToCss(raw.color),
    author,
    thumbnailUrl: readUrl(raw.thumbnail),
    title: title ? title.slice(0, 256) : null,
    description: description.slice(0, MAX_TEXT),
    imageUrl: readUrl(raw.image),
    footer: footer ? { text: footer.text.slice(0, 2048), iconUrl: footer.iconUrl } : null,
    fields,
  };
}

/**
 * Baca satu kartu Components V2 (Container) menjadi bentuk untuk pratinjau.
 *
 * Struktur JSON komponen dibaca apa adanya karena itulah yang dikirim ke
 * Discord. Tipe komponen yang dipakai di proyek ini: 17 = container,
 * 10 = text display, 12 = media gallery, 14 = separator, 9 = section,
 * 11 = thumbnail.
 */
export function containerToMock(
  source: ContainerBuilder | { toJSON?: () => unknown } | null,
): ContainerMock | null {
  if (!source) return null;
  const raw = readData(source);
  if (!raw) return null;
  // Hanya container yang bisa dipratinjau.
  if (raw.type !== undefined && raw.type !== 17) return null;

  const blocks: ContainerBlock[] = [];

  const walk = (items: unknown[]): void => {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const node = item as Record<string, unknown>;
      const type = node.type;

      if (type === 10 && typeof node.content === 'string') {
        // Konvensi Discord: baris diawali `-#` = teks kecil (footer).
        const text = node.content.slice(0, MAX_TEXT);
        blocks.push({ kind: /^\s*-#\s/.test(text) ? 'small' : 'text', text });
        continue;
      }
      if (type === 12 && Array.isArray(node.items)) {
        // Bentuk JSON resmi: { type: 12, items: [{ media: { url } }] }. Dulu
        // pembaca ini mencari `items[].url` langsung, sehingga tidak pernah
        // menemukan gambar apa pun — pratinjau container selalu tanpa avatar.
        for (const media of node.items) {
          if (!media || typeof media !== 'object') continue;
          const entry = media as Record<string, unknown>;
          const url =
            readUrl(entry.media) ?? readUrl(entry) ?? (typeof entry.url === 'string' ? entry.url : null);
          if (url) blocks.push({ kind: 'image', url });
        }
        continue;
      }
      // Section (9): teks + thumbnail (11) di kanan. Bentuk inilah yang dipakai
      // sambutan supaya avatar tidak jadi kotak selebar penuh di tengah.
      //
      // Teks di dalamnya digabung menjadi SATU blok bersama thumbnail-nya:
      // Discord menampilkan keduanya berdampingan, bukan bertumpuk.
      if (type === 9 && Array.isArray(node.components)) {
        const isi = node.components
          .map((child) =>
            child && typeof child === 'object' && (child as Record<string, unknown>).type === 10
              ? String((child as Record<string, unknown>).content ?? '')
              : '',
          )
          .filter(Boolean)
          .join('\n');
        const accessory = node.accessory as Record<string, unknown> | undefined;
        const thumb = accessory && accessory.type === 11 ? readUrl(accessory.media) : null;
        if (isi) blocks.push({ kind: 'section', text: isi.slice(0, MAX_TEXT), thumbnailUrl: thumb });
        continue;
      }
      if (type === 14) {
        blocks.push({ kind: 'separator' });
        continue;
      }
      // Container bersarang / action row: turun satu tingkat.
      if (Array.isArray(node.components)) walk(node.components);
    }
  };

  if (Array.isArray(raw.components)) walk(raw.components);
  if (blocks.length === 0) return null;

  return {
    accentColor: colorToCss(raw.accent_color ?? raw.accentColor),
    blocks,
  };
}

/* ------------------------------------------------------------------ */
/*  pembaca data mentah                                                */
/* ------------------------------------------------------------------ */

function readData(source: { toJSON?: () => unknown; data?: unknown }): Record<string, unknown> | null {
  let raw: unknown = null;
  if (typeof source.toJSON === 'function') {
    try {
      raw = source.toJSON();
    } catch {
      return null;
    }
  } else if ('data' in source && source.data) {
    raw = source.data;
  } else {
    raw = source;
  }
  if (!raw || typeof raw !== 'object') return null;
  return raw as Record<string, unknown>;
}

function readUrl(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const url = (node as Record<string, unknown>).url;
  return typeof url === 'string' && url.trim() ? url : null;
}

function readAuthor(node: unknown): EmbedMock['author'] {
  if (!node || typeof node !== 'object') return null;
  const raw = node as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name : '';
  // `icon_url` (mentah) atau `iconURL` (builder lama) — dua-duanya diterima.
  const icon = raw.icon_url ?? raw.iconURL;
  if (!name.trim() && typeof icon !== 'string') return null;
  return { name: name.slice(0, 256), iconUrl: typeof icon === 'string' ? icon : null };
}

function readFooter(node: unknown): { text: string; iconUrl: string | null } | null {
  if (!node || typeof node !== 'object') return null;
  const raw = node as Record<string, unknown>;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const icon = raw.icon_url ?? raw.iconURL;
  if (!text.trim() && typeof icon !== 'string') return null;
  return { text, iconUrl: typeof icon === 'string' ? icon : null };
}
