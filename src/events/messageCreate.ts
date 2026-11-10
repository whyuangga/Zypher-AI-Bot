import type { Message } from 'discord.js';
import { handleRoomMessage } from '../features/chat.js';
import { moderateMessage } from '../features/moderation.js';
import { errorMessage, logger } from '../lib/logger.js';
import { ownsGuild } from '../lib/shard.js';

export async function onMessageCreate(message: Message): Promise<void> {
  try {
    // Multi-shard: instance ini hanya menangani server yang jadi porsinya.
    if (!ownsGuild(message.guildId)) return;

    // Moderasi berjalan untuk semua channel teks di server, sebelum AI menjawab.
    const blocked = await moderateMessage(message);
    if (blocked) return;

    await handleRoomMessage(message);
  } catch (error) {
    logger.error('Error pada messageCreate', errorMessage(error));
  }
}
