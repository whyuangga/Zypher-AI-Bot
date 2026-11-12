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
  opsi: { accent?: string | null; title?: string | null } = {},
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

  if (!embed.title && !embed.description && !embed.image) return null;

  /*
   * Batas total 6000 karakter untuk seluruh embed. Kalau kelebihan, deskripsi
   * yang dipotong lebih dulu (judul & gambar tetap utuh): deskripsi paling
   * sering panjang, dan memotong tanpa laporan akan menyembunyikan bagian
   * pesan yang hilang.
   */
  const total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
  if (total > BATAS.total && embed.description) {
    const sisa = BATAS.total - (embed.title?.length ?? 0);
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
