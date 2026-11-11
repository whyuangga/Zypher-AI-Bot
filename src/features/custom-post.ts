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
  /**
   * Gambar yang DIUNGGAH dari komputer, disimpan sebagai data URI base64.
   *
   * Kenapa tidak langsung URL saja: Discord membutuhkan `attachment://nama`
   * untuk gambar unggahan, sedangkan data URI ditolak di komponen V2. Jadi
   * kalau `data` terisi, pengirim mengubahnya menjadi lampiran, dan blok
   * hanya menyimpan data aslinya.
   *
   * Tidak ikut dikirim ke Discord apa adanya.
   */
  data?: string;
  /**
   * Emoji untuk button atau opsi menu role.
   *
   * Disimpan sebagai teks utuh (mis. "🎮" atau "<:nama:123>") dan baru
   * diterjemahkan ke bentuk Discord saat mengirim.
   */
  emoji?: string;
  /**
   * Gaya tombol role: primary (biru), secondary (abu), success (hijau),
   * danger (merah).
   */
  style?: 'primary' | 'secondary' | 'success' | 'danger';
  /**
   * Id blok — dipakai sebagai customId untuk select menu role.
   *
   * Sengaja stabil dan kecil (bukan snowflake) supaya bisa ditanam di
   * customId tanpa melewati batas 100 karakter Discord.
   */
  blockId?: string;
}

/**
 * Gaya tombol yang boleh dipakai.
 *
 * Discord punya 5 gaya, tapi 'link' tidak masuk di sini: tombol role selalu
 * interaktif (membawa customId), dan tombol link diurus blok 'button'.
 */
export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'] as const;
export type ButtonStyleName = (typeof BUTTON_STYLES)[number];

/** Normalisasi gaya tombol; nilai aneh jatuh ke primary. */
export function normalizeButtonStyle(value: unknown): ButtonStyleName {
  return BUTTON_STYLES.includes(value as ButtonStyleName)
    ? (value as ButtonStyleName)
    : 'primary';
}

/**
 * Emoji aman untuk label tombol.
 *
 * Dua bentuk yang diterima Discord:
 *   - emoji unicode: satu karakter (bisa berlapis, mis. 👍🏽)
 *   - emoji server: <:nama:id> atau <a:nama:id>
 *
 * Teks lain ditolak — kalau tidak, tombol bisa berisi potongan kalimat yang
 * membuat Discord menolak seluruh pesan.
 */
export function normalizeEmoji(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  const kustom = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{15,25})>$/.exec(raw);
  if (kustom) return raw;
  // Unicode: batasi panjangnya supaya bukan kalimat. 8 satuan cukup untuk
  // emoji berlapis (bendera, warna kulit, ZWJ).
  if (raw.length <= 8 && /\p{Extended_Pictographic}/u.test(raw)) return raw;
  return '';
}

/** Warna aksen bawaan — sama dengan brand sambutan. */
export const DEFAULT_ACCENT = '#6d8cff';

/**
 * Warna aksen pesan: pilihan admin, kalau tidak ada pakai bawaan.
 *
 * Dibatasi ke 6 digit hex dan dikembalikan dalam bentuk `#rrggbb` supaya bisa
 * dipakai langsung sebagai CSS (pratinjau) maupun diubah jadi angka (Discord).
 */
export function normalizeAccent(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_ACCENT;
  const raw = value.trim();
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#[0-9a-f]{6}$/i.test(withHash)) return DEFAULT_ACCENT;
  return withHash.toLowerCase();
}

