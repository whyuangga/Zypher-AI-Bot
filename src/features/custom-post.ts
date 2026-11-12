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
export type PostBlockKind =
  | 'text'
  | 'divider'
  | 'image'
  | 'button'
  | 'container'
  | 'section'
  /**
   * Select menu yang TIDAK mengubah apa pun saat dipakai member.
   *
   * Bukan pilihan acak: Discord hanya meneruskan interaksi select ke aplikasi
   * pemilik komponen, dan akun bot tidak bisa membaca isi pilihan user/role/
   * channel (@everyone tidak bisa dipilih user biasa). Menu yang memakai
   * `values` tetap disusun lewat menu role (tabel post_role_menus), sedangkan
   * blok ini dikirim apa adanya seperti Discohook — tampil rapi, dan bot
   * menjawab dengan penjelasan sopan saat dipilih.
   */
  | 'select'
  /**
   * Baris baru untuk tombol — padanan "Row" di Discohook.
   *
   * Di Discohook, Action Row adalah wadah eksplisit: tombol di dalam satu Row
   * tampil sebaris, dan Row berikutnya memotong baris. Tanpa blok ini, baris
   * tombol hanya terbentuk otomatis setiap 5 tombol, sehingga "2 tombol di
   * atas, 1 di bawah" tidak bisa disusun.
   */
  | 'row'
  /**
   * Menutup kartu: blok sesudahnya tampil DI LUAR container, langsung di
   * pesan — seperti teks pembuka dan baris tombol di pesan Discohook.
   *
   * Tanpa ini, semua blok selalu berada di dalam suatu kartu, sehingga pesan
   * bergaya "pembuka + dua kartu + tombol penutup" tidak bisa disusun.
   */
  | 'close'
  /**
   * Lampiran berkas (PDF, zip, gambar besar, ...).
   *
   * Berbeda dari `image` yang tampil sebagai galeri di dalam kartu, blok ini
   * muncul sebagai kartu unduhan di dasar pesan — sama seperti lampiran biasa.
   */
  | 'file';

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
   * Tampilkan garis pemisah. `false` = hanya jarak kosong tanpa garis.
   *
   * Discord menyebutnya `divider`; Discohook menampilkannya sebagai centang
   * "Show Divider" pada komponen Separator. Tanpa field ini, pemisah tanpa
   * garis tidak bisa disusun padahal sah dikirim.
   */
  divider?: boolean;

  /**
   * Tombol tidak bisa diklik (`disabled`).
   *
   * Berguna untuk tombol penutup yang belum berlaku, mis. "Coming soon" —
   * tombol tetap tampil, tetapi Discord menolak kliknya.
   */
  disabled?: boolean;

  /**
   * Teks tombol aksesori untuk blok `section`.
   *
   * Kalau terisi, tombol link menempel di kanan teks section. Discord hanya
   * mengizinkan SATU aksesori per section: thumbnail ATAU tombol, tidak dua.
   */
  accessoryLabel?: string;

  /**
   * Aksesori untuk blok `text` dan `image`.
   *
   * Discohook membungkus teks/gambar dalam Section saat kamu menambahkan
   * aksesori, karena hanya Section yang punya slot aksesori di Discord. Di
   * sini hal yang sama terjadi: blok teks bergambar-kecil/bertombol otomatis
   * dikirim sebagai Section. Tanpa aksesori, blok tetap TextDisplay biasa.
   */
  accessoryUrl?: string;

  /**
   * Tandai komponen sebagai spoiler (tersembunyi sampai diklik).
   *
   * Berlaku untuk blok `image` (satu gambar) dan `file` (lampiran), dan untuk
   * blok `container` — Discohook punya centang "spoiler" pada container, yang
   * membuat SELURUH kartu tertutup sampai member mengkliknya.
   */
  spoiler?: boolean;

  /**
   * Nama berkas untuk blok `file` — dipakai sebagai nama unduhan di Discord.
   * Untuk unggahan, nama ini juga menentukan ekstensi lampiran.
   */
  name?: string;

  /**
   * Jenis select menu untuk blok `select`.
   *
   * `string` = daftar pilihan bebas (tidak mengubah apa pun), sedangkan
   * `user`/`role`/`mentionable`/`channel` memakai daftar yang disediakan
   * Discord sendiri (anggota, role server, atau channel).
   */
  selectKind?: SelectMenuKind;

  /** Teks ajakan di dalam select (maksimal 150 karakter di Discord). */
  placeholder?: string;

  /** Berapa pilihan yang boleh diambil sekaligus. */
  minValues?: number;
  maxValues?: number;

  /**
   * Pilihan untuk `select` jenis `string`.
   *
   * `value` tidak dikirim ke bot mana pun (select ini tidak menulis apa pun),
   * jadi dibiarkan seperti di Discohook: teks bebas.
   */
  options?: Array<{ label: string; value?: string; description?: string; emoji?: string }>;

  /** Menu ini tidak bisa dipakai (`disabled`). */
  selectDisabled?: boolean;

  /**
   * Teks alternatif gambar (alt text) untuk blok `image`.
   *
   * Discord menampilkannya sebagai deskripsi saat gambar gagal dimuat dan
   * membacakannya untuk pembaca layar. Discohook menyebutnya "description"
   * pada item Media Gallery.
   */
  alt?: string;

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
/**
 * Jenis select menu yang bisa disusun.
 *
 * Urutannya sama dengan menu "Add Component" di Discohook supaya admin yang
 * terbiasa di sana menemukan nama yang sama:
 *   Select Menu (string) · User · Role · User & Role (mentionable) · Channel
 */
