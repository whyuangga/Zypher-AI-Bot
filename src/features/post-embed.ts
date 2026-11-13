import { applyTemplate } from './post-template.js';
/**
 * Pesan bergaya embed klasik (padanan "Webhook message" ala Discohook).
 *
 * Components V2 adalah tampilan baru, tetapi banyak server masih memakai embed
 * biasa: ia bisa dipakai di channel pengumuman, tampil rapi di notifikasi HP,
 * dan tidak butuh flag khusus. Discohook mendukung keduanya; di sini pun.
 *
 * Kenapa satu modul sendiri, bukan cabang di `custom-post-send.ts`:
 *   - Embed dan Components V2 SALING MENOLAK di Discord. Payload yang membawa
 *     `flags: IsComponentsV2` tidak boleh punya `embeds`, dan sebaliknya.
 *     Menaruh keduanya di satu jalur kode membuat aturan itu mudah terlewat.
 *   - Bentuk masukannya beda: embed punya judul, keterangan, warna, penulis,
 *     footer, bidang (field), dan thumbnail — tidak ada padanannya di blok.
 *
 * Isi blok tetap dipakai apa adanya:
 *   - teks pertama          → `description`
 *   - `divider`             → pemisah `\n\n` di antara bagian teks
 *   - `image`               → `image` (embed hanya boleh satu gambar)
 *   - teks dengan aksesori  → thumbnail (gambar kecil di kanan atas)
 *   - `button`/`select`     → ActionRow DI LUAR embed (tombol tetap bisa diklik)
 *   - `file`                → lampiran berkas, bukan bagian embed
 */

export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/** Bentuk embed yang dikirim ke Discord (subset yang dipakai dashboard). */
export interface ClassicEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  thumbnail?: { url: string };
  image?: { url: string };
  author?: { name: string; url?: string; icon_url?: string };
  footer?: { text: string; icon_url?: string };
  fields?: EmbedField[];
}

export interface EmbedBuildResult {
  embed: ClassicEmbed;
  /** Bagian yang tidak bisa masuk embed, dalam bahasa manusia. */
  dropped: string[];
}

/**
 * Bagian embed yang DIISI ADMIN, bukan diturunkan dari blok.
 *
 * Dipisah dari `ClassicEmbed` karena bentuknya disimpan di database
 * (kolom `custom_posts.embed` sebagai JSON) dan harus bertahan dari input
 * asing: dashboard bisa memanggil API langsung, jadi penyaringnya ada di sini
 * — satu tempat, dipakai server dan pratinjau.
 *
 * Batasnya batas Discord, bukan karangan: judul 256, footer 2048, penulis 256,
 * nama bidang 256, isi bidang 1024, maksimal 25 bidang dan TOTAL 6000 karakter
 * untuk seluruh embed (judul + isi + footer + penulis + bidang).
 */
export interface EmbedExtra {
  /** URL yang dibuka saat judul diklik (embed `url`). */
  url?: string;
  /**
   * Warna garis kiri embed ini saja (`#rrggbb`).
   *
   * Discohook mengizinkan tiap embed punya warnanya sendiri; tanpa ini semua
   * embed dalam satu pesan terpaksa berwarna sama dengan aksen pesan.
   */
  color?: string;
  author?: { name: string; url?: string; icon_url?: string };
  footer?: { text: string; icon_url?: string };
  fields?: EmbedField[];
  /** ISO 8601. Kosong = tanpa stempel waktu. */
  timestamp?: string;
}

const BATAS_EXTRA = {
  url: 2048,
  color: 7,
  iconUrl: 2048,
  authorName: 256,
  footer: 2048,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
} as const;

function teksAtauKosong(nilai: unknown, batas: number): string {
  return typeof nilai === 'string' ? nilai.trim().slice(0, batas) : '';
}

