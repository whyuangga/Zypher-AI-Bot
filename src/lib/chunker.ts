/**
 * Ekstraksi teks + pemotongan dokumen untuk RAG.
 *
 * Semua fungsi di sini murni (tanpa database/Discord) supaya mudah diuji.
 * Teks biasa dibaca langsung; PDF (via `unpdf`) dan DOCX (via `fflate`, cukup
 * membaca `word/document.xml`) diekstrak jadi teks. Format biner lain ditolak
 * dengan pesan yang jelas daripada dipaksa dibaca dan menghasilkan teks sampah.
 *
 * Library berat diimpor secara lazy supaya proses bot tetap ringan walau
 * tidak pernah upload PDF, dan panel hosting 512 MB tidak kaget.
 */

/** Ekstensi yang teksnya bisa dibaca langsung. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml',
  'log', 'html', 'htm', 'xml', 'ini', 'conf', 'env', 'sql', 'ts', 'js', 'tsx', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'php', 'sh', 'css',
]);

/** Format populer yang belum didukung — beri saran konversi, jangan tebak-tebakan. */
const KNOWN_BINARY: Record<string, string> = {
  doc: 'Word 97-2003 (.doc)',
  xlsx: 'Excel',
  xls: 'Excel',
  pptx: 'PowerPoint',
  odt: 'OpenDocument',
  rtf: 'RTF',
  epub: 'EPUB',
};

/** Batas ukuran berkas biner sebelum diekstrak (proteksi RAM panel 512 MB). */
export const MAX_BINARY_BYTES = 8 * 1024 * 1024;

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

export function extensionOf(fileName: string): string {
  const clean = fileName.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1);
}

/** Buang tag HTML/XML, decode entitas umum, rapikan spasi berlebih. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Rapikan teks hasil upload: buang karakter kontrol & baris kosong berlebihan. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Ubah isi file jadi teks siap diindeks.
 * Melempar `DocumentError` dengan pesan yang bisa langsung ditampilkan ke user.
 */
export function extractText(fileName: string, content: string | Uint8Array): string {
  const extension = extensionOf(fileName);

  if (KNOWN_BINARY[extension]) {
    throw new DocumentError(
      `Format **${KNOWN_BINARY[extension]}** belum didukung. Ubah dulu ke teks (.txt atau .md), lalu upload lagi.`,
    );
  }

  if (extension && !TEXT_EXTENSIONS.has(extension)) {
    throw new DocumentError(
      `Ekstensi \`.${extension}\` tidak dikenali. Format yang didukung: .txt, .md, .csv, .json, .html, .log, .pdf, .docx.`,
    );
  }

  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw new DocumentError(
        'File ini sepertinya bukan teks UTF-8 (mungkin biner). Simpan ulang sebagai .txt lalu upload lagi.',
      );
    }
  }

  const cleaned = normalizeText(extension === 'html' || extension === 'htm' || extension === 'xml' ? htmlToText(text) : text);

  if (cleaned.length < 20) {
    throw new DocumentError('Isinya terlalu pendek untuk dijadikan dokumen (minimal 20 karakter).');
  }

  return cleaned;
}

/** Buang huruf yang tidak bisa dipakai diukur + pastikan hasilnya cukup panjang. */
function finishExtraction(raw: string, extension: string): string {
  const cleaned = normalizeText(raw);
  if (cleaned.length < 20) {
    throw new DocumentError(
      extension === 'pdf'
        ? 'PDF ini tidak mengandung teks yang bisa dibaca (biasanya hasil scan/gambar). OCR dulu atau ubah ke teks (.txt/.md).'
        : 'Isinya terlalu pendek untuk dijadikan dokumen (minimal 20 karakter).',
    );
  }
  return cleaned;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  // Salin ke Uint8Array baru: pdf.js membaca `data.buffer` dan mengabaikan byteOffset,
  // jadi Buffer dari Node (yang menumpang ArrayBuffer bersama) bisa terbaca sebagai file rusak.
  return new Uint8Array(content);
}

/** PDF -> teks. Butuh `unpdf` (pdf.js versi server, tanpa dependency native). */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new DocumentError('File PDF kosong.');
  if (bytes.byteLength > MAX_BINARY_BYTES) {
    throw new DocumentError(
      `PDF-nya terlalu besar (${Math.round(bytes.byteLength / 1024 / 1024)} MB). Batasnya 8 MB — pecah dulu filenya.`,
    );
  }

  let unpdf: typeof import('unpdf');
  try {
    unpdf = await import('unpdf');
  } catch {
    throw new DocumentError('Dukungan PDF belum terpasang di server ini. Jalankan `npm install` lalu coba lagi.');
  }

  try {
    const pdf = await unpdf.getDocumentProxy(bytes);
    const result = await unpdf.extractText(pdf, { mergePages: true });
    return Array.isArray(result.text) ? result.text.join('\n\n') : result.text;
  } catch (error) {
    // Jangan bocorkan stack trace pdf.js ke user; cukup jelaskan kemungkinan penyebabnya.
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(
      'PDF ini tidak bisa dibuka — mungkin rusak atau terkunci password. Coba simpan ulang, atau ubah ke teks.',
    );
  }
}

