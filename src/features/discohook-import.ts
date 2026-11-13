/**
 * Impor pesan **Discohook** menjadi blok `/pesan`.
 *
 * Discohook (https://github.com/discohook/discohook) menyimpan pesan sebagai
 * payload Discord apa adanya: `messages[].data` berisi `content`, `embeds`,
 * `attachments`, dan `components` Components V2. Formatnya didefinisikan di
 * `packages/site/app/types/QueryData.ts` + `components.ts` + `components-raw.ts`
 * pada repo itu, dan berkas ini mengikuti definisi tersebut — bukan menebak.
 *
 * Kenapa diimpor sebagai BLOK, bukan disimpan sebagai payload mentah:
 *
 *   - Blok adalah sumber kebenaran `/pesan`. Kalau payload Discohook dikirim
 *     langsung, tombol ambil role, batas komponen, dan pratinjau dashboard
 *     tidak akan mengenalinya.
 *   - Penyusun payload bot (`buildPostPayload`) tetap satu-satunya yang
 *     menentukan bentuk akhir, jadi hasil impor tidak bisa melewati batas
 *     Discord yang sudah dijaga di sana.
 *
 * Modul ini murni: tidak menyentuh jaringan, database, atau Discord.
 * Pengambilan tautan share dilakukan pemanggil (`src/web/server.ts`).
 */
import { normalizeAccent, type PostBlock } from './custom-post.js';

/** Satu pesan hasil impor, siap dimasukkan ke editor `/pesan`. */
import { sanitizeEmbedList, type EmbedExtra } from './post-embed.js';

export interface DiscohookMessage {
  /** Nama pesan di Discohook (opsional di sana). */
  name: string | null;
  blocks: PostBlock[];
  /**
   * Embed asli dari Discohook, siap disimpan ke `custom_posts.embed`.
   *
   * Dulu embed diterjemahkan menjadi kartu teks karena bot belum bisa mengirim
   * embed. Sekarang bisa, jadi embed DIPERTAHANKAN apa adanya — dan hanya
   * diterjemahkan menjadi blok kalau pesannya juga membawa komponen V2
   * (Discord tidak mengizinkan keduanya dalam satu pesan).
   */
  embed: EmbedExtra[];
  /** Bentuk yang harus dipakai pesan ini: `embed` kalau isinya embed saja. */
  layout: 'container' | 'embed';
  /** Bagian yang tidak bisa diwakili blok — ditampilkan ke admin. */
  warnings: string[];
}

