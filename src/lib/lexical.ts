/**
 * Pencarian leksikal (BM25) tanpa dependensi & tanpa API key.
 *
 * Dipakai RAG sebagai mesin pencari utama: untuk korpus dokumen komunitas
 * (puluhan sampai ribuan potongan teks) hasilnya sudah sangat memadai, jalan
 * offline, dan gratis. Kalau embeddings dikonfigurasi, skor BM25 digabung
 * dengan kemiripan vektor (hybrid) di `features/rag.ts`.
 */

/** Kata yang terlalu umum untuk membedakan dokumen (Indonesia + Inggris). */
const STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'pada', 'adalah', 'akan', 'atau',
  'juga', 'dalam', 'karena', 'bisa', 'dapat', 'tidak', 'tak', 'sudah', 'belum', 'masih', 'agar', 'supaya',
  'saya', 'aku', 'kamu', 'anda', 'kita', 'kami', 'mereka', 'dia', 'ia', 'para', 'nya', 'kah', 'lah', 'pun',
  'ada', 'oleh', 'sebagai', 'saat', 'ketika', 'kalau', 'jika', 'maka', 'saja', 'hanya', 'lagi', 'sangat',
  'lebih', 'paling', 'banyak', 'semua', 'tiap', 'setiap', 'antara', 'tentang', 'bagi', 'per', 'hal',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'you', 'your', 'our', 'but',
  'not', 'can', 'will', 'have', 'has', 'had', 'they', 'them', 'there', 'their', 'what', 'which', 'when',
  'how', 'why', 'who', 'all', 'any', 'one', 'out', 'into', 'about', 'than', 'then', 'its', 'it', 'is',
]);

/** Akhiran yang tidak mengubah makna penting (imbuhan ringan bahasa Indonesia). */
const SUFFIXES = ['kannya', 'annya', 'nya', 'kah', 'lah', 'pun', 'ku', 'mu'];
/** Prefiks yang sering muncul; dipangkas hati-hati supaya tidak merusak kata pendek. */
const PREFIXES = ['meng', 'meny', 'mem', 'men', 'ber', 'ter', 'per', 'pen', 'pem', 'di', 'ke', 'se', 'me'];

/** Normalisasi + pemotongan imbuhan sederhana. Hasilnya bukan kata baku, hanya kunci pencarian. */
export function stem(word: string): string {
  let result = word;

  for (const suffix of SUFFIXES) {
    if (result.length - suffix.length >= 4 && result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }

  // Sisakan minimal 5 huruf setelah prefiks dibuang, supaya kata akar seperti
  // "memori" tidak rusak jadi "mori" (imbuhan dilepas hanya kalau aman).
  for (const prefix of PREFIXES) {
    if (result.length - prefix.length >= 5 && result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break;
    }
  }

  return result;
}

/** Pecah teks jadi token siap dicari: huruf kecil, tanpa tanda baca, tanpa stopword. */
export function tokenize(text: string): string[] {
  const clean = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');

  const tokens: string[] = [];
  for (const raw of clean.split(' ')) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.push(stem(raw));
  }
  return tokens;
}

export interface LexicalDocument {
  id: number;
  text: string;
}

export interface LexicalHit {
  id: number;
  score: number;
}

interface IndexedDocument {
  id: number;
  tokens: string[];
  length: number;
  termFreq: Map<string, number>;
}

const K1 = 1.5;
const B = 0.75;

/**
 * Indeks BM25 sederhana. Dibangun ulang saat dokumen berubah — cukup murah
 * untuk korpus ribuan potongan, dan tidak butuh penyimpanan tambahan.
 */
export class Bm25Index {
  private readonly documents: IndexedDocument[] = [];
  private readonly documentFreq = new Map<string, number>();
  private averageLength = 0;

  constructor(documents: LexicalDocument[]) {
    let totalLength = 0;

    for (const document of documents) {
      const tokens = tokenize(document.text);
      if (tokens.length === 0) continue;

      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      for (const term of termFreq.keys()) {
        this.documentFreq.set(term, (this.documentFreq.get(term) ?? 0) + 1);
      }

      this.documents.push({ id: document.id, tokens, length: tokens.length, termFreq });
      totalLength += tokens.length;
    }

    this.averageLength = this.documents.length > 0 ? totalLength / this.documents.length : 0;
  }

  get size(): number {
    return this.documents.length;
  }

  search(query: string, limit = 5): LexicalHit[] {
    const terms = tokenize(query);
    if (terms.length === 0 || this.documents.length === 0) return [];

    const total = this.documents.length;
    const scores = new Map<number, number>();
    // Term yang sama tidak dihitung dua kali; pakai set supaya "promo promo" tidak mendominasi.
    const uniqueTerms = [...new Set(terms)];

    for (const term of uniqueTerms) {
      const df = this.documentFreq.get(term) ?? 0;
      if (df === 0) continue;

      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));

      for (const document of this.documents) {
        const tf = document.termFreq.get(term);
        if (!tf) continue;

        const norm = tf + K1 * (1 - B + (B * document.length) / (this.averageLength || 1));
        const contribution = idf * ((tf * (K1 + 1)) / norm);
        scores.set(document.id, (scores.get(document.id) ?? 0) + contribution);
      }
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** Kemiripan kosinus dua vektor; 0 kalau salah satunya nol/kosong. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
