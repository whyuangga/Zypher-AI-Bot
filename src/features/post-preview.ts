/**
 * Susun pratinjau pesan /pesan TANPA browser.
 *
 * Kenapa di server, bukan digambar langsung di browser: pratinjau dan pesan
 * yang benar-benar dikirim harus berasal dari sumber yang SAMA. Kalau pratinjau
 * digambar ulang dengan JavaScript terpisah, cepat atau lambat keduanya
 * berbeda — dan pratinjau yang berbohong lebih buruk daripada tidak ada
 * pratinjau.
 *
 * Modul ini murni: blok masuk, blok pratinjau keluar. `custom-post-send.ts`
 * memakai `buildPostPayload`, halaman memakai modul ini; keduanya membaca
 * `PostBlock` yang sama.
 */
import {
  DEFAULT_ACCENT,
  LIMITS,
  normalizeAccent,
  type PostBlock,
} from './custom-post.js';

/** Satu butir pratinjau — bentuknya sengaja mirip ContainerBlock. */
export type PreviewBlock =
  | { kind: 'text'; text: string; small: boolean }
  | { kind: 'separator' }
  | { kind: 'image'; url: string | null; uploadName: string | null }
  | { kind: 'buttons'; buttons: Array<{ id: number; label: string; role: boolean }> };

export interface PostPreview {
  accentColor: string;
  blocks: PreviewBlock[];
  /** true kalau isi cuma pemisah — Discord akan menolaknya. */
  empty: boolean;
}

/**
 * Apakah baris teks adalah "teks kecil" Discord.
 *
 * `-#` di awal baris membuat teks kecil dan redup. Penandanya tetap dibuang
 * di pratinjau, sama seperti yang dilakukan Discord.
 */
function isSmall(text: string): boolean {
  return /^\s*-#/.test(text);
}

/**
 * Ubah blok pesan menjadi blok pratinjau.
 *
 * Dua hal yang ditiru dari Discord dan sering dilupakan:
 *   - Tombol dikumpulkan 5 per baris (bukan satu tombol satu baris).
 *   - Tombol role selalu di baris PALING BAWAH, sesudah semua isi.
 */
export function buildPostPreview(
  blocks: PostBlock[],
  options: {
    accent?: string;
    roleButtons?: Array<{ id: number; label: string }>;
  } = {},
): PostPreview {
  const out: PreviewBlock[] = [];
  let tombolTertunda: PostBlock[] = [];

  const flush = (): void => {
    for (let i = 0; i < tombolTertunda.length; i += LIMITS.buttonsPerRow) {
      const baris = tombolTertunda.slice(i, i + LIMITS.buttonsPerRow);
      out.push({
        kind: 'buttons',
        buttons: baris.map((b) => ({ id: 0, label: b.value, role: false })),
      });
    }
    tombolTertunda = [];
  };

  for (const block of blocks) {
    if (block.kind === 'button') {
      tombolTertunda.push(block);
      continue;
    }
    if (tombolTertunda.length > 0) flush();

    if (block.kind === 'divider') {
      out.push({ kind: 'separator' });
      continue;
    }
    if (block.kind === 'text') {
      out.push({ kind: 'text', text: block.value, small: isSmall(block.value) });
      continue;
    }
    if (block.kind === 'image') {
      out.push({
        kind: 'image',
        // Unggahan tidak punya URL publik; pratinjau menampilkan nama berkas
        // saja supaya jelas bahwa itu gambar unggahan, bukan tautan.
        url: block.data ? null : block.value,
        uploadName: block.data ? 'gambar unggahan' : null,
      });
    }
  }
  if (tombolTertunda.length > 0) flush();

  // Tombol role di baris paling bawah, sama seperti pesan sungguhan.
  const roleButtons = options.roleButtons ?? [];
  for (let i = 0; i < roleButtons.length; i += LIMITS.buttonsPerRow) {
    out.push({
      kind: 'buttons',
      buttons: roleButtons
        .slice(i, i + LIMITS.buttonsPerRow)
        .map((b) => ({ id: b.id, label: b.label, role: true })),
    });
  }

  return {
    // Kalau warna tidak sah, jangan tampilkan aksen yang salah — pakai bawaan.
    accentColor: normalizeAccent(options.accent ?? DEFAULT_ACCENT),
    blocks: out,
    // Discord menolak pesan yang isinya hanya pemisah.
    empty: !blocks.some((b) => b.kind === 'text' || b.kind === 'image'),
  };
}
