/**
 * Ekspresi cron lima ruas untuk jadwal kirim pesan.
 *
 * Kenapa ditulis sendiri, bukan memakai paket `cron-parser` seperti Discohook:
 *
 *   - yang dibutuhkan hanya SATU hal — "kapan jadwal berikutnya", bukan parse
 *     penuh, bukan `stringify`, bukan zona waktu IANA sembarang;
 *   - bot ini hanya mengenal tiga zona Indonesia (WIB/WITA/WIT) yang offsetnya
 *     tetap, sehingga konversi zona cukup penjumlahan jam — jauh lebih kecil
 *     daripada menarik dependensi baru yang harus ikut di-audit setiap update;
 *   - kesalahan ekspresi harus bisa dijelaskan ke admin dalam bahasa manusia
 *     ("menit 60 tidak ada"), dan itu lebih mudah kalau parsernya sendiri.
 *
 * Format yang didukung: `menit jam tanggal bulan hari`
 *
 *   ┌───────── menit  0-59
 *   │ ┌─────── jam    0-23
 *   │ │ ┌───── tanggal 1-31
 *   │ │ │ ┌─── bulan  1-12 (atau nama jan..dec)
 *   │ │ │ │ ┌─ hari   0-6 (0 = Minggu, 7 juga Minggu)
 *   * * * * *
 *
 * Tiap ruas boleh berisi: angka (5), daftar (1,3,5), rentang (1-5), langkah
 * (bintang garis miring 10, atau 1-30/5), dan bintang. Singkatan bulan/hari
 * diterima (mon, fri). Tanpa dukungan detik, tanda tanya, L, W, atau pagar —
 * Discohook pun hanya memakai lima ruas lewat cron-parser.
 */

/** Batas keamanan: jangan pernah mencari lebih jauh dari ini. */
const CARI_MAKS_HARI = 400;

const NAMA_BULAN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NAMA_HARI = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface Ruas {
  /** Nilai yang lolos, sudah unik dan terurut. */
  nilai: Set<number>;
  /** true kalau ruasnya `*` (dipakai untuk aturan "hari vs tanggal"). */
  bintang: boolean;
}

export interface CronJadwal {
  /** Ekspresi yang sudah dirapikan (spasi tunggal, huruf kecil). */
  ekspresi: string;
  menit: Ruas;
  jam: Ruas;
  tanggal: Ruas;
  bulan: Ruas;
  hari: Ruas;
}

export class CronError extends Error {}

function namaKeAngka(teks: string, daftar: readonly string[]): number | null {
  const posisi = daftar.indexOf(teks.toLowerCase().slice(0, 3));
  return posisi === -1 ? null : posisi;
}

/**
 * Baca satu angka. `offset` dipakai untuk hari: `7` juga berarti Minggu,
 * jadi hasilnya dipetakan ke 0.
 */
function bacaAngka(
  teks: string,
  min: number,
  maks: number,
  nama: readonly string[] | null,
  namaPesan: string,
): number {
  const bersih = teks.trim();
  if (!bersih) throw new CronError(`ruas ${namaPesan} kosong`);

  if (nama) {
    const dariNama = namaKeAngka(bersih, nama);
    if (dariNama !== null) {
      return nama === NAMA_HARI && dariNama === 0 ? 0 : dariNama + (nama === NAMA_BULAN ? 1 : 0);
    }
  }

  if (!/^\d+$/.test(bersih)) {
    throw new CronError(`ruas ${namaPesan} berisi "${bersih}" — harus angka, rentang, atau */langkah`);
  }
  let angka = Number(bersih);
  // Hari 7 = Minggu (cron klasik), dipetakan supaya tidak ada dua wakil.
  if (namaPesan === 'hari' && angka === 7) angka = 0;
  if (angka < min || angka > maks) {
    throw new CronError(`ruas ${namaPesan} bernilai ${bersih} — harus ${min}-${maks}`);
  }
  return angka;
}

