/**
 * Mode tampilan pesan sambutan & salam perpisahan.
 *
 * Tiga mode, mengikuti dua bot pembanding yang sudah ditinjau:
 *
 * | Mode        | Bentuk pesan                                   | Butuh kartu PNG? |
 * |-------------|------------------------------------------------|------------------|
 * | `card`      | kartu PNG sebagai lampiran                     | ya               |
 * | `container` | kartu Components V2 (blok berwarna aksen)      | tidak            |
 * | `embed`     | embed Discord biasa                            | tidak            |
 * | `text`      | teks polos (satu-satunya yang bisa me-*ping*)  | tidak            |
 *
 * Catatan mention: **mention hanya hidup di luar embed**. Di dalam embed,
 * `<@id>` tampil sebagai teks biasa dan tidak pernah memicu notifikasi. Karena
 * itu `text` (lewat `content`) dan `container` (mention di dalam Text Display)
 * bisa me-ping, sedangkan `card` dan `embed` tidak.
 *
 * Catatan Components V2: pesan ber-flag `IsComponentsV2` **tidak boleh**
 * memuat `content`, `embeds`, atau `files` — Discord menolaknya. Karena itu
 * mode `container` mengirim komponen saja, dan mention-nya ikut di dalam teks.
 *
 * Modul ini murni fungsi: tidak menyentuh database, jaringan, atau Discord.
 * Penyimpanan mode ada di `repo.ts`, penyusunan payload di `welcome.ts`.
 */

export type DisplayMode = 'card' | 'container' | 'embed' | 'text';

export interface DisplayModeInfo {
  key: DisplayMode;
  label: string;
  /** Penjelasan singkat untuk dashboard. */
  note: string;
  /** Mode ini bergantung pada kartu PNG yang harus dirender dulu. */
  needsCard: boolean;
  /** Mode ini mengirim `content` sehingga mention benar-benar memicu notifikasi. */
  canMention: boolean;
}

/** Urutan mengikuti urutan tombol di dashboard. */
export const DISPLAY_MODES: DisplayModeInfo[] = [
  {
    key: 'card',
    label: 'Card',
    note: 'Kartu PNG (banner + avatar + nama). Tidak bisa me-ping member.',
    needsCard: true,
    canMention: false,
  },
  {
    key: 'container',
    label: 'Container',
    note: 'Kartu Components V2 bertema server (gaya panel baru Discord). Bisa me-ping lewat teksnya.',
    needsCard: false,
    canMention: true,
  },
  {
    key: 'embed',
    label: 'Embed',
    note: 'Embed berwarna bertema server. Tidak bisa me-ping member.',
    needsCard: false,
    canMention: false,
  },
  {
    key: 'text',
    label: 'Text',
    note: 'Teks biasa. Bisa me-ping member.',
    needsCard: false,
    canMention: true,
  },
];

/**
 * Mode bawaan.
 *
 * `embed` dipilih karena itu bentuk pesan yang dikirim sebelum mode tampilan
 * ada. Dengan begitu server yang sudah berjalan tidak berubah tampilannya
 * hanya karena pembaruan ini.
 */
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'embed';

/** Apakah sebuah nilai adalah mode yang sah. */
export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === 'card' || value === 'container' || value === 'embed' || value === 'text';
}

/**
 * Normalisasi nilai dari database/dashboard menjadi mode yang sah.
 *
 * Nilai kosong/tak dikenal jatuh ke `embed`, bukan melempar error: data lama
 * atau payload dashboard yang aneh tidak boleh membuat sambutan berhenti
 * terkirim. Nama mode lama ikut diterima supaya database lama tidak perlu
 * migrasi manual.
 */
export function normalizeDisplayMode(value: unknown): DisplayMode {
  const key = String(value ?? '').trim().toLowerCase();
  if (isDisplayMode(key)) return key;

  // Kompatibilitas data lama: mati→text, statis→embed, dinamis→card.
  const legacy: Record<string, DisplayMode> = {
    mati: 'text',
    text: 'text',
    statis: 'embed',
    embed: 'embed',
    dinamis: 'card',
    card: 'card',
    image: 'card',
    png: 'card',
    v2: 'container',
    components: 'container',
  };
  return legacy[key] ?? DEFAULT_DISPLAY_MODE;
}

/** Info lengkap satu mode. */
export function displayModeInfo(value: unknown): DisplayModeInfo {
  const key = normalizeDisplayMode(value);
  return DISPLAY_MODES.find((mode) => mode.key === key) ?? DISPLAY_MODES[1]!;
}

/** Label manusiawi (`Card`, `Embed`, `Text`). */
export function displayModeLabel(value: unknown): string {
  return displayModeInfo(value).label;
}

/**
 * Peta kompatibilitas dari pengaturan lama.
 *
 * Sebelum ada `displayMode`, satu-satunya saklar bentuk pesan adalah
 * `imageEnabled`: menyala berarti kartu, mati berarti embed. Fungsi ini
 * menerjemahkannya **sekali** saat baris database belum punya mode, sehingga
 * server lama tetap tampil persis seperti sebelumnya.
 */
export function modeFromLegacySettings(imageEnabled: boolean): DisplayMode {
  return imageEnabled ? 'card' : 'embed';
}

/**
 * Mode yang benar-benar bisa dipakai, mengingat sumber daya yang ada.
 *
 * Urutan cadangan meniru `welcome_view.py` di repo referensi:
 *   - `card` tanpa kartu terender → `embed`
 *   - `embed` tanpa izin EmbedLinks → `text`
 *   - `text` selalu bisa
 *
 * `available` tidak diisi = anggap semua bisa. Pemanggil yang tahu pasti
 * (mis. renderer kartu sedang mati) mengisi sendiri.
 */
export function fallbackMode(
  wanted: unknown,
  available: { card?: boolean; embed?: boolean; container?: boolean } = {},
): { mode: DisplayMode; fellBack: boolean; reason: string | null } {
  const card = available.card !== false;
  const embed = available.embed !== false;
  const container = available.container !== false;
  const mode = normalizeDisplayMode(wanted);

  // `container` tidak butuh izin khusus (bukan embed, bukan lampiran), tapi
  // butuh dukungan pustaka. Kalau tidak ada, embed adalah bentuk terdekat.
  if (mode === 'container' && !container) {
    return {
      mode: embed ? 'embed' : 'text',
      fellBack: true,
      reason: 'Components V2 tidak didukung',
    };
  }
  if (mode === 'card' && !card) {
    return {
      mode: embed ? 'embed' : 'text',
      fellBack: true,
      reason: 'kartu tidak bisa dirender',
    };
  }
  if (mode === 'embed' && !embed) {
    return { mode: 'text', fellBack: true, reason: 'bot tidak punya izin "Embed Links"' };
  }
  return { mode, fellBack: false, reason: null };
}
