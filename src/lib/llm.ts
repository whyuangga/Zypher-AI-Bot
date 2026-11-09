import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from './logger.js';
import { buildProviderChain, type AiProvider } from './providers.js';

/**
 * Client AI memakai protokol OpenAI-compatible.
 * Provider utama dari `AI_BASE_URL` + `AI_MODEL`, lalu fallback berurutan dari `AI_FALLBACKS`.
 */
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
export type AssistantMessage = OpenAI.Chat.Completions.ChatCompletionMessage;

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
}

export interface ChatResult {
  message: AssistantMessage;
  model: string;
  provider: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class AiError extends Error {
  override readonly name = 'AiError';

  constructor(
    message: string,
    readonly status?: number,
    /** true = masih ada harapan provider lain bisa menjawab */
    readonly tryNextProvider = true,
    /** true = kesalahan di sisi kita (prompt terlalu panjang), fallback tidak akan menolong */
    readonly fatal = false,
  ) {
    super(message);
  }
}

const clients = new Map<string, OpenAI>();

function clientFor(provider: AiProvider): OpenAI {
  const cacheKey = `${provider.baseUrl}::${provider.apiKey}`;
  let client = clients.get(cacheKey);

  if (!client) {
    client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
      timeout: 60_000,
      maxRetries: 0, // retry & fallback kita kelola sendiri
    });
    clients.set(cacheKey, client);
  }

  return client;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const PRIMARY_ATTEMPTS = 3;
const FALLBACK_ATTEMPTS = 2;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isToolUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error.status !== 400) return false;
  const text = `${error.message} ${JSON.stringify(error.error ?? '')}`;
  return text.toLowerCase().includes('tool');
}

/** Ubah error SDK menjadi AiError + info apakah layak di-retry di provider yang sama. */
function classify(error: unknown): { error: AiError; retryable: boolean } {
  if (error instanceof AiError) return { error, retryable: false };

  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const detail = (error.error as { message?: string } | undefined)?.message ?? error.message;
    const text = `${detail} ${JSON.stringify(error.error ?? '')}`;

    if (status === 401 || status === 403) {
      return { error: new AiError('API key ditolak', status), retryable: false };
    }
    if (status === 402) {
      return { error: new AiError('kredit/kuota provider habis', status), retryable: false };
    }
    if (status === 404) {
      return { error: new AiError('model tidak ditemukan', status), retryable: false };
    }
    if (status === 429) {
      return { error: new AiError('kuota/rate limit penuh', status), retryable: true };
    }
    if (status === 413 || /too large|context length|maximum context|token limit/i.test(text)) {
      return {
        error: new AiError('Percakapan terlalu panjang. Pakai `/reset` lalu mulai topik baru ya.', status, false, true),
        retryable: false,
      };
    }
    if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) {
      return { error: new AiError(`gangguan sementara provider (${status})`, status), retryable: true };
    }

    return { error: new AiError(`permintaan ditolak provider (${status ?? 'tanpa status'})`, status), retryable: false };
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return { error: new AiError('tidak bisa menghubungi layanan AI'), retryable: true };
  }

  if (error instanceof OpenAI.APIUserAbortError) {
    return { error: new AiError('permintaan timeout'), retryable: true };
  }

  return {
    error: new AiError(error instanceof Error ? error.message : 'kesalahan tak terduga pada AI'),
    retryable: false,
  };
}

async function callOnce(
  provider: AiProvider,
  request: ChatRequest,
  useTools: boolean,
  allowModelOverride: boolean,
): Promise<ChatResult> {
  const model = allowModelOverride && request.model ? request.model : provider.model;

  const completion = await clientFor(provider).chat.completions.create({
    model,
    messages: request.messages,
    temperature: request.temperature ?? config.ai.temperature,
    max_tokens: request.maxTokens ?? config.ai.maxTokens,
    ...(useTools && request.tools?.length ? { tools: request.tools, tool_choice: 'auto' as const } : {}),
  });

  const choice = completion.choices[0];
  if (!choice?.message) {
    throw new AiError('AI tidak mengembalikan jawaban.', undefined, true);
  }

  return {
    message: choice.message,
    model,
    provider: provider.name,
    usage: completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined,
  };
}

/** Coba satu provider (dengan retry internal), lempar AiError kalau menyerah. */
async function runOnProvider(
  provider: AiProvider,
  request: ChatRequest,
  attempts: number,
  allowModelOverride: boolean,
): Promise<ChatResult> {
  let useTools = Boolean(request.tools?.length);
  let lastError: AiError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const started = Date.now();
      const result = await callOnce(provider, request, useTools, allowModelOverride);
      logger.debug(
        `AI ${result.provider}/${result.model} selesai dalam ${Date.now() - started}ms` +
          (result.usage ? ` (${result.usage.totalTokens} token)` : ''),
      );
      return result;
    } catch (error) {
      // Model tanpa dukungan tool: ulangi di provider yang sama tanpa tools.
      if (isToolUnsupported(error) && useTools) {
        logger.warn(`Model ${provider.model} tidak mendukung tool calling — lanjut tanpa tools.`);
        useTools = false;
        continue;
      }

      const { error: aiError, retryable } = classify(error);
      lastError = aiError;

      if (!retryable || attempt === attempts) throw aiError;

      const backoff = 400 * 2 ** (attempt - 1);
      logger.warn(
        `${provider.name} gagal (${attempt}/${attempts}): ${aiError.message} — ulangi dalam ${backoff}ms.`,
      );
      await sleep(backoff);
    }
  }

  throw lastError ?? new AiError('AI tidak merespons.');
}

/**
 * Kirim permintaan ke provider utama; kalau gagal, coba provider fallback sesuai urutan.
 * Error yang tidak bisa ditolong provider lain (mis. percakapan kepanjangan) langsung dilempar.
 */
export async function chat(request: ChatRequest): Promise<ChatResult> {
  const chain = buildProviderChain();
  const failures: string[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const provider = chain[index];
    if (!provider) continue;

    try {
      const result = await runOnProvider(
        provider,
        request,
        index === 0 ? PRIMARY_ATTEMPTS : FALLBACK_ATTEMPTS,
        index === 0,
      );

      if (index > 0) {
        logger.info(`Provider utama gagal — jawaban diberikan oleh fallback ${result.provider}/${result.model}.`);
      }

      return result;
    } catch (error) {
      const aiError = error instanceof Error && error.name === 'AiError'
        ? (error as AiError)
        : classify(error).error;

      if (aiError.fatal) throw aiError;

      failures.push(`${provider.name}: ${aiError.message}`);

      // Provider tunggal: teruskan pesan aslinya supaya user tahu penyebab pastinya.
      if (chain.length === 1 || !aiError.tryNextProvider) throw aiError;

      logger.warn(`Provider ${provider.name} menyerah — pindah ke provider berikutnya.`);
    }
  }

  const detail = failures.join('; ').slice(0, 300);
  throw new AiError(
    `Semua provider AI sedang tidak tersedia (${failures.length} dicoba) — ${detail}. Coba lagi beberapa saat lagi ya.`,
    undefined,
    false,
    true,
  );
}
