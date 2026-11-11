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

/**
 * Jenis blok yang bisa disusun admin.
 *
 * `container` dan `section` adalah blok STRUKTUR, bukan isi: keduanya mengubah
 * tempat blok lain berada, bukan menambah teks. Blok isi sesudah `container`
 * masuk ke dalam container itu sampai ada `container` berikutnya.
 */
export type PostBlockKind = 'text' | 'divider' | 'image' | 'button' | 'container' | 'section';

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
   * Warna aksen khusus untuk blok `container`.
   *
   * Kosong = pakai warna pesan. Inilah yang membuat satu pesan bisa punya
   * dua kartu dengan warna berbeda.
   */
  accent?: string;

  /**
   * Gambar kecil di kanan teks untuk blok `section`.
   *
   * Boleh URL http(s) atau hasil unggahan (`data` di blok yang sama).
   */
  thumbnail?: string;

  /**
   * Jarak pemisah: `small` (rapat, bawaan) atau `large` (renggang).
   * Hanya dipakai blok `divider`.
   */
  spacing?: 'small' | 'large';

  /**
   * Teks tombol aksesori untuk blok `section`.
   *
   * Kalau terisi, tombol link menempel di kanan teks section. Discord hanya
   * mengizinkan SATU aksesori per section: thumbnail ATAU tombol, tidak dua.
   */
  accessoryLabel?: string;

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
  /**
   * Maksimum blok per pesan — jaring pengaman dashboard, BUKAN batas Discord.
   *
   * Sengaja lebih longgar dari 40: batas Discord menghitung KOMPONEN, dan
   * beberapa blok bisa jadi satu komponen (deretan tombol = satu ActionRow).
   * Kalau angka ini dipakai sebagai batas komponen, pesan sah akan ditolak
   * lebih awal — itu yang dulu terjadi pada 45 baris teks pendek.
   * Yang menentukan boleh-kirim adalah `measureBlocks`.
   */
  blocks: 120,
  /** Maksimum gambar dalam satu Media Gallery. */
  imagesInGallery: 10,
  /**
   * Batas ASLI Discord untuk Components V2: 40 komponen total (termasuk yang
   * bersarang) dan 10 komponen top-level.
   *
   * Angka 25 yang sering dikutip di internet adalah batas pesan LAMA, bukan
   * V2 — memakainya akan menolak pesan yang sebenarnya sah.
   */
  totalComponents: 40,
  topLevelComponents: 10,
  /** Maksimum anak dalam satu Container kalau ia satu-satunya komponen atas. */
  containerChildren: 39,
  /** Maksimum Text Display di dalam satu Section. */
  sectionTexts: 3,
  /** Maksimum container dalam satu pesan — dibatasi top-level juga. */
  containers: 10,
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

    if (kind === 'container') {
      const jumlah = out.filter((b) => b.kind === 'container').length;
      if (jumlah >= LIMITS.containers) {
        dropped.push(`container ke-${jumlah + 1} (maksimum ${LIMITS.containers}, batas Discord)`);
        continue;
      }
      // Container tanpa isi akan tampil sebagai kartu kosong — tidak berguna.
      const accentRaw = typeof item.accent === 'string' ? item.accent.trim() : '';
      out.push({
        kind: 'container',
        value: '',
        // Kosong = ikut warna pesan, jadi tidak perlu disimpan sebagai nilai.
        ...(accentRaw && /^#?[0-9a-f]{6}$/i.test(accentRaw) ? { accent: normalizeAccent(accentRaw) } : {}),
      });
      continue;
    }

    if (kind === 'section') {
      const text = typeof item.value === 'string' ? item.value.trim() : '';
      const thumbnailRaw = typeof item.thumbnail === 'string' ? item.thumbnail.trim() : '';
      const label = typeof item.accessoryLabel === 'string' ? item.accessoryLabel.trim().slice(0, 80) : '';
      if (!text && !thumbnailRaw) {
        dropped.push('section tanpa teks dan tanpa gambar');
        continue;
      }
      // Teks section ikut memakan kuota 4000 karakter, sama seperti blok teks.
      let isi = '';
      if (text) {
        const sisa = LIMITS.totalText - totalText;
        if (sisa <= 0) {
          dropped.push('teks section melebihi batas satu pesan');
          continue;
        }
        isi = text.length > sisa ? text.slice(0, sisa) : text;
        totalText += isi.length;
      }
      // Discord: SATU aksesori per section. Tombol menang atas thumbnail
      // kalau admin mengisi keduanya, karena tombol lebih terlihat.
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      const pakaiTombol = Boolean(label) && isHttpUrl(url);
      out.push({
        kind: 'section',
        value: isi,
        ...(pakaiTombol
          ? { accessoryLabel: label, url }
          : isHttpUrl(thumbnailRaw)
            ? { thumbnail: thumbnailRaw }
            : {}),
      });
      continue;
    }

    if (kind === 'divider') {
      // Dua pemisah berurutan hanya menghasilkan ruang kosong.
      if (out.length > 0 && out[out.length - 1]!.kind !== 'divider') {
        const blockId = typeof item.blockId === 'string' ? item.blockId.trim() : '';
        out.push({
          kind: 'divider',
          value: '',
          // Block id hanya dipakai kalau bentuknya aman untuk customId.
          ...(/^[a-z0-9]{1,16}$/.test(blockId) ? { blockId } : {}),
          ...(item.spacing === 'large' ? { spacing: 'large' as const } : {}),
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

/** Hasil hitung pemakaian komponen — untuk ditampilkan di dashboard. */
export interface ComponentUsage {
  /** Komponen total termasuk yang bersarang. Batas Discord: 40. */
  total: number;
  /** Komponen top-level (container). Batas Discord: 10. */
  topLevel: number;
  /** Karakter teks yang sudah terpakai. Batas aman kita: 3500. */
  text: number;
  /** Container yang berisi sesuatu (yang benar-benar dikirim). */
  containers: number;
  /** true kalau salah satu batas sudah terlampaui. */
  over: boolean;
  /** Bagian mana yang terlampaui, dalam bahasa manusia. */
  masalah: string[];
}

/**
 * Hitung pemakaian komponen persis seperti yang akan dibentuk penyusun payload.
 *
 * Kenapa dihitung di sini, bukan di browser saja: dashboard boleh menampilkan
 * angkanya, tapi keputusan "boleh dikirim atau tidak" tetap di server. Kalau
 * hanya dihitung di browser, API bisa dipanggil langsung untuk melewati batas.
 *
 * Cara menghitungnya sengaja meniru `buildPostPayload` langkah demi langkah:
 * satu container = satu komponen top-level, dan setiap TextDisplay, separator,
 * media gallery, section, serta ActionRow menambah hitungan total.
 */
export function measureBlocks(blocks: PostBlock[]): ComponentUsage {
  const masalah: string[] = [];
  let total = 0;
  let topLevel = 0;
  let text = 0;
  let containers = 0;

  // Wadah pertama selalu ada (blok isi tanpa blok container tetap dikirim).
  let anak = 0;
  let adaIsi = false;
  let adaTombol = 0;

  const tutup = (): void => {
    if (!adaIsi) return;
    topLevel += 1;
    containers += 1;
    // ActionRow tombol menumpuk dan baru dihitung saat ditutup, karena baru
    // di titik itu jumlah barisnya diketahui.
    total += anak + Math.ceil(adaTombol / LIMITS.buttonsPerRow);
    anak = 0;
    adaTombol = 0;
    adaIsi = false;
  };

  for (const block of blocks) {
    if (block.kind === 'container') {
      tutup();
      continue;
    }
    if (block.kind === 'button') {
      adaTombol += 1;
      continue;
    }
    if (block.kind === 'divider') {
      // Pemisah pertama di container kosong tidak ditampilkan sendirian.
      if (adaIsi) {
        anak += 1;
      }
      continue;
    }
    if (block.kind === 'text' || block.kind === 'section' || block.kind === 'image') {
      text += block.kind === 'text' || block.kind === 'section' ? block.value.length : 0;
      anak += 1;
      adaIsi = true;
    }
  }
  tutup();

  if (total > LIMITS.totalComponents) {
    masalah.push(
      `${total} komponen melebihi batas Discord (${LIMITS.totalComponents}). Gabungkan beberapa blok teks jadi satu.`,
    );
  }
  if (topLevel > LIMITS.topLevelComponents) {
    masalah.push(
      `${topLevel} container melebihi batas Discord (${LIMITS.topLevelComponents} komponen teratas per pesan).`,
    );
  }
  if (text > LIMITS.totalText) {
    masalah.push(`Teks ${text} karakter melebihi batas ${LIMITS.totalText}.`);
  }

  return {
    total,
    topLevel,
    text,
    containers,
    over: masalah.length > 0,
    masalah,
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
    /** Untuk blok `section` — versi lawas discord.js boleh tidak punya ini. */
    SectionBuilder?: new () => any;
    ThumbnailBuilder?: new () => any;
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
  /*
   * Penjaga "pesan kosong". Tombol saja tidak cukup (Discord menolak pesan
   * yang hanya berisi ActionRow di dalam container tanpa teks), tapi section
   * yang hanya berisi gambar tetap sah — jadi ia ikut dihitung sebagai isi.
   */
  const adaIsi = blocks.some(
    (b) => b.kind === 'text' || b.kind === 'image' || b.kind === 'section',
  );
  if (!adaIsi) return null;

  /*
   * Wadah = satu Container Discord. Blok `container` MEMBUKA wadah baru;
   * blok isi sesudahnya masuk ke wadah yang sedang aktif. Kalau pesan tidak
   * punya blok `container` sama sekali, hasilnya satu wadah — persis seperti
   * sebelum fitur ini ada, jadi pesan lama tidak berubah tampilannya.
   */
  const accentDefault = deps.accentHex && deps.accentToNumber
    ? deps.accentToNumber(deps.accentHex)
    : deps.accent;

  interface Wadah {
    builder: any;
    /** Jumlah komponen di dalamnya, untuk penjagaan batas 39 anak. */
    anak: number;
    /** Apakah sudah ada isi — container kosong dibuang sebelum dikirim. */
    adaIsi: boolean;
  }

  const wadah: Wadah[] = [];
  const buatWadah = (accent?: number): Wadah => {
    const builder = new deps.ContainerBuilder();
    const warna = accent ?? accentDefault;
    if (warna !== undefined) builder.setAccentColor(warna);
    const baru: Wadah = { builder, anak: 0, adaIsi: false };
    wadah.push(baru);
    return baru;
  };
  /*
   * Wadah pertama selalu ada: kalau pesan hanya memakai blok isi biasa, semua
   * masuk ke sini dan hasilnya sama seperti sebelum fitur container ada.
   */
  let aktif = buatWadah();

  /** Pindah ke container berikutnya; dipanggil saat blok `container` dibaca. */
  const bukaContainer = (block: PostBlock): void => {
    const accent = block.accent && deps.accentToNumber ? deps.accentToNumber(block.accent) : undefined;
    aktif = buatWadah(accent);
  };

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
      aktif.builder.addActionRowComponents(row);
      aktif.anak += 1;
      aktif.adaIsi = true;
    }
  };

  for (const block of blocks) {
    // Blok struktur tidak menghasilkan komponen: ia memindahkan tujuan
    // penulisan blok berikutnya.
    if (block.kind === 'container') {
      if (tombolTertunda.length > 0) flushButtons();
      bukaContainer(block);
      continue;
    }
    if (block.kind === 'button') {
      tombolTertunda.push(block);
      continue;
    }
    // Blok lain menutup deretan tombol sebelumnya supaya urutan tetap terjaga.
    if (tombolTertunda.length > 0) flushButtons();

    if (block.kind === 'divider') {
      const sep = new deps.SeparatorBuilder().setDivider(true);
      // Jarak: 1 = kecil (rapat), 2 = besar (renggang). Discord menamainya
      // `spacing`, bukan ukuran piksel.
      if (block.spacing === 'large' && typeof sep.setSpacing === 'function') sep.setSpacing(2);
      aktif.builder.addSeparatorComponents(sep);
      aktif.anak += 1;
      aktif.adaIsi = true;
      continue;
    }
    if (block.kind === 'text') {
      aktif.builder.addTextDisplayComponents(new deps.TextDisplayBuilder().setContent(block.value));
      aktif.anak += 1;
      aktif.adaIsi = true;
      continue;
    }
    if (block.kind === 'section') {
      // Section = teks + SATU aksesori (thumbnail ATAU tombol link).
      if (deps.SectionBuilder && deps.ThumbnailBuilder) {
        const section = new deps.SectionBuilder();
        section.addTextDisplayComponents(
          new deps.TextDisplayBuilder().setContent(block.value || '\u200b'),
        );
        if (block.accessoryLabel && block.url) {
          section.setButtonAccessory(
            new deps.ButtonBuilder()
              .setStyle(deps.ButtonStyle.Link)
              .setLabel(block.accessoryLabel)
              .setURL(block.url),
          );
        } else if (block.thumbnail) {
          const thumb = new deps.ThumbnailBuilder();
          thumb.setURL(block.thumbnail);
          section.setThumbnailAccessory(thumb);
        }
        aktif.builder.addSectionComponents(section);
        aktif.anak += 1;
        aktif.adaIsi = true;
      }
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
      aktif.builder.addMediaGalleryComponents(
        new deps.MediaGalleryBuilder().addItems(
          new deps.MediaGalleryItemBuilder().setURL(url),
        ),
      );
      aktif.anak += 1;
      aktif.adaIsi = true;
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
      aktif.builder.addActionRowComponents(row);
      aktif.anak += 1;
      aktif.adaIsi = true;
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
      aktif.builder.addActionRowComponents(new deps.ActionRowBuilder().addComponents(select));
      aktif.anak += 1;
      aktif.adaIsi = true;
    }
  }

  /*
   * Buang container kosong.
   *
   * Dua alasan: (1) Discord menolak container tanpa komponen, (2) admin yang
   * menekan "container baru" lalu berubah pikiran tidak boleh mendapat kartu
   * kosong di pesannya. Kalau SEMUA kosong, pemanggil menganggap pesan kosong
   * (mengembalikan null) — sama seperti perilaku sebelumnya.
   */
  const dipakai = wadah.filter((w) => w.adaIsi);
  if (dipakai.length === 0) return null;

  // Batas top-level: 10 komponen teratas per pesan (batas Discord, bukan
  // pilihan kita). Wadah pertama selalu container, jadi ini cukup.
  const terpakai = dipakai.slice(0, LIMITS.topLevelComponents);

  return { components: terpakai.map((w) => w.builder), flags: 1 << 15, files };
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
