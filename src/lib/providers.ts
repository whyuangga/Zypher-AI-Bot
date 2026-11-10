import { config } from '../config.js';
import { logger } from './logger.js';
import {
  KNOWN_PROVIDERS,
  parseFallbackSpec,
  providerNameForBaseUrl,
  type FallbackParseResult,
  type ProviderSpec,
  type ProviderTarget,
} from './provider-catalog.js';

export type AiProvider = ProviderTarget;

export { KNOWN_PROVIDERS, parseFallbackSpec, providerNameForBaseUrl };
export type { FallbackParseResult, ProviderSpec, ProviderTarget };

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
