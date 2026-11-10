import 'dotenv/config';
import { z } from 'zod';

/**
 * Konversi string env -> boolean dengan benar.
 * `z.coerce.boolean()` akan mengubah "false" menjadi true, jadi kita tangani manual.
 */
const booleanish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return fallback;
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
      return fallback;
    });

const numberish = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return fallback;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `harus berupa angka, diterima "${value}"` });
        return z.NEVER;
      }
      return Math.min(max, Math.max(min, parsed));
    });

/**
 * Port dari env. `0` atau kosong dianggap "belum diisi", karena beberapa panel
 * hosting (mis. Wispbyte) mengirim `WEB_PORT=0` sebagai nilai default.
 */
const portish = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `port tidak valid: "${value}"` });
      return z.NEVER;
    }
    return parsed === 0 ? undefined : parsed;
  });

const optionalHost = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

/** Token dashboard: kosong = fitur mati; kalau diisi harus cukup panjang. */
const optionalToken = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined))
  .refine((value) => value === undefined || value.length >= 12, {
    message: 'DASHBOARD_TOKEN minimal 12 karakter (atau kosongkan untuk mematikan dashboard)',
  });

const schema = z.object({
  DISCORD_TOKEN: z.string().min(20, 'DISCORD_TOKEN tidak valid — salin ulang dari Discord Developer Portal'),
  CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'CLIENT_ID harus berupa angka (Application ID)'),
  DEV_GUILD_ID: optionalId,
  AI_API_KEY: z.string().min(10, 'AI_API_KEY wajib diisi — ambil di https://console.groq.com/keys'),
  AI_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  AI_MODEL: z.string().default('openai/gpt-oss-120b'),
  AI_TEMPERATURE: numberish(0.8, 0, 2),
  AI_MAX_TOKENS: numberish(700, 64, 8192),
  AI_HISTORY_LIMIT: numberish(20, 0, 100),
  // Daftar provider cadangan: "gemini:gemini-3.8-flash,openrouter:google/gemma-4-31b-it:free"
  AI_FALLBACKS: z.string().optional(),
  GROQ_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  OPENROUTER_API_KEY: optionalSecret,
  NVIDIA_API_KEY: optionalSecret,
  OLLAMA_API_KEY: optionalSecret,
  // ---------- RAG dokumen ----------
  RAG_ENABLED: booleanish(true),
  RAG_TOP_K: numberish(5, 1, 12),
  RAG_CHUNK_SIZE: numberish(900, 200, 2000),
  RAG_CHUNK_OVERLAP: numberish(150, 0, 500),
  RAG_MAX_CHARS: numberish(200000, 1000, 2000000),
  // Embeddings opsional (endpoint /embeddings kompatibel OpenAI). Kosong = leksikal (BM25) saja.
  EMBED_BASE_URL: z.string().url().optional(),
  EMBED_API_KEY: optionalSecret,
  EMBED_MODEL: optionalSecret,
  // ---------- Web dashboard ----------
  // Kosong = dashboard tidak dijalankan.
  DASHBOARD_TOKEN: optionalToken,
  DASHBOARD_PORT: portish,
  DASHBOARD_HOST: optionalHost,
  // Alias yang dikirim panel hosting (Wispbyte, Railway, Render, dsb).
  WEB_PORT: portish,
  WEB_HOST: optionalHost,
  PORT: portish,
  SERVER_PORT: portish,
  DATABASE_PATH: z.string().default('./data/zypher.db'),
  AUTO_MEMORY: booleanish(true),
  RATE_LIMIT_PER_MINUTE: numberish(12, 0, 240),
  MAX_INPUT_CHARS: numberish(2000, 100, 6000),
  AI_CATEGORY_ID: optionalId,
  TRANSCRIPT_CHANNEL_ID: optionalId,
  STAFF_ROLE_ID: optionalId,
  ADMIN_ONLY_ROOMS: booleanish(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error('\n❌ Konfigurasi .env belum lengkap / tidak valid:\n' + issues + '\n');
  console.error('   Tips: isi variabel di atas di file .env (contoh lengkap ada di .env.example).\n');
  process.exit(1);
}

const env = parsed.data;

export const config = {
  discord: {
    token: env.DISCORD_TOKEN,
    clientId: env.CLIENT_ID,
    devGuildId: env.DEV_GUILD_ID,
  },
  ai: {
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
    temperature: env.AI_TEMPERATURE,
    maxTokens: env.AI_MAX_TOKENS,
    historyLimit: env.AI_HISTORY_LIMIT,
    fallbacks: env.AI_FALLBACKS?.trim() || undefined,
    providerKeys: {
      GROQ_API_KEY: env.GROQ_API_KEY,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      NVIDIA_API_KEY: env.NVIDIA_API_KEY,
      OLLAMA_API_KEY: env.OLLAMA_API_KEY,
    },
  },
  rag: {
    enabled: env.RAG_ENABLED,
    topK: env.RAG_TOP_K,
    chunkSize: env.RAG_CHUNK_SIZE,
    chunkOverlap: env.RAG_CHUNK_OVERLAP,
    maxChars: env.RAG_MAX_CHARS,
    embedBaseUrl: env.EMBED_BASE_URL,
    embedApiKey: env.EMBED_API_KEY,
    embedModel: env.EMBED_MODEL,
  },
  dashboard: (() => {
    const portSources = [
      ['DASHBOARD_PORT', env.DASHBOARD_PORT],
      ['WEB_PORT', env.WEB_PORT],
      ['PORT', env.PORT],
      ['SERVER_PORT', env.SERVER_PORT],
    ] as const;
    const found = portSources.find(([, value]) => value !== undefined);

    return {
      token: env.DASHBOARD_TOKEN,
      port: found?.[1] ?? 3000,
      /** Nama variabel yang menentukan port — dipakai untuk log diagnostik. */
      portSource: found?.[0] ?? 'default',
      host: env.DASHBOARD_HOST ?? env.WEB_HOST ?? '0.0.0.0',
    };
  })(),
  database: {
    path: env.DATABASE_PATH,
  },
  features: {
    autoMemory: env.AUTO_MEMORY,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    maxInputChars: env.MAX_INPUT_CHARS,
    adminOnlyRooms: env.ADMIN_ONLY_ROOMS,
  },
  ids: {
    category: env.AI_CATEGORY_ID,
    transcriptChannel: env.TRANSCRIPT_CHANNEL_ID,
    staffRole: env.STAFF_ROLE_ID,
  },
  isDev: Boolean(env.DEV_GUILD_ID),
} as const;

export type Config = typeof config;
