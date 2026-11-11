/**
 * Blok pesan container buatan admin — halaman "/pesan".
 *
 * Modul ini murni: tidak menyentuh database, jaringan, Discord, atau browser.
 * Semua aturan bentuk pesan ada di sini supaya bisa diuji tanpa Discord, dan
 * supaya penyusun (dashboard) dan pengirim (bot) memakai aturan yang SAMA.
 * Pola ini sama dengan display-mode.ts: satu tempat tahu bentuk, pemakai
 * lain hanya membaca.
 *
 * Kenapa blok, bukan HTML atau komponen Discord langsung:
 *
 *   - JSON blok tersimpan rapi di database dan tahan perubahan pustaka.
 *   - Dashboard menggambar blok ke HTML, bot menerjemahkannya ke komponen
 *     Components V2. Dua penerjemah, satu sumber kebenaran.
 *   - Kalau bentuk Discord berubah, hanya penerjemah bot yang perlu diubah.
 */

/** Jenis blok yang bisa disusun admin. */
export type PostBlockKind = 'text' | 'divider' | 'image' | 'button';

export interface PostBlock {
  kind: PostBlockKind;
  /**
   * Isi blok:
   *   - text    : teks (boleh markdown Discord dan -# untuk teks kecil)
   *   - image  : URL gambar (http/https)
   *   - button : label tombol
   *   - divider: diabaikan
   */
  value: string;
  /**
   * URL tujuan untuk button. Wajib untuk tombol (Discord hanya mengizinkan
   * tombol link di pesan biasa; tombol interaktif butuh handler dan tidak
   * disusun dari sini).
   */
  url?: string;
}

/** Batas dari Discord, bukan pilihan kita. */
export const LIMITS = {
  /** Panjang satu Text Display. */
  textLength: 4000,
  /** Batas aman total teks satu pesan (Discord menolak > 4000 per pesan). */
  totalText: 3500,
  /** Maksimum tombol per ActionRow. */
  buttonsPerRow: 5,
  /** Maksimum ActionRow per pesan. */
  rowsPerMessage: 5,
  /** Maksimum blok per pesan — jaring pengaman dashboard. */
  blocks: 40,
  /** Maksimum gambar dalam satu Media Gallery. */
  imagesInGallery: 10,
} as const;

export interface SanitizeResult {
  /** Blok yang lolos, sudah dirapikan dan dipotong sesuai batas. */
  blocks: PostBlock[];
  /** Alasan blok dibuang — ditampilkan ke admin, bukan disembunyikan. */
  dropped: string[];
}

/** Apakah URL boleh dipakai (http/https saja — data URI ditolak Discord). */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

/**
 * Rapikan daftar blok dari input dashboard.
 *
 * Sengaja **tidak melempar**: input yang aneh tidak boleh membuat halaman
 * gagal, dan admin perlu tahu bagian mana yang dibuang beserta alasannya.
 * Yang dibuang hanya blok yang tidak mungkin dikirim Discord:
 *
 *   - teks kosong / hanya spasi
 *   - gambar atau tombol dengan URL bukan http(s)
 *   - blok setelah batas LIMITS.blocks
 *
 * Pemisah berurutan digabung menjadi satu supaya tampilan tidak berlubang.
 */
export function sanitizeBlocks(input: unknown): SanitizeResult {
  const dropped: string[] = [];
  const source = Array.isArray(input) ? input : [];
  const out: PostBlock[] = [];
  let totalText = 0;
  let images = 0;
  let buttons = 0;

  for (const raw of source) {
    if (out.length >= LIMITS.blocks) {
      dropped.push(`blok ke-${out.length + 1} dan seterusnya (maksimum ${LIMITS.blocks} blok)`);
      break;
    }
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const kind = item.kind;

    if (kind === 'divider') {
      // Dua pemisah berurutan hanya menghasilkan ruang kosong.
      if (out.length > 0 && out[out.length - 1]!.kind !== 'divider') {
        out.push({ kind: 'divider', value: '' });
      }
      continue;
    }

    const value = typeof item.value === 'string' ? item.value : '';

    if (kind === 'text') {
      const text = value.trim();
      if (!text) continue;
      if (totalText >= LIMITS.totalText) {
        dropped.push('teks melebihi batas satu pesan');
        continue;
      }
      // Dipotong, bukan dibuang: sisa teks panjang masih berguna.
      const sisa = LIMITS.totalText - totalText;
      const isi = text.length > sisa ? text.slice(0, sisa) : text;
      totalText += isi.length;
      out.push({ kind: 'text', value: isi });
      continue;
    }

    if (kind === 'image') {
      const url = value.trim();
      if (!isHttpUrl(url)) {
        dropped.push(`gambar "${url.slice(0, 40)}" (URL harus http/https)`);
        continue;
      }
      if (images >= LIMITS.imagesInGallery * LIMITS.rowsPerMessage) {
        dropped.push('gambar melebihi batas');
        continue;
      }
      images += 1;
      out.push({ kind: 'image', value: url });
      continue;
    }

    if (kind === 'button') {
      const label = value.trim().slice(0, 80);
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!label) {
        dropped.push('tombol tanpa label');
        continue;
      }
      if (!isHttpUrl(url)) {
        dropped.push(`tombol "${label}" (URL tujuan harus http/https)`);
        continue;
      }
      if (buttons >= LIMITS.buttonsPerRow * LIMITS.rowsPerMessage) {
        dropped.push('tombol melebihi batas (25)');
        continue;
      }
      buttons += 1;
      out.push({ kind: 'button', value: label, url });
      continue;
    }

    dropped.push(`jenis blok tidak dikenal: ${String(kind).slice(0, 20)}`);
  }

  return { blocks: out, dropped };
}

