import { addMemory, clearMemories, deleteMemory, listMemories, type Memory } from '../db/repo.js';
import { chat } from '../lib/llm.js';
import type { ChatTool } from '../lib/llm.js';
import { logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';

export interface MemoryContext {
  guildId: string;
  userId: string;
}

/**
 * Tool yang boleh dipanggil model untuk mengelola memori jangka panjang.
 * Model hanya diberi tool ini kalau AUTO_MEMORY=true.
 */
export const memoryTools: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'simpan_memori',
      description:
        'Simpan satu fakta jangka panjang tentang user (nama, minat, pekerjaan, preferensi, keluhan, hal penting). ' +
        'Panggil HANYA jika user menyebutkan informasi pribadi yang berguna di percakapan berikutnya. ' +
        'Jangan simpan obrolan basa-basi, pertanyaan, atau informasi tentang orang lain.',
      parameters: {
        type: 'object',
        properties: {
          fakta: {
            type: 'string',
            description:
              'Satu fakta ringkas dalam bahasa Indonesia, gaya orang ketiga. Contoh: "Namanya Bagas, bekerja sebagai desainer grafis."',
          },
        },
        required: ['fakta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hapus_memori',
      description: 'Hapus satu fakta yang sudah tersimpan jika user meminta dilupakan atau jika informasinya terbukti salah.',
      parameters: {
        type: 'object',
        properties: {
          fakta: { type: 'string', description: 'Teks fakta yang ingin dihapus, salin mendekati aslinya.' },
        },
        required: ['fakta'],
        additionalProperties: false,
      },
    },
  },
];

/** Ambil memori user, urut terbaru, dibatasi supaya prompt tetap ringkas. */
export async function getMemories(context: MemoryContext, limit = 40): Promise<Memory[]> {
  return listMemories(context.guildId, context.userId, limit);
}

export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return '(belum ada yang kamu ingat tentang user ini)';
  return memories
    .slice()
    .reverse()
    .map((memory) => `- ${truncate(memory.content, 220)}`)
    .join('\n');
}

interface ToolCallContext extends MemoryContext {
  source?: 'manual' | 'auto';
}

/** Eksekusi tool memory, kembalikan hasil sebagai teks untuk model. */
export async function runMemoryTool(name: string, rawArguments: string, context: ToolCallContext): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
  } catch {
    return 'Gagal membaca argumen tool: JSON tidak valid.';
  }

  const fakta = typeof args.fakta === 'string' ? args.fakta.trim() : '';

  if (name === 'simpan_memori') {
    if (!fakta) return 'Tidak ada fakta yang bisa disimpan.';
    const result = await addMemory(context.guildId, context.userId, truncate(fakta, 400), context.source ?? 'auto');
    if (result.inserted) {
      logger.info(`Memori baru disimpan untuk user ${context.userId}`);
      return 'Tersimpan.';
    }
    return 'Fakta ini sudah pernah tersimpan, jadi tidak diduplikasi.';
  }

  if (name === 'hapus_memori') {
    if (!fakta) return 'Tidak ada fakta yang disebutkan untuk dihapus.';
    const memories = await listMemories(context.guildId, context.userId, 200);
    const target = memories.find((memory) => memory.content.toLowerCase().includes(fakta.toLowerCase()));
    if (!target) return 'Tidak menemukan memori yang cocok untuk dihapus.';
    await deleteMemory(context.guildId, context.userId, target.id);
    return `Terhapus: ${target.content}`;
  }

  return `Tool "${name}" tidak dikenal.`;
}


/* ------------------------------------------------------------------ */
/*  Konsolidasi memori                                                  */
/* ------------------------------------------------------------------ */

export interface ConsolidateResult {
  before: number;
  after: number;
  removed: number;
  /** Fakta yang dipertahankan/digabung setelah konsolidasi. */
  kept: string[];
  /** Mengapa tidak dikonversi (jika terlalu sedikit atau AI gagal). */
  skipped?: string;
}

/**
 * AI meninjau semua memori user, menggabungkan fakta yang berulang,
 * dan membuang yang tidak berguna (obrolan basi, asumsi tak jelas).
 *
 * Keamanan: memori lama dihapus hanya jika AI mengembalikan hasil valid
 * dengan minimal 1 fakta — jadi konsolidasi yang gagal tidak menghapus apa pun.
 */
export async function consolidateMemories(guildId: string, userId: string): Promise<ConsolidateResult> {
  const memories = await listMemories(guildId, userId, 100);

  if (memories.length < 8) {
    return {
      before: memories.length,
      after: memories.length,
      removed: 0,
      kept: memories.map((memory) => memory.content),
      skipped: 'Memori masih sedikit — konsolidasi tidak perlu.',
    };
  }

  const list = memories
    .map((memory, index) => `${index + 1}. ${memory.content}`)
    .join('\n');

  const systemPrompt = `Kamu mengorganisir memori jangka panjang seorang user di Discord.
Tugas: tinjau daftar memori di bawah, lalu:
- GABUNG fakta yang sama/berulang menjadi satu fakta yang lebih ringkas
- HAPUS obrolan basi, asumsi yang tidak jelas, atau fakta yang tidak berguna untuk percakapan nanti
- PERtahankan fakta penting (nama, preferensi, pekerjaan, keluhan, tanggal penting)

Kembalikan JSON array string — HANYA JSON, tanpa penjelasan:
["fakta 1", "fakta 2", ...]
Batas: maksimal 25 fakta. Jangan menambahkan fakta baru yang tidak ada di daftar.`;

  try {
    const result = await chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Daftar memori user:\n${list}` },
      ],
    });

    const raw = (result.message.content ?? '').trim();
    const kept = parseConsolidatedMemories(raw);

    if (kept.length === 0) {
      return {
        before: memories.length,
        after: memories.length,
        removed: 0,
        kept: memories.map((memory) => memory.content),
        skipped: 'AI tidak mengembalikan hasil yang valid — memori tetap utuh.',
      };
    }

    // Hapus semua memori lama, lalu simpan yang baru (dedupe otomatis lewat addMemory).
    const removed = await clearMemories(guildId, userId);
    for (const fact of kept) {
      await addMemory(guildId, userId, truncate(fact, 400), 'manual');
    }

    return {
      before: memories.length,
      after: memories.length,
      removed,
      kept,
    };
  } catch (error) {
    logger.warn('Konsolidasi memori gagal', error instanceof Error ? error.message : String(error));
    return {
      before: memories.length,
      after: memories.length,
      removed: 0,
      kept: memories.map((memory) => memory.content),
      skipped: 'Gagal menghubungi AI — memori tetap utuh.',
    };
  }
}

/** Ubah output AI (JSON atau daftar bullet) jadi array fakta bersih. */
export function parseConsolidatedMemories(raw: string): string[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: baris-baris bullet (mis. model tidak mengikuti format JSON).
    const lines = cleaned
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((line) => line.length > 0);
    return lines.slice(0, 25);
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 25);
}
