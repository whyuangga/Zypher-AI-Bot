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

/** Boolean opsional: tidak diisi = `undefined` (biar bisa dibedakan dari `false`). */
const optionalBool = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value.trim() === '') return undefined;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return undefined;
  });

const optionalHost = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

/**
 * ID server tempat bot ini tinggal. **Wajib** — bot ini memang dirancang untuk
 * satu server. Kalau mau dipakai di server lain: fork repo, pakai API key sendiri.
 */
const requiredGuildId = z
  .string({ required_error: 'GUILD_ID wajib diisi (ID server Discord kamu)' })
  .min(1, 'GUILD_ID wajib diisi (ID server Discord kamu)')
  .transform((value) => value.trim())
  .refine((value) => /^\d{17,20}$/.test(value), 'GUILD_ID harus angka 17–20 digit (ID server, bukan nama)');

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
  // Nama utama. Alias (DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID) diterima
  // karena banyak template bot di panel hosting memakai nama itu — salah nama = bot
  // mati dengan pesan "belum diisi" padahal kolomnya sudah terisi.
  DISCORD_TOKEN: optionalSecret,
  DISCORD_BOT_TOKEN: optionalSecret,
  CLIENT_ID: optionalSecret,
  DISCORD_CLIENT_ID: optionalSecret,
  GUILD_ID: requiredGuildId,
  // Alias lama: banyak template panel hosting memakai nama ini.
  DEV_GUILD_ID: optionalId,
  DISCORD_GUILD_ID: optionalId,
  SERVER_ID: optionalId,
  AI_API_KEY: z.string().min(10, 'AI_API_KEY wajib diisi — ambil di https://console.groq.com/keys'),
  AI_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  AI_MODEL: z.string().default('openai/gpt-oss-120b'),
  AI_TEMPERATURE: numberish(0.8, 0, 2),
  AI_MAX_TOKENS: numberish(4096, 64, 8192),
  // Jatah token untuk jawaban pendek (sambutan, salam, pemecah sepi, agent).
  //
  // Dulu tiap pemanggil menulis angka kecil sendiri-sendiri (80-220) tanpa
  // memandang AI_MAX_TOKENS. Untuk model reasoning itu jatah yang habis
  // sebelum sempat menulis jawaban, jadi hasilnya "teks kosong" terus.
  // Sekarang satu nilai, dan bisa dinaikkan tanpa menyentuh kode.
  AI_BREVITY_TOKENS: numberish(1024, 64, 8192),
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
  WEB_ENABLED: optionalBool,
  PORT: portish,
  SERVER_PORT: portish,
  // Alamat publik dashboard, mis. http://78.154.103.15:16954 — dipakai di log.
  PUBLIC_URL: optionalHost,
  WEB_PUBLIC_URL: optionalHost,
  DATABASE_PATH: z.string().default('./data/zypher.db'),
  // Postgres opsional. Terisi = semua data disimpan di Postgres, bukan SQLite.
  // Contoh: postgres://user:pass@host:5432/db?sslmode=require
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : undefined)),
  // Multi-shard: bagi server (guild) ke beberapa instance bot yang berbagi
  // satu database. SHARD_COUNT=1 (default) = semua server ditangani instance ini.
  SHARD_INDEX: numberish(0, 0, 255),
  SHARD_COUNT: numberish(1, 1, 256),
  AUTO_MEMORY: booleanish(true),
  RATE_LIMIT_PER_MINUTE: numberish(12, 0, 240),
  MAX_INPUT_CHARS: numberish(2000, 100, 6000),
  MODLOG_CHANNEL_ID: optionalId,
  STAFF_ROLE_ID: optionalId,
  ADMIN_ONLY_ROOMS: booleanish(false),
  // ---------- Moderasi otomatis ----------
  MODERATION_ENABLED: booleanish(false),
  // Daftar kata dipisah koma. Boleh juga diatur per server dari dashboard.
  MODERATION_WORDS: z.string().optional(),
  // delete = hapus pesan, warn = tegur saja, timeout = hapus + bisukan member
  MODERATION_ACTION: z.enum(['delete', 'warn', 'timeout']).default('delete'),
  MODERATION_TIMEOUT_MINUTES: numberish(10, 1, 10080),
  // ---------- Vision (gambar) ----------
  VISION_MODEL: z.string().default('meta-llama/llama-4-scout-17b-16e-instruct'),
  VISION_MAX_MB: numberish(5, 1, 20),
  // ---------- Suara (STT/TTS, endpoint OpenAI-compatible mis. Groq) ----------
  VOICE_ENABLED: booleanish(false),
  STT_MODEL: z.string().default('whisper-large-v3'),
  TTS_ENABLED: booleanish(true),
  TTS_MODEL: z.string().default('playai-tts'),
  TTS_VOICE: z.string().default('Fritz-PlayAI'),
  VOICE_MAX_MB: numberish(20, 1, 25),
  /** Otomatis membalas jawaban chat AI dengan suara (TTS). */
  TTS_REPLY_IN_ROOM: booleanish(true),
});

