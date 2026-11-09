/**
 * Tampilkan daftar model yang benar-benar tersedia di provider kamu (dari endpoint /models).
 * Jauh lebih akurat daripada daftar model di blog/dokumentasi yang cepat usang.
 *
 * Pakai:
 *   npm run models              # semua provider yang key-nya terisi di .env
 *   npm run models -- gemini    # satu provider saja
 *
 * Tidak butuh token Discord.
 */
import 'dotenv/config';
import { KNOWN_PROVIDERS } from '../src/lib/provider-catalog.js';

interface Target {
  key: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  currentModels: string[];
}

interface RemoteModel {
  id: string;
  context?: number;
  free?: boolean;
}

const RESET = '\x1b[0m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

const only = process.argv.slice(2).find((arg) => !arg.startsWith('-'))?.toLowerCase();

function buildTargets(): Target[] {
  const targets = new Map<string, Target>();

  const primaryBaseUrl = (process.env.AI_BASE_URL || KNOWN_PROVIDERS.groq?.baseUrl || '').replace(/\/+$/, '');
  const primaryKey = process.env.AI_API_KEY?.trim();

  if (primaryBaseUrl && primaryKey) {
    targets.set(primaryBaseUrl, {
      key: primaryBaseUrl,
      name: `${primaryBaseUrl.includes('127.0.0.1') || primaryBaseUrl.includes('localhost') ? 'custom' : new URL(primaryBaseUrl).hostname}`,
      baseUrl: primaryBaseUrl,
      apiKey: primaryKey,
      currentModels: [process.env.AI_MODEL?.trim()].filter((value): value is string => Boolean(value)),
    });
  }

  for (const rawEntry of (process.env.AI_FALLBACKS ?? '').split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const separator = entry.indexOf(':');
    if (separator <= 0) continue;

    const name = entry.slice(0, separator).trim().toLowerCase();
    const model = entry.slice(separator + 1).trim();
    const spec = KNOWN_PROVIDERS[name];
    if (!spec) continue;

    const apiKey = process.env[spec.keyEnv]?.trim() || spec.defaultKey;
    if (!apiKey) continue;

    const baseUrl = spec.baseUrl.replace(/\/+$/, '');
    const existing = targets.get(baseUrl);
    if (existing) {
      if (model) existing.currentModels.push(model);
      continue;
    }

    targets.set(baseUrl, {
      key: baseUrl,
      name,
      baseUrl,
      apiKey,
      currentModels: model ? [model] : [],
    });
  }

  return [...targets.values()];
}

/** Buang model yang jelas bukan untuk chat (audio/embedding/image). */
function isChatModel(id: string): boolean {
  return !/whisper|tts|embed|rerank|image|video|guard|moderation|safeguard/i.test(id);
}

async function fetchModels(target: Target): Promise<RemoteModel[]> {
  const response = await fetch(`${target.baseUrl}/models`, {
    headers: { authorization: `Bearer ${target.apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { data?: unknown[] } | unknown[];
  const rows = Array.isArray(payload) ? payload : (payload.data ?? []);

  return rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      const pricing = record.pricing as { prompt?: string; completion?: string } | undefined;
      const promptPrice = Number(pricing?.prompt ?? 0);
      const completionPrice = Number(pricing?.completion ?? 0);

      return {
        id: String(record.id ?? record.name ?? '(tanpa id)'),
        context: Number(record.context_length ?? record.context_window ?? record.context ?? 0) || undefined,
        free: pricing ? promptPrice === 0 && completionPrice === 0 : undefined,
      } satisfies RemoteModel;
    })
    .filter((model) => model.id !== '(tanpa id)');
}

function formatContext(context?: number): string {
  if (!context) return '';
  if (context >= 1000) return `${Math.round(context / 1000)}K konteks`;
  return `${context} konteks`;
}

async function main(): Promise<void> {
  const targets = buildTargets().filter((target) => !only || target.name === only);

  console.log(`\n${BOLD}🔎 Model yang tersedia di provider kamu${RESET}`);
  console.log(`${DIM}Sumber: endpoint /models milik provider. Daftar model gratis bisa berubah kapan saja.${RESET}\n`);

  if (targets.length === 0) {
    console.log(`${YELLOW}Tidak ada provider yang bisa dicek.${RESET}`);
    console.log('Isi AI_API_KEY (provider utama) dan/atau API key provider fallback di .env.\n');
    console.log('Saran model per provider (dari katalog bawaan):');
    for (const [name, spec] of Object.entries(KNOWN_PROVIDERS)) {
      console.log(`  ${CYAN}${name}${RESET}: ${spec.suggestedModels.join(', ')}`);
    }
    console.log('');
    return;
  }

  let anyFailed = false;

  for (const target of targets) {
    console.log(`${BOLD}${target.name}${RESET} ${DIM}${target.baseUrl}${RESET}`);

    try {
      const models = await fetchModels(target);
      const filtered = models.filter((model) => isChatModel(model.id));

      // OpenRouter mengembalikan seluruh katalog; tampilkan yang gratis saja.
      const visible =
        target.name === 'openrouter' && filtered.some((model) => model.free !== undefined)
          ? filtered.filter((model) => model.free)
          : filtered;

      if (visible.length === 0) {
        console.log(`  ${YELLOW}(tidak ada model chat yang terdeteksi)${RESET}\n`);
        continue;
      }

      visible.sort((a, b) => a.id.localeCompare(b.id));

      for (const model of visible) {
        const isCurrent = target.currentModels.includes(model.id);
        const marker = isCurrent ? `${GREEN}●${RESET}` : ' ';
        const badge = isCurrent ? ` ${GREEN}← dipakai bot${RESET}` : '';
        const context = formatContext(model.context);
        console.log(`  ${marker} ${model.id}${badge}${context ? ` ${DIM}(${context})${RESET}` : ''}`);
      }

      console.log(`  ${DIM}${visible.length} model${target.name === 'openrouter' ? ' gratis' : ''}${RESET}\n`);
    } catch (error) {
      anyFailed = true;
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`  ${RED}✖ gagal mengambil daftar${RESET} ${DIM}(${reason})${RESET}`);

      const spec = KNOWN_PROVIDERS[target.name];
      if (spec) {
        console.log(`  Saran model: ${spec.suggestedModels.join(', ')}`);
        console.log(`  Dokumentasi: ${spec.docsUrl}`);
      }
      console.log(`${DIM}  Cek manual: key valid? provider sedang down?${RESET}\n`);
    }
  }

  console.log(`${DIM}Tips: pasang model yang muncul di atas ke AI_MODEL atau AI_FALLBACKS=nama:model.${RESET}`);
  if (anyFailed) console.log(`${DIM}Sebagian provider gagal dicek — lihat pesan di atas.${RESET}`);
  console.log('');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