function bacaRuas(
  teks: string,
  min: number,
  maks: number,
  namaPesan: string,
  nama: readonly string[] | null = null,
): Ruas {
  const nilai = new Set<number>();
  const bintang = teks.trim() === '*';

  for (const bagian of teks.split(',')) {
    const potong = bagian.trim();
    if (!potong) throw new CronError(`ruas ${namaPesan} punya bagian kosong (koma berlebih?)`);

    // langkah: */n atau a-b/n
    const [dasar, langkahTeks, sisa] = potong.split('/');
    if (sisa !== undefined) throw new CronError(`ruas ${namaPesan} punya terlalu banyak garis miring`);
    const langkah = langkahTeks === undefined ? 1 : Number(langkahTeks);
    if (langkahTeks !== undefined && (!/^\d+$/.test(langkahTeks) || langkah < 1)) {
      throw new CronError(`langkah pada ruas ${namaPesan} harus angka ≥ 1`);
    }

    let awal: number;
    let akhir: number;
    if (dasar === '*') {
      awal = min;
      akhir = maks;
    } else if (dasar!.includes('-')) {
      const [kiri, kanan, ekstra] = dasar!.split('-');
      if (ekstra !== undefined) throw new CronError(`rentang pada ruas ${namaPesan} tidak sah`);
      awal = bacaAngka(kiri!, min, maks, nama, namaPesan);
      akhir = bacaAngka(kanan!, min, maks, nama, namaPesan);
      if (awal > akhir) {
        throw new CronError(`rentang ${dasar} pada ruas ${namaPesan} terbalik (awal > akhir)`);
      }
    } else {
      awal = bacaAngka(dasar!, min, maks, nama, namaPesan);
      // `5/10` pada cron klasik berarti "mulai 5, tiap 10 sampai batas atas".
      akhir = langkahTeks === undefined ? awal : maks;
      if (langkahTeks === undefined) {
        nilai.add(awal);
        continue;
      }
    }

    for (let angka = awal; angka <= akhir; angka += langkah) nilai.add(angka);
  }

  return { nilai, bintang };
}

/**
 * Baca ekspresi cron. Melempar `CronError` dengan alasan yang bisa ditampilkan
 * ke admin — bukan `null`, supaya pemanggil tidak perlu menebak sebabnya.
 */
export function parseCron(input: string): CronJadwal {
  const teks = String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!teks) throw new CronError('ekspresi cron kosong');
  const ruas = teks.split(' ');
  if (ruas.length !== 5) {
    throw new CronError(`ekspresi cron harus 5 ruas (menit jam tanggal bulan hari), bukan ${ruas.length}`);
  }

  const jadwal: CronJadwal = {
    ekspresi: teks,
    menit: bacaRuas(ruas[0]!, 0, 59, 'menit'),
    jam: bacaRuas(ruas[1]!, 0, 23, 'jam'),
    tanggal: bacaRuas(ruas[2]!, 1, 31, 'tanggal'),
    bulan: bacaRuas(ruas[3]!, 1, 12, 'bulan', NAMA_BULAN),
    hari: bacaRuas(ruas[4]!, 0, 6, 'hari', NAMA_HARI),
  };
  if (jadwal.menit.nilai.size === 0) throw new CronError('ruas menit tidak berisi satu nilai pun');
  if (jadwal.jam.nilai.size === 0) throw new CronError('ruas jam tidak berisi satu nilai pun');
  return jadwal;
}

