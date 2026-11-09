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

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const schema = z.object({
  DISCORD_TOKEN: z.string().min(20, 'DISCORD_TOKEN tidak valid — salin ulang dari Discord Developer Portal'),
  CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'CLIENT_ID harus berupa angka (Application ID)'),
  DEV_GUILD_ID: optionalId,
  AI_API_KEY: z.string().min(10, 'AI_API_KEY wajib diisi — ambil di https://console.groq.com/keys'),
  AI_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  AI_MODEL: z.string().default('llama-3.3-70b-versatile'),
  AI_TEMPERATURE: numberish(0.8, 0, 2),
  AI_MAX_TOKENS: numberish(700, 64, 8192),
  AI_HISTORY_LIMIT: numberish(20, 0, 100),
  // Daftar provider cadangan: "gemini:gemini-2.5-flash,openrouter:google/gemma-4-31b-it:free"
  AI_FALLBACKS: z.string().optional(),
  GROQ_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  OPENROUTER_API_KEY: optionalSecret,
  CEREBRAS_API_KEY: optionalSecret,
  MISTRAL_API_KEY: optionalSecret,
  OLLAMA_API_KEY: optionalSecret,
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
  console.error('   Tips: salin .env.example menjadi .env lalu isi nilainya.\n');
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
      CEREBRAS_API_KEY: env.CEREBRAS_API_KEY,
      MISTRAL_API_KEY: env.MISTRAL_API_KEY,
      OLLAMA_API_KEY: env.OLLAMA_API_KEY,
    },
  },
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
