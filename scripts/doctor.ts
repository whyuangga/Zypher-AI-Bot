/**
 * Cek kesehatan konfigurasi AI: apakah setiap provider benar-benar menjawab?
 *
 * Untuk tiap provider di rantai (utama + fallback), skrip ini:
 *   1. mengirim satu request chat pendek (non-streaming)
 *   2. menguji streaming (membaca chunk pertama)
 *   3. melaporkan latensi atau alasan gagal
 *
 * Pakai:
 *   npm run doctor
 *
 * Tidak butuh token Discord.
 */
import 'dotenv/config';
import OpenAI from 'openai';
import {
  KNOWN_PROVIDERS,
  parseFallbackSpec,
  providerNameForBaseUrl,
  type ProviderTarget,
} from '../src/lib/provider-catalog.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

interface CheckResult {
  chat: { ok: boolean; ms: number; detail: string };
  stream: { ok: boolean; ms: number; detail: string };
}

function buildChain(): { chain: ProviderTarget[]; problems: string[] } {
  const problems: string[] = [];
  const baseUrl = (process.env.AI_BASE_URL?.trim() || KNOWN_PROVIDERS.groq?.baseUrl || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim() || 'openai/gpt-oss-120b';

  if (!baseUrl || !apiKey) {
    return { chain: [], problems: ['AI_BASE_URL / AI_API_KEY belum diisi — provider utama tidak bisa diuji.'] };
  }

  const primary: ProviderTarget = { name: providerNameForBaseUrl(baseUrl), baseUrl, apiKey, model };

  const parsed = parseFallbackSpec(process.env.AI_FALLBACKS, {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
  }, primary);

  return { chain: [primary, ...parsed.providers], problems: [...problems, ...parsed.problems] };
}

const clientFor = (provider: ProviderTarget): OpenAI =>
  new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl, timeout: 25_000, maxRetries: 0 });

function explain(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === 401 || status === 403) return `key ditolak (${status}) — cek API key provider ini`;
    if (status === 402) return 'kredit/kuota habis (402)';
    if (status === 404) return 'model tidak ditemukan (404) — jalankan `npm run models`';
    if (status === 429) return 'rate limit (429) — coba lagi sebentar';
    return `HTTP ${status}: ${error.message.slice(0, 120)}`;
  }
  if (error instanceof OpenAI.APIConnectionError) return 'tidak bisa terhubung — cek jaringan/base URL';
  if (error instanceof Error) return error.message.slice(0, 140);
  return String(error).slice(0, 140);
}

async function checkProvider(provider: ProviderTarget): Promise<CheckResult> {
  const client = clientFor(provider);

  // 1. Chat biasa
  const chatStarted = Date.now();
  let chat: CheckResult['chat'];
  try {
    const response = await client.chat.completions.create({
      model: provider.model,
      messages: [{ role: 'user', content: 'Balas dengan satu kata: ok' }],
      max_tokens: 16,
      temperature: 0,
    });
    const content = response.choices[0]?.message?.content?.trim() ?? '';
    chat = { ok: true, ms: Date.now() - chatStarted, detail: content.slice(0, 40) || '(kosong)' };
  } catch (error) {
    chat = { ok: false, ms: Date.now() - chatStarted, detail: explain(error) };
  }

  // 2. Streaming (cukup baca chunk pertama)
  const streamStarted = Date.now();
  let stream: CheckResult['stream'];
  try {
    const iterable = await client.chat.completions.create({
      model: provider.model,
      messages: [{ role: 'user', content: 'Hitung 1 sampai 3, satu baris.' }],
      max_tokens: 32,
      temperature: 0,
      stream: true,
    });

    let received = '';
    for await (const chunk of iterable) {
      received += chunk.choices[0]?.delta?.content ?? '';
      if (received.length > 0) break;
    }

    stream = received
      ? { ok: true, ms: Date.now() - streamStarted, detail: `chunk pertama "${received.slice(0, 20)}"` }
      : { ok: false, ms: Date.now() - streamStarted, detail: 'stream tidak mengirim teks' };
  } catch (error) {
    stream = { ok: false, ms: Date.now() - streamStarted, detail: explain(error) };
  }

  return { chat, stream };
}

