import type { Message } from 'discord.js';
import { handleDmMessage } from '../features/dm.js';
import { moderateMessage } from '../features/moderation.js';
import { errorMessage, logger } from '../lib/logger.js';
import { ownsGuild } from '../lib/shard.js';

export async function onMessageCreate(message: Message): Promise<void> {
  try {
    // ---- DM: percakapan AI privat (tidak ada channel, tidak bisa dibaca admin) ----
    if (!message.inGuild()) {
      await handleDmMessage(message);
      return;
    }

    // Multi-shard: instance ini hanya menangani server yang jadi porsinya.
    if (!ownsGuild(message.guildId)) return;

    // Moderasi berjalan untuk semua channel teks di server. AI tidak lagi
    // menjawab di channel/thread server — percakapan hanya lewat DM.
    await moderateMessage(message);
  } catch (error) {
    logger.error('Error pada messageCreate', errorMessage(error));
  }
}
