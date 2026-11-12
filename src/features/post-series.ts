/**
 * Dokumen BERISI BEBERAPA PESAN — padanan `messages[]` di Discohook.
 *
 * Kenapa modul terpisah dan MURNI (tanpa discord.js, tanpa database):
 *
 *   - Bentuk data ini dipakai tiga tempat: impor Discohook, penyimpanan
 *     dokumen (`?grup=`), dan pengirim yang mengubahnya jadi pesan Discord
 *     sungguhan. Kalau tiap tempat menebak sendiri, cepat atau lambat pesan
 *     yang sama terkirim dengan urutan berbeda.
 *   - Aturan "pesan mana membalas pesan mana" adalah hal yang paling mudah
 *     salah dan paling sulit dilihat hasilnya (pesan tetap terkirim, hanya
 *     rangkaiannya kacau). Karena itu aturannya di sini, dan diuji tanpa
 *     Discord.
 *
 * Istilah yang dipakai, mengikuti Discohook supaya admin tidak perlu
 * menerjemahkan:
 *
 *   - `id`       — penanda pesan di dalam dokumen (bukan ID Discord).
 *   - `name`     — nama yang terlihat di daftar pesan editor.
 *   - `blocks`   — isi pesan; sama persis dengan pesan satu-dokumen.
 *   - `reference`— `id` pesan lain yang dibalas pesan ini (opsional).
 *   - `threadName`/`threadId` — pesan yang memulai thread.
 *
 * Yang SENGAJA berbeda dari Discohook, dan alasannya:
 *
 *   - Tidak ada `_id` acak yang dibuat server: `id` dipakai apa adanya dan
 *     hanya wajib unik DI DALAM satu dokumen. ID Discord tetap dipakai untuk
 *     hal yang memang butuh ID Discord.
 *   - `reference` menunjuk `id` pesan lain, bukan `message_reference` mentah.
 *     Rujukan mentah ke pesan Discord mana pun akan membuat dokumen yang
 *     terlihat benar tetapi tidak bisa dikirim (pesannya bukan bagian
 *     rangkaian ini).
 */
import { measureBlocks, sanitizeBlocks, type PostBlock } from './custom-post.js';

/** Satu pesan di dalam dokumen. */
export interface SeriesMessage {
  /** Penanda unik di dalam dokumen. */
  id: string;
  /** Nama yang terlihat di daftar pesan. */
  name: string;
  blocks: PostBlock[];
  /** `id` pesan lain yang dibalas pesan ini. */
  reference?: string;
  /** Nama thread yang dimulai dari pesan ini (opsional). */
  threadName?: string;
  /** Flag pesan Discord untuk pesan ini saja (0 = tanpa flag). */
  flags?: number;
}

/** Batas yang dijaga sanitizer, dasbor, dan pengirim. */
export const SERIES_LIMITS = {
  /**
   * Jumlah pesan per dokumen.
   *
   * Discohook membatasi 15 aksi pesan per flow; untuk satu dokumen, batas
   * yang masuk akal adalah seberapa banyak orang mau membaca rangkaian
   * balasan. 20 sudah jauh melewati itu, dan masih menjaga satu klik
   * "kirim" tidak berubah jadi puluhan permintaan Discord.
   */
  messages: 20,
  /** Panjang nama pesan. */
  nameLength: 80,
  /** Panjang `id`. */
  idLength: 40,
} as const;

const ID_BERSIH = /^[A-Za-z0-9_-]{1,40}$/;

/** Apakah nilai ini bisa dipakai sebagai `id` pesan? */
export function isSeriesId(value: unknown): boolean {
  return typeof value === 'string' && ID_BERSIH.test(value.trim());
}

/**
 * Rapikan satu dokumen multi-pesan.
 *
 * Tidak pernah melempar. Bagian yang tidak sah DIBUANG dengan alasan yang
 * bisa dibaca admin — termasuk rujukan yang menunjuk pesan yang tidak ada,
 * karena rujukan seperti itu akan membuat pengiriman gagal di tengah
 * rangkaian (pesan pertama terkirim, sisanya tidak).
 */