export interface DiscohookImport {
  messages: DiscohookMessage[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/*  Jenis komponen Discord (Components V2)                             */
/* ------------------------------------------------------------------ */

/**
 * Angka tipe komponen Discord.
 *
 * Ditulis sebagai konstanta, bukan enum, supaya modul ini tidak perlu
 * mengimpor `discord.js` — dengan begitu bisa diuji tanpa login bot.
 */
const T = {
  actionRow: 1,
  button: 2,
  stringSelect: 3,
  userSelect: 5,
  roleSelect: 6,
  mentionableSelect: 7,
  channelSelect: 8,
  section: 9,
  textDisplay: 10,
  thumbnail: 11,
  mediaGallery: 12,
  file: 13,
  separator: 14,
  container: 17,
} as const;

/** Gaya tombol Discord. Hanya `link` yang bisa diimpor sebagai blok. */
const STYLE_LINK = 5;

/** Batas aman panjang teks satu pesan — sama dengan penyusun payload. */
const MAX_TEXT = 3500;

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Angka komponen: Discohook kadang mengirimnya sebagai string. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Emoji Discohook ({ id, name, animated }) -> bentuk yang dipahami editor.
 *
 * Editor dan penyusun payload memakai teks: emoji unicode apa adanya, emoji
 * server sebagai `<:nama:id>` / `<a:nama:id>`. Tanpa terjemahan ini, emoji
 * impor akan hilang diam-diam.
 */
export function discohookEmojiToString(value: unknown): string {
  const emoji = asObject(value);
  if (!emoji) return '';
  const id = asString(emoji.id).trim();
  const name = asString(emoji.name).trim();
  if (id) {
    if (!name) return '';
    return `<${emoji.animated === true ? 'a' : ''}:${name}:${id}>`;
  }
  return name;
}

/** `5814783` -> `#58b4ff`. Warna di Discord selalu angka 24-bit. */
export function discohookColorToHex(value: unknown): string {
  const angka = asNumber(value);
  if (angka === null || angka < 0 || angka > 0xffffff) return '';
  return `#${Math.trunc(angka).toString(16).padStart(6, '0')}`;
}

/** Tautan gambar yang bisa dipakai langsung (http/https). */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

/** Ambil URL dari `{ media: { url } }` milik UnfurledMediaItem. */
function mediaUrl(value: unknown): string {
  const media = asObject(asObject(value)?.media);
  return asString(media?.url).trim();
}

/* ------------------------------------------------------------------ */
/*  Konversi komponen -> blok                                          */
/* ------------------------------------------------------------------ */

/** Hasil konversi satu komponen; `card` menandai blok yang membuka kartu. */
interface Converted {
  blocks: PostBlock[];
  warnings: string[];
  /** true kalau komponen ini sebuah Container (kartu). */
  card: boolean;
}

function warningDari(judul: string, detail: string): string {
  return `${judul}: ${detail}`;
}

/**
 * Apakah ActionRow ini MENGHASILKAN baris tombol.
 *
 * Dua baris tombol berurutan di Discohook adalah dua Row terpisah. Di
 * `/pesan`, tombol yang berurutan tanpa blok `row` digabung sampai lima per
 * baris — jadi impor wajib menyisipkan `row` untuk mempertahankan bentuknya.
 */
function mulaiTombol(blocks: PostBlock[]): boolean {
  return blocks.length > 0 && blocks[0]!.kind === 'button';
}

function akhiriTombol(blocks: PostBlock[]): boolean {
  return blocks.length > 0 && blocks[blocks.length - 1]!.kind === 'button';
}

/**
 * Jenis select menu Discohook -> jenis blok `/pesan`.
 *
 * Semuanya diterjemahkan, bukan dibuang: Discohook sendiri mengirim menu ini
 * "tampil saja" (tanpa bot yang menanggapinya), dan blok `select` di /pesan
 * berperilaku sama. Yang TIDAK diimpor adalah menu role buatan bot sendiri
 * (customId `post-menu:`), karena menu itu hanya bermakna untuk pesan kita.
 */
const SELECT_KIND_BY_TYPE: Record<number, string> = {
  [T.stringSelect]: 'string',
  [T.userSelect]: 'user',
  [T.roleSelect]: 'role',
  [T.mentionableSelect]: 'mentionable',
  [T.channelSelect]: 'channel',
};

/** Terjemahkan satu select menu Discohook menjadi blok `select`. */
function convertSelect(raw: Raw, jenis: string): { block: PostBlock | null; warnings: string[] } {
  const warnings: string[] = [];
  const blok: PostBlock = { kind: 'select', value: '', selectKind: jenis as PostBlock['selectKind'] };

  const placeholder = asString(raw.placeholder).trim();
  if (placeholder) blok.placeholder = placeholder.slice(0, 150);

  const minValues = asNumber(raw.min_values);
  const maxValues = asNumber(raw.max_values);
  if (minValues !== null) blok.minValues = Math.max(0, Math.trunc(minValues));
  if (maxValues !== null) blok.maxValues = Math.max(1, Math.trunc(maxValues));
  if (raw.disabled === true) blok.selectDisabled = true;

  if (jenis === 'string') {
    const opsi: NonNullable<PostBlock['options']> = [];
    for (const item of asArray(raw.options)) {
      const mentah = asObject(item);
      if (!mentah) continue;
      const label = asString(mentah.label).trim();
      if (!label) continue;
      const value = asString(mentah.value).trim();
      const emoji = discohookEmojiToString(mentah.emoji);
      const description = asString(mentah.description).trim();
      opsi.push({
        label: label.slice(0, 100),
        ...(value ? { value: value.slice(0, 100) } : {}),
        ...(emoji ? { emoji } : {}),
        ...(description ? { description: description.slice(0, 100) } : {}),
      });
    }
    if (opsi.length === 0) {
      warnings.push(
        warningDari(
          'Menu pilihan',
          'tidak punya pilihan sah — Discord menolak menu kosong, jadi menu ini dilewati',
        ),
      );
      return { block: null, warnings };
    }
    blok.options = opsi;
  }

  return { block: blok, warnings };
}

/**
 * Penerjemah satu komponen Discohook menjadi nol atau lebih blok.
 *
 * Aturan yang dipegang: **tidak ada yang dibuang diam-diam**. Setiap komponen
 * yang tidak bisa diwakili menghasilkan satu baris `warnings` yang bisa
 * dibaca admin, supaya ia tahu bagian mana yang perlu disusun ulang manual.
 */
function convertComponent(component: Raw): Converted {
  const blocks: PostBlock[] = [];
  const warnings: string[] = [];
  const type = asNumber(component.type);

  if (type === T.textDisplay) {
    const content = asString(component.content);
    if (content.trim()) blocks.push({ kind: 'text', value: content });
    return { blocks, warnings, card: false };
  }

  if (type === T.container) {
    const accent = discohookColorToHex(component.accent_color);
    blocks.push({
      kind: 'container',
      value: '',
      ...(accent ? { accent } : {}),
      ...(component.spoiler === true ? { spoiler: true } : {}),
    });
    /*
     * Isi container diterjemahkan sebagai blok biasa. Blok `close` TIDAK
     * disisipkan di akhir: pemanggil yang tahu apakah komponen berikutnya
     * masih di dalam kartu atau sudah keluar. Menyisipkan di sini akan
     * membuat dua kartu berurutan kehilangan isinya.
     */
    let barisTerakhirTombol = false;
    for (const child of asArray(component.components)) {
      const raw = asObject(child);
      if (!raw) continue;
      const hasil = convertComponent(raw);
      warnings.push(...hasil.warnings);
      // Baris tombol kedua dan seterusnya dipisah blok `row`.
      if (barisTerakhirTombol && mulaiTombol(hasil.blocks)) blocks.push({ kind: 'row', value: '' });
      blocks.push(...hasil.blocks);
      if (hasil.blocks.length > 0) barisTerakhirTombol = akhiriTombol(hasil.blocks);
    }
    return { blocks, warnings, card: true };
  }

  if (type === T.separator) {
    blocks.push({
      kind: 'divider',
      value: '',
      ...(component.spacing === 2 ? { spacing: 'large' as const } : {}),
      ...(component.divider === false ? { divider: false } : {}),
    });
    return { blocks, warnings, card: false };
  }

  if (type === T.section) {
    // Discord mengizinkan sampai 3 Text Display dalam satu Section; blok
    // `/pesan` hanya punya satu kolom teks, jadi isinya digabung dengan baris
    // baru — hasil visualnya sama karena Discord menumpuknya vertikal.
    const teks = asArray(component.components)
      .map((child) => asString(asObject(child)?.content))
      .filter((isi) => isi.trim())
      .join('\n');

    const accessory = asObject(component.accessory);
    const accessoryType = asNumber(accessory?.type);
    const blok: PostBlock = { kind: 'section', value: teks };

    if (accessoryType === T.button) {
      const style = asNumber(accessory?.style);
      if (style !== STYLE_LINK) {
        warnings.push(
          warningDari(
            'Section',
            'tombol interaktif (bukan tautan) tidak bisa diimpor — buat tombol ambil role dari dashboard',
          ),
        );
      } else {
        const url = asString(accessory?.url).trim();
        const label = asString(accessory?.label).trim();
        if (url && label) {
          blok.accessoryLabel = label;
          blok.url = url;
          const emoji = discohookEmojiToString(accessory?.emoji);
          if (emoji) blok.emoji = emoji;
          if (accessory?.disabled === true) blok.disabled = true;
        }
      }
    } else if (accessoryType === T.thumbnail) {
      const url = mediaUrl(accessory);
      if (isHttpUrl(url)) blok.thumbnail = url;
      else if (url) warnings.push(warningDari('Section', `gambar ${url} bukan http/https`));
    }

    if (!teks.trim() && !blok.thumbnail) {
      warnings.push(warningDari('Section', 'tidak punya teks maupun gambar — dilewati'));
      return { blocks, warnings, card: false };
    }
    blocks.push(blok);
    return { blocks, warnings, card: false };
  }

  if (type === T.mediaGallery) {
    for (const item of asArray(component.items)) {
      const raw = asObject(item);
      if (!raw) continue;
      const url = mediaUrl(raw);
      if (!isHttpUrl(url)) {
        // `attachment://` hanya berlaku untuk lampiran yang ikut terkirim.
        warnings.push(
          warningDari(
            'Gambar',
            url.startsWith('attachment://')
              ? `${url} adalah lampiran Discohook — unggah ulang gambarnya di dashboard`
              : `URL gambar tidak sah (${url || 'kosong'})`,
          ),
        );
        continue;
      }
      const alt = asString(raw.description).trim();
      blocks.push({
        kind: 'image',
        value: url,
        ...(alt ? { alt } : {}),
        ...(raw.spoiler === true ? { spoiler: true } : {}),
      });
    }
    return { blocks, warnings, card: false };
  }

  if (type === T.file) {
    const url = mediaUrl(component.file ?? component);
    if (!isHttpUrl(url)) {
      warnings.push(
        warningDari(
          'Berkas',
          url.startsWith('attachment://')
            ? 'lampiran Discohook tidak bisa dibawa lewat tautan — pakai blok File dengan URL atau unggah dari perangkat'
            : `URL berkas tidak sah (${url || 'kosong'})`,
        ),
      );
      return { blocks, warnings, card: false };
    }
    blocks.push({
      kind: 'file',
      value: url,
      ...(component.spoiler === true ? { spoiler: true } : {}),
    });
    return { blocks, warnings, card: false };
  }

  if (type === T.actionRow) {
    /*
     * Baris select: satu select memenuhi seluruh baris (5 slot dari 5), jadi
     * blok `row` dipakai supaya baris tombol di sekitarnya tidak ikut
     * bergabung — persis seperti Row di Discohook.
     */
    for (const child of asArray(component.components)) {
      const raw = asObject(child);
      if (!raw) continue;
      const childType = asNumber(raw.type);
      if (childType === T.button) {
        const style = asNumber(raw.style);
        const label = asString(raw.label).trim();
        const url = asString(raw.url).trim();
        if (style !== STYLE_LINK) {
          warnings.push(
            warningDari(
              `Tombol "${label || '(tanpa label)'}"`,
              'tombol interaktif memakai customId dan tidak bisa dipindah — pakai tombol ambil role',
            ),
          );
          continue;
        }
        if (!label || !isHttpUrl(url)) {
          warnings.push(warningDari(`Tombol "${label || '(tanpa label)'}"`, 'label atau URL tidak sah'));
          continue;
        }
        const emoji = discohookEmojiToString(raw.emoji);
        blocks.push({
          kind: 'button',
          value: label,
          url,
          ...(emoji ? { emoji } : {}),
          ...(raw.disabled === true ? { disabled: true } : {}),
        });
        continue;
      }
      const jenisSelect = childType === null ? undefined : SELECT_KIND_BY_TYPE[childType];
      if (jenisSelect) {
        const hasilSelect = convertSelect(raw, jenisSelect);
        warnings.push(...hasilSelect.warnings);
        if (hasilSelect.block) blocks.push(hasilSelect.block);
        continue;
      }
      warnings.push(warningDari('Baris komponen', `jenis ${String(childType)} tidak dikenal`));
    }
    return { blocks, warnings, card: false };
  }

  warnings.push(warningDari('Komponen', `jenis ${String(type)} belum didukung impor`));
  return { blocks, warnings, card: false };
}

/**
 * Terjemahkan daftar komponen TOP-LEVEL menjadi blok utuh satu pesan.
 *
 * Dua hal yang harus dijaga di sini, dan keduanya adalah alasan fungsi ini
 * terpisah dari `convertComponent`:
 *
 *   1. **Batas kartu.** Komponen top-level Discohook adalah saudara sejajar.
 *      Di `/pesan`, blok sesudah `container` masuk KE DALAM kartu sampai ada
 *      `container` berikutnya atau blok `close`. Karena itu setiap kali
 *      container selesai dan komponen berikutnya bukan container, satu blok
 *      `close` disisipkan — tanpa itu, tombol penutup ikut terkurung di kartu.
 *
 *   2. **Pesan tanpa container.** Discohook boleh mengirim TextDisplay,
 *      Separator, dan ActionRow langsung di pesan. Blok `/pesan` tanpa
 *      container akan dibungkus satu kartu oleh penyusun payload, sehingga
 *      tampilannya berubah. Satu blok `close` di awal menahan itu: semua blok
 *      tetap di luar kartu, sama seperti aslinya.
 */
export function discohookComponentsToBlocks(components: unknown[]): { blocks: PostBlock[]; warnings: string[] } {
  const warnings: string[] = [];
  const blocks: PostBlock[] = [];

  const daftar = components.map(asObject).filter((item): item is Raw => item !== null);
  const adaContainer = daftar.some((item) => asNumber(item.type) === T.container);
  if (!adaContainer && daftar.length > 0) {
    // Seluruh isi berada di luar kartu, persis seperti pesan Discohook.
    blocks.push({ kind: 'close', value: '' });
  }

  let diDalamKartu = false;
  let totalTeks = 0;
  /**
   * Jenis blok terakhir yang dihasilkan.
   *
   * Dipakai untuk menyisipkan blok `row` di antara DUA ActionRow berisi
   * tombol: di Discohook barisnya eksplisit, sedangkan `/pesan` tanpa blok
   * `row` akan menggabungkan tombolnya sampai lima per baris. Tanpa ini,
   * dua baris 3 + 2 tombol akan tampil sebagai 5 tombol dalam satu baris.
   */
  let blokTerakhir = '';

  for (const component of daftar) {
    const hasil = convertComponent(component);
    warnings.push(...hasil.warnings);

    if (hasil.blocks.length === 0) continue;

    if (hasil.card) {
      // Kartu baru: tidak perlu `close` lebih dulu, karena blok `container`
      // sendiri sudah memindahkan penulisan ke dalam kartu baru.
      diDalamKartu = true;
    } else if (diDalamKartu) {
      // Komponen di luar kartu sesudah kartu selesai.
      blocks.push({ kind: 'close', value: '' });
      diDalamKartu = false;
      blokTerakhir = 'close';
    }

    /*
     * Baris tombol kedua dan seterusnya: sisipkan `row` supaya ActionRow
     * Discohook tetap terpisah, bukan digabung otomatis lima per baris.
     */
    if (mulaiTombol(hasil.blocks) && blokTerakhir === 'button') {
      blocks.push({ kind: 'row', value: '' });
    }

    for (const block of hasil.blocks) {
      if (block.kind === 'text' || block.kind === 'section') {
        // Jaring aman yang sama dengan sanitizeBlocks: satu pesan tidak boleh
        // membawa teks lebih dari 3500 karakter.
        const sisa = MAX_TEXT - totalTeks;
        if (sisa <= 0) {
          warnings.push(warningDari('Teks', 'melebihi batas satu pesan — sisa teks dilewati'));
          continue;
        }
        if (block.value.length > sisa) {
          warnings.push(warningDari('Teks', 'dipotong agar tidak melebihi batas satu pesan'));
          block.value = block.value.slice(0, sisa);
        }
        totalTeks += block.value.length;
      }
      blocks.push(block);
      blokTerakhir = block.kind;
    }
  }

  return { blocks, warnings };
}

/**
 * Terjemahkan komponen API Discord (bentuk yang dikirim Discord, bukan bentuk
 * Discohook) menjadi blok `/pesan`.
 *
 * Dipakai saat memuat pesan yang SUDAH ada di Discord. Bentuknya sama dengan
 * komponen Discohook karena keduanya JSON API Discord, jadi penerjemahnya
 * dipakai ulang — bukan ditulis kedua kali dan lama-lama berbeda hasilnya.
 */
export function v2ToBlocks(components: unknown[]): { blocks: PostBlock[]; warnings: string[] } {
  return discohookComponentsToBlocks(components);
}

/* ------------------------------------------------------------------ */
/*  embed -> blok                                                      */
/* ------------------------------------------------------------------ */

/**
 * Embed Discohook/Discord mentah → bentuk yang disimpan bot.
 *
 * Hanya memindahkan field; penyaringan (URL http, batas panjang, ISO 8601)
 * tetap di `sanitizeEmbedList` supaya aturannya satu tempat.
 *
 * `title` dan `description` TIDAK ikut di sini: di bot keduanya datang dari
 * nama pesan dan blok teks, bukan dari bagian admin. Pemanggil yang
 * memindahkannya (lihat `parseDiscohookShare`).
 */
export function embedKeExtra(raw: Raw): Record<string, unknown> {
  const hasil: Record<string, unknown> = {};
  if (asString(raw.url).trim()) hasil.url = asString(raw.url).trim();
  /*
   * Warna embed ikut dipertahankan: Discohook memakai warna per embed, dan
   * menghapusnya berarti semua embed impor tampil dengan warna aksen pesan.
   */
  const warna = discohookColorToHex(raw.color);
  if (warna) hasil.color = warna;
  if (asString(raw.timestamp).trim()) hasil.timestamp = asString(raw.timestamp).trim();

  const author = asObject(raw.author);
  if (author && asString(author.name).trim()) {
    hasil.author = {
      name: asString(author.name).trim(),
      ...(asString(author.url).trim() ? { url: asString(author.url).trim() } : {}),
      ...(asString(author.icon_url).trim() ? { icon_url: asString(author.icon_url).trim() } : {}),
    };
  }
  const footer = asObject(raw.footer);
  if (footer && asString(footer.text).trim()) {
    hasil.footer = {
      text: asString(footer.text).trim(),
      ...(asString(footer.icon_url).trim() ? { icon_url: asString(footer.icon_url).trim() } : {}),
    };
  }
  /*
   * Thumbnail & gambar besar ikut dipertahankan. Pada embed pertama bot tetap
   * memakai gambar dari blok; nilai di sini menang karena ditulis eksplisit.
   */
  const thumbnail = mediaUrl(raw.thumbnail);
  if (isHttpUrl(thumbnail)) hasil.thumbnail = thumbnail;
  const gambar = mediaUrl(raw.image);
  if (isHttpUrl(gambar)) hasil.image = gambar;

  const fields = asArray(raw.fields)
    .map(asObject)
    .filter((satu): satu is Raw => satu !== null)
    .map((field) => ({
      name: asString(field.name).trim(),
      value: asString(field.value).trim(),
      inline: field.inline === true,
    }))
    .filter((field) => field.name && field.value);
  if (fields.length) hasil.fields = fields;
  return hasil;
}

/**
 * Embed tidak bisa dikirim bersama Components V2 (`content`/`embeds`
 * dilarang saat flag 1 << 15 dipakai). Karena itu embed diterjemahkan menjadi
 * kartu berisi teks, dan admin diberi tahu bahwa bentuknya berubah.
 */
function embedToBlocks(embed: Raw): PostBlock[] {
  const blocks: PostBlock[] = [];
  const accent = discohookColorToHex(embed.color);
  blocks.push({ kind: 'container', value: '', ...(accent ? { accent : accent } : {}) } as PostBlock);

  const author = asObject(embed.author);
  if (asString(author?.name).trim()) blocks.push({ kind: 'text', value: `**${asString(author?.name)}**` });
  if (asString(embed.title).trim()) blocks.push({ kind: 'text', value: `### ${asString(embed.title)}` });
  if (asString(embed.description).trim()) blocks.push({ kind: 'text', value: asString(embed.description) });

  for (const field of asArray(embed.fields)) {
    const raw = asObject(field);
    if (!raw) continue;
    const judul = asString(raw.name).trim();
    const isi = asString(raw.value).trim();
    if (!judul && !isi) continue;
    blocks.push({ kind: 'text', value: `**${judul || '—'}**${isi ? `\n${isi}` : ''}` });
  }

  const image = asObject(embed.image);
  const urlGambar = asString(image?.url).trim();
  if (isHttpUrl(urlGambar)) blocks.push({ kind: 'image', value: urlGambar });

  const footer = asObject(embed.footer);
  if (asString(footer?.text).trim()) blocks.push({ kind: 'text', value: `-# ${asString(footer?.text)}` });

  return blocks;
}

/* ------------------------------------------------------------------ */
/*  QueryData Discohook -> pesan                                       */
/* ------------------------------------------------------------------ */

/**
 * Apakah data ini berbentuk QueryData Discohook?
 *
 * Dipakai dashboard untuk mengenali tempelan JSON tanpa harus bertanya
 * formatnya ke admin, dan untuk menolak JSON asing dengan pesan jelas.
 */
export function looksLikeDiscohook(value: unknown): boolean {
  const data = asObject(value);
  if (!data) return false;
  // Pembungkus respons API: { data: QueryData, expires }
  if (asObject(data.data)?.messages) return true;
  return Array.isArray(data.messages);
}

/**
 * Buka data Discohook menjadi pesan-pesan siap impor.
 *
 * Menerima dua bentuk yang dikirim Discohook sendiri:
 *   - respons API share: `{ data: { messages: [...] }, expires }`
 *   - QueryData mentah:  `{ version: 'd2', messages: [...] }`
 *
 * Pesan tanpa isi sama sekali dilewati — bukan menghasilkan pesan kosong yang
 * ditolak Discord saat dikirim.
 */
export function parseDiscohookShare(input: unknown): DiscohookImport {
  const warnings: string[] = [];
  const root = asObject(input);
  if (!root) {
    return { messages: [], warnings: ['Data Discohook kosong atau bukan objek.'] };
  }

  const query = asObject(root.data)?.messages !== undefined ? asObject(root.data)! : root;
  if (!Array.isArray(query.messages)) {
    return { messages: [], warnings: ['Data ini tidak punya daftar "messages" seperti milik Discohook.'] };
  }

  const messages: DiscohookMessage[] = [];
  for (const [index, entry] of query.messages.entries()) {
    const item = asObject(entry);
    if (!item) continue;
    const data = asObject(item.data) ?? {};
    let nameDariEmbed = '';
    const namaAwal = asString(item.name).trim();
    const pesanWarnings: string[] = [];

    const blocks: PostBlock[] = [];
    const components = asArray(data.components);
    if (components.length > 0) {
      const hasil = discohookComponentsToBlocks(components);
      blocks.push(...hasil.blocks);
      pesanWarnings.push(...hasil.warnings);
    }

    // `content` lama (pesan teks biasa) tetap didukung.
    const content = asString(data.content).trim();
    if (content) {
      if (components.length > 0) {
        pesanWarnings.push('Teks "content" diletakkan di atas komponen — Discord tidak mengizinkan keduanya sekaligus.');
      }
      const teksPembuka: PostBlock = { kind: 'text', value: content };
      /*
       * Kalau pesan dimulai dengan penanda `close` (artinya "semua isi di luar
       * kartu"), teks pembuka harus masuk SESUDAH penanda itu. Menaruhnya di
       * paling depan membuat teks itu jatuh ke dalam kartu dan merusak
       * susunan yang baru saja disiapkan.
       */
      if (blocks[0]?.kind === 'close') blocks.splice(1, 0, teksPembuka);
      else blocks.unshift(teksPembuka);
    }

    const embeds = asArray(data.embeds).map(asObject).filter((satu): satu is Raw => satu !== null);

    /*
     * Embed dipertahankan sebagai embed ASLI bila pesannya tidak membawa
     * komponen: Discord menolak Components V2 bersama embeds, jadi memaksa
     * keduanya berarti salah satunya harus dibuang. Kalau ada komponen, embed
     * tetap diterjemahkan menjadi kartu teks seperti sebelumnya — dan admin
     * diberi tahu bentuknya berubah.
     */
    const adaKomponen = components.length > 0 || content.length > 0;
    let embed: EmbedExtra[] = [];
    let layout: 'container' | 'embed' = 'container';

    if (embeds.length > 0 && !adaKomponen) {
      /*
       * Embed pertama: judul jadi NAMA pesan, isi jadi blok teks, gambar jadi
       * blok gambar — itulah jalur yang dipakai builder saat mengirim embed.
       * Sisanya (penulis, footer, bidang, tautan judul, stempel waktu) masuk
       * ke bagian admin per embed.
       */
      const hasil = sanitizeEmbedList(embeds.map(embedKeExtra));
      embed = hasil.list;
      layout = 'embed';
      pesanWarnings.push(...hasil.dropped);

      const pertama = embeds[0]!;
      nameDariEmbed = asString(pertama.title).trim();
      const isiUtama = asString(pertama.description).trim();
      if (isiUtama) blocks.push({ kind: 'text', value: isiUtama });
      const gambarUtama = asString(asObject(pertama.image)?.url).trim();
      if (isHttpUrl(gambarUtama)) blocks.push({ kind: 'image', value: gambarUtama });

      /*
       * Embed kedua dan seterusnya di bot hanya berisi bagian admin (penulis,
       * footer, bidang, tautan, waktu). Isi & gambar mereka tidak punya tempat
       * — lebih baik dikatakan daripada hilang tanpa jejak.
       */
      for (let i = 1; i < embeds.length; i += 1) {
        const satu = embeds[i]!;
        if (asString(satu.description).trim() || asString(asObject(satu.image)?.url).trim()) {
          pesanWarnings.push(
            `embed ${i + 1}: isi & gambar tidak bisa dipertahankan (hanya embed pertama yang memuat teks) — dipindahkan ke catatan impor.`,
          );
          const isiTambahan = asString(satu.description).trim();
          if (isiTambahan) blocks.push({ kind: 'text', value: isiTambahan });
          const gambarTambahan = asString(asObject(satu.image)?.url).trim();
          if (isHttpUrl(gambarTambahan)) blocks.push({ kind: 'image', value: gambarTambahan });
        }
      }
      if (embed.length < embeds.length) {
        pesanWarnings.push(`${embeds.length - embed.length} embed kosong dilewati.`);
      }
    } else if (embeds.length > 0) {
      pesanWarnings.push(
        embeds.length > 1
          ? `${embeds.length} embed diterjemahkan menjadi kartu teks (Components V2 tidak bisa membawa embed).`
          : 'Embed diterjemahkan menjadi kartu teks — Components V2 tidak bisa membawa embed.',
      );
      for (const raw of embeds) {
        /*
         * Embed diletakkan SESUDAH komponen, tetapi harus di luar kartu
         * komponen supaya tidak menyatu dengan kartu terakhir Discohook.
         */
        if (blocks.some((block) => block.kind === 'container')) {
          const terakhir = blocks[blocks.length - 1];
          if (terakhir?.kind !== 'close') blocks.push({ kind: 'close', value: '' });
        }
        blocks.push(...embedToBlocks(raw));
      }
    }

    /*
     * Nama pesan: nama di Discohook kalau ada, lalu judul embed pertama, lalu
     * nomor urut. Judul embed dipakai karena di bot judul embed = nama pesan;
     * mengabaikannya akan membuat pesan impor kehilangan judulnya.
     */
    const nama = namaAwal || nameDariEmbed || `Pesan Discohook ${index + 1}`;

    if (blocks.length === 0 && embed.length === 0) {
      pesanWarnings.push('Pesan ini tidak punya teks, komponen, atau embed — dilewati.');
      warnings.push(...pesanWarnings.map((isi) => `${nama}: ${isi}`));
      continue;
    }

    messages.push({ name: nama, blocks, embed, layout, warnings: pesanWarnings });
  }

  if (messages.length === 0) {
    warnings.push('Tidak ada pesan yang bisa diimpor dari data ini.');
  }

  return { messages, warnings };
}

/* ------------------------------------------------------------------ */
/*  Tautan share                                                       */
/* ------------------------------------------------------------------ */

/** Host Discohook yang diterima — hanya milik proyek itu sendiri. */
const DISCOHOOK_HOSTS = new Set(['discohook.app', 'www.dischook.app', 'discohook.org', 'www.dischook.org']);

/** Awalan URL API share resmi di repo Discohook (`packages/site/app/api/v1/share.$shareId.ts`). */
export const DISCOHOOK_SHARE_API = 'https://discohook.app/api/v1/share';

/**
 * Ambil ID share dari tautan Discohook.
 *
 * Bentuk yang diterima (semuanya memakai `?share=` atau `/share/`):
 *   - https://discohook.app/?share=CpazsKTm
 *   - https://discohook.app/share/CpazsKTm
 *   - https://discohook.org/?share=CpazsKTm
 *   - CpazsKTm  (ID saja)
 *
 * Host selain Discohook sengaja ditolak: tanpa ini, dashboard bisa disuruh
 * bot mengunduh URL apa pun (SSRF) hanya dengan menempelkan tautan.
 */
export function parseDiscohookShareId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // ID saja: Discohook memakai 8 karakter alfanumerik.
  if (/^[A-Za-z0-9_-]{4,64}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!DISCOHOOK_HOSTS.has(url.hostname.toLowerCase())) return null;

  const dariQuery = url.searchParams.get('share');
  if (dariQuery && /^[A-Za-z0-9_-]{4,64}$/.test(dariQuery)) return dariQuery;

  const cocok = /\/share\/([A-Za-z0-9_-]{4,64})/.exec(url.pathname);
  return cocok ? cocok[1]! : null;
}

/** URL API untuk satu ID share. */
export function discohookShareApiUrl(shareId: string): string {
  return `${DISCOHOOK_SHARE_API}/${encodeURIComponent(shareId)}`;
}

/** Normalisasi aksen untuk blok, dipakai UI saat membuka hasil impor. */
export { normalizeAccent };

/* ------------------------------------------------------------------ */
/*  Tautan pesan Discord -> bagian                            */
/* ------------------------------------------------------------------ */

/**
 * Baca tautan pesan Discord.
 *
 * Formatnya `https://discord.com/channels/<guild>/<channel>/<message>` (juga
 * `ptb.`/`canary.` dan `discordapp.com`). Mengembalikan `null` kalau bukan
 * tautan pesan — pemanggil yang memutuskan cara menjelaskannya.
 *
 * ID dikembalikan sebagai teks, bukan angka: snowflake 19 digit melewati
 * batas aman angka JavaScript, dan ID yang berubah satu digit terakhir berarti
 * pesan yang salah dimuat.
 */
export function parseMessageLink(
  raw: unknown,
): { guildId: string; channelId: string; messageId: string } | null {
  const teks = asString(raw).trim();
  if (!teks) return null;
  const cocok = teks.match(
    /^(?:https?:\/\/)?(?:[a-z]+\.)?(?:discord(?:app)?\.com)\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})\/?(?:[?#].*)?$/i,
  );
  if (!cocok) return null;
  return { guildId: cocok[1]!, channelId: cocok[2]!, messageId: cocok[3]! };
}