/** Ekspresi ini sah? Dipakai sanitizer dan dashboard. */
export function isCronExpression(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  try {
    parseCron(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Jam dinding (tahun, bulan, tanggal, jam, menit) di satu zona.
 *
 * Offset zona Indonesia tetap, jadi cukup `Intl` untuk membaca bagian-bagian
 * tanggal lalu menambah offset. Tidak ada DST yang bisa menggeser hasilnya.
 */
function jamDinding(
  waktu: number,
  offsetJam: number,
): { tahun: number; bulan: number; tanggal: number; jam: number; menit: number; hari: number } {
  // Digeser dulu, lalu dibaca sebagai UTC: hasilnya jam dinding di zona itu.
  const geser = new Date(waktu + offsetJam * 3_600_000);
  return {
    tahun: geser.getUTCFullYear(),
    bulan: geser.getUTCMonth() + 1,
    tanggal: geser.getUTCDate(),
    jam: geser.getUTCHours(),
    menit: geser.getUTCMinutes(),
    hari: geser.getUTCDay(),
  };
}

/** Kebalikan dari `jamDinding`: jam dinding di zona → epoch ms. */
function dariJamDinding(
  tahun: number,
  bulan: number,
  tanggal: number,
  jam: number,
  menit: number,
  offsetJam: number,
): number {
  return Date.UTC(tahun, bulan - 1, tanggal, jam, menit, 0, 0) - offsetJam * 3_600_000;
}

/**
 * Waktu berikutnya (epoch ms) sesudah `sekarang`.
 *
 * Mengembalikan `null` kalau tidak ketemu dalam ±400 hari — mis. `0 0 30 2 *`
 * (30 Februari) yang tidak pernah ada. Itu bukan kesalahan parse, jadi tidak
 * dilempar sebagai error: admin perlu tahu jadwalnya tidak akan pernah jalan.
 *
 * Aturan hari-vs-tanggal mengikuti cron klasik: kalau KEDUA ruas dibatasi
 * (bukan `*`), jadwal cocok bila salah satunya cocok. Kalau salah satu `*`,
 * yang dibatasi harus cocok. Tanpa aturan ini, `0 9 * * 1` (tiap Senin) dan
 * `0 9 1 * *` (tiap tanggal 1) tidak bisa dibedakan artinya.
 */
export function nextCronTime(
  jadwal: CronJadwal | string,
  sekarang: number,
  offsetJam: number,
): number | null {
  const cron = typeof jadwal === 'string' ? parseCron(jadwal) : jadwal;
  const menitUrut = [...cron.menit.nilai].sort((a, b) => a - b);
  const jamUrut = [...cron.jam.nilai].sort((a, b) => a - b);

  // Mulai dari menit berikutnya: jadwal yang "sekarang" sudah dianggap lewat,
  // supaya jadwal tidak dikirim dua kali dalam menit yang sama.
  let batas = (Math.floor(sekarang / 60_000) + 1) * 60_000;

  for (let hariKe = 0; hariKe <= CARI_MAKS_HARI; hariKe += 1) {
    const dinding = jamDinding(batas, offsetJam);

    if (
      !cron.bulan.nilai.has(dinding.bulan) ||
      !cocokHariTanggal(cron, dinding.tanggal, dinding.hari)
    ) {
      // Lewati ke awal hari berikutnya, jangan periksa tiap menit.
      batas = dariJamDinding(dinding.tahun, dinding.bulan, dinding.tanggal + 1, 0, 0, offsetJam);
      continue;
    }

    for (const jam of jamUrut) {
      if (jam < dinding.jam) continue;
      for (const menit of menitUrut) {
        if (jam === dinding.jam && menit < dinding.menit) continue;
        const calon = dariJamDinding(dinding.tahun, dinding.bulan, dinding.tanggal, jam, menit, offsetJam);
        if (calon >= batas) return calon;
      }
    }

    // Sisa hari ini tidak ada yang cocok: pindah ke awal hari berikutnya.
    batas = dariJamDinding(dinding.tahun, dinding.bulan, dinding.tanggal + 1, 0, 0, offsetJam);
  }

  return null;
}

function cocokHariTanggal(cron: CronJadwal, tanggal: number, hari: number): boolean {
  const tanggalCocok = cron.tanggal.nilai.has(tanggal);
  const hariCocok = cron.hari.nilai.has(hari);
  if (cron.tanggal.bintang && cron.hari.bintang) return true;
  if (cron.tanggal.bintang) return hariCocok;
  if (cron.hari.bintang) return tanggalCocok;
  return tanggalCocok || hariCocok;
}

/**
 * Seberapa rapat jadwal ini berjalan, dalam menit — diukur dari dua waktu
 * berikutnya. Dipakai untuk menolak jadwal yang lebih rapat dari batas
 * (Discohook: sekali per 2 jam) SEBELUM disimpan.
 *
 * Mengembalikan `null` kalau jadwal tidak akan pernah berjalan.
 */
export function cronIntervalMinutes(
  jadwal: CronJadwal | string,
  sekarang: number,
  offsetJam: number,
): number | null {
  const pertama = nextCronTime(jadwal, sekarang, offsetJam);
  if (pertama === null) return null;
  const kedua = nextCronTime(jadwal, pertama, offsetJam);
  if (kedua === null) return null;
  return Math.round((kedua - pertama) / 60_000);
}

/** Tampilan manusiawi yang singkat untuk daftar jadwal. */
export function describeCron(input: string): string {
  let cron: CronJadwal;
  try {
    cron = parseCron(input);
  } catch {
    return `cron tidak sah: ${input}`;
  }
  const jam = [...cron.jam.nilai].sort((a, b) => a - b).map((n) => String(n).padStart(2, '0'));
  const menit = [...cron.menit.nilai].sort((a, b) => a - b).map((n) => String(n).padStart(2, '0'));

  if (cron.tanggal.bintang && cron.hari.bintang && cron.bulan.bintang) {
    if (cron.menit.nilai.size === 1 && cron.jam.nilai.size === 1) {
      return `tiap hari pukul ${jam[0]}:${menit[0]}`;
    }
    return `tiap hari (menit ${menit.join(',')}; jam ${jam.join(',')})`;
  }
  if (cron.tanggal.bintang && cron.bulan.bintang && cron.hari.nilai.size === 1) {
    const nama = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const hari = [...cron.hari.nilai][0]!;
    return `tiap ${nama[hari] ?? `hari ke-${hari}`} pukul ${jam.join(',')}:${menit.join(',')}`;
  }
  if (cron.hari.bintang && cron.bulan.bintang && cron.tanggal.nilai.size === 1) {
    return `tiap tanggal ${[...cron.tanggal.nilai][0]} pukul ${jam.join(',')}:${menit.join(',')}`;
  }
  return `cron ${cron.ekspresi}`;
}