/** Jumlah tombol dan gambar — dipakai dashboard untuk peringatan batas. */
export function countBlocks(blocks: PostBlock[]): {
  text: number;
  image: number;
  button: number;
  divider: number;
} {
  return {
    text: blocks.filter((b) => b.kind === 'text').length,
    image: blocks.filter((b) => b.kind === 'image').length,
    button: blocks.filter((b) => b.kind === 'button').length,
    divider: blocks.filter((b) => b.kind === 'divider').length,
  };
}

/**
 * Baca blok dari database.
 *
 * Data rusak (JSON tidak valid, bentuk lama, kolom kosong) menghasilkan daftar
 * kosong — bukan error. Halaman harus tetap terbuka supaya admin bisa
 * memperbaikinya dari dashboard, bukan terkunci karena satu baris rusak.
 */
export function parseBlocks(raw: unknown): PostBlock[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return sanitizeBlocks(JSON.parse(raw)).blocks;
  } catch {
    return [];
  }
}

/** Nama default supaya pesan baru langsung bisa dikenali. */
export function defaultPostName(index: number): string {
  return `Pesan ${index}`;
}

/* ------------------------------------------------------------------ */
/*  Penerjemah blok -> payload Discord                                 */
/* ------------------------------------------------------------------ */

/**
 * Susun payload siap kirim dari daftar blok.
 *
 * Dipisah dari custom-post-send.ts (yang menyentuh Discord client) supaya
 * bentuk pesannya bisa diuji tanpa login bot.
 *
 * Kenapa container, bukan embed: container bisa memuat beberapa gambar dan
 * tombol dalam satu pesan bertema, dan tidak menghitung gambar sebagai lampiran
 * terpisah. Pesan embed tidak bisa menampung lebih dari satu gambar.
 *
 * Tombol memakai Action Row (tipe 1) dengan link — bukan tombol interaktif,
 * karena tombol interaktif butuh handler customId dan itu di luar cakupan
 * penyusun pesan.
 */
export interface BuiltPost {
  components: unknown[];
  flags: number;
}

export function buildPostPayload(
  blocks: PostBlock[],
  deps: {
    ContainerBuilder: new () => any;
    TextDisplayBuilder: new () => any;
    SeparatorBuilder: new () => any;
    MediaGalleryBuilder: new () => any;
    MediaGalleryItemBuilder: new () => any;
    ActionRowBuilder: new () => any;
    ButtonBuilder: new () => any;
    ButtonStyle: { Link: number };
    accent?: number;
  },
): BuiltPost | null {
  const isi = blocks.filter((b) => b.kind !== 'divider' || blocks.length > 1);
  if (!isi.some((b) => b.kind === 'text' || b.kind === 'image')) return null;

  const container = new deps.ContainerBuilder();
  if (deps.accent !== undefined) container.setAccentColor(deps.accent);

  let tombolTertunda: PostBlock[] = [];

  /** Buang tombol yang menumpuk: Discord hanya menerima 5 per baris. */
  const flushButtons = (): void => {
    while (tombolTertunda.length > 0) {
      const baris = tombolTertunda.splice(0, 5);
      const row = new deps.ActionRowBuilder();
      for (const tombol of baris) {
        row.addComponents(
          new deps.ButtonBuilder()
            .setStyle(deps.ButtonStyle.Link)
            .setLabel(tombol.value)
            .setURL(tombol.url ?? ''),
        );
      }
      container.addActionRowComponents(row);
    }
  };

  for (const block of blocks) {
    if (block.kind === 'button') {
      tombolTertunda.push(block);
      continue;
    }
    // Blok lain menutup deretan tombol sebelumnya supaya urutan tetap terjaga.
    if (tombolTertunda.length > 0) flushButtons();

    if (block.kind === 'divider') {
      container.addSeparatorComponents(new deps.SeparatorBuilder().setDivider(true));
      continue;
    }
    if (block.kind === 'text') {
      container.addTextDisplayComponents(new deps.TextDisplayBuilder().setContent(block.value));
      continue;
    }
    if (block.kind === 'image') {
      container.addMediaGalleryComponents(
        new deps.MediaGalleryBuilder().addItems(
          new deps.MediaGalleryItemBuilder().setURL(block.value),
        ),
      );
    }
  }
  if (tombolTertunda.length > 0) flushButtons();

  return { components: [container], flags: 1 << 15 };
}
