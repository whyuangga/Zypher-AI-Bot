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
  author?: { name: string; url?: string; icon_url?: string };
  footer?: { text: string; icon_url?: string };
  fields?: EmbedField[];
  /** ISO 8601. Kosong = tanpa stempel waktu. */
  timestamp?: string;
}

const BATAS_EXTRA = {
  url: 2048,
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
    !extra.timestamp
  );
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
  opsi: {
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
  } = {},
): EmbedBuildResult | null {
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
  const extra = opsi.extra ?? null;
  if (extra) {
    /*
     * Template berlaku juga di sini: footer "dikirim oleh {member.name}" pada
     * pesan yang dipicu member masuk harus terisi, bukan tercetak mentah.
     * Token yang tidak dikenal DIBIARKAN apa adanya, sama seperti di blok.
     */
    const isiTemplate = (nilai: string): string => {
      const tabel = opsi.template;
      if (!tabel) return nilai;
      let hasil = nilai;
      for (const [token, isiToken] of Object.entries(tabel)) {
        hasil = hasil.split(`{${token}}`).join(isiToken);
      }
      return hasil;
    };

    if (extra.url) embed.url = extra.url;
    if (extra.timestamp) embed.timestamp = extra.timestamp;
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

  if (!embed.title && !embed.description && !embed.image && !(embed.fields?.length ?? 0)) {
    return null;
  }

  /*
   * Batas total 6000 karakter untuk seluruh embed. Kalau kelebihan, deskripsi
   * yang dipotong lebih dulu (judul & gambar tetap utuh): deskripsi paling
   * sering panjang, dan memotong tanpa laporan akan menyembunyikan bagian
   * pesan yang hilang.
   */
  /*
   * Batas 6000 karakter berlaku untuk SELURUH embed, bukan hanya judul +
   * deskripsi: penulis, footer, dan bidang ikut dihitung Discord. Kalau
   * bagian admin yang membuatnya melewati batas, deskripsi lagi yang dipotong
   * — bagian admin sengaja yang ditulis tangan admin sendiri, sedangkan
   * deskripsi sering berupa blok panjang yang bisa dipindah ke pesan lain.
   */
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

  return { embed, dropped };
}

/** `#rrggbb` → angka warna Discord. Null = tanpa warna (embed abu-abu). */
export function warnaDari(accent: string | null | undefined): number | null {
  const teks = (accent ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(teks)) return null;
  return Number.parseInt(teks, 16);
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