export function sanitizeSeries(input: unknown): {
  messages: SeriesMessage[];
  dropped: string[];
  /** Peringatan yang tidak membuang apa pun (mis. rujukan melingkar). */
  warnings: string[];
} {
  const dropped: string[] = [];
  const warnings: string[] = [];
  const sumber = Array.isArray(input) ? input : [];
  const mentah: Array<Record<string, unknown>> = [];

  for (const satu of sumber.slice(0, SERIES_LIMITS.messages)) {
    if (!satu || typeof satu !== 'object') continue;
    mentah.push(satu as Record<string, unknown>);
  }
  if (Array.isArray(input) && input.length > SERIES_LIMITS.messages) {
    dropped.push(
      `dokumen dibatasi ${SERIES_LIMITS.messages} pesan; ${input.length - SERIES_LIMITS.messages} pesan terakhir tidak disimpan`,
    );
  }

  /* --- Tahap 1: id & nama, supaya rujukan bisa diperiksa di tahap 2 --- */
  const idDipakai = new Set<string>();
  const pesan: SeriesMessage[] = [];
  for (let i = 0; i < mentah.length; i += 1) {
    const item = mentah[i]!;
    let id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!isSeriesId(id)) {
      // ID otomatis TIDAK dipakai diam-diam: dokumen yang sama diimpor dua
      // kali akan menghasilkan ID berbeda, dan rujukan antar pesan jadi
      // menunjuk ke tempat yang salah.
      dropped.push(`pesan #${i + 1}: id tidak sah (huruf/angka/-/_ maks. ${SERIES_LIMITS.idLength})`);
      continue;
    }
    if (idDipakai.has(id)) {
      dropped.push(`pesan #${i + 1}: id "${id}" sudah dipakai pesan lain`);
      continue;
    }
    idDipakai.add(id);

    const bersih = sanitizeBlocks(item.blocks);
    for (const alasan of bersih.dropped) dropped.push(`pesan "${id}": ${alasan}`);
    const ukuran = measureBlocks(bersih.blocks);
    if (ukuran.over) {
      dropped.push(`pesan "${id}" melewati batas Discord: ${ukuran.masalah.join(' ')}`);
      continue;
    }
    if (bersih.blocks.length === 0) {
      dropped.push(`pesan "${id}" kosong (tidak ada teks/gambar/tombol)`);
      continue;
    }

    const nama = (typeof item.name === 'string' ? item.name.trim() : '').slice(0, SERIES_LIMITS.nameLength);
    const threadName =
      typeof item.threadName === 'string' ? item.threadName.trim().slice(0, 100) : '';
    const flags = Number(item.flags ?? 0);

    pesan.push({
      id,
      name: nama || `Pesan ${pesan.length + 1}`,
      blocks: bersih.blocks,
      ...(typeof item.reference === 'string' && item.reference.trim()
        ? { reference: item.reference.trim() }
        : {}),
      ...(threadName ? { threadName } : {}),
      ...(Number.isFinite(flags) && flags > 0 ? { flags: Math.trunc(flags) } : {}),
    });
  }

  /* --- Tahap 2: rujukan harus menunjuk pesan yang IKUT terkirim --- */
  const adaId = new Set(pesan.map((satu) => satu.id));
  for (const satu of pesan) {
    if (satu.reference && !adaId.has(satu.reference)) {
      dropped.push(`pesan "${satu.id}": balasan menunjuk "${satu.reference}" yang tidak ada di dokumen`);
      delete satu.reference;
    }
    if (satu.reference === satu.id) {
      dropped.push(`pesan "${satu.id}": tidak bisa membalas dirinya sendiri`);
      delete satu.reference;
    }
  }

  /*
   * Rujukan melingkar (A membalas B, B membalas A) TIDAK mungkin dikirim:
   * Discord menetapkan `message_reference` saat pesan dibuat, jadi salah satu
   * harus lebih dulu ada. Rujukan itu dilepas dan dilaporkan sebagai
   * peringatan — bukan kegagalan, karena pesannya sendiri tetap sah.
   */
  for (const satu of pesan) {
    if (!satu.reference) continue;
    const dilihat = new Set<string>([satu.id]);
    let sekarang = satu.reference;
    while (sekarang) {
      if (dilihat.has(sekarang)) {
        dropped.push(`pesan "${satu.id}": balasan melingkar dengan "${sekarang}" — rujukannya dilepas`);
        delete satu.reference;
        break;
      }
      dilihat.add(sekarang);
      sekarang = pesan.find((lain) => lain.id === sekarang)?.reference ?? '';
    }
  }

  /* --- Tahap 3: urutan kirim --- */
  const urutan = resolveSendOrder(pesan);
  for (const alasan of urutan.warnings) warnings.push(alasan);
  return { messages: urutan.ordered, dropped, warnings };
}