export const SELECT_KINDS = ['string', 'user', 'role', 'mentionable', 'channel'] as const;
export type SelectMenuKind = (typeof SELECT_KINDS)[number];

/** Nama manusiawi — dipakai dashboard dan pesan peringatan. */
export const SELECT_KIND_LABEL: Record<SelectMenuKind, string> = {
  string: 'Select Menu',
  user: 'User Select Menu',
  role: 'Role Select Menu',
  mentionable: 'User & Role Select Menu',
  channel: 'Channel Select Menu',
};

export function normalizeSelectKind(value: unknown): SelectMenuKind {
  return SELECT_KINDS.includes(value as SelectMenuKind) ? (value as SelectMenuKind) : 'string';
}

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
  /** Maksimum pilihan dalam satu select menu (batas Discord). */
  selectOptions: 25,
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
  /**
   * Lampiran berkas per pesan.
   *
   * Discord mengizinkan 10 lampiran; 5 dipakai supaya pesan yang juga membawa
   * gambar unggahan tidak melewati batas itu.
   */
  filesPerMessage: 5,
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
  let files = 0;
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
        // Spoiler container: seluruh kartu tertutup sampai diklik, sama
        // seperti centang "spoiler" pada container di Discohook.
        ...(item.spoiler === true ? { spoiler: true } : {}),
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
      // Emoji & status nonaktif hanya berarti kalau aksesorinya tombol.
      const emojiAksesori = pakaiTombol ? normalizeEmoji(item.emoji) : '';
      out.push({
        kind: 'section',
        value: isi,
        ...(pakaiTombol
          ? {
              accessoryLabel: label,
              url,
              ...(emojiAksesori ? { emoji: emojiAksesori } : {}),
              ...(item.disabled === true ? { disabled: true } : {}),
            }
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
          // `divider: false` = jarak kosong tanpa garis (Discord mendukungnya).
          ...(item.divider === false ? { divider: false } : {}),
        });
      }
      continue;
    }

    const value = typeof item.value === 'string' ? item.value : '';

    /**
     * Aksesori opsional untuk blok teks/gambar.
     *
     * Di Discord hanya Section yang punya slot aksesori. Jadi kalau admin
     * memasang tombol link atau thumbnail pada teks, blok itu dikirim sebagai
     * Section — persis yang dilakukan Discohook saat kamu menekan
     * "Add Accessory" pada komponen teks.
     */
    const aksesori = (): { accessoryLabel?: string; accessoryUrl?: string; thumbnail?: string } => {
      const label = typeof item.accessoryLabel === 'string' ? item.accessoryLabel.trim().slice(0, 80) : '';
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      const thumb = typeof item.thumbnail === 'string' ? item.thumbnail.trim() : '';
      if (label && isHttpUrl(url)) return { accessoryLabel: label, accessoryUrl: url };
      if (isHttpUrl(thumb)) return { thumbnail: thumb };
      return {};
    };

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
      out.push({ kind: 'text', value: isi, ...aksesori() });
      continue;
    }

    if (kind === 'image') {
      // Gambar unggahan: data URI base64 dari dashboard. Discord menolak data
      // URI di komponen V2, jadi pengirim mengubahnya jadi lampiran lebih
      // dulu — di sini hanya bentuknya yang diperiksa.
      const data = typeof item.data === 'string' ? item.data.trim() : '';
      // Alt text: dibaca pembaca layar dan tampil saat gambar gagal dimuat.
      const altRaw = typeof item.alt === 'string' ? item.alt.trim().slice(0, 1024) : '';
      const alt = altRaw ? { alt: altRaw } : {};
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
        out.push({
          kind: 'image',
          value: '',
          data,
          ...alt,
          ...(item.spoiler === true ? { spoiler: true } : {}),
          ...aksesori(),
        });
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
      out.push({
        kind: 'image',
        value: url,
        ...alt,
        ...(item.spoiler === true ? { spoiler: true } : {}),
        ...aksesori(),
      });
      continue;
    }

    if (kind === 'file') {
      // Lampiran berkas: URL http(s) atau unggahan (data URI) dari dashboard.
      const data = typeof item.data === 'string' ? item.data.trim() : '';
      const url = value.trim();
      // UI mengirim `name`; `caption` diterima juga supaya data lama tetap sah.
      const namaSumber = typeof item.name === 'string' ? item.name : item.caption;
      const nama = typeof namaSumber === 'string' && namaSumber.trim()
        ? namaSumber.trim().slice(0, 100)
        : '';
      if (data) {
        if (!/^data:[a-z0-9.+\-]+\/[a-z0-9.+\-]+;base64,[A-Za-z0-9+/=]+$/i.test(data)) {
          dropped.push('berkas unggahan (format data tidak dikenal)');
          continue;
        }
      } else if (!isHttpUrl(url)) {
        dropped.push(`berkas "${(url || '(kosong)').slice(0, 40)}" (URL harus http/https)`);
        continue;
      }
      if (files >= LIMITS.filesPerMessage) {
        dropped.push(`berkas melebihi batas (${LIMITS.filesPerMessage})`);
        continue;
      }
      files += 1;
      out.push({
        kind: 'file',
        value: data ? '' : url,
        ...(data ? { data } : {}),
        ...(nama ? { name: nama } : {}),
        ...(item.spoiler === true ? { spoiler: true } : {}),
      });
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
        ...(item.disabled === true ? { disabled: true } : {}),
      });
      continue;
    }

    if (kind === 'row') {
      /*
       * Baris baru untuk tombol. Dua `row` berurutan sama saja dengan satu —
       * baris kosong tidak menghasilkan komponen apa pun, tetapi tetap
       * disimpan sebagai penanda supaya susunan admin tidak bergeser saat
       * disimpan ulang.
       */
      if (out.length === 0 || out[out.length - 1]!.kind !== 'row') {
        out.push({ kind: 'row', value: '' });
      }
      continue;
    }

    if (kind === 'select') {
      const selectKind = normalizeSelectKind(item.selectKind);
      const placeholder = typeof item.placeholder === 'string'
        ? item.placeholder.trim().slice(0, 150)
        : '';
      const isi = typeof item.value === 'string' ? item.value.trim().slice(0, 150) : '';

      /*
       * Pilihan untuk select jenis string.
       *
       * `value` WAJIB ada: Discord menolak select tanpa opsi. Kalau admin
       * tidak mengisinya, label dipakai sebagai nilainya — lebih berguna
       * daripada membuang seluruh komponen.
       */
      const options: Array<{ label: string; value: string; description?: string; emoji?: string }> = [];
      if (selectKind === 'string') {
        for (const raw of Array.isArray(item.options) ? item.options : []) {
          if (!raw || typeof raw !== 'object') continue;
          const opsi = raw as Record<string, unknown>;
          const label = typeof opsi.label === 'string' ? opsi.label.trim().slice(0, 100) : '';
          if (!label) continue;
          const value = typeof opsi.value === 'string' && opsi.value.trim()
            ? opsi.value.trim().slice(0, 100)
            : label;
          const description = typeof opsi.description === 'string'
            ? opsi.description.trim().slice(0, 100)
            : '';
          const emoji = normalizeEmoji(opsi.emoji);
          options.push({
            label,
            value,
            ...(description ? { description } : {}),
            ...(emoji ? { emoji } : {}),
          });
          if (options.length >= LIMITS.selectOptions) break;
        }
        if (options.length === 0) {
          dropped.push('select menu tanpa pilihan (Discord menolak menu kosong)');
          continue;
        }
      }

      // Discord: min 0..25, max 1..25, dan min tidak boleh melebihi max.
      const maks = Math.min(Math.max(1, Number(item.maxValues) || 1), LIMITS.selectOptions);
      const minRaw = Number(item.minValues);
      const min = Number.isFinite(minRaw) ? Math.min(Math.max(0, Math.trunc(minRaw)), maks) : 1;

      out.push({
        kind: 'select',
        value: isi,
        selectKind,
        ...(placeholder ? { placeholder } : {}),
        minValues: min,
        maxValues: maks,
        ...(options.length > 0 ? { options } : {}),
        ...(item.selectDisabled === true ? { selectDisabled: true } : {}),
      });
      continue;
    }

    if (kind === 'close') {
      /*
       * Penanda struktur murni: tidak menghasilkan komponen, dan dua penutup
       * berurutan sama saja dengan satu.
       *
       * Penutup PERTAMA harus tetap dipertahankan walaupun belum ada blok
       * sebelumnya. Artinya: "mulai menulis di luar kartu". Itu satu-satunya
       * cara menyusun pesan yang SELURUH isinya di luar kartu — mis. teks
       * polos + baris tombol seperti pesan Discohook tanpa container. Dulu
       * syarat `out.length > 0` membuang penanda ini, sehingga pesan seperti
       * itu tetap terbungkus satu kartu dan tampilannya berubah.
       */
      if (out.length === 0 || out[out.length - 1]!.kind !== 'close') {
        out.push({ kind: 'close', value: '' });
      }
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
  /** Jumlah lampiran berkas yang ikut terkirim (batas `filesPerMessage`). */
  files: number;
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

  /*
   * Hitungan ini meniru `buildPostPayload`, termasuk aturan yang mudah
   * terlewat: kalau pesan memakai blok `container`, maka blok isi SEBELUM
   * container pertama tampil di luar kartu (top-level), bukan di dalamnya.
   */
  const adaContainerEksplisit = blocks.some((b) => b.kind === 'container');

  let anak = 0;
  let adaIsi = false;
  let adaTombol = 0;
  /** true = sedang menulis di luar kartu (komponen top-level). */
  let luar = adaContainerEksplisit;
  /** Jumlah lampiran berkas (batas Discord 10, kita pakai 5). */
  let totalFiles = 0;
  /** Komponen top-level di luar container (teks/tombol pembuka & penutup). */
  let luarCount = 0;

  const tutup = (): void => {
    if (!adaIsi) return;
    topLevel += 1;
    containers += 1;
    total += anak;
    anak = 0;
    adaTombol = 0;
    adaIsi = false;
  };

  /**
   * Tutup deretan tombol yang sedang menumpuk.
   *
   * Di dalam kartu, hasilnya ditambahkan ke `anak` — BUKAN langsung ke `total`,
   * karena `tutup()` menjumlahkan `anak` ke `total`. Menambah ke keduanya
   * membuat tombol terhitung dua kali (3 dihitung sebagai 4).
   */
  const tutupTombol = (): void => {
    if (adaTombol === 0) return;
    const baris = Math.ceil(adaTombol / LIMITS.buttonsPerRow);
    if (luar) {
      total += baris;
      luarCount += baris;
    } else {
      anak += baris;
      adaIsi = true;
    }
    adaTombol = 0;
  };

  for (const block of blocks) {
    if (block.kind === 'container') {
      tutupTombol();
      tutup();
      luar = false;
      continue;
    }
    if (block.kind === 'close') {
      tutupTombol();
      tutup();
      luar = true;
      continue;
    }
    if (block.kind === 'button') {
      adaTombol += 1;
      continue;
    }
    if (block.kind === 'row') {
      // Baris baru: deretan tombol yang menumpuk dihitung sebagai baris utuh,
      // sama seperti `flushButtons(true)` di penyusun payload.
      tutupTombol();
      continue;
    }
    if (block.kind === 'select') {
      // Select selalu satu baris penuh (5 slot), jadi tombol yang menumpuk
      // harus ditutup lebih dulu — kalau tidak, angkanya kurang satu baris.
      tutupTombol();
      if (luar) {
        total += 1;
        luarCount += 1;
      } else {
        anak += 1;
        adaIsi = true;
      }
      continue;
    }
    if (block.kind === 'divider') {
      // Pemisah pertama di container kosong tidak ditampilkan sendirian.
      if (adaIsi || luar) {
        if (luar) {
          total += 1;
          luarCount += 1;
        } else {
          anak += 1;
        }
      }
      continue;
    }
    if (block.kind === 'file') {
      // Berkas adalah komponen top-level sendiri (File), bukan isi kartu.
      total += 1;
      totalFiles += 1;
      if (luar) luarCount += 1;
      continue;
    }
    if (block.kind === 'text' || block.kind === 'section' || block.kind === 'image') {
      text += block.kind === 'text' || block.kind === 'section' ? block.value.length : 0;
      if (luar) {
        total += 1;
        luarCount += 1;
      } else {
        anak += 1;
        adaIsi = true;
      }
    }
  }
  tutupTombol();
  tutup();

  // Komponen di luar kartu juga memakan kuota top-level (batas Discord: 10).
  topLevel += luarCount;

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

  if (totalFiles > LIMITS.filesPerMessage) {
    masalah.push(`Berkas ${totalFiles} melebihi batas ${LIMITS.filesPerMessage} per pesan.`);
  }

  return {
    total,
    topLevel,
    text,
    containers,
    files: totalFiles,
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
  /**
   * Berkas dari URL yang harus diunduh saat pengiriman.
   *
   * `FileBuilder` di Discord HANYA menerima `attachment://<nama>`, bukan URL
   * http. Jadi berkas jarak-jauh tidak bisa dirujuk langsung: ia diunduh lebih
   * dulu, dikirim sebagai lampiran, lalu komponennya menunjuk nama lampiran
   * itu. Pengunduhan dilakukan di lapisan pengirim (butuh jaringan).
   */
  remoteFiles: Array<{ url: string; name: string; spoiler?: boolean; indeks: number }>;
  /**
   * Blok yang dilewati saat menyusun payload, dalam bahasa manusia.
   *
   * Contoh: select yang tidak didukung versi discord.js, atau aksesori teks
   * yang butuh Section. Dikembalikan (bukan hanya dicatat di dalam) supaya
   * dashboard bisa memberi tahu admin apa yang tidak jadi terkirim.
   */
  dropped: string[];
}

/** Bentuk minimal lampiran — pemanggil yang membuat AttachmentBuilder asli. */
export interface AttachmentLike {
  dataUri: string;
  /** Kalau terisi, lampiran ini berasal dari URL dan harus diunduh saat kirim. */
  remoteUrl?: string;
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
    /** Untuk blok `file` — versi lawas discord.js boleh tidak punya ini. */
    FileBuilder?: new () => any;
    /** Untuk select menu role. */
    StringSelectMenuBuilder?: new () => any;
    StringSelectMenuOptionBuilder?: new () => any;
    /**
     * Select menu yang disediakan Discord sendiri (blok `select`).
     *
     * Tidak semua versi discord.js punya keempatnya, jadi semuanya opsional:
     * blok yang tidak bisa dibangun dilewati dengan alasan, bukan menggagalkan
     * seluruh pesan.
     */
    UserSelectMenuBuilder?: new () => any;
    RoleSelectMenuBuilder?: new () => any;
    MentionableSelectMenuBuilder?: new () => any;
    ChannelSelectMenuBuilder?: new () => any;
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
    /**
     * ID pesan (/pesan) pemilik komponen.
     *
     * Disisipkan ke customId blok Select (`post-ctx:<postId>:<jenis>`) supaya
     * aksi komponen bisa dicari secara pasti. Tanpa ini, dua pesan yang
     * sama-sama punya select berjenis `role` tidak bisa dibedakan — dan aksi
     * milik pesan lain bisa ikut dijalankan.
     */
    contextPostId?: number | null;
  },
): BuiltPost | null {
  /*
   * Penjaga "pesan kosong". Tombol saja tidak cukup (Discord menolak pesan
   * yang hanya berisi ActionRow di dalam container tanpa teks), tapi section
   * yang hanya berisi gambar tetap sah — jadi ia ikut dihitung sebagai isi.
   */
  const adaIsi = blocks.some(
    (b) =>
      b.kind === 'text' ||
      b.kind === 'image' ||
      b.kind === 'section' ||
      b.kind === 'file' ||
      // Select menu adalah isi, bukan hiasan: pesan berisi satu dropdown saja
      // tetap sah di Discord, sama seperti di Discohook.
      b.kind === 'select',
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
  const buatWadah = (accent?: number, spoiler?: boolean): Wadah => {
    const builder = new deps.ContainerBuilder();
    const warna = accent ?? accentDefault;
    if (warna !== undefined) builder.setAccentColor(warna);
    // Spoiler container: seluruh kartu tertutup sampai member mengkliknya.
    // `setSpoiler` ada di discord.js 14.19+; versi lawas cukup dilewati.
    if (spoiler && typeof builder.setSpoiler === 'function') builder.setSpoiler(true);
    const baru: Wadah = { builder, anak: 0, adaIsi: false };
    wadah.push(baru);
    return baru;
  };
  /*
   * Apakah pesan ini memakai container EKSPLISIT (blok `container`).
   *
   * Ini menentukan perilaku untuk blok yang datang SEBELUM container pertama:
   *   - tidak ada container → semua masuk satu kartu (perilaku lama)
   *   - ada container       → blok sebelum container pertama tampil DI LUAR
   *     kartu, persis seperti pesan Discohook (teks pembuka polos di atas,
   *     baru kemudian kartu-kartunya)
   *
   * Kalau aturan ini tidak dibuat, teks pembuka ikut terkurung di dalam
   * kartu pertama dan hasilnya tidak lagi menyerupai Discohook.
   */
  const adaContainerEksplisit = blocks.some((b) => b.kind === 'container');

  let aktif = buatWadah();

  /*
   * Komponen yang tampil DI LUAR kartu (top-level).
   *
   * Discord mengizinkan TextDisplay, Separator, MediaGallery, Section, dan
   * ActionRow tampil langsung di pesan tanpa dibungkus Container. Itu yang
   * dipakai pesan Discohook: teks pembuka polos di atas, lalu dua kartu,
   * lalu baris tombol penutup.
   *
   * Disimpan beserta urutannya terhadap wadah, karena urutan tampil harus
   * sama dengan urutan blok yang disusun admin.
   */
  interface TopLevel {
    /** `container` = wadah, `lain` = komponen langsung di pesan. */
    jenis: 'container' | 'lain';
    wadah?: Wadah;
    komponen?: any;
  }
  const urutan: TopLevel[] = [];
  const daftarkanWadah = (w: Wadah): void => {
    // Wadah yang sama hanya didaftarkan sekali; panggilan berikutnya dari
    // blok isi berikutnya tidak menambah entri.
    if (urutan.some((u) => u.wadah === w)) return;
    urutan.push({ jenis: 'container', wadah: w });
  };
  // Wadah awal hanya dipakai kalau pesan memang tanpa container eksplisit.
  if (!adaContainerEksplisit) daftarkanWadah(aktif);

  /**
   * Mode penulisan: di dalam kartu (bawaan) atau langsung di pesan.
   *
   * `luar` dinyalakan oleh blok `close`, dan dimatikan lagi oleh blok
   * `container` berikutnya. Bedanya penting: komponen di luar kartu tidak
   * mendapat warna aksen dan tidak bisa berisi ActionRow + teks sekaligus.
   */
  let luar = adaContainerEksplisit;

  /** Tulis satu komponen ke tujuan yang sedang aktif. */
  const tulis = (komponen: any): void => {
    if (luar) {
      urutan.push({ jenis: 'lain', komponen });
      return;
    }
    /*
     * ContainerBuilder tidak punya `addComponents` generik — ia hanya punya
     * penambah per jenis (addTextDisplayComponents, addSeparatorComponents,
     * ...). `spliceComponents` adalah satu-satunya cara menyisipkan komponen
     * tanpa peduli jenisnya, dan itulah yang dipakai di sini.
     *
     * Catatan: versi pertama fungsi ini memakai `addComponents?.()` — opsional
     * chaining membuatnya diam-diam tidak melakukan apa pun, sehingga semua
     * isi container hilang tanpa satu pun error.
     */
    aktif.builder.spliceComponents(aktif.builder.components.length, 0, komponen);
    aktif.anak += 1;
    aktif.adaIsi = true;
  };

  /** Pindah ke container berikutnya; dipanggil saat blok `container` dibaca. */
  const bukaContainer = (block: PostBlock): void => {
    const accent = block.accent && deps.accentToNumber ? deps.accentToNumber(block.accent) : undefined;
    aktif = buatWadah(accent, block.spoiler);
    // Wadah BARU harus didaftarkan — tanpa ini ia tidak pernah masuk daftar
    // urutan dan seluruh isinya hilang dari pesan.
    daftarkanWadah(aktif);
    // Container SELALU membuka kartu: admin yang menutup kartu lalu menambah
    // container jelas ingin kembali ke dalam kartu.
    luar = false;
  };

  // Lampiran (gambar unggahan + berkas) dikumpulkan dulu, lalu dikirim.
  const files: AttachmentLike[] = [];
  const remoteFiles: Array<{ url: string; name: string; spoiler?: boolean; indeks: number }> = [];
  const dropped: string[] = [];

  /**
   * Pasang aksesori pada Section: tombol link lebih dulu, lalu thumbnail.
   *
   * Discord hanya menerima SATU aksesori per Section. Tombol dipilih kalau
   * keduanya terisi karena lebih terlihat dan bisa diklik.
   */
  const tambahAksesori = (section: any, block: PostBlock): void => {
    if (block.accessoryLabel && block.accessoryUrl) {
      const tombol = new deps.ButtonBuilder()
        .setStyle(deps.ButtonStyle.Link)
        .setLabel(block.accessoryLabel)
        .setURL(block.accessoryUrl);
      // Emoji tombol aksesori — Discohook mengizinkannya pada tombol Section.
      const emoji = parseEmoji(block.emoji);
      if (emoji) tombol.setEmoji(emoji);
      if (block.disabled && typeof tombol.setDisabled === 'function') tombol.setDisabled(true);
      section.setButtonAccessory(tombol);
    } else if (block.thumbnail && deps.ThumbnailBuilder) {
      const thumb = new deps.ThumbnailBuilder();
      thumb.setURL(block.thumbnail);
      section.setThumbnailAccessory(thumb);
    }
  };

  let tombolTertunda: PostBlock[] = [];

  /**
   * Bangun ActionRow untuk blok `select`.
   *
   * Select selalu memakai SATU baris penuh: di Discord lebarnya 5 slot
   * (lihat `getComponentWidth` di Discohook), dan baris hanya punya 5 slot.
   * Karena itu tombol yang menumpuk harus dikeluarkan lebih dulu dari baris
   * ini — bukan digabung.
   *
   * `null` = jenis select tidak didukung versi discord.js yang dipakai.
   */
  const buatSelect = (block: PostBlock): { row: any } | { drop: string } => {
    const jenis = block.selectKind ?? 'string';
    const placeholder = (block.placeholder || block.value || '').slice(0, 150);
    const min = Math.max(0, Math.min(block.minValues ?? 1, 25));
    const max = Math.max(1, Math.min(block.maxValues ?? 1, 25));

    const pasang = (builder: any): any => {
      if (placeholder) builder.setPlaceholder(placeholder);
      if (typeof builder.setMinValues === 'function') builder.setMinValues(Math.min(min, max));
      if (typeof builder.setMaxValues === 'function') builder.setMaxValues(max);
      if (block.selectDisabled && typeof builder.setDisabled === 'function') builder.setDisabled(true);
      return new deps.ActionRowBuilder().addComponents(builder);
    };

    if (jenis === 'string') {
      if (!deps.StringSelectMenuBuilder || !deps.StringSelectMenuOptionBuilder) {
        return { drop: 'select menu dilewati (versi discord.js tidak mendukungnya)' };
      }
      const select = new deps.StringSelectMenuBuilder().setCustomId(selectId(block));
      for (const opsi of (block.options ?? []).slice(0, LIMITS.selectOptions)) {
        const option = new deps.StringSelectMenuOptionBuilder()
          .setLabel(opsi.label.slice(0, 100))
          .setValue((opsi.value || opsi.label).slice(0, 100));
        const emoji = parseEmoji(opsi.emoji);
        if (emoji) option.setEmoji(emoji);
        if (opsi.description) option.setDescription(opsi.description.slice(0, 100));
        select.addOptions(option);
      }
      return { row: pasang(select) };
    }

    const map: Record<string, [string, (new () => any) | undefined]> = {
      user: ['user', deps.UserSelectMenuBuilder],
      role: ['role', deps.RoleSelectMenuBuilder],
      mentionable: ['user & role', deps.MentionableSelectMenuBuilder],
      channel: ['channel', deps.ChannelSelectMenuBuilder],
    };
    const [nama, Builder] = map[jenis] ?? [jenis, undefined];
    if (!Builder) return { drop: `select ${nama} dilewati (versi discord.js tidak mendukungnya)` };
    return { row: pasang(new Builder().setCustomId(selectId(block))) };
  };

  /**
   * customId select.
   *
   * Memakai prefix `post-ctx:` supaya router interaksi bisa mengenalinya dan
   * menjawab dengan penjelasan — menu ini memang tidak mengubah apa pun.
   * Isinya cuma jenis menu, jadi jauh di bawah batas 100 karakter Discord.
   */
  const selectId = (block: PostBlock): string => {
    const jenis = block.selectKind ?? 'string';
    /*
     * ID pesan ikut dikirim bila diketahui. Pesan lama (yang dikirim sebelum
     * ini ada) tetap memakai bentuk pendek `post-ctx:<jenis>`; bot mengenali
     * kedua bentuk, jadi tidak ada komponen yang berhenti bekerja.
     */
    return deps.contextPostId ? `post-ctx:${deps.contextPostId}:${jenis}` : `post-ctx:${jenis}`;
  };

  /**
   * Buang SEMUA tombol yang menumpuk menjadi ActionRow, 5 per baris.
   *
   * Dipanggil saat deretan tombol selesai: sebelum blok bukan-tombol, sebelum
   * container/penutup, dan pada blok `row`. Karena seluruh tumpukan
   * dikeluarkan, tombol sesudah `row` otomatis mulai dari baris baru —
   * itulah padanan "Row" di Discohook. (Versi pertama fungsi ini punya
   * parameter `paksa` yang tidak pernah mengubah perilaku, karena
   * `splice(0, 5)` sudah mengosongkan tumpukan; parameternya dibuang supaya
   * tidak menyesatkan.)
   */
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
        // Tombol nonaktif tetap tampil, tetapi Discord menolak kliknya.
        if (tombol.disabled && typeof button.setDisabled === 'function') button.setDisabled(true);
        row.addComponents(button);
      }
      if (luar) {
        // Di luar kartu, ActionRow berdiri sendiri sebagai komponen top-level.
        urutan.push({ jenis: 'lain', komponen: row });
      } else {
        aktif.builder.addActionRowComponents(row);
        aktif.anak += 1;
        aktif.adaIsi = true;
      }
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
    if (block.kind === 'close') {
      if (tombolTertunda.length > 0) flushButtons();
      luar = true;
      continue;
    }
    if (block.kind === 'row') {
      // Baris baru: keluarkan tombol yang sudah terkumpul sebagai satu baris
      // utuh, lalu baris berikutnya dimulai dari tombol sesudah blok ini.
      if (tombolTertunda.length > 0) flushButtons();
      continue;
    }
    if (block.kind === 'button') {
      tombolTertunda.push(block);
      continue;
    }
    // Blok lain menutup deretan tombol sebelumnya supaya urutan tetap terjaga.
    if (tombolTertunda.length > 0) flushButtons();

    if (block.kind === 'select') {
      const hasil = buatSelect(block);
      if ('drop' in hasil) {
        dropped.push(hasil.drop);
        continue;
      }
      tulis(hasil.row);
      continue;
    }

    if (block.kind === 'divider') {
      // Discord menyebut dua hal terpisah pada Separator: `divider` (ada
      // garisnya atau tidak) dan `spacing` (rapat/renggang). Discohook
      // mengekspos keduanya, jadi keduanya diteruskan di sini.
      const sep = new deps.SeparatorBuilder().setDivider(block.divider !== false);
      // Jarak: 1 = kecil (rapat), 2 = besar (renggang). Discord menamainya
      // `spacing`, bukan ukuran piksel.
      if (block.spacing === 'large' && typeof sep.setSpacing === 'function') sep.setSpacing(2);
      tulis(sep);
      continue;
    }
    if (block.kind === 'text') {
      /*
       * Teks yang diberi aksesori (tombol link / thumbnail) harus dikirim
       * sebagai Section, bukan TextDisplay: hanya Section yang punya slot
       * aksesori di Discord. Ini yang dilakukan Discohook saat kamu menekan
       * "Add Accessory" pada komponen teks.
       *
       * Tanpa aksesori, blok tetap TextDisplay biasa — pesan lama tidak
       * berubah bentuknya.
       */
      const adaAksesori = Boolean(
        (block.accessoryLabel && block.accessoryUrl) || block.thumbnail,
      );
      if (adaAksesori && deps.SectionBuilder) {
        const section = new deps.SectionBuilder();
        section.addTextDisplayComponents(new deps.TextDisplayBuilder().setContent(block.value));
        tambahAksesori(section, block);
        tulis(section);
        continue;
      }
      if (adaAksesori && !deps.SectionBuilder) {
        dropped.push('aksesori teks dilewati (versi discord.js tidak mendukung Section)');
      }
      tulis(new deps.TextDisplayBuilder().setContent(block.value));
      continue;
    }
    if (block.kind === 'section') {
      // Section = teks + SATU aksesori (thumbnail ATAU tombol link).
      if (deps.SectionBuilder && deps.ThumbnailBuilder) {
        const section = new deps.SectionBuilder();
        section.addTextDisplayComponents(
          new deps.TextDisplayBuilder().setContent(block.value || '\u200b'),
        );
        tambahAksesori(section, {
          ...block,
          accessoryLabel: block.accessoryLabel,
          accessoryUrl: block.url,
        });
        tulis(section);
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
      const item = new deps.MediaGalleryItemBuilder().setURL(url);
      // Alt text: deskripsi gambar untuk pembaca layar (dan saat gagal muat).
      if (block.alt && typeof item.setDescription === 'function') item.setDescription(block.alt);
      // Spoiler: gambar disamarkan sampai diklik. `setSpoiler` ada di
      // discord.js 14.19+; versi lawas dilewati tanpa menggagalkan pesan.
      if (block.spoiler && typeof item.setSpoiler === 'function') item.setSpoiler(true);
      const galeri = new deps.MediaGalleryBuilder().addItems(item);

      // Aksesori pada gambar membungkus galeri dalam Section, karena hanya
      // Section yang punya slot aksesori.
      if ((block.accessoryLabel && block.accessoryUrl) || block.thumbnail) {
        if (deps.SectionBuilder) {
          const section = new deps.SectionBuilder();
          section.addMediaGalleryComponents(galeri);
          tambahAksesori(section, block);
          tulis(section);
          continue;
        }
        dropped.push('aksesori gambar dilewati (versi discord.js tidak mendukung Section)');
      }
      tulis(galeri);
      continue;
    }

    if (block.kind === 'file') {
      /*
       * Lampiran berkas.
       *
       * Dua sumber: URL http(s) (Discord mengunduh sendiri) atau unggahan
       * dashboard (data URI) yang harus dikirim sebagai lampiran lalu
       * dirujuk lewat attachment://<nama>.
       *
       * `FileBuilder` ada di discord.js 14.19+; kalau tidak ada, blok ini
       * dilewati dengan alasan yang jelas alih-alih mengirim payload rusak.
       */
      if (!deps.FileBuilder) {
        dropped.push(`berkas "${(block.name || block.value).slice(0, 40)}" dilewati (versi discord.js tidak mendukung File)`);
        continue;
      }
      let urlBerkas = block.value;
      const file = new deps.FileBuilder();
      if (block.value) {
        /*
         * Berkas jarak-jauh: nama ditentukan sekarang supaya komponen dan
         * lampiran memakai nama yang sama, tetapi isinya belum diunduh.
         * `FileBuilder` menolak URL http, jadi ia menunggu nama lampiran.
         */
        const namaAsli = (block.name || block.value.split('/').pop() || 'berkas')
          .replace(/[^A-Za-z0-9._-]/g, '-')
          .slice(0, 60) || 'berkas';
        const name = /\.[A-Za-z0-9]{1,8}$/.test(namaAsli) ? namaAsli : `${namaAsli}.bin`;
        remoteFiles.push({
          url: block.value,
          name,
          ...(block.spoiler ? { spoiler: true } : {}),
          indeks: files.length,
        });
        files.push({ dataUri: '', name, remoteUrl: block.value });
        urlBerkas = `attachment://${name}`;
      } else if (block.data) {
        // Nama file wajib aman: hanya huruf/angka/titik/strip.
        const dasar = (block.name || `berkas-${files.length + 1}`)
          .replace(/[^A-Za-z0-9._-]/g, '-')
          .slice(0, 60) || `berkas-${files.length + 1}`;
        const name = /\.[A-Za-z0-9]{1,8}$/.test(dasar) ? dasar : `${dasar}.bin`;
        files.push({ dataUri: block.data, name });
        urlBerkas = `attachment://${name}`;
      }
      file.setURL(urlBerkas);
      if (block.spoiler && typeof file.setSpoiler === 'function') file.setSpoiler(true);
      /*
       * Berkas SELALU komponen top-level, tidak pernah di dalam kartu.
       *
       * Dua alasan: (1) Discord menampilkan lampiran di dasar pesan, terpisah
       * dari kartu, jadi menaruhnya di dalam container akan tampak sebagai
       * kartu di dalam kartu; (2) Discohook pun memperlakukan File sebagai
       * komponen sejajar Container, bukan isi container.
       */
      urutan.push({ jenis: 'lain', komponen: file });
      continue;
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
      /*
       * Tombol role SELALU masuk ke kartu terakhir, bukan ke luar kartu.
       * Alasan: ia menyatu secara visual dengan isi pesan, dan kalau
       * ditaruh di luar kartu ia bisa jadi komponen top-level tambahan yang
       * memakan kuota 10 — untuk komponen yang tidak admin susun sendiri.
       */
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
   * Susun komponen top-level sesuai urutan blok.
   *
   * Container kosong dibuang: (1) Discord menolak container tanpa komponen,
   * (2) admin yang menekan "container baru" lalu berubah pikiran tidak boleh
   * mendapat kartu kosong. Kalau semua kosong, pemanggil menganggap pesan
   * kosong (null) — sama seperti perilaku sebelumnya.
   */
  const komponen: any[] = [];
  for (const item of urutan) {
    if (item.jenis === 'container') {
      if (item.wadah?.adaIsi) komponen.push(item.wadah.builder);
    } else if (item.komponen) {
      komponen.push(item.komponen);
    }
  }
  if (komponen.length === 0) return null;

  // Batas Discord: 10 komponen teratas per pesan.
  return {
    components: komponen.slice(0, LIMITS.topLevelComponents),
    flags: 1 << 15,
    files,
    remoteFiles,
    /*
     * Blok yang dilewati saat penyusunan payload.
     *
     * Dikembalikan supaya pengirim bisa memberi tahu admin — dulu daftar ini
     * hanya hidup di dalam fungsi dan hilang tanpa jejak, sehingga select atau
     * berkas yang dilewati tidak pernah dilaporkan.
     */
    dropped,
  };
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
