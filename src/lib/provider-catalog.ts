/**
 * Katalog provider OpenAI-compatible yang dikenali bot.
 * File ini sengaja BEBAS dari config/Discord, supaya bisa dipakai
 * skrip CLI (npm run models) tanpa perlu token Discord.
 */

export interface ProviderSpec {
  baseUrl: string;
  keyEnv: string;
  /** Key yang dipakai kalau provider tidak butuh autentikasi (mis. Ollama lokal). */
  defaultKey?: string;
  /** Saran model kalau katalog live tidak bisa diambil. */
  suggestedModels: string[];
  docsUrl: string;
}

export const KNOWN_PROVIDERS: Record<string, ProviderSpec> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    suggestedModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    docsUrl: 'https://console.groq.com/docs/models',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: 'GEMINI_API_KEY',
    suggestedModels: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    suggestedModels: ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free'],
    docsUrl: 'https://openrouter.ai/models?max_price=0',
  },
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyEnv: 'NVIDIA_API_KEY',
    suggestedModels: ['openai/gpt-oss-120b', 'meta/llama-3.3-70b-instruct', 'qwen/qwen3-235b-a22b'],
    docsUrl: 'https://build.nvidia.com',
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    suggestedModels: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-32b'],
    docsUrl: 'https://inference-docs.cerebras.ai/models/overview',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    suggestedModels: ['mistral-small-latest', 'open-mistral-nemo'],
    docsUrl: 'https://docs.mistral.ai/getting-started/models/models_overview/',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: 'OLLAMA_API_KEY',
    defaultKey: 'ollama',
    suggestedModels: ['llama3.1', 'qwen3', 'gemma3'],
    docsUrl: 'https://ollama.com/library',
  },
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
