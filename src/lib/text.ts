/** Batas keras pesan Discord. */
export const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_LIMIT = 1900;

/**
 * Pecah teks panjang jadi beberapa bagian yang aman untuk Discord,
 * sebisa mungkin tanpa memotong blok kode di tengah.
 */
export function chunkMessage(text: string, limit = SAFE_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.6) cut = remaining.lastIndexOf(' ', limit);
    if (cut < limit * 0.6) cut = limit;

    const piece = remaining.slice(0, cut).trimEnd();
    if (piece) chunks.push(piece);
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) chunks.push(remaining);

  // Kalau jumlah backtick ganjil, tutup fence supaya format tidak rusak.
  return chunks.map((chunk) => {
    const fences = (chunk.match(/```/g) ?? []).length;
    return fences % 2 === 1 ? `${chunk}\n\`\`\`` : chunk;
  });
}

/** Potong teks dengan penanda elipsis yang jelas. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Normalisasi teks untuk pencocokan keyword: huruf kecil, tanpa tanda baca. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ringkas daftar jadi string berkomah, aman untuk embed. */
export function joinList(items: string[], max = 10): string {
  if (items.length === 0) return '-';
  const shown = items.slice(0, max);
  const suffix = items.length > max ? ` +${items.length - max} lainnya` : '';
  return shown.join(', ') + suffix;
}
