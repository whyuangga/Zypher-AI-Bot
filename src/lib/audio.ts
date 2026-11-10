import { config } from '../config.js';
import { buildProviderChain, type AiProvider } from './providers.js';
import { logger } from './logger.js';

/**
 * STT & TTS lewat endpoint audio OpenAI-compatible (Groq, OpenAI, dll).
 * Bot memakai provider chain yang sama dengan chat: provider pertama yang
 * mendukung audio dipakai, sisanya jadi cadangan.
 */

export class AudioError extends Error {
  override readonly name = 'AudioError';

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const AUDIO_TIMEOUT_MS = 90_000;
const MAX_ERROR_CHARS = 300;

const AUDIO_EXTENSIONS = new Set(['ogg', 'oga', 'mp3', 'm4a', 'wav', 'webm', 'flac', 'mpga', 'mpeg']);

/** Lampiran audio yang bisa ditranskrip (termasuk voice note Discord `.ogg`). */
export function isAudioAttachment(name: string, contentType?: string | null): boolean {
  if (contentType?.startsWith('audio/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(ext);
}

function mimeForUpload(name: string, contentType?: string | null): string {
  if (contentType?.startsWith('audio/')) return contentType;
  const ext = name.split('.').pop()?.toLowerCase() ?? 'ogg';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    mpga: 'audio/mpeg',
    mpeg: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    webm: 'audio/webm',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
  };
  return map[ext] ?? 'audio/ogg';
}

function errorText(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

function hintFor(status: number): string {
  if (status === 401 || status === 403) return 'API key ditolak provider.';
  if (status === 404) return 'Model/endpoint audio tidak tersedia di provider ini.';
  if (status === 413) return 'File audio terlalu besar untuk provider.';
  if (status === 429) return 'Kuota provider sedang penuh (429).';
  return 'Provider menolak permintaan audio.';
}

/** TRY every provider; kembalikan hasil pertama yang sukses. */
async function attempt<T>(
  label: string,
  run: (provider: AiProvider) => Promise<T>,
): Promise<{ value: T; provider: string }> {
  const providers = buildProviderChain();
  const problems: string[] = [];

  for (const provider of providers) {
    try {
      const value = await run(provider);
      return { value, provider: provider.name };
    } catch (error) {
      const status = error instanceof AudioError ? error.status : undefined;
      problems.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);

      // Key salah / model tidak ada tidak akan membaik di provider yang sama,
      // tapi provider berikutnya mungkin punya model yang berbeda — tetap coba.
      logger.warn(`Audio ${label} gagal di ${provider.name}${status ? ` (${status})` : ''}`);
    }
  }

  throw new AudioError(
    providers.length === 0
      ? 'Belum ada provider AI yang siap — isi API key di .env.'
      : `Semua provider gagal untuk ${label}. ${problems.join(' | ')}`,
  );
}

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
}

/** Transkrip audio jadi teks (`/audio/transcriptions`). */
export async function transcribeAudio(input: {
  bytes: Uint8Array;
  filename: string;
  contentType?: string | null;
}): Promise<TranscriptionResult> {
  const model = config.voice.sttModel;
  const { value, provider } = await attempt<{ text: string }>('transkripsi', async (target) => {
    const form = new FormData();
    // Buffer dipakai supaya Node tidak meng-copy Uint8Array dari pool lain.
    const blob = new Blob([Buffer.from(input.bytes)], { type: mimeForUpload(input.filename, input.contentType) });
    form.append('file', blob, input.filename || 'audio.ogg');
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const response = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new AudioError(`${hintFor(response.status)} ${errorText(await response.text())}`, response.status);
    }

    const payload = (await response.json()) as { text?: unknown };
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new AudioError('Provider mengembalikan transkrip kosong.');
    return { text };
  });

  return { text: value.text, provider, model };
}

export interface SpeechResult {
  bytes: Uint8Array;
  mime: string;
  provider: string;
  model: string;
}

/**
 * Teks jadi suara (`/audio/speech`) — dipakai untuk membalas voice note.
 * Groq PlayAI memakai `response_format: 'wav'`, OpenAI `mp3`; keduanya kita
 * minta `mp3` dan fallback ke `wav` bila ditolak.
 */
export async function synthesizeSpeech(text: string): Promise<SpeechResult> {
  const model = config.voice.ttsModel;
  const voice = config.voice.ttsVoice;
  const input = text.slice(0, 4000);

  const { value, provider } = await attempt<{ bytes: Uint8Array; mime: string }>('text-to-speech', async (target) => {
    const url = `${target.baseUrl.replace(/\/+$/, '')}/audio/speech`;

    for (const format of ['mp3', 'wav'] as const) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${target.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, input, voice, response_format: format }),
        signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
      });

      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0) throw new AudioError('Provider mengembalikan audio kosong.');
        return { bytes, mime: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' };
      }

      const status = response.status;
      const detail = errorText(await response.text());
      // Format tidak didukung → coba format lain; selain itu menyerah.
      if (status === 400 && /format|response_format/i.test(detail) && format === 'mp3') continue;
      throw new AudioError(`${hintFor(status)} ${detail}`, status);
    }

    throw new AudioError('Provider tidak menerima format audio apa pun.');
  });

  return { bytes: value.bytes, mime: value.mime, provider, model };
}