/**
 * DOCX -> teks. DOCX hanyalah arsip ZIP berisi XML, jadi cukup `word/document.xml`
 * di-unzip lalu tag-nya dibuang (tanpa library konversi Word yang berat).
 */
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new DocumentError('File DOCX kosong.');
  if (bytes.byteLength > MAX_BINARY_BYTES) {
    throw new DocumentError(
      `File-nya terlalu besar (${Math.round(bytes.byteLength / 1024 / 1024)} MB). Batasnya 8 MB — pecah dulu filenya.`,
    );
  }

  let fflate: typeof import('fflate');
  try {
    fflate = await import('fflate');
  } catch {
    throw new DocumentError('Dukungan DOCX belum terpasang di server ini. Jalankan `npm install` lalu coba lagi.');
  }

  let files: Record<string, Uint8Array>;
  try {
    files = fflate.unzipSync(bytes);
  } catch {
    throw new DocumentError('File .docx rusak atau bukan dokumen Word yang valid. Coba simpan ulang dari Word/Google Docs.');
  }

  const documentXml = files['word/document.xml'];
  if (!documentXml) throw new DocumentError('File .docx ini tidak berisi teks dokumen Word (mungkin .doc lama yang di-rename).');

  const xml = fflate.strFromU8(documentXml);
  const text = xml
    .replace(/<w:tab[^>]*\/>/g, ' ')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return htmlToText(text);
}

/**
 * Versi async dari `extractText` yang juga menangani PDF/DOCX.
 * Dipakai jalur upload (Discord & dashboard).
 */
export async function extractFileText(fileName: string, content: string | Uint8Array): Promise<string> {
  const extension = extensionOf(fileName);

  if (extension === 'pdf') return finishExtraction(await extractPdfText(toBytes(content)), 'pdf');
  if (extension === 'docx') return finishExtraction(await extractDocxText(toBytes(content)), 'docx');
  return extractText(fileName, content);
}

export interface ChunkOptions {
  /** Target panjang potongan (karakter). */
  size?: number;
  /** Tumpang tindih antar potongan supaya konteks tidak terpotong tajam. */
  overlap?: number;
  /** Batas keras satu potongan. */
  maxSize?: number;
}

const DEFAULT_SIZE = 900;
const DEFAULT_OVERLAP = 150;
const DEFAULT_MAX = 1400;

/** Pecah satu blok panjang per kalimat (fallback per kata kalau kalimatnya kepanjangan). */
function splitLongBlock(block: string, maxSize: number): string[] {
  const sentences = block.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) pieces.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxSize) {
      flush();
      // Kalimat raksasa (tanpa titik) — potong per kata.
      let buffer = '';
      for (const word of sentence.split(/\s+/)) {
        if ((buffer + ' ' + word).trim().length > maxSize) {
          if (buffer.trim()) pieces.push(buffer.trim());
          buffer = word;
        } else {
          buffer = buffer ? `${buffer} ${word}` : word;
        }
      }
      if (buffer.trim()) pieces.push(buffer.trim());
      continue;
    }

    if ((current + ' ' + sentence).trim().length > maxSize) {
      flush();
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  flush();
  return pieces;
}

/**
 * Potong dokumen jadi bagian-bagian yang saling tumpang tindih.
 * Prioritas pemotongan: paragraf -> kalimat -> kata, supaya konteks tetap utuh.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const size = Math.max(200, options.size ?? DEFAULT_SIZE);
  const overlap = Math.min(Math.max(0, options.overlap ?? DEFAULT_OVERLAP), Math.floor(size / 2));
  const maxSize = Math.max(size, options.maxSize ?? DEFAULT_MAX);

  const blocks = normalizeText(text)
    .split(/\n{2,}/)
    .flatMap((block) => (block.length > maxSize ? splitLongBlock(block, size) : [block.trim()]))
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    // Bawa ekor potongan sebelumnya sebagai konteks untuk potongan berikutnya.
    current = overlap > 0 && trimmed.length > overlap ? trimmed.slice(-overlap) : '';
  };

  for (const block of blocks) {
    if (!current) {
      current = block;
      continue;
    }

    if (current.length + block.length + 2 <= size) {
      current = `${current}\n\n${block}`;
      continue;
    }

    push();

    if (block.length > maxSize) {
      // Blok masih terlalu panjang setelah dipecah; masukkan potongan-potongannya satu per satu.
      for (const piece of splitLongBlock(block, size)) {
        if (current.length + piece.length + 2 > size) push();
        current = current ? `${current}\n\n${piece}` : piece;
      }
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((chunk) => chunk.length >= 20);
}
