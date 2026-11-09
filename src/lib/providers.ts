import { config } from '../config.js';
import { logger } from './logger.js';
import { KNOWN_PROVIDERS, providerNameForBaseUrl, type ProviderSpec } from './provider-catalog.js';

export interface AiProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export { KNOWN_PROVIDERS, providerNameForBaseUrl };
export type { ProviderSpec };

export interface FallbackParseResult {
  providers: AiProvider[];
  problems: string[];
}

/**
 * Urai string `AI_FALLBACKS` menjadi daftar provider siap pakai.
 * Format entri: `nama:model` — contoh `gemini:gemini-3.8-flash`.
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