/** URL yang aman dikirim Discord: hanya http/https. */
function urlSah(nilai: unknown): string | undefined {
  const teks = teksAtauKosong(nilai, BATAS_EXTRA.url);
  if (!teks) return undefined;
  try {
    const url = new URL(teks);
    return url.protocol === 'http:' || url.protocol === 'https:' ? teks : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saring `EmbedExtra` dari input dashboard/JSON.
 *
 * Tidak pernah melempar. Bagian yang tidak sah DIBUANG dengan alasan yang bisa
 * dibaca admin — sama seperti `sanitizeBlocks` dan `sanitizeActions`.
 */
export function sanitizeEmbedExtra(input: unknown): { extra: EmbedExtra; dropped: string[] } {
  const dropped: string[] = [];
  const extra: EmbedExtra = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { extra, dropped };
  const source = input as Record<string, unknown>;

  const url = urlSah(source.url);
  if (url) extra.url = url;
  else if (teksAtauKosong(source.url, 2048)) dropped.push('URL judul harus alamat http/https');

  /* --- warna embed sendiri (opsional; bawaan = aksen pesan) --- */
  const warnaExtra = teksAtauKosong(source.color, BATAS_EXTRA.color).replace(/^#/, '');
  if (warnaExtra) {
    if (/^[0-9a-fA-F]{6}$/.test(warnaExtra)) extra.color = `#${warnaExtra.toLowerCase()}`;
    else dropped.push('warna embed harus #rrggbb');
  }

  /* --- penulis --- */
  if (source.author && typeof source.author === 'object' && !Array.isArray(source.author)) {
    const author = source.author as Record<string, unknown>;
    const name = teksAtauKosong(author.name, BATAS_EXTRA.authorName);
    if (name) {
      const icon = urlSah(author.icon_url);
      const tautan = urlSah(author.url);
      extra.author = {
        name,
        ...(tautan ? { url: tautan } : {}),
        ...(icon ? { icon_url: icon } : {}),
      };
    } else if (teksAtauKosong(author.name, 1) === '' && author.name !== undefined) {
      dropped.push('penulis embed butuh nama');
    }
  }

  /* --- footer --- */
  if (source.footer && typeof source.footer === 'object' && !Array.isArray(source.footer)) {
    const footer = source.footer as Record<string, unknown>;
    const text = teksAtauKosong(footer.text, BATAS_EXTRA.footer);
    if (text) {
      const icon = urlSah(footer.icon_url);
      extra.footer = { text, ...(icon ? { icon_url: icon } : {}) };
    } else if (footer.text !== undefined) {
      dropped.push('footer embed butuh teks');
    }
  }

  /* --- bidang --- */
  if (Array.isArray(source.fields)) {
    const fields: EmbedField[] = [];
    for (const satu of source.fields) {
      if (!satu || typeof satu !== 'object') continue;
      const field = satu as Record<string, unknown>;
      const name = teksAtauKosong(field.name, BATAS_EXTRA.fieldName);
      const value = teksAtauKosong(field.value, BATAS_EXTRA.fieldValue);
      if (!name || !value) {
        dropped.push('bidang embed butuh nama DAN isi');
        continue;
      }
      fields.push({ name, value, inline: field.inline === true });
      if (fields.length >= BATAS_EXTRA.fields) {
        if (source.fields.length > BATAS_EXTRA.fields) {
          dropped.push(`bidang embed dibatasi ${BATAS_EXTRA.fields}`);
        }
        break;
      }
    }
    if (fields.length) extra.fields = fields;
  }

  /* --- stempel waktu (ISO 8601) --- */
  const timestamp = teksAtauKosong(source.timestamp, 64);
  if (timestamp) {
    const waktu = new Date(timestamp);
    // Discord menolak stempel waktu yang tidak bisa diurai; lebih baik
    // dilaporkan di sini daripada pesannya gagal terkirim seluruhnya.
    if (Number.isNaN(waktu.getTime())) dropped.push('stempel waktu embed harus tanggal ISO 8601');
    else extra.timestamp = waktu.toISOString();
  }

  return { extra, dropped };
}

/** Ada isi admin yang perlu dikirim? (dipakai untuk memutuskan validasi) */
export function embedExtraKosong(extra: EmbedExtra | null | undefined): boolean {
  if (!extra) return true;
  return (
    !extra.url &&
    !extra.author?.name &&
    !extra.footer?.text &&
    !(extra.fields?.length ?? 0) &&
    !extra.timestamp &&
    !extra.color
  );
}

/**
 * Saring DAFTAR bagian embed (sampai 10 embed per pesan).
 *
 * Menerima satu objek juga — bentuk lama, dan bentuk yang lebih wajar dikirim
 * tangan ke API. Hasilnya selalu daftar, supaya pemanggil tidak perlu dua
 * cabang. Embed yang seluruh isinya kosong dibuang seluruhnya.
 */
export function sanitizeEmbedList(input: unknown): { list: EmbedExtra[]; dropped: string[] } {
  const dropped: string[] = [];
  const sumber = Array.isArray(input) ? input : input === null || input === undefined ? [] : [input];
  const list: EmbedExtra[] = [];

  for (const satu of sumber) {
    const hasil = sanitizeEmbedExtra(satu);
    for (const alasan of hasil.dropped) dropped.push(alasan);
    if (embedExtraKosong(hasil.extra)) continue;
    if (list.length >= 10) {
      dropped.push('embed dibatasi 10 per pesan (batas Discord)');
      break;
    }
    list.push(hasil.extra);
  }
  return { list, dropped };
}

const BATAS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
  author: 256,
  total: 6000,
  /**
   * Batas Discord: 10 embed per pesan, totalnya 6000 karakter.
   *
   * Discohook memakai angka yang sama (tombol Add Embed berhenti di 10), jadi
   * dokumen yang diimpor dari sana tidak terpotong di sini.
   */
  embeds: 10,
} as const;

/** Blok teks yang dipakai membangun embed (bentuk dari `PostBlock`). */
export interface EmbedBlock {
  kind: string;
  value?: string;
  url?: string;
  data?: string | null;
  thumbnail?: string;
  spoiler?: boolean;
  name?: string | null;
}

function potong(teks: string, batas: number): string {
  return teks.length <= batas ? teks : `${teks.slice(0, batas - 1)}…`;
}

/**
 * Bangun embed dari blok pesan.
 *
 * Mengembalikan `null` kalau tidak ada isi yang bisa masuk embed — pemanggil
 * harus memberi tahu admin, bukan mengirim pesan kosong yang ditolak Discord.
 */
export function buildClassicEmbed(
  blocks: EmbedBlock[],
  opsi: BuildEmbedOptions = {},
): EmbedBuildResult | null {
  return buildClassicEmbeds(blocks, opsi)[0] ?? null;
}

/**
 * Sampai 10 embed dalam satu pesan — batas Discord, dan sama dengan tombol
 * Add Embed di Discohook.
 *
 * Embed pertama tetap dibangun dari blok (judul, isi, gambar, thumbnail) lalu
 * dilengkapi bagian admin, persis seperti sebelumnya. Embed kedua dan
 * seterusnya hanya berasal dari bagian admin: blok pesan menggambarkan SATU
 * pesan, dan menyalin isinya ke semua embed akan mengulang teks yang sama.
 *
 * Embed yang tidak punya isi sama sekali DIBUANG (bukan dikirim kosong —
 * Discord menolak seluruh pesannya), dan alasannya dilaporkan.
 */
export function buildClassicEmbeds(
  blocks: EmbedBlock[],
  opsi: BuildEmbedOptions = {},
): EmbedBuildResult[] {
  const ekstra = Array.isArray(opsi.embedList) && opsi.embedList.length ? opsi.embedList : null;
  const utama = ekstra ? ekstra[0] ?? null : (opsi.extra ?? null);

  const hasil: EmbedBuildResult[] = [];
  const pertama = blocksToEmbed(blocks, { ...opsi, extra: utama });
  if (pertama) hasil.push(pertama);
  /*
   * Blok bisa saja tidak menghasilkan embed (mis. pesan hanya berisi tombol),
   * padahal admin mengisi bagian embed. Tanpa cabang ini, embed PERTAMA milik
   * admin ikut hilang — bukan cuma bloknya.
   */
  else if (ekstra) {
    const satu = bagianAdminSaja(ekstra[0] ?? null, opsi.template ?? null);
    if (satu) hasil.push(satu);
  }

  /*
   * Embed tambahan hanya lahir kalau admin memang mengirim daftar. `extra`
   * tunggal tetap berarti satu embed, supaya pemanggil lama tidak berubah
   * perilakunya.
   */
  if (ekstra) {
    for (let i = 1; i < ekstra.length; i += 1) {
      const satu = bagianAdminSaja(ekstra[i] ?? null, opsi.template ?? null);
      if (satu) hasil.push(satu);
      else {
        /*
         * Embed yang hanya berisi penulis/footer/warna TIDAK cukup bagi
         * Discord: harus ada judul, isi, gambar, atau bidang. Membuangnya
         * diam-diam membuat admin mengira embednya terkirim, jadi alasannya
         * dilaporkan di embed pertama.
         */
        const catatan = `embed ${i + 1} dilewati: tidak punya judul, isi, gambar, atau bidang`;
        if (hasil.length) hasil[0]!.dropped.push(catatan);
      }
    }
    if (ekstra.length > BATAS.embeds) {
      hasil.length = Math.min(hasil.length, BATAS.embeds);
      if (hasil.length) {
        hasil[0]!.dropped.push(`embed dibatasi ${BATAS.embeds} per pesan (batas Discord)`);
      }
    }
  }

  return hasil;
}

/** Embed murni dari bagian admin (dipakai untuk embed ke-2 dan seterusnya). */
function bagianAdminSaja(
  extra: EmbedExtra | null,
  template: Record<string, string> | null,
): EmbedBuildResult | null {
  if (!extra || embedExtraKosong(extra)) return null;
  const dropped: string[] = [];
  const embed: ClassicEmbed = {};
  terapkanExtra(embed, extra, template);
  /*
   * Embed tanpa judul/isi/gambar sama sekali tidak bisa dikirim Discord. Bidang
   * saja DITERIMA — itu kasus umum "tabel kecil" di embed kedua.
   */
  if (!embed.title && !embed.description && !embed.image && !(embed.fields?.length ?? 0)) {
    return null;
  }
  jagaTotal(embed, dropped);
  return { embed, dropped };
}

interface BuildEmbedOptions {
  accent?: string | null;
  title?: string | null;
  /**
   * Bagian yang diisi admin: URL judul, penulis, footer, bidang, stempel
   * waktu. Sudah disaring `sanitizeEmbedExtra` sebelum sampai ke sini —
   * fungsi ini tidak memotong lagi, supaya tidak ada dua tempat yang bisa
   * berbeda pendapat soal batas.
   */
  extra?: EmbedExtra | null;
  /** Nilai template untuk teks admin ({member.name}, {var.*}, …). */
  template?: Record<string, string> | null;
  /**
   * Daftar bagian admin untuk beberapa embed sekaligus. Kalau diisi, elemen
   * pertama menggantikan `extra` dan sisanya menjadi embed tambahan.
   */
  embedList?: EmbedExtra[] | null;
}

function blocksToEmbed(blocks: EmbedBlock[], opsi: BuildEmbedOptions): EmbedBuildResult | null {
  const dropped: string[] = [];
  const embed: ClassicEmbed = {};

  /* ---------- judul & warna dari pengaturan pesan, bukan dari blok ---------- */
  const judul = (opsi.title ?? '').trim();
  if (judul) embed.title = potong(judul, BATAS.title);
  const warna = warnaDari(opsi.accent);
  if (warna !== null) embed.color = warna;

  /* ---------- teks → description ---------- */
  const bagian: string[] = [];
  for (const blok of blocks) {
    if (blok.kind === 'text' && String(blok.value ?? '').trim()) {
      bagian.push(String(blok.value));
      continue;
    }
    if (blok.kind === 'section' && String(blok.value ?? '').trim()) {
      bagian.push(String(blok.value));
      continue;
    }
    if (blok.kind === 'separator') {
      // Pemisah tidak punya bentuk di embed; jarak baris adalah padanannya.
      if (bagian.length && bagian[bagian.length - 1] !== '') bagian.push('');
      continue;
    }
    if (blok.kind === 'image') {
      const url = String(blok.url ?? blok.value ?? '').trim();
      if (!url) continue;
      if (embed.image) {
        // Embed hanya punya SATU gambar besar. Menimpa diam-diam akan
        // menghilangkan gambar yang sudah dipilih admin.
        dropped.push('gambar kedua dan seterusnya tidak muat di embed (maksimal satu)');
        continue;
      }
      embed.image = { url };
      continue;
    }
    if (blok.kind === 'file') {
      dropped.push('berkas jadi lampiran, bukan bagian embed');
      continue;
    }
    if (blok.kind === 'button' || blok.kind === 'select') {
      dropped.push('tombol/menu dikirim di luar embed (tetap bisa diklik)');
      continue;
    }
    if (blok.kind === 'container' || blok.kind === 'close' || blok.kind === 'row') {
      // Penanda struktur Components V2 — tidak ada artinya di embed.
      continue;
    }
  }

  /* ---------- gambar kecil (thumbnail): dari section beraksesori ---------- */
  const thumbnail = blocks.find(
    (blok) => blok.kind === 'section' && String(blok.thumbnail ?? '').trim(),
  )?.thumbnail;
  if (thumbnail) embed.thumbnail = { url: thumbnail };

  const isi = bagian.join('\n').trim();
  if (isi) embed.description = potong(isi, BATAS.description);

  /* ---------- bagian yang diisi admin ---------- */
  terapkanExtra(embed, opsi.extra ?? null, opsi.template ?? null);

  if (!embed.title && !embed.description && !embed.image && !(embed.fields?.length ?? 0)) {
    return null;
  }

  jagaTotal(embed, dropped);
  return { embed, dropped };
}

/**
 * Salin bagian admin ke embed, dengan template.
 *
 * Dipisah karena dipakai dua jalur: embed pertama (yang juga membawa blok) dan
 * embed tambahan (yang hanya berisi bagian admin).
 */
function terapkanExtra(
  embed: ClassicEmbed,
  extra: EmbedExtra | null,
  template: Record<string, string> | null,
): void {
  if (!extra) return;
  /*
   * Template berlaku juga di sini: footer "dikirim oleh {member.name}" pada
   * pesan yang dipicu member masuk harus terisi, bukan tercetak mentah.
   * Token yang tidak dikenal DIBIARKAN apa adanya, sama seperti di blok.
   */
  const isiTemplate = (nilai: string): string => applyTemplate(nilai, template ?? {});

  if (extra.url) embed.url = extra.url;
  if (extra.timestamp) embed.timestamp = extra.timestamp;
  /*
   * Warna per embed menang atas aksen pesan: admin yang mengisi warna untuk
   * satu embed berarti memang ingin embed itu beda.
   */
  const warna = warnaDari(extra.color);
  if (warna !== null) embed.color = warna;
  if (extra.author?.name) {
    embed.author = {
      name: isiTemplate(extra.author.name),
      ...(extra.author.url ? { url: extra.author.url } : {}),
      ...(extra.author.icon_url ? { icon_url: extra.author.icon_url } : {}),
    };
  }
  if (extra.footer?.text) {
    embed.footer = {
      text: isiTemplate(extra.footer.text),
      ...(extra.footer.icon_url ? { icon_url: extra.footer.icon_url } : {}),
    };
  }
  if (extra.fields?.length) {
    embed.fields = extra.fields.map((field) => ({
      name: isiTemplate(field.name),
      value: isiTemplate(field.value),
      inline: field.inline,
    }));
  }
}

/**
 * Jaga total 6000 karakter untuk SATU embed.
 *
 * Batas ini berlaku untuk seluruh embed (judul + isi + penulis + footer +
 * bidang), dan Discord menjumlahkannya lagi untuk semua embed dalam satu pesan
 * — itu diperiksa `validateEmbeds`. Kalau bagian admin yang membuatnya
 * melewati batas, deskripsi yang dipotong: bagian admin ditulis tangan admin
 * sendiri, sedangkan deskripsi sering berupa blok panjang yang bisa dipindah.
 */
function jagaTotal(embed: ClassicEmbed, dropped: string[]): void {
  const panjangAdmin =
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((jumlah, field) => jumlah + field.name.length + field.value.length, 0);
  const total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + panjangAdmin;
  if (total > BATAS.total && embed.description) {
    const sisa = BATAS.total - (embed.title?.length ?? 0) - panjangAdmin;
    embed.description = potong(embed.description, Math.max(0, sisa));
    dropped.push(`isi dipotong agar muat batas ${BATAS.total} karakter embed`);
  }
}

/** `#rrggbb` → angka warna Discord. Null = tanpa warna (embed abu-abu). */
export function warnaDari(accent: string | null | undefined): number | null {
  const teks = (accent ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(teks)) return null;
  return Number.parseInt(teks, 16);
}

/**
 * Validasi beberapa embed sekaligus.
 *
 * Dua aturan tambahan yang hanya berlaku untuk pesan berisi lebih dari satu
 * embed — dan keduanya ditolak Discord untuk SELURUH pesan, bukan hanya embed
 * yang salah:
 *   - maksimal 10 embed per pesan;
 *   - jumlah karakter semua embed maksimal 6000.
 */
export function validateEmbeds(embeds: ClassicEmbed[]): string[] {
  const masalah: string[] = [];
  if (embeds.length === 0) masalah.push('pesan tidak punya embed yang bisa dikirim');
  if (embeds.length > BATAS.embeds) masalah.push(`embed lebih dari ${BATAS.embeds} per pesan`);
  embeds.forEach((embed, i) => {
    for (const satu of validateEmbed(embed)) masalah.push(`embed ${i + 1}: ${satu}`);
  });
  const total = embeds.reduce((jumlah, embed) => jumlah + panjangEmbed(embed), 0);
  if (total > BATAS.total) masalah.push(`semua embed lebih dari ${BATAS.total} karakter (${total})`);
  return masalah;
}

/** Panjang satu embed menurut hitungan Discord (judul, isi, penulis, footer, bidang). */
export function panjangEmbed(embed: ClassicEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((jumlah, field) => jumlah + field.name.length + field.value.length, 0)
  );
}

/**
 * Validasi embed sebelum dikirim: mengembalikan daftar masalah, bukan melempar.
 *
 * Dipakai dashboard (menampilkan peringatan) dan server (menolak kirim).
 * Alasannya sama seperti `measureBlocks`: API bisa dipanggil langsung, jadi
 * aturan ini tidak boleh hanya hidup di browser.
 */
export function validateEmbed(embed: ClassicEmbed): string[] {
  const masalah: string[] = [];
  if (embed.title && embed.title.length > BATAS.title) masalah.push(`judul lebih dari ${BATAS.title} karakter`);
  if (embed.description && embed.description.length > BATAS.description) {
    masalah.push(`isi lebih dari ${BATAS.description} karakter`);
  }
  if ((embed.fields?.length ?? 0) > BATAS.fields) masalah.push(`bidang lebih dari ${BATAS.fields}`);
  for (const field of embed.fields ?? []) {
    if (field.name.length > BATAS.fieldName) masalah.push(`nama bidang "${field.name.slice(0, 20)}…" kepanjangan`);
    if (field.value.length > BATAS.fieldValue) masalah.push(`isi bidang "${field.name.slice(0, 20)}…" kepanjangan`);
  }
  if (!embed.title && !embed.description && !embed.image && !(embed.fields?.length ?? 0)) {
    masalah.push('embed tidak punya isi yang bisa dikirim');
  }
  return masalah;
}
