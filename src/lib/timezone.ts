/**
 * Zona waktu Indonesia — WIB, WITA, WIT.
 *
 * Indonesia punya tiga zona resmi, dan server Discord bisa berada di mana saja.
 * Sebelumnya semua jam di bot ini dipaku ke `Asia/Jakarta`, jadi member di
 * Makassar atau Jayapura selalu melihat jam yang meleset 1–2 jam: sapaan
 * "selamat pagi" muncul jam 8 pagi WITA padahal itu jam 9 pagi mereka.
 *
 * Tiga label yang dipakai (mengikuti referensi `ai-discord-chat`):
 *
 *   | Label | Zona IANA        | Offset | Wilayah contoh             |
 *   |-------|------------------|--------|----------------------------|
 *   | WIB   | Asia/Jakarta     | UTC+7  | Sumatra, Jawa, Kalimantan  |
 *   | WITA  | Asia/Makassar    | UTC+8  | Bali, Sulawesi, NTB, NTT   |
 *   | WIT   | Asia/Jayapura    | UTC+9  | Maluku, Papua              |
 *
 * Indonesia tidak memakai DST, jadi offset tetap sepanjang tahun — tetapi
 * `Intl` tetap dipakai supaya kalau aturannya berubah, kode ini ikut benar
 * tanpa perubahan.
 */

export type TimeZoneId = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';

export interface TimeZoneOption {
  /** Nama zona IANA — nilai yang disimpan. */
  id: TimeZoneId;
  /** Label pendek yang ditampilkan ke pengguna. */
  label: 'WIB' | 'WITA' | 'WIT';
  /** Nama panjang untuk pilihan di dashboard. */
  longName: string;
  /** Offset jam dari UTC (tanpa DST). */
  offset: number;
}

export const TIME_ZONES: readonly TimeZoneOption[] = [
  { id: 'Asia/Jakarta', label: 'WIB', longName: 'Waktu Indonesia Barat', offset: 7 },
  { id: 'Asia/Makassar', label: 'WITA', longName: 'Waktu Indonesia Tengah', offset: 8 },
  { id: 'Asia/Jayapura', label: 'WIT', longName: 'Waktu Indonesia Timur', offset: 9 },
];

/** Zona bawaan: WIB, sama seperti perilaku sebelum fitur ini ada. */
export const DEFAULT_TIME_ZONE: TimeZoneId = 'Asia/Jakarta';

/**
 * Normalisasi nilai dari database/.env jadi zona yang dikenal.
 *
 * Menerima nama IANA (`Asia/Makassar`), label (`WITA`, huruf besar/kecil),
 * maupun kosong. Nilai tak dikenal → zona bawaan, bukan error: lebih baik
 * dashboard tetap jalan dengan WIB daripada mati karena satu baris DB salah.
 */
export function normalizeTimeZone(value: unknown): TimeZoneId {
  if (typeof value !== 'string') return DEFAULT_TIME_ZONE;
  const raw = value.trim();
  if (!raw) return DEFAULT_TIME_ZONE;

  const exact = TIME_ZONES.find((zone) => zone.id.toLowerCase() === raw.toLowerCase());
  if (exact) return exact.id;

  const byLabel = TIME_ZONES.find((zone) => zone.label.toLowerCase() === raw.toLowerCase());
  if (byLabel) return byLabel.id;

  return DEFAULT_TIME_ZONE;
}

/** Label pendek ("WIB") untuk zona apa pun yang dikenal. */
export function timeZoneLabel(timeZone: string | null | undefined): string {
  const zone = TIME_ZONES.find((item) => item.id === normalizeTimeZone(timeZone));
  return zone?.label ?? 'WIB';
}

/** "WIB (Asia/Jakarta)" — untuk pilihan di dashboard. */
export function timeZoneTitle(timeZone: string | null | undefined): string {
  const zone = TIME_ZONES.find((item) => item.id === normalizeTimeZone(timeZone));
  return zone ? `${zone.label} (${zone.id})` : `${timeZoneLabel(timeZone)} (${DEFAULT_TIME_ZONE})`;
}

/**
 * Jam (0–23) pada zona tertentu.
 *
 * Memakai `Intl` dengan `hourCycle: 'h23'`, bukan `hour12: false` — di beberapa
 * runtime `hour12: false` menghasilkan "24" untuk tengah malam, dan "24 >= 23"
 * akan salah dianggap jam tenang.
 */
export function hourInZone(now: number | Date, timeZone: string | null | undefined): number {
  const date = typeof now === 'number' ? new Date(now) : now;
  const text = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
  return Number(text);
}

/**
 * Suasana waktu: pagi/siang/sore/malam/dinihari.
 *
 * Dipakai prompt sambutan & agent supaya model tahu "sekarang jam berapa" di
 * zona server, bukan sekadar tanggal.
 */
export function partOfDayInZone(
  now: number | Date,
  timeZone: string | null | undefined,
): 'dinihari' | 'pagi' | 'siang' | 'sore' | 'malam' {
  const hour = hourInZone(now, timeZone);
  if (hour < 4) return 'dinihari';
  if (hour < 11) return 'pagi';
  if (hour < 15) return 'siang';
  if (hour < 18) return 'sore';
  return 'malam';
}

/**
 * Jam + label untuk ditulis di prompt: "14:05 WITA".
 *
 * Yang ditulis labelnya, bukan nama IANA: model bahasa jauh lebih paham "WITA"
 * daripada "Asia/Makassar", dan member juga begitu.
 */
export function clockInZone(now: number | Date, timeZone: string | null | undefined): string {
  const date = typeof now === 'number' ? new Date(now) : now;
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
  return `${time} ${timeZoneLabel(timeZone)}`;
}
