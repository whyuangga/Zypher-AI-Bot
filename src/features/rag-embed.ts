/**
 * Embeddings OPSIONAL untuk pencarian semantik.
 *
 * Butuh endpoint `/embeddings` yang kompatibel OpenAI (Gemini, Ollama, dsb).
 * Groq belum menyediakan embeddings, jadi default-nya RAG tetap jalan dengan
 * pencarian leksikal (BM25) tanpa konfigurasi apa pun. Kalau embeddings aktif,
 * skornya digabung dengan BM25 (hybrid) di `rag.ts`.
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { errorMessage, logger } from '../lib/logger.js';

let client: OpenAI | null | undefined;
let warned = false;

export function embeddingsConfigured(): boolean {
  return Boolean(config.rag.embedModel && (config.rag.embedBaseUrl || config.ai.apiKey));
}

export function embeddingModelName(): string | null {
  return config.rag.embedModel ?? null;
}

function getClient(): OpenAI | null {
  if (!embeddingsConfigured()) return null;
  if (client) return client;

  client = new OpenAI({
    apiKey: config.rag.embedApiKey ?? config.ai.apiKey,
    baseURL: config.rag.embedBaseUrl ?? config.ai.baseUrl,
    timeout: 20_000,
    maxRetries: 0,
  });
  return client;
}

/**
 * Ubah sekumpulan teks jadi vektor. Mengembalikan `null` (bukan melempar) kalau
 * gagal — RAG harus tetap jalan walau provider embeddings bermasalah.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const active = getClient();
  if (!active || texts.length === 0) return null;

  try {
    const response = await active.embeddings.create({
      model: config.rag.embedModel!,
      input: texts.map((text) => text.slice(0, 8000)),
    });

    const vectors = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding as number[]);

    if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length === 0)) {
      throw new Error('jumlah/isi vektor tidak sesuai permintaan');
    }
    return vectors;
  } catch (error) {
    if (!warned) {
      warned = true;
      logger.warn(`Embeddings tidak bisa dipakai (${errorMessage(error).slice(0, 120)}) — RAG lanjut dengan pencarian leksikal.`);
    }
    return null;
  }
}
