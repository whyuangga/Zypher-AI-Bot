/**
 * RAG (Retrieval-Augmented Generation) untuk pengetahuan server.
 *
 * Alur: dokumen (upload Discord/dashboard) -> diekstrak jadi teks -> dipotong
 * jadi chunk -> disimpan di SQLite. Setiap pertanyaan user, chunk paling relevan
 * dicari (BM25 + embeddings kalau tersedia), lalu diselipkan ke system prompt
 * sebagai rujukan. AI menjawab berdasarkan isi dokumen, bukan mengarang.
 */
import { config } from '../config.js';
import {
  deleteDocument as deleteDocumentRow,
  findDocumentByName,
  getDocument,
  insertChunks,
  insertDocument,
  listChunks,
  listDocuments,
  type ChunkWithDocument,
  type DocumentRecord,
} from '../db/repo.js';
import { chunkText, DocumentError, extractFileText } from '../lib/chunker.js';
import { Bm25Index, cosineSimilarity } from '../lib/lexical.js';
import { logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { embedTexts, embeddingModelName } from './rag-embed.js';

export { DocumentError };

export interface RetrievedChunk {
  documentId: number;
  documentName: string;
  ordinal: number;
  content: string;
  /** Skor gabungan 0..1 (bukan probabilitas, hanya untuk peringkat). */
  score: number;
  /** Dari mana skor datang: leksikal, vektor, atau keduanya. */
  via: 'lexical' | 'vector' | 'hybrid';
}

/* ------------------------------------------------------------------ */
/*  Cache indeks per server                                            */
/* ------------------------------------------------------------------ */

interface GuildIndex {
  chunks: ChunkWithDocument[];
  bm25: Bm25Index;
  signature: string;
}

const indexCache = new Map<string, GuildIndex>();

async function getIndex(guildId: string): Promise<GuildIndex> {
  const cached = indexCache.get(guildId);
  if (cached) return cached;

  const chunks = await listChunks(guildId);
  const index: GuildIndex = {
    chunks,
    bm25: new Bm25Index(chunks.map((chunk) => ({ id: chunk.id, text: chunk.content }))),
    signature: `${chunks.length}:${chunks[0]?.id ?? 0}`,
  };
  indexCache.set(guildId, index);
  return index;
}

export function invalidateIndex(guildId: string): void {
  indexCache.delete(guildId);
}

/* ------------------------------------------------------------------ */
/*  Ingest                                                             */
/* ------------------------------------------------------------------ */

export interface IngestResult {
  document: DocumentRecord;
  chunkCount: number;
  embedded: boolean;
}

/**
 * Tambah dokumen ke pengetahuan server.
 * Nama yang sama akan MENGGANTI dokumen lama (re-upload = update, bukan duplikat).
 */
export async function ingestDocument(input: {
  guildId: string;
  name: string;
  content: string | Uint8Array;
  createdBy?: string | null;
  source?: string;
}): Promise<IngestResult> {
  const name = input.name.trim().slice(0, 120) || 'dokumen.txt';
  const text = await extractFileText(name, input.content);

  if (text.length > config.rag.maxChars) {
    throw new DocumentError(
      `Dokumen terlalu besar (${Math.round(text.length / 1000)} ribu karakter). Batasnya ${Math.round(
        config.rag.maxChars / 1000,
      )} ribu karakter — pecah jadi beberapa file dulu ya.`,
    );
  }

  const pieces = chunkText(text, { size: config.rag.chunkSize, overlap: config.rag.chunkOverlap });
  if (pieces.length === 0) throw new DocumentError('Dokumen tidak menghasilkan potongan teks yang bisa diindeks.');

  const vectors = await embedTexts(pieces);

  const existing = await findDocumentByName(input.guildId, name);
  if (existing) await deleteDocumentRow(input.guildId, existing.id);

  const documentId = await insertDocument({
    guildId: input.guildId,
    name,
    source: input.source ?? 'upload',
    chars: text.length,
    createdBy: input.createdBy ?? null,
  });

  await insertChunks(
    documentId,
    input.guildId,
    pieces.map((content, index) => ({ content, embedding: vectors?.[index] ?? null })),
  );

  invalidateIndex(input.guildId);

  const document = await getDocument(input.guildId, documentId);
  logger.info(
    `RAG: "${name}" diindeks untuk ${input.guildId} — ${pieces.length} potongan${vectors ? ' (vektor)' : ' (leksikal)'}${
      existing ? ' [menggantikan versi lama]' : ''
    }`,
  );

  return {
    document: document ?? {
      id: documentId,
      guildId: input.guildId,
      name,
      source: input.source ?? 'upload',
      chars: text.length,
      chunkCount: pieces.length,
      createdBy: input.createdBy ?? null,
      createdAt: Date.now(),
    },
    chunkCount: pieces.length,
    embedded: Boolean(vectors),
  };
}

export async function removeDocument(guildId: string, id: number): Promise<boolean> {
  const removed = await deleteDocumentRow(guildId, id);
  if (removed) invalidateIndex(guildId);
  return removed;
}

export async function listGuildDocuments(guildId: string): Promise<DocumentRecord[]> {
  return listDocuments(guildId);
}

/* ------------------------------------------------------------------ */
/*  Pencarian                                                          */
/* ------------------------------------------------------------------ */

export interface SearchOptions {
  topK?: number;
  /** Buang hasil yang skornya jauh di bawah hasil terbaik. */
  minRelative?: number;
}

/**
 * Cari potongan paling relevan untuk sebuah pertanyaan.
 * Menggabungkan BM25 (selalu ada) dengan kemiripan vektor (kalau embeddings aktif).
 */
export async function searchKnowledge(
  guildId: string,
  query: string,
  options: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  if (!config.rag.enabled || !query.trim()) return [];

  const index = await getIndex(guildId);
  if (index.bm25.size === 0) return [];

  const topK = Math.max(1, options.topK ?? config.rag.topK);
  const minRelative = options.minRelative ?? 0.35;

  // Ambil kandidat lebih banyak dari BM25, lalu peringkat diulang dengan skor gabungan.
  const lexicalHits = index.bm25.search(query, Math.max(topK * 4, 12));
  const lexicalByChunk = new Map(lexicalHits.map((hit) => [hit.id, hit.score]));
  const bestLexical = lexicalHits[0]?.score ?? 0;

  let semanticByChunk = new Map<number, number>();
  const modelName = embeddingModelName();

  if (modelName) {
    const [queryVector] = (await embedTexts([query])) ?? [];
    if (queryVector) {
      const withVectors = (await getIndex(guildId)).chunks.filter((chunk) => chunk.embedding);
      const scored = withVectors.map((chunk) => {
        let vector: number[] = [];
        try {
          vector = JSON.parse(chunk.embedding ?? '[]') as number[];
        } catch {
          vector = [];
        }
        return { id: chunk.id, score: cosineSimilarity(queryVector, vector) };
      });
      semanticByChunk = new Map(scored.filter((hit) => hit.score > 0.2).map((hit) => [hit.id, hit.score]));
    }
  }

  const candidateIds = new Set<number>([...lexicalByChunk.keys(), ...semanticByChunk.keys()]);
  if (candidateIds.size === 0) return [];

  const byId = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
  const scored: RetrievedChunk[] = [];

  for (const id of candidateIds) {
    const chunk = byId.get(id);
    if (!chunk) continue;

    const lexicalScore = lexicalByChunk.get(id) ?? 0;
    const normalLexical = bestLexical > 0 ? lexicalScore / bestLexical : 0;
    const semanticScore = semanticByChunk.get(id) ?? 0;

    const both = normalLexical > 0 && semanticScore > 0;
    const score = both ? 0.6 * semanticScore + 0.4 * normalLexical : semanticScore > 0 ? semanticScore : normalLexical;

    scored.push({
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      ordinal: chunk.ordinal,
      content: chunk.content,
      score,
      via: both ? 'hybrid' : semanticScore > 0 ? 'vector' : 'lexical',
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const floor = Math.max(0.05, best * minRelative);

  const ranked = scored.filter((hit) => hit.score >= floor).slice(0, topK);

  // Ambil potongan yang berdampingan (ordinal berurutan) supaya konteks tidak bolong.
  return expandNeighbours(index.chunks, ranked).slice(0, topK + 2);
}

/** Tambahkan tetangga terdekat dari potongan teratas (satu sebelum / sesudah). */
function expandNeighbours(chunks: ChunkWithDocument[], hits: RetrievedChunk[]): RetrievedChunk[] {
  const picked = new Map<string, RetrievedChunk>();

  for (const hit of hits) {
    picked.set(`${hit.documentId}:${hit.ordinal}`, hit);
  }

  for (const hit of hits.slice(0, 2)) {
    for (const delta of [-1, 1]) {
      const ordinal = hit.ordinal + delta;
      if (ordinal < 0) continue;
      const neighbour = chunks.find((chunk) => chunk.documentId === hit.documentId && chunk.ordinal === ordinal);
      if (!neighbour) continue;

      const key = `${neighbour.documentId}:${neighbour.ordinal}`;
      if (picked.has(key)) continue;

      picked.set(key, {
        documentId: neighbour.documentId,
        documentName: neighbour.documentName,
        ordinal: neighbour.ordinal,
        content: neighbour.content,
        score: hit.score * 0.5,
        via: hit.via,
      });
    }
  }

  return [...picked.values()]
    .sort((a, b) => a.documentId - b.documentId || a.ordinal - b.ordinal)
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/*  Format untuk prompt / tampilan                                     */
/* ------------------------------------------------------------------ */

/** Ubah hasil pencarian jadi blok rujukan untuk system prompt. */
export function buildKnowledgeBlock(results: RetrievedChunk[], charBudget = 3500): string {
  if (results.length === 0) return '';

  const entries: string[] = [];
  let used = 0;

  for (const result of results) {
    const body = truncate(result.content, 1200);
    if (used + body.length > charBudget) break;
    used += body.length;
    entries.push(`[Sumber: ${result.documentName} — bagian ${result.ordinal + 1}]\n${body}`);
  }

  if (entries.length === 0) return '';

  return `
[DOKUMEN RUJUKAN SERVER]
Kutipan di bawah diambil otomatis dari dokumen resmi server ini. Ini sumber kebenaran tertinggi.
${entries.join('\n\n')}

Cara memakainya:
- Jawab berdasarkan kutipan di atas kalau pertanyaannya relevan. Ketika kamu memakai informasi dari
  suatu dokumen, sebutkan namanya secara natural di jawaban — contoh: "Seperti yang tertulis di FAQ, ..."
- JANGAN mengarang di luar isi dokumen. Kalau tidak ada di dokumen, bilang belum ada informasinya.
- Ringkas dengan bahasamu sendiri, jangan menyalin mentah dan jangan menulis ulang tag [Sumber: ...].
`.trimEnd();
}

/**
 * Ringkas sumber unik untuk ditampilkan di bawah jawaban.
 * Menampilkan nama dokumen + bagian yang dipakai (bukan sekadar nama dokumen).
 */
export function summarizeSources(results: RetrievedChunk[], max = 3): string {
  if (results.length === 0) return '';
  const parts = [...new Set(results.map((result) => `${result.documentName} — bagian ${result.ordinal + 1}`))];
  return `📚 Sumber: ${parts.slice(0, max).join(' · ')}`;
}
