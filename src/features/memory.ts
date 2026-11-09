import { addMemory, deleteMemory, listMemories, type Memory } from '../db/repo.js';
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
export function getMemories(context: MemoryContext, limit = 40): Memory[] {
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
export function runMemoryTool(name: string, rawArguments: string, context: ToolCallContext): string {
  let args: Record<string, unknown> = {};
  try {
    args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
  } catch {
    return 'Gagal membaca argumen tool: JSON tidak valid.';
  }

  const fakta = typeof args.fakta === 'string' ? args.fakta.trim() : '';

  if (name === 'simpan_memori') {
    if (!fakta) return 'Tidak ada fakta yang bisa disimpan.';
    const result = addMemory(context.guildId, context.userId, truncate(fakta, 400), context.source ?? 'auto');
    if (result.inserted) {
      logger.info(`Memori baru disimpan untuk user ${context.userId}`);
      return 'Tersimpan.';
    }
    return 'Fakta ini sudah pernah tersimpan, jadi tidak diduplikasi.';
  }

  if (name === 'hapus_memori') {
    if (!fakta) return 'Tidak ada fakta yang disebutkan untuk dihapus.';
    const memories = listMemories(context.guildId, context.userId, 200);
    const target = memories.find((memory) => memory.content.toLowerCase().includes(fakta.toLowerCase()));
    if (!target) return 'Tidak menemukan memori yang cocok untuk dihapus.';
    deleteMemory(context.guildId, context.userId, target.id);
    return `Terhapus: ${target.content}`;
  }

  return `Tool "${name}" tidak dikenal.`;
}