/**
 * Urutan pengiriman yang MUSTAHIL gagal karena rujukan.
 *
 * Pesan yang membalas pesan lain harus dikirim SESUDAH pesan yang dibalas.
 * Kalau urutan di dokumen sudah begitu, urutannya dipertahankan apa adanya —
 * admin yang menyusun "pembuka, isi, penutup" tidak ingin pesannya
 * diurutkan ulang hanya karena salah satunya membalas.
 */
export function resolveSendOrder(messages: SeriesMessage[]): {
  ordered: SeriesMessage[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const tersisa = [...messages];
  const hasil: SeriesMessage[] = [];
  const dikirim = new Set<string>();

  while (tersisa.length > 0) {
    const indeks = tersisa.findIndex((satu) => !satu.reference || dikirim.has(satu.reference));
    if (indeks === -1) {
      /*
       * Tidak ada yang bisa dikirim = rujukan saling menunggu. Seharusnya
       * tidak terjadi (rujukan melingkar sudah dilepas), tetapi kalau
       * terjadi, sisanya dikirim berurutan tanpa rujukan — lebih baik
       * terkirim dengan urutan datar daripada hilang tanpa kabar.
       */
      warnings.push('sebagian pesan saling menunggu balasan; sisanya dikirim berurutan tanpa rujukan');
      for (const satu of tersisa) {
        delete satu.reference;
        hasil.push(satu);
      }
      break;
    }
    const berikut = tersisa.splice(indeks, 1)[0]!;
    hasil.push(berikut);
    dikirim.add(berikut.id);
  }

  return { ordered: hasil, warnings };
}

/**
 * Rangkuman satu dokumen untuk daftar di dasbor.
 *
 * Ditulis sebagai teks, bukan angka saja: "5 pesan · 1 berbalas · 2 thread"
 * langsung memberi tahu admin apakah dokumennya berbentuk rangkaian atau
 * sekadar kumpulan pesan lepas.
 */
export function describeSeries(messages: SeriesMessage[]): string {
  if (messages.length === 0) return 'belum ada pesan';
  const balasan = messages.filter((satu) => satu.reference).length;
  const thread = messages.filter((satu) => satu.threadName).length;
  const bagian = [`${messages.length} pesan`];
  if (balasan) bagian.push(`${balasan} berbalas`);
  if (thread) bagian.push(`${thread} thread`);
  return bagian.join(' · ');
}

/**
 * Apakah dokumen ini benar-benar RANGKAIAN (bukan sekadar kumpulan pesan)?
 *
 * Dipakai untuk memutuskan apakah pengiriman harus memakai `reply` (satu
 * `message_reference`) atau tidak. Dokumen tanpa satu pun rujukan dikirim
 * sebagai pesan lepas — persis seperti perilaku sebelum fitur ini ada.
 */
export function hasReferences(messages: SeriesMessage[]): boolean {
  return messages.some((satu) => Boolean(satu.reference));
}
