import { config } from '../config.js';
import { logger } from './logger.js';

export interface AiProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface KnownProvider {
  baseUrl: string;
  keyEnv: string;
  defaultKey?: string;
}

/**
 * Provider yang dikenali untuk `AI_FALLBACKS`.
 * Format entri: `nama:model` — contoh `gemini:gemini-2.5-flash`.
 */
export const KNOWN_PROVIDERS: Record<string, KnownProvider> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', keyEnv: 'CEREBRAS_API_KEY' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY' },
  ollama: { baseUrl: 'http://localhost:11434/v1', keyEnv: 'OLLAMA_API_KEY', defaultKey: 'ollama' },
};

/** Tebak nama provider dari base URL, untuk label di log. */
export function providerNameForBaseUrl(baseUrl: string): string {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // biarkan apa adanya kalau URL tidak valid
  }

  if (host.includes('groq.com')) return 'groq';
  if (host.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (host.includes('openrouter.ai')) return 'openrouter';
  if (host.includes('cerebras.ai')) return 'cerebras';
  if (host.includes('mistral.ai')) return 'mistral';
  if (host === 'localhost' || host === '127.0.0.1' || host === 'host.docker.internal') {
    // Hanya port default Ollama yang dianggap Ollama; endpoint lokal lain = custom.
    return baseUrl.includes(':11434') ? 'ollama' : 'custom';
  }
  return host;
}

export interface FallbackParseResult {
  providers: AiProvider[];
  problems: string[];
}

/**
 * Urai string `AI_FALLBACKS` menjadi daftar provider siap pakai.
 * Entri yang salah / key-nya belum diisi dilewati dengan catatan, bukan membuat bot gagal start.
 */
export function parseFallbackSpec(
  spec: string | undefined,
  keys: Record<string, string | undefined>,
  primary?: AiProvider,
): FallbackParseResult {
  const providers: AiProvider[] = [];
  const problems: string[] = [];

  if (!spec || !spec.trim()) return { providers, problems };

  const seen = new Set<string>();
  if (primary) seen.add(`${primary.baseUrl}::${primary.model}`);

  for (const rawEntry of spec.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const separator = entry.indexOf(':');
    if (separator <= 0 || separator === entry.length - 1) {
      problems.push(`"${entry}" formatnya salah (harus nama:model)`);
      continue;
    }

    const providerName = entry.slice(0, separator).trim().toLowerCase();
    const model = entry.slice(separator + 1).trim();
    const known = KNOWN_PROVIDERS[providerName];

    if (!known) {
      problems.push(`"${providerName}" tidak dikenal (pilihan: ${Object.keys(KNOWN_PROVIDERS).join(', ')})`);
      continue;
    }

    const apiKey = keys[known.keyEnv] ?? known.defaultKey;
    if (!apiKey) {
      problems.push(`${providerName} dilewati — isi ${known.keyEnv} di .env`);
      continue;
    }

    const signature = `${known.baseUrl}::${model}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    providers.push({ name: providerName, baseUrl: known.baseUrl, apiKey, model });
  }

  return { providers, problems };
}

let cachedChain: AiProvider[] | null = null;

/**
 * Rantai provider: utama dulu, lalu fallback sesuai urutan di `AI_FALLBACKS`.
 */
export function buildProviderChain(): AiProvider[] {
  if (cachedChain) return cachedChain;

  const primary: AiProvider = {
    name: providerNameForBaseUrl(config.ai.baseUrl),
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
  };

  const { providers, problems } = parseFallbackSpec(config.ai.fallbacks, config.ai.providerKeys, primary);

  for (const problem of problems) logger.warn(`AI_FALLBACKS: ${problem}`);

  cachedChain = [primary, ...providers];

  if (providers.length > 0) {
    logger.info(`Provider AI aktif (fallback berurutan): ${cachedChain.map((p) => `${p.name}/${p.model}`).join(' → ')}`);
  }

  return cachedChain;
}

/** Hanya untuk pengujian. */
export function resetProviderChainCache(): void {
  cachedChain = null;
}