/** `#6d8cff` -> `0x6d8cff` untuk ContainerBuilder. */
export function accentToNumber(value: unknown): number {
  return Number.parseInt(normalizeAccent(value).slice(1), 16);
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
        const blockId = typeof item.blockId === 'string' ? item.blockId.trim() : '';
        out.push({
          kind: 'divider',
          value: '',
          // Block id hanya dipakai kalau bentuknya aman untuk customId.
          ...(/^[a-z0-9]{1,16}$/.test(blockId) ? { blockId } : {}),
        });
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
      // Gambar unggahan: data URI base64 dari dashboard. Discord menolak data
      // URI di komponen V2, jadi pengirim mengubahnya jadi lampiran lebih
      // dulu — di sini hanya bentuknya yang diperiksa.
      const data = typeof item.data === 'string' ? item.data.trim() : '';
      if (data) {
        if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(data)) {
          dropped.push('gambar unggahan (format harus PNG, JPG, atau WebP)');
          continue;
        }
        if (images >= LIMITS.imagesInGallery * LIMITS.rowsPerMessage) {
          dropped.push('gambar melebihi batas');
          continue;
        }
        images += 1;
        out.push({ kind: 'image', value: '', data });
        continue;
      }

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
      const emoji = normalizeEmoji(item.emoji);
      out.push({
        kind: 'button',
        value: label,
        url,
        ...(emoji ? { emoji } : {}),
        style: normalizeButtonStyle(item.style),
      });
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
  /**
   * Lampiran gambar unggahan, kalau ada.
   *
   * Discord menolak data URI di komponen V2, jadi gambar unggahan harus
   * dikirim sebagai lampiran dan dirujuk lewat attachment://<nama>.
   */
  files: AttachmentLike[];
}

