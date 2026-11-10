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

function isStreamUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error.status !== 400 && error.status !== 422) return false;
  const text = `${error.message} ${JSON.stringify(error.error ?? '')}`.toLowerCase();
  return text.includes('stream') && (text.includes('support') || text.includes('unsupported') || text.includes('not allowed'));
}

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
      const aiError = error instanceof AiError ? error : classify(error).error;

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

/* ------------------------------------------------------------------ */
/*  Streaming                                                          */
/* ------------------------------------------------------------------ */

export interface StreamOptions {
  /** Dipanggil setiap potongan teks baru dari model. */
  onDelta: (delta: string) => void;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Konsumsi stream dari satu provider.
 * `emitted` dipakai untuk memutuskan: boleh pindah provider (belum ada teks terkirim)
 * atau tidak (teks sudah tampil, pindah provider akan menduplikasi jawaban).
 */
async function streamOnProvider(
  provider: AiProvider,
  request: ChatRequest,
  attempts: number,
  allowModelOverride: boolean,
  onDelta: (delta: string) => void,
): Promise<ChatResult> {
  let useTools = Boolean(request.tools?.length);
  let emitted = false;
  let lastError: AiError | null = null;

  const emit = (text: string) => {
    if (!text) return;
    emitted = true;
    onDelta(text);
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const model = allowModelOverride && request.model ? request.model : provider.model;
      const started = Date.now();

      const stream = await clientFor(provider).chat.completions.create({
        model,
        messages: request.messages,
        temperature: request.temperature ?? config.ai.temperature,
        max_tokens: request.maxTokens ?? config.ai.maxTokens,
        ...(useTools && request.tools?.length ? { tools: request.tools, tool_choice: 'auto' as const } : {}),
        stream: true,
      });

      let content = '';
      const toolCalls = new Map<number, AccumulatedToolCall>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          emit(delta.content);
        }

        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? 0;
          const entry = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
          if (call.id) entry.id = call.id;
          if (call.function?.name) entry.name += call.function.name;
          if (call.function?.arguments) entry.arguments += call.function.arguments;
          toolCalls.set(index, entry);
        }
      }

      const message = {
        role: 'assistant',
        content: content || null,
        ...(toolCalls.size > 0
          ? {
              tool_calls: [...toolCalls.entries()]
                .sort(([a], [b]) => a - b)
                .map(([index, call]) => ({
                  id: call.id || `call_${index}`,
                  type: 'function' as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
            }
          : {}),
      } as unknown as AssistantMessage;

      logger.debug(`AI ${provider.name}/${model} stream selesai dalam ${Date.now() - started}ms`);

      return { message, model, provider: provider.name };
    } catch (error) {
      // Provider menolak streaming: ambil jawaban utuh sekaligus, tetap di provider yang sama.
      if (isStreamUnsupported(error) && !emitted) {
        logger.warn(`${provider.name} tidak mendukung streaming — memakai mode non-streaming.`);
        const fallbackResult = await callOnce(provider, request, useTools, allowModelOverride);
        emit(fallbackResult.message.content ?? '');
        return fallbackResult;
      }

      if (isToolUnsupported(error) && useTools && !emitted) {
        logger.warn(`Model ${provider.model} tidak mendukung tool calling saat streaming — lanjut tanpa tools.`);
        useTools = false;
        continue;
      }

      const { error: aiError, retryable } = classify(error);
      lastError = aiError;

      // Sudah ada teks yang tampil: jangan pindah provider / retry, nanti jawaban dobel.
      if (emitted) {
        throw new AiError(`${aiError.message} (jawaban terputus)`, aiError.status, false, true);
      }

      if (!retryable || attempt === attempts) throw aiError;

      const backoff = 400 * 2 ** (attempt - 1);
      logger.warn(`${provider.name} gagal stream (${attempt}/${attempts}): ${aiError.message} — ulangi dalam ${backoff}ms.`);
      await sleep(backoff);
    }
  }

  throw lastError ?? new AiError('AI tidak merespons.');
}

/**
 * Versi streaming dari `chat()`. Potongan teks dikirim lewat `onDelta`,
 * dan hasil akhir tetap mengembalikan pesan lengkap (termasuk tool_calls) untuk loop memori.
 */
export async function streamChat(request: ChatRequest, options: StreamOptions): Promise<ChatResult> {
  const chain = buildProviderChain();
  const failures: string[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const provider = chain[index];
    if (!provider) continue;

    let emitted = false;

    try {
      const result = await streamOnProvider(
        provider,
        request,
        index === 0 ? PRIMARY_ATTEMPTS : FALLBACK_ATTEMPTS,
        index === 0,
        (delta) => {
          emitted = true;
          options.onDelta(delta);
        },
      );

      if (index > 0) {
        logger.info(`Provider utama gagal — jawaban streaming diberikan oleh fallback ${result.provider}/${result.model}.`);
      }

      return result;
    } catch (error) {
      const aiError = error instanceof AiError ? error : classify(error).error;

      // Teks sudah tampil ke user atau error tidak bisa ditolong provider lain.
      if (aiError.fatal || emitted) throw aiError;

      failures.push(`${provider.name}: ${aiError.message}`);

      if (chain.length === 1 || !aiError.tryNextProvider) throw aiError;

      logger.warn(`Provider ${provider.name} gagal sebelum mengirim teks — pindah provider.`);
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
