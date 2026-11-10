import type { Message } from 'discord.js';
import { handleRoomMessage } from '../features/chat.js';
import { moderateMessage } from '../features/moderation.js';
import { errorMessage, logger } from '../lib/logger.js';

export async function onMessageCreate(message: Message): Promise<void> {
  try {
    // Moderasi berjalan untuk semua channel teks di server, sebelum AI menjawab.
    const blocked = await moderateMessage(message);
    if (blocked) return;

    await handleRoomMessage(message);
  } catch (error) {
    logger.error('Error pada messageCreate', errorMessage(error));
  }
}