async function main(): Promise<void> {
  const { chain, problems } = buildChain();

  console.log(`\n${BOLD}🩺 Pemeriksaan provider AI${RESET}`);
  console.log(`${DIM}Menguji request sungguhan (chat + streaming) ke setiap provider di rantai.${RESET}\n`);

  for (const problem of problems) console.log(`${YELLOW}⚠️  ${problem}${RESET}`);
  if (problems.length > 0) console.log('');

  if (chain.length === 0) {
    console.log(`${RED}Tidak ada provider yang bisa diuji.${RESET} Isi AI_API_KEY di .env terlebih dahulu.\n`);
    process.exitCode = 1;
    return;
  }

  let working = 0;
  let primaryOk = false;

  for (const [index, provider] of chain.entries()) {
    const role = index === 0 ? 'utama' : `fallback ${index}`;
    console.log(`${BOLD}${provider.name}${RESET} ${DIM}(${role})${RESET} · ${provider.model}`);

    const result = await checkProvider(provider);

    if (result.chat.ok) {
      working += 1;
      if (index === 0) primaryOk = true;
      console.log(`  ${GREEN}✅ chat${RESET}   ${result.chat.ms} ms ${DIM}→ ${result.chat.detail}${RESET}`);

      console.log(
        result.stream.ok
          ? `  ${GREEN}✅ stream${RESET} ${result.stream.ms} ms ${DIM}→ ${result.stream.detail}${RESET}`
          : `  ${YELLOW}⚠️  stream${RESET} ${result.stream.ms} ms ${DIM}→ ${result.stream.detail} (bot akan pakai mode non-streaming)${RESET}`,
      );
    } else {
      console.log(`  ${RED}❌ chat${RESET}  ${result.chat.ms} ms ${DIM}→ ${result.chat.detail}${RESET}`);
      console.log(`  ${DIM}   streaming tidak diuji karena chat gagal.${RESET}`);
    }

    console.log('');
  }

  console.log(`${DIM}────────────────────────────────────────${RESET}`);
  if (working === 0) {
    console.log(`${RED}✖ Tidak ada provider yang menjawab.${RESET} Periksa API key / kuota / nama model.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`${GREEN}✓ ${working} dari ${chain.length} provider merespons.${RESET}`);
  printFeatureStatus();
  if (!primaryOk) {
    console.log(`${YELLOW}Provider utama gagal — bot masih bisa jalan lewat fallback, tapi perbaiki key utamanya.${RESET}`);

    const hints = [
      'Key salah/kedaluwarsa? buat ulang di console provider.',
      'Model tidak ada? jalankan `npm run models` untuk ID yang valid.',
      'Kuota habis? tunggu reset harian atau andalkan provider berikutnya.',
    ];
    for (const hint of hints) console.log(`${DIM}  • ${hint}${RESET}`);
  }
  console.log('');
}

/** Ringkasan fitur opsional — tidak memanggil API, jadi aman walau kuota habis. */
function printFeatureStatus(): void {
  const on = (key: string, fallback = false): boolean => {
    const raw = process.env[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on', 'ya'].includes(raw);
  };
  const text = (key: string, fallback: string): string => process.env[key]?.trim() || fallback;

  const rows: Array<[string, string, string]> = [
    [
      'Moderasi',
      `${on('MODERATION_ENABLED') ? `${GREEN}aktif${RESET}` : `${DIM}mati${RESET}`} ${DIM}(dashboard: /moderasi)${RESET}`,
      on('MODERATION_ENABLED')
        ? `${DIM}${text('MODERATION_WORDS', '(daftar kosong — isi dulu!)')} · ${text('MODERATION_ACTION', 'delete')}${RESET}`
        : `${DIM}MODERATION_ENABLED=false${RESET}`,
    ],
    [
      'Vision',
      `${on('VISION_ENABLED') ? `${GREEN}aktif${RESET}` : `${DIM}mati${RESET}`}`,
      `${DIM}model ${text('VISION_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct')}${RESET}`,
    ],
    [
      'Voice',
      `${on('VOICE_ENABLED') ? `${GREEN}STT aktif${RESET}` : `${DIM}STT mati${RESET}`} ${DIM}·${RESET} ${
        on('TTS_ENABLED', true) ? `${GREEN}TTS aktif${RESET}` : `${DIM}TTS mati${RESET}`
      }`,
      `${DIM}${text('STT_MODEL', 'whisper-large-v3')} · ${text('TTS_MODEL', 'playai-tts')} / ${text('TTS_VOICE', 'Fritz-PlayAI')}${RESET}`,
    ],
  ];

  console.log(`\n${BOLD}🧩 Fitur opsional${RESET}`);
  for (const [label, status, detail] of rows) {
    console.log(`  ${label.padEnd(9)} ${status}  ${detail}`);
  }
  console.log(`${DIM}  STT/TTS memakai endpoint audio provider utama; pastikan modelnya ada di provider itu.${RESET}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
