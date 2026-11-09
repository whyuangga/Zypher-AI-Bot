import type { Message } from 'discord.js';
import { handleRoomMessage } from '../features/chat.js';
import { errorMessage, logger } from '../lib/logger.js';

export async function onMessageCreate(message: Message): Promise<void> {
  try {
    await handleRoomMessage(message);
  } catch (error) {
    logger.error('Error pada messageCreate', errorMessage(error));
  }
}
