import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Client AI memakai protokol OpenAI-compatible.
 * Default: Groq (https://api.groq.com/openai/v1).
 * Mau pindah ke OpenAI / OpenRouter / Ollama? Cukup ubah AI_BASE_URL + AI_MODEL di .env.
 */
const client = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseUrl,
  timeout: 60_000,
  maxRetries: 0, // retry kita tangani sendiri supaya bisa logging + backoff yang jelas
});

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
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class AiError extends Error {
  override readonly name = 'AiError';

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isToolUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error.status !== 400) return false;
  const text = `${error.message} ${JSON.stringify(error.error ?? '')}`.toLowerCase();
  return text.includes('tool');
}

function toFriendlyError(error: unknown): AiError {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const detail = (error.error as { message?: string } | undefined)?.message ?? error.message;

    if (status === 401 || status === 403) {
      return new AiError('API key AI ditolak. Cek `AI_API_KEY` di file .env.', status);
    }
    if (status === 429) {
      return new AiError('Kuota AI sedang penuh (rate limit). Coba lagi beberapa detik lagi ya.', status);
    }
    if (status === 413 || /too large|context length|maximum context/i.test(detail)) {
      return new AiError('Percakapan terlalu panjang. Pakai `/reset` lalu mulai topik baru ya.', status);
    }
    if (status === 404) {
      return new AiError(`Model AI \`${config.ai.model}\` tidak ditemukan. Cek \`AI_MODEL\` di .env.`, status);
    }
    return new AiError(`Layanan AI menolak permintaan (${status}). ${detail}`.slice(0, 300), status);
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new AiError('Tidak bisa menghubungi layanan AI. Cek koneksi internet server.');
  }

  if (error instanceof OpenAI.APIUserAbortError) {
    return new AiError('Permintaan AI dibatalkan karena timeout.');
  }

  return new AiError(error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga pada AI.');
}

async function callOnce(request: ChatRequest, useTools: boolean): Promise<ChatResult> {
  const model = request.model ?? config.ai.model;

  const completion = await client.chat.completions.create({
    model,
    messages: request.messages,
    temperature: request.temperature ?? config.ai.temperature,
    max_tokens: request.maxTokens ?? config.ai.maxTokens,
    ...(useTools && request.tools?.length
      ? { tools: request.tools, tool_choice: 'auto' as const }
      : {}),
  });

  const choice = completion.choices[0];
  if (!choice?.message) {
    throw new AiError('AI tidak mengembalikan jawaban. Coba lagi ya.');
  }

  return {
    message: choice.message,
    model,
    usage: completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined,
  };
}

/**
 * Kirim permintaan ke model, dengan retry otomatis untuk error sementara.
 * Kalau model menolak fitur tool calling, permintaan diulang tanpa tools.
 */
export async function chat(request: ChatRequest): Promise<ChatResult> {
  let useTools = Boolean(request.tools?.length);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const started = Date.now();
      const result = await callOnce(request, useTools);
      logger.debug(
        `AI ${result.model} selesai dalam ${Date.now() - started}ms` +
          (result.usage ? ` (${result.usage.totalTokens} token)` : ''),
      );
      return result;
    } catch (error) {
      if (isToolUnsupported(error) && useTools) {
        logger.warn('Model tidak mendukung tool calling — lanjut tanpa tools.');
        useTools = false;
        continue;
      }

      const retryable =
        error instanceof OpenAI.APIConnectionError ||
        (error instanceof OpenAI.APIError && typeof error.status === 'number' && RETRYABLE_STATUS.has(error.status));

      if (retryable && attempt < MAX_ATTEMPTS) {
        const backoff = 700 * 2 ** (attempt - 1);
        logger.warn(`Panggilan AI gagal (percobaan ${attempt}/${MAX_ATTEMPTS}), ulangi dalam ${backoff}ms.`);
        await sleep(backoff);
        continue;
      }

      logger.error('Panggilan AI gagal permanen', error);
      throw toFriendlyError(error);
    }
  }

  throw new AiError('AI tidak merespons setelah beberapa percobaan. Coba lagi nanti.');
}