const schemaWithAliases = schema
  .superRefine((value, ctx) => {
    const token = value.DISCORD_TOKEN ?? value.DISCORD_BOT_TOKEN;
    if (!token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DISCORD_TOKEN'],
        message: 'wajib diisi — salin dari Developer Portal → Bot → Reset Token',
      });
    } else if (token.length < 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DISCORD_TOKEN'],
        message: 'tidak valid — token bot panjangnya jauh lebih dari 20 karakter',
      });
    }

    const clientId = value.CLIENT_ID ?? value.DISCORD_CLIENT_ID;
    if (!clientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLIENT_ID'],
        message: 'wajib diisi — Application ID dari Developer Portal → General Information',
      });
    } else if (!/^\d{17,20}$/.test(clientId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLIENT_ID'],
        message: 'harus berupa angka 17–20 digit (Application ID), bukan token',
      });
    }
  })
  .transform((value) => ({
    ...value,
    DISCORD_TOKEN: value.DISCORD_TOKEN ?? value.DISCORD_BOT_TOKEN,
    CLIENT_ID: value.CLIENT_ID ?? value.DISCORD_CLIENT_ID,
    // Urutan: GUILD_ID resmi dulu, lalu alias lama (template panel hosting).
    // Hasilnya selalu GUILD_ID yang sudah divalidasi 17–20 digit.
    GUILD_ID: value.GUILD_ID ?? value.DEV_GUILD_ID ?? value.DISCORD_GUILD_ID ?? value.SERVER_ID,
  }));

const parsed = schemaWithAliases.safeParse(process.env);

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
    token: env.DISCORD_TOKEN ?? '',
    clientId: env.CLIENT_ID ?? '',
    /** Server tunggal tempat bot ini tinggal. Selalu terisi (wajib di .env). */
    homeGuildId: env.GUILD_ID,
  },
  ai: {
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
    temperature: env.AI_TEMPERATURE,
    maxTokens: env.AI_MAX_TOKENS,
    brevityTokens: env.AI_BREVITY_TOKENS,
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
      /** `WEB_ENABLED=false` mematikan dashboard walau token diisi (gaya panel). */
      enabled: env.WEB_ENABLED !== false && Boolean(env.DASHBOARD_TOKEN),
      port: found?.[1] ?? 3000,
      /** Nama variabel yang menentukan port — dipakai untuk log diagnostik. */
      portSource: found?.[0] ?? 'default',
      host: env.DASHBOARD_HOST ?? env.WEB_HOST ?? '0.0.0.0',
      /** Kalau diisi, log memakai alamat ini apa adanya (berguna di panel hosting). */
      publicUrl: (env.PUBLIC_URL ?? env.WEB_PUBLIC_URL)?.replace(/\/+$/, '') ?? undefined,
    };
  })(),
  database: {
    path: env.DATABASE_PATH,
    url: env.DATABASE_URL,
    shardIndex: env.SHARD_INDEX,
    shardCount: env.SHARD_COUNT,
  },
  moderation: {
    enabled: env.MODERATION_ENABLED,
    words: (env.MODERATION_WORDS ?? '')
      .split(',')
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean),
    action: env.MODERATION_ACTION,
    timeoutMinutes: env.MODERATION_TIMEOUT_MINUTES,
  },
  vision: {
    // Selalu aktif: tidak ada sakelar on/off. Kalau `VISION_MODEL` bukan model
    // multimodal, provider akan menolak dan alasannya diteruskan ke admin —
    // lebih jujur daripada gambar diam-diam diabaikan.
    model: env.VISION_MODEL,
    maxBytes: env.VISION_MAX_MB * 1024 * 1024,
  },
  voice: {
    enabled: env.VOICE_ENABLED,
    sttModel: env.STT_MODEL,
    ttsEnabled: env.TTS_ENABLED,
    ttsModel: env.TTS_MODEL,
    ttsVoice: env.TTS_VOICE,
    ttsReplyInRoom: env.TTS_REPLY_IN_ROOM,
    maxBytes: env.VOICE_MAX_MB * 1024 * 1024,
  },
  features: {
    // Zona waktu untuk jam di prompt sambutan & statistik dashboard.
    timeZone: 'Asia/Jakarta',
    autoMemory: env.AUTO_MEMORY,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    maxInputChars: env.MAX_INPUT_CHARS,
    adminOnlyRooms: env.ADMIN_ONLY_ROOMS,
  },
  ids: {
    modLogChannel: env.MODLOG_CHANNEL_ID,
    staffRole: env.STAFF_ROLE_ID,
  },
  isDev: Boolean(env.GUILD_ID),
} as const;

export type Config = typeof config;