/** Bentuk minimal lampiran — pemanggil yang membuat AttachmentBuilder asli. */
export interface AttachmentLike {
  dataUri: string;
  /** Nama file yang dipakai di attachment:// — harus sama persis. */
  name: string;
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
    ButtonStyle: {
      Link: number;
      Primary?: number;
      Secondary?: number;
      Success?: number;
      Danger?: number;
    };
    /** Untuk select menu role. */
    StringSelectMenuBuilder?: new () => any;
    StringSelectMenuOptionBuilder?: new () => any;
    accent?: number;
    /**
     * Tombol ambil role milik pesan ini (dari tabel post_role_buttons).
     * customId diambil dari `roleButtonId()` supaya router bot bisa
     * mengenalinya lewat prefix.
     */
    roleButtons?: Array<{ id: number; label: string; emoji?: string; style?: string }>;
    /** Pembuat customId — disuntik supaya modul ini tetap murni. */
    roleButtonId?: (id: number) => string;
    /** Menu role (select menu) milik pesan ini. */
    roleMenus?: Array<{
      id: number;
      placeholder: string;
      minValues?: number;
      maxValues?: number;
      options: Array<{ label: string; value: string; emoji?: string; description?: string }>;
    }>;
    roleMenuId?: (id: number) => string;
    /** Pembuat warna aksen (angka) dari hex — disuntik supaya tetap murni. */
    accentToNumber?: (hex: string) => number;
    /** Warna aksen pilihan admin; kalau kosong, `deps.accent`. */
    accentHex?: string;
  },
): BuiltPost | null {
  if (!blocks.some((b) => b.kind === 'text' || b.kind === 'image')) return null;

  const container = new deps.ContainerBuilder();
  const accent = deps.accentHex && deps.accentToNumber
    ? deps.accentToNumber(deps.accentHex)
    : deps.accent;
  if (accent !== undefined) container.setAccentColor(accent);

  // Gambar unggahan dikumpulkan dulu, lalu dikirim sebagai lampiran.
  const files: AttachmentLike[] = [];

  let tombolTertunda: PostBlock[] = [];

  /** Buang tombol yang menumpuk: Discord hanya menerima 5 per baris. */
  const flushButtons = (): void => {
    while (tombolTertunda.length > 0) {
      const baris = tombolTertunda.splice(0, 5);
      const row = new deps.ActionRowBuilder();
      for (const tombol of baris) {
        const button = new deps.ButtonBuilder()
          .setStyle(deps.ButtonStyle.Link)
          .setLabel(tombol.value)
          .setURL(tombol.url ?? '');
        // Tombol link selalu bergaya Link (Discord menolak gaya lain untuk
        // URL), jadi `style` di sini hanya mengatur emoji. Gaya warna hanya
        // berlaku untuk tombol role.
        const emoji = parseEmoji(tombol.emoji);
        if (emoji) button.setEmoji(emoji);
        row.addComponents(button);
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
      // Unggahan: rujuk lampiran. Nama file dibuat berurutan dan hanya berisi
      // huruf/angka supaya tidak ada karakter aneh di dalam URL lampiran.
      let url = block.value;
      if (block.data) {
        const name = `post-image-${files.length + 1}.png`;
        files.push({ dataUri: block.data, name });
        url = `attachment://${name}`;
      }
      container.addMediaGalleryComponents(
        new deps.MediaGalleryBuilder().addItems(
          new deps.MediaGalleryItemBuilder().setURL(url),
        ),
      );
    }
  }
  if (tombolTertunda.length > 0) flushButtons();

  // Tombol role selalu di baris paling bawah, sesudah semua isi. Alasan:
  // tombol ini yang paling sering diklik member, jadi posisinya tetap dan
  // mudah ditemukan walaupun admin mengubah isi teks di atasnya.
  const roleButtons = deps.roleButtons ?? [];
  if (roleButtons.length > 0 && deps.roleButtonId && deps.ButtonStyle.Primary !== undefined) {
    for (let i = 0; i < roleButtons.length; i += LIMITS.buttonsPerRow) {
      const baris = roleButtons.slice(i, i + LIMITS.buttonsPerRow);
      const row = new deps.ActionRowBuilder();
      for (const tombol of baris) {
        const button = new deps.ButtonBuilder()
          .setStyle(styleNumber(tombol.style, deps.ButtonStyle))
          .setCustomId(deps.roleButtonId(tombol.id))
          .setLabel(tombol.label.slice(0, 80));
        const emoji = parseEmoji(tombol.emoji);
        if (emoji) button.setEmoji(emoji);
        row.addComponents(button);
      }
      container.addActionRowComponents(row);
    }
  }

  // Select menu role: SATU menu untuk banyak role, karena satu menu bisa
  // memuat 25 opsi sedangkan baris tombol hanya 5. Ditempatkan sesudah
  // tombol role supaya urutannya bisa ditebak.
  const menus = deps.roleMenus ?? [];
  if (menus.length > 0 && deps.StringSelectMenuBuilder && deps.StringSelectMenuOptionBuilder) {
    for (const menu of menus) {
      const select = new deps.StringSelectMenuBuilder()
        .setCustomId(deps.roleMenuId ? deps.roleMenuId(menu.id) : `post-menu:${menu.id}`)
        .setPlaceholder(menu.placeholder.slice(0, 150))
        .setMinValues(menu.minValues ?? 1)
        .setMaxValues(Math.min(Math.max(1, menu.maxValues ?? 1), menu.options.length));
      for (const opsi of menu.options.slice(0, 25)) {
        const option = new deps.StringSelectMenuOptionBuilder()
          .setLabel(opsi.label.slice(0, 100))
          .setValue(opsi.value);
        const emoji = parseEmoji(opsi.emoji);
        if (emoji) option.setEmoji(emoji);
        if (opsi.description) option.setDescription(opsi.description.slice(0, 100));
        select.addOptions(option);
      }
      container.addActionRowComponents(new deps.ActionRowBuilder().addComponents(select));
    }
  }

  return { components: [container], flags: 1 << 15, files };
}

/* ------------------------------------------------------------------ */
/*  Terjemahan kecil: emoji & gaya tombol                              */
/* ------------------------------------------------------------------ */

/**
 * Ubah teks emoji menjadi bentuk yang diterima discord.js.
 *
 * Emoji server (`<:nama:id>`) harus jadi objek { id, name, animated },
 * sedangkan emoji unicode dibiarkan teks. Kalau salah bentuk, `setEmoji`
 * melempar dan SELURUH pesan gagal dikirim — jadi kegagalan di sini harus
 * diam-diam dilewati, bukan fatal.
 */
export function parseEmoji(raw: string | undefined): unknown {
  if (!raw) return undefined;
  const kustom = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{15,25})>$/.exec(raw.trim());
  if (kustom) {
    return { id: kustom[3], name: kustom[2], animated: kustom[1] === 'a' };
  }
  return raw;
}

/** Nama gaya -> angka ButtonStyle discord.js. */
function styleNumber(
  gaya: string | undefined,
  styles: { Primary?: number; Secondary?: number; Success?: number; Danger?: number },
): number {
  switch (gaya) {
    case 'secondary':
      return styles.Secondary ?? 2;
    case 'success':
      return styles.Success ?? 3;
    case 'danger':
      return styles.Danger ?? 4;
    default:
      return styles.Primary ?? 1;
  }
}
